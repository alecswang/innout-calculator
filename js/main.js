/* Bootstrap: load data + models, wire UI <-> 3D tray scene. */

import { Stage } from "./scene.js";
import { loadAll } from "./models.js";
import { TrayScene } from "./food.js";
import { UI } from "./ui.js";
import { orderTotals, runSelfTest } from "./nutrition.js";

let DATA = null;
let order = [];
let nextId = 1;
let selectedId = null;

let stage, tray, ui;

function save() {
  try { localStorage.setItem("inout3d-order", JSON.stringify({ order, nextId })); } catch {}
}
function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem("inout3d-order"));
    if (s && Array.isArray(s.order)) return s;
  } catch {}
  return null;
}

function refresh({ cinematicId = null } = {}) {
  tray.sync(order, DATA, { cinematicId });
  ui.renderTotals(orderTotals(DATA, order));
  ui.renderOrder(order, selectedId);
  ui.renderDrawer(order.find((l) => l.id === selectedId) || null);
  save();
}

function select(id, opts) {
  selectedId = id;
  tray.select(id, opts);
  ui.renderOrder(order, selectedId);
  ui.renderDrawer(order.find((l) => l.id === selectedId) || null);
}

const handlers = {
  addPreset(key) {
    const p = DATA.presets[key];
    const line = { id: nextId++, kind: "food", cat: p.cat, preset: key, items: { ...p.items }, salt: "regular" };
    if (p.cat === "fries") line.cook = "Regular";
    order.push(line);
    refresh({ cinematicId: line.id });
    select(line.id, { focus: false });
    tray.cinematicFocus(line.id);
  },
  addExtra(key) {
    const line = { id: nextId++, kind: "extra", key };
    order.push(line);
    refresh();
  },
  addSide(key) {
    const line = { id: nextId++, kind: "side", key };
    order.push(line);
    refresh();
  },
  removeLine(id) {
    order = order.filter((l) => l.id !== id);
    if (selectedId === id) select(null);
    refresh();
  },
  select(id) { select(id); },
  change() { refresh(); },
  clear() {
    order = [];
    select(null);
    refresh();
  },
};

async function boot() {
  const res = await fetch("data.json");
  DATA = await res.json();

  stage = new Stage(document.getElementById("stage"));
  await loadAll((p) => {
    document.getElementById("loaderFill").style.width = Math.round(p * 100) + "%";
  });

  tray = new TrayScene(stage);
  ui = new UI(DATA, handlers);
  window.__dbg = { stage, tray };

  const saved = loadSaved();
  if (saved) ({ order, nextId } = saved);
  refresh();
  runSelfTest(DATA);

  document.getElementById("loader").classList.add("done");

  // click food on the tray to select & edit it
  let downAt = null;
  const canvas = document.getElementById("stage");
  canvas.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY, Date.now()]; });
  canvas.addEventListener("pointerup", (e) => {
    if (!downAt) return;
    const [x, y, t] = downAt;
    downAt = null;
    if (Math.hypot(e.clientX - x, e.clientY - y) > 6 || Date.now() - t > 400) return; // it was a drag
    select(tray.pick(e.clientX, e.clientY));
  });

  setTimeout(() => document.getElementById("hint")?.classList.add("gone"), 9000);

  (function loop() {
    requestAnimationFrame(loop);
    const dt = stage.update();
    tray.update(dt);
  })();
}

boot().catch((e) => {
  console.error(e);
  document.querySelector(".loader-text").textContent =
    "failed to load — serve over http (python3 -m http.server)";
});
