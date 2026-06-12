/* DOM panels: menu, order list, nutrition totals, mods drawer. */

import { sumComponents, lineTotals, foodName, isProteinStyle } from "./nutrition.js";

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(DATA, handlers) {
    this.DATA = DATA;
    this.h = handlers; // {addPreset, addExtra, addSide, removeLine, select, change, clear}
    this.editingLine = null;

    $("resetBtn").onclick = () => this.h.clear();
    $("drawerClose").onclick = () => this.h.select(null);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.h.select(null);
    });
    for (const pid of ["menuPanel", "orderPanel"]) {
      const panel = $(pid);
      panel.querySelector(".panel-toggle").onclick = () => panel.classList.toggle("open");
    }
    this.renderMenu();
  }

  pulse(el) {
    el.classList.remove("pulse");
    void el.offsetWidth;
    el.classList.add("pulse");
    el.addEventListener("animationend", () => el.classList.remove("pulse"), { once: true });
  }

  renderMenu() {
    const { DATA } = this;
    const burgers = $("burgers"), fries = $("fries");
    for (const [key, p] of Object.entries(DATA.presets)) {
      const b = document.createElement("button");
      b.className = "preset";
      b.textContent = "+ " + p.name;
      b.onclick = () => { this.pulse(b); this.h.addPreset(key); };
      (p.cat === "fries" ? fries : burgers).appendChild(b);
    }
    const extras = $("extras");
    for (const [key, e] of Object.entries(DATA.extras)) {
      const b = document.createElement("button");
      b.className = "extra";
      b.innerHTML = `<span>+ ${e.name}</span><span class="ecal">${e.cal} cal</span>`;
      b.onclick = () => { this.pulse(b); this.h.addExtra(key); };
      extras.appendChild(b);
    }
    const sides = $("sides");
    for (const key of DATA.sides || []) {
      const c = DATA.components[key];
      const b = document.createElement("button");
      b.className = "extra";
      b.innerHTML = `<span>+ Side of ${c.name}${c.estimated ? " ~" : ""}</span><span class="ecal">${c.cal} cal</span>`;
      b.onclick = () => { this.pulse(b); this.h.addSide(key); };
      sides.appendChild(b);
    }
  }

  renderTotals(t) {
    $("calTotal").textContent = t.cal;
    $("fatTotal").textContent = t.fat + "g";
    $("carbTotal").textContent = t.carb + "g";
    $("proTotal").textContent = t.protein + "g";
    $("sodiumTotal").textContent = t.sodium + "mg";
    const ring = $("macroRing");
    const fc = t.fat * 9, cc = t.carb * 4, pc = t.protein * 4;
    const sum = fc + cc + pc;
    if (!sum) {
      ring.classList.add("empty");
      ring.style.background = "";
    } else {
      ring.classList.remove("empty");
      const a = (fc / sum) * 100, b = a + (cc / sum) * 100;
      ring.style.background =
        `conic-gradient(var(--fat) 0 ${a}%, var(--carb) 0 ${b}%, var(--pro) 0 100%)`;
    }
  }

  renderOrder(order, selectedId) {
    const { DATA } = this;
    const ul = $("order");
    ul.innerHTML = "";
    if (!order.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "Tray's empty — add something from the menu.";
      ul.appendChild(li);
      return;
    }
    for (const line of order) {
      const lt = lineTotals(DATA, line);
      const editable = line.kind === "food";
      const name =
        line.kind === "food" ? foodName(DATA, line)
        : line.kind === "side" ? "Side of " + DATA.components[line.key].name
        : DATA.extras[line.key].name;
      const li = document.createElement("li");
      if (line.id === selectedId) li.classList.add("selected");
      li.innerHTML =
        `<span class="oi-name">${name}</span>` +
        `<span class="oi-cal">${Math.round(lt.cal)} cal</span>` +
        (editable
          ? `<button class="oi-edit" title="Customize">✎ edit</button>`
          : `<span class="oi-fixed" title="No modifications for this item"></span>`) +
        `<button class="oi-x" title="Remove">×</button>`;
      li.onclick = () => this.h.select(line.id);
      if (editable) {
        li.querySelector(".oi-edit").onclick = (e) => {
          e.stopPropagation();
          this.h.select(line.id);
        };
      }
      li.querySelector(".oi-x").onclick = (e) => {
        e.stopPropagation();
        this.h.removeLine(line.id);
      };
      ul.appendChild(li);
    }
  }

  /* ---------------- mods drawer ---------------- */

  renderDrawer(line) {
    const drawer = $("drawer");
    this.editingLine = line;
    if (!line || line.kind !== "food") {
      drawer.hidden = true;
      return;
    }
    const { DATA } = this;
    drawer.hidden = false;
    $("drawerTitle").textContent = foodName(DATA, line);
    $("drawerCal").textContent =
      Math.round(sumComponents(DATA, line.items, line.salt).cal) + " cal";

    this.renderQuickMods(line);
    this.renderSeg("saltGroup", "Salt",
      Object.keys(DATA.salt).map((k) => [k, DATA.salt[k].name]),
      line.salt || "regular",
      (val) => { line.salt = val; this.h.change(line); });

    const cookG = $("cookGroup");
    if (line.cat === "fries") {
      cookG.style.display = "";
      this.renderSeg("cookGroup", "Cook", DATA.cook.map((c) => [c, c]),
        line.cook || "Regular",
        (val) => { line.cook = val; this.h.change(line); });
    } else {
      cookG.style.display = "none";
      cookG.innerHTML = "";
    }

    const wrap = $("builderRows");
    wrap.innerHTML = "";
    for (const key of DATA.builder[line.cat]) {
      const c = DATA.components[key];
      const count = line.items[key] || 0;
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML =
        `<div class="info"><span class="name">${c.name}${c.estimated ? " ~" : ""}</span>` +
        `<span class="meta">${c.cal} cal · ${c.fat}f / ${c.carb}c / ${c.protein}p</span></div>`;
      row.appendChild(this.stepper(line, key, count));
      wrap.appendChild(row);
    }
  }

  defCount(line, key) {
    const p = this.DATA.presets[line.preset];
    return (p && p.items[key]) || 0;
  }

  setItem(line, key, n) {
    if (n <= 0) delete line.items[key];
    else line.items[key] = n;
    line._dirty = true;
    this.h.change(line);
  }

  chip(g, label, on, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "seg" + (on ? " on" : "");
    b.textContent = label;
    b.onclick = onClick;
    g.appendChild(b);
  }

  renderQuickMods(line) {
    const { DATA } = this;
    const g = $("quickMods");
    g.innerHTML = "";
    for (const m of (DATA.mods?.[line.cat]) || []) {
      if (m.mode === "protein") {
        this.chip(g, "Protein Style", isProteinStyle(line), () => {
          if (isProteinStyle(line)) { delete line.items.wrap; line.items.bun = 1; }
          else { delete line.items.bun; line.items.wrap = 1; }
          line._dirty = true;
          this.h.change(line);
        });
        continue;
      }
      const name = m.label || DATA.components[m.key].name;
      const def = this.defCount(line, m.key);
      const cur = line.items[m.key] || 0;
      if (m.type === "extra" || m.type === "both")
        this.chip(g, "Extra " + name, cur > def,
          () => this.setItem(line, m.key, cur > def ? def : def + 1));
      if (m.type === "both")
        this.chip(g, "No " + name, cur === 0,
          () => this.setItem(line, m.key, cur === 0 ? def : 0));
      if (m.type === "add")
        this.chip(g, "Add " + name, cur > 0,
          () => this.setItem(line, m.key, cur > 0 ? 0 : 1));
    }
  }

  renderSeg(id, label, opts, current, onPick) {
    const g = $(id);
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

  stepper(line, key, count) {
    const s = document.createElement("div");
    s.className = "stepper";
    const minus = document.createElement("button");
    minus.textContent = "−";
    minus.onclick = () => this.setItem(line, key, Math.max(0, count - 1));
    const num = document.createElement("span");
    num.className = "count";
    num.textContent = count;
    const plus = document.createElement("button");
    plus.textContent = "+";
    plus.onclick = () => this.setItem(line, key, count + 1);
    s.append(minus, num, plus);
    return s;
  }
}
