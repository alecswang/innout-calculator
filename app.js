/* In-N-Out Nutrition Builder — all client-side, zero deps */

const MACROS = ["cal", "fat", "carb", "protein", "sodium"];

let DATA = null;
let order = []; // food: {id,kind:'food',cat,preset,items,salt,cook} | extra: {id,kind:'extra',key}
let nextId = 1;
let editingId = null;

/* ---------- load ---------- */
fetch("data.json")
  .then((r) => r.json())
  .then((d) => {
    DATA = d;
    const saved = loadSaved();
    if (saved) ({ order, nextId } = saved);
    renderPresets();
    renderExtras();
    renderSides();
    renderAll();
    runSelfTest();
  })
  .catch((e) => {
    document.getElementById("order").textContent =
      "Could not load data.json — serve over http (python3 -m http.server).";
    console.error(e);
  });

/* ---------- helpers ---------- */
const comp = (k) => DATA.components[k];
const lineById = (id) => order.find((l) => l.id === id);
const isProteinStyle = (line) => (line.items.wrap || 0) > 0;
const saltMult = (salt) => (DATA.salt[salt] ? DATA.salt[salt].mult : 1);

function sumComponents(items, salt) {
  const mult = saltMult(salt || "regular");
  const t = { cal: 0, fat: 0, carb: 0, protein: 0, sodium: 0 };
  for (const [k, n] of Object.entries(items)) {
    const c = comp(k);
    if (!c) continue;
    for (const m of MACROS) t[m] += m === "sodium" ? c[m] * n * mult : c[m] * n;
  }
  return t;
}
function lineTotals(line) {
  if (line.kind === "food") return sumComponents(line.items, line.salt);
  const src = line.kind === "side" ? comp(line.key) : DATA.extras[line.key];
  return { cal: src.cal, fat: src.fat, carb: src.carb, protein: src.protein, sodium: src.sodium };
}
function orderTotals() {
  const t = { cal: 0, fat: 0, carb: 0, protein: 0, sodium: 0 };
  for (const line of order) { const lt = lineTotals(line); for (const m of MACROS) t[m] += lt[m]; }
  for (const m of MACROS) t[m] = Math.round(t[m]);
  return t;
}
function foodName(line) {
  const p = DATA.presets[line.preset];
  let n = p ? p.name : "Custom";
  if (line.cat === "burger" && isProteinStyle(line) && !n.includes("Protein")) n += " · Protein Style";
  if (line.cat === "fries" && line.cook && line.cook !== "Regular") n += " · " + line.cook;
  if (line.salt && line.salt !== "regular") n += " · " + DATA.salt[line.salt].name;
  return n;
}

/* ---------- left: add items ---------- */
function renderPresets() {
  const burgers = document.getElementById("burgers");
  const fries = document.getElementById("fries");
  burgers.innerHTML = ""; fries.innerHTML = "";
  for (const [key, p] of Object.entries(DATA.presets)) {
    const b = document.createElement("button");
    b.className = "preset";
    b.textContent = "+ " + p.name;
    b.onclick = () => {
      const line = { id: nextId++, kind: "food", cat: p.cat, preset: key, items: { ...p.items }, salt: "regular" };
      if (p.cat === "fries") line.cook = "Regular";
      order.push(line);
      pulse(b);
      renderAll(); save();
    };
    (p.cat === "fries" ? fries : burgers).appendChild(b);
  }
}
function renderExtras() {
  const wrap = document.getElementById("extras");
  wrap.innerHTML = "";
  for (const [key, e] of Object.entries(DATA.extras)) {
    const div = document.createElement("button");
    div.className = "extra"; div.type = "button";
    div.innerHTML = `<span>+ ${e.name}</span><span class="ecal">${e.cal} cal</span>`;
    div.onclick = () => { order.push({ id: nextId++, kind: "extra", key }); pulse(div); renderAll(); save(); };
    wrap.appendChild(div);
  }
}

function renderSides() {
  const wrap = document.getElementById("sides");
  wrap.innerHTML = "";
  for (const key of DATA.sides || []) {
    const c = comp(key);
    const div = document.createElement("button");
    div.className = "extra"; div.type = "button";
    const est = c.estimated ? " ~" : "";
    div.innerHTML = `<span>+ Side of ${c.name}${est}</span><span class="ecal">${c.cal} cal</span>`;
    div.onclick = () => { order.push({ id: nextId++, kind: "side", key }); pulse(div); renderAll(); save(); };
    wrap.appendChild(div);
  }
}

function pulse(el) {
  el.classList.remove("pulse");
  void el.offsetWidth; // restart animation
  el.classList.add("pulse");
  el.addEventListener("animationend", () => el.classList.remove("pulse"), { once: true });
}

/* ---------- right: order total + list ---------- */
function renderAll() {
  const t = orderTotals();
  document.getElementById("calTotal").textContent = t.cal;
  document.getElementById("fatTotal").textContent = t.fat + "g";
  document.getElementById("carbTotal").textContent = t.carb + "g";
  document.getElementById("proTotal").textContent = t.protein + "g";
  document.getElementById("sodiumTotal").textContent = t.sodium + "mg";

  const ring = document.getElementById("macroRing");
  const fc = t.fat * 9, cc = t.carb * 4, pc = t.protein * 4;
  const sum = fc + cc + pc;
  if (sum === 0) {
    ring.classList.add("empty");
    ring.style.background = "";
  } else {
    ring.classList.remove("empty");
    const a = (fc / sum) * 100, bb = a + (cc / sum) * 100;
    ring.style.background =
      `conic-gradient(var(--fat) 0 ${a}%, var(--carb) 0 ${bb}%, var(--pro) 0 100%)`;
  }

  // mobile bar
  const n = order.length;
  document.getElementById("barCount").textContent = n + (n === 1 ? " item" : " items");
  document.getElementById("barCal").textContent = t.cal + " cal";

  renderOrderList();
  if (editingId != null) renderModal();
}

/* ---------- mobile cart sheet ---------- */
function openCart() {
  document.querySelector(".nutrition-panel").classList.add("open");
  document.getElementById("cartBar").classList.add("open");
  document.getElementById("cartBackdrop").hidden = false;
}
function closeCart() {
  document.querySelector(".nutrition-panel").classList.remove("open");
  document.getElementById("cartBar").classList.remove("open");
  document.getElementById("cartBackdrop").hidden = true;
}
document.getElementById("cartBar").onclick = openCart;
document.getElementById("cartBackdrop").onclick = closeCart;
document.getElementById("sheetCloseBtn").onclick = closeCart;

function renderOrderList() {
  const ul = document.getElementById("order");
  ul.innerHTML = "";
  if (!order.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Empty — add something from the left.";
    ul.appendChild(li);
    return;
  }
  for (const line of order) {
    const lt = lineTotals(line);
    const name = line.kind === "food" ? foodName(line)
      : line.kind === "side" ? "Side of " + comp(line.key).name
      : DATA.extras[line.key].name;
    const li = document.createElement("li");
    let html = `<span class="oi-name">${name}</span><span class="oi-cal">${Math.round(lt.cal)} cal</span>`;
    if (line.kind === "food") html += `<button class="oi-edit" title="Edit">Edit</button>`;
    html += `<button class="oi-x" title="Remove">×</button>`;
    li.innerHTML = html;
    if (line.kind === "food") li.querySelector(".oi-edit").onclick = () => openModal(line.id);
    li.querySelector(".oi-x").onclick = () => {
      order = order.filter((l) => l.id !== line.id);
      if (editingId === line.id) closeModal();
      renderAll(); save();
    };
    ul.appendChild(li);
  }
}

/* ---------- edit modal ---------- */
function openModal(id) { editingId = id; document.getElementById("modal").hidden = false; renderModal(); }
function closeModal() { editingId = null; document.getElementById("modal").hidden = true; }

function renderModal() {
  const line = lineById(editingId);
  if (!line) return closeModal();

  document.getElementById("modalTitle").textContent = foodName(line);

  renderQuickMods(line);

  renderSegGroup("saltGroup", "Salt", Object.keys(DATA.salt).map((k) => [k, DATA.salt[k].name]),
    line.salt || "regular", (val) => { line.salt = val; renderAll(); save(); });

  const cookG = document.getElementById("cookGroup");
  if (line.cat === "fries") {
    cookG.style.display = "";
    renderSegGroup("cookGroup", "Cook", DATA.cook.map((c) => [c, c]),
      line.cook || "Regular", (val) => { line.cook = val; renderAll(); save(); });
  } else { cookG.style.display = "none"; cookG.innerHTML = ""; }

  // component steppers for this category
  const wrap = document.getElementById("modalBuilder");
  wrap.innerHTML = "";
  for (const key of DATA.builder[line.cat]) {
    const c = comp(key);
    const count = line.items[key] || 0;
    const row = document.createElement("div");
    row.className = "row";
    const info = document.createElement("div");
    info.className = "info";
    const est = c.estimated ? " ~" : "";
    info.innerHTML =
      `<span class="name">${c.name}${est}</span>` +
      `<span class="meta">${c.cal} cal · ${c.fat}f / ${c.carb}c / ${c.protein}p</span>`;
    row.append(info, makeStepper(line, key, count));
    wrap.appendChild(row);
  }
  document.getElementById("modalCal").textContent =
    Math.round(sumComponents(line.items, line.salt).cal) + " cal";
}

// default count for a component = whatever the preset ships with
function defCount(line, key) {
  const p = DATA.presets[line.preset];
  return (p && p.items[key]) || 0;
}
function setItem(line, key, n) {
  if (n <= 0) delete line.items[key];
  else line.items[key] = n;
  renderAll(); save();
}
function addChip(g, label, on, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "seg" + (on ? " on" : "");
  b.textContent = label;
  b.onclick = onClick;
  g.appendChild(b);
}

function renderQuickMods(line) {
  const g = document.getElementById("quickMods");
  g.innerHTML = "";
  const mods = (DATA.mods && DATA.mods[line.cat]) || [];
  for (const m of mods) {
    if (m.mode === "protein") {
      addChip(g, "Protein Style", isProteinStyle(line), () => {
        if (isProteinStyle(line)) { delete line.items.wrap; line.items.bun = 1; }
        else { delete line.items.bun; line.items.wrap = 1; }
        renderAll(); save();
      });
      continue;
    }
    const name = m.label || comp(m.key).name;
    const def = defCount(line, m.key);
    const cur = line.items[m.key] || 0;

    // "Extra X" — active when more than default; tap again returns to default
    if (m.type === "extra" || m.type === "both") {
      addChip(g, "Extra " + name, cur > def,
        () => setItem(line, m.key, cur > def ? def : def + 1));
    }
    // "No X" — only for default-on items; active when zero
    if (m.type === "both") {
      addChip(g, "No " + name, cur === 0,
        () => setItem(line, m.key, cur === 0 ? def : 0));
    }
    // "Add X" — default-off topping toggle
    if (m.type === "add") {
      addChip(g, "Add " + name, cur > 0,
        () => setItem(line, m.key, cur > 0 ? 0 : 1));
    }
  }
}

function renderSegGroup(id, label, opts, current, onPick) {
  const g = document.getElementById(id);
  g.innerHTML = `<span class="seg-label">${label}</span>`;
  const row = document.createElement("div");
  row.className = "seg-row";
  for (const [val, name] of opts) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "seg" + (val === current ? " on" : "");
    b.textContent = name;
    b.onclick = () => onPick(val);
    row.appendChild(b);
  }
  g.appendChild(row);
}

function makeStepper(line, key, count) {
  const s = document.createElement("div");
  s.className = "stepper";
  const minus = document.createElement("button");
  minus.className = "minus"; minus.textContent = "−";
  minus.onclick = () => setCount(line, key, Math.max(0, count - 1));
  const num = document.createElement("span");
  num.className = "count"; num.textContent = count;
  const plus = document.createElement("button");
  plus.textContent = "+";
  plus.onclick = () => setCount(line, key, count + 1); // no limit
  s.append(minus, num, plus);
  return s;
}
function setCount(line, key, n) {
  if (n <= 0) delete line.items[key];
  else line.items[key] = n;
  renderAll(); save();
}

document.getElementById("doneBtn").onclick = closeModal;
document.querySelectorAll("[data-close]").forEach((el) => (el.onclick = closeModal));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeModal(); closeCart(); } });
document.getElementById("resetBtn").onclick = () => { order = []; closeModal(); renderAll(); save(); };

/* ---------- persistence ---------- */
function save() {
  try { localStorage.setItem("inout-order", JSON.stringify({ order, nextId })); } catch {}
}
function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem("inout-order"));
    if (s && Array.isArray(s.order)) return s;
  } catch {}
  return null;
}

/* ---------- closure self-test ---------- */
function runSelfTest() {
  let pass = true;
  for (const [key, exp] of Object.entries(DATA.official)) {
    const p = DATA.presets[key]; if (!p) continue;
    const got = sumComponents(p.items, "regular");
    for (const m of MACROS)
      if (Math.abs(Math.round(got[m]) - exp[m]) > 2) {
        pass = false;
        console.warn(`✗ ${key} ${m}: got ${Math.round(got[m])}, official ${exp[m]}`);
      }
  }
  console.log(pass
    ? "%c✓ closure test passed — base items match official In-N-Out totals (±2)"
    : "%c✗ closure test FAILED",
    `color:${pass ? "green" : "red"};font-weight:bold`);
}
