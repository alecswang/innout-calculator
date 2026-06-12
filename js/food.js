/* 3D food views + the falling-assembly choreography. */

import * as THREE from "three";
import { instance, LAYER, burgerRecipe } from "./models.js";

const G = 9.5;

/* ------------------------------------------------------------ layer stack */

class Layer {
  constructor(key, obj, target) {
    this.key = key;
    this.obj = obj;          // wrapper group, local to the view
    this.target = target;    // resting local y
    this.y = target;
    this.x = 0;              // sideways offset (slide-in insertions)
    this.vel = 0;
    this.state = "idle";     // wait | fall | slide | move | idle | eject
    this.delay = 0;
    this.squash = 0;
    this.bounced = false;
    this.ejectT = 0;
    this.spin = new THREE.Vector3();
  }
}

/* Shared drop/spring/eject physics for any stack of pieces. */
export class LayerStack {
  constructor(group, fx, { massScale = 1 } = {}) {
    this.group = group;
    this.fx = fx;
    this.layers = [];
    this.ejecting = [];
  }

  /* Diff to a new bottom-to-top key list. */
  setLayers(keys, targets, { cinematic = false, makeObj }) {
    const oldByKey = new Map();
    for (const l of this.layers) {
      if (!oldByKey.has(l.key)) oldByKey.set(l.key, []);
      oldByKey.get(l.key).push(l);
    }
    const next = [];
    const isNew = [];
    let added = 0;
    keys.forEach((key, i) => {
      const pool = oldByKey.get(key);
      if (pool && pool.length) {
        const l = pool.shift();
        l.target = targets[i];
        if (l.state === "idle" && Math.abs(l.y - l.target) > 1e-4) l.state = "move";
        next.push(l);
        isNew.push(false);
      } else {
        const obj = makeObj(key);
        this.group.add(obj);
        const l = new Layer(key, obj, targets[i]);
        // cinematic: the whole stack hovers exploded, then collapses bottom-up;
        // single mods drop in from just above the stack
        const drop = cinematic ? 0.55 + i * 0.30 : 1.4 + added * 0.5 + i * 0.1;
        l.y = targets[i] + drop;
        l.state = "wait";
        l.delay = cinematic ? 0.2 + i * 0.07 : 0.05 + added * 0.12;
        l.obj.position.y = l.y;
        added++;
        next.push(l);
        isNew.push(true);
      }
    });
    // a new layer with settled layers ABOVE it can't fall through the stack —
    // it slides in from the side while the stack lifts to make room
    for (let i = 0; i < next.length; i++) {
      if (!isNew[i]) continue;
      const hasOldAbove = isNew.slice(i + 1).some((n) => !n);
      if (!hasOldAbove) continue;
      const l = next[i];
      l.state = "slide";
      l.delay = 0;
      l.x = (Math.random() < 0.5 ? -1 : 1) * 1.8;
      l.y = l.target + 0.16;
      l.obj.position.x = l.x;
      l.obj.position.y = l.y;
    }
    // anything left over flies off the stack
    for (const pool of oldByKey.values())
      for (const l of pool) {
        l.state = "eject";
        l.vel = 3.2;
        l.spin.set((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 7);
        l.dir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
        this.ejecting.push(l);
      }
    this.layers = next;
  }

  worldPos(localY, out) {
    out.set(0, localY, 0);
    return this.group.localToWorld(out);
  }

  update(dt) {
    const tmp = new THREE.Vector3();
    // while something slides in, every layer above it lifts to make room
    let slideIdx = Infinity;
    this.layers.forEach((l, i) => {
      if (l.state === "slide" && i < slideIdx) slideIdx = i;
    });
    this.layers.forEach((l, idx) => {
      const eff = l.target + (idx > slideIdx ? 0.42 : 0);
      if (l.state === "idle" && Math.abs(eff - l.y) > 0.004) l.state = "move";
      switch (l.state) {
        case "wait":
          l.delay -= dt;
          if (l.delay <= 0) { l.state = "fall"; l.vel = 0; }
          break;
        case "slide": {
          l.x += (0 - l.x) * (1 - Math.exp(-dt * 5.5));
          if (Math.abs(l.x) < 0.05) {
            l.x = 0;
            l.state = "fall";
            l.vel = 0;
          }
          break;
        }
        case "fall": {
          l.vel -= G * dt;
          l.y += l.vel * dt;
          if (l.y <= l.target) {
            l.y = l.target;
            const impact = -l.vel;
            if (!l.bounced && impact > 2.2) {
              l.bounced = true;
              l.vel = impact * 0.16;
            } else {
              l.vel = 0;
              l.state = "idle";
            }
            const meta = LAYER[l.key] || { mass: 0.4 };
            const strength = Math.min(impact / 6.5, 1);
            l.squash = Math.min(0.3, 0.05 + strength * meta.mass * 0.28);
            if (impact > 1.5) {
              this.worldPos(l.target + 0.03, tmp);
              this.fx.particles.puff(tmp, {
                count: 4 + Math.round(meta.mass * 8),
                speed: 0.5 + strength * meta.mass * 1.1,
                scale: 0.12 + meta.mass * 0.16,
                opacity: 0.4 + meta.mass * 0.2,
              });
              this.fx.shake(0.06 + strength * meta.mass * 0.3);
              if (l.key === "patty") this.fx.particles.steam(tmp, { count: 11 });
              if (l.key === "fries_base" || l.key === "cup") this.fx.particles.steam(tmp, { count: 3 });
            }
          }
          break;
        }
        case "move": {
          const k = 90, c = 13;
          l.vel += (eff - l.y) * k * dt - l.vel * c * dt;
          l.y += l.vel * dt;
          if (Math.abs(eff - l.y) < 0.002 && Math.abs(l.vel) < 0.02) {
            l.y = eff;
            l.vel = 0;
            l.state = "idle";
          }
          break;
        }
      }
      l.squash = Math.max(0, l.squash - dt * 1.9);
      l.obj.position.x = l.x;
      l.obj.position.y = l.y;
      const s = l.squash;
      l.obj.scale.set(1 + s * 0.55, 1 - s, 1 + s * 0.55);
    });

    for (let i = this.ejecting.length - 1; i >= 0; i--) {
      const l = this.ejecting[i];
      l.ejectT += dt;
      l.vel -= G * dt;
      l.y += l.vel * dt;
      l.obj.position.y = l.y;
      l.obj.position.addScaledVector(l.dir, dt * 2.4);
      l.obj.rotation.x += l.spin.x * dt;
      l.obj.rotation.z += l.spin.z * dt;
      const sc = Math.max(0.001, 1 - l.ejectT * 1.5);
      l.obj.scale.setScalar(sc);
      if (l.ejectT > 0.66) {
        this.group.remove(l.obj);
        this.ejecting.splice(i, 1);
      }
    }
  }

  get settled() {
    return this.layers.every((l) => l.state === "idle") && !this.ejecting.length;
  }

  topY() {
    let y = 0;
    for (const l of this.layers) y = Math.max(y, l.target);
    return y;
  }

  dispose() {
    for (const l of [...this.layers, ...this.ejecting]) this.group.remove(l.obj);
    this.layers = [];
    this.ejecting = [];
  }
}

/* ------------------------------------------------------------- base view */

let _ringTpl = null;
function selectionRing() {
  if (!_ringTpl) {
    _ringTpl = new THREE.Mesh(
      new THREE.RingGeometry(0.78, 0.9, 48),
      new THREE.MeshBasicMaterial({ color: 0xc8102e, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
  }
  const r = _ringTpl.clone();
  r.material = r.material.clone();
  r.rotation.x = -Math.PI / 2;
  r.position.y = 0.013;
  return r;
}

export class FoodView {
  constructor(fx, lineId) {
    this.fx = fx;
    this.lineId = lineId;
    this.group = new THREE.Group();
    this.group.userData.lineId = lineId;
    this.slot = new THREE.Vector3();
    this.ring = null;
    this.t = 0;
  }

  setSlot(v) { this.slot.copy(v); }

  setSelected(on) {
    if (on && !this.ring) {
      this.ring = selectionRing();
      this.group.add(this.ring);
    } else if (!on && this.ring) {
      this.group.remove(this.ring);
      this.ring = null;
    }
  }

  baseUpdate(dt) {
    this.t += dt;
    // glide horizontally to assigned slot (y handled by stacks/drops)
    const k = 1 - Math.exp(-dt * 6);
    this.group.position.x += (this.slot.x - this.group.position.x) * k;
    this.group.position.z += (this.slot.z - this.group.position.z) * k;
    if (this.ring) {
      this.ring.material.opacity = 0.35 + Math.sin(this.t * 4) * 0.15;
      const s = 1 + Math.sin(this.t * 4) * 0.03;
      this.ring.scale.set(s, s, 1);
    }
  }

  focusPoint() {
    return new THREE.Vector3(this.group.position.x, 0.5, this.group.position.z);
  }

  /* hero shot framing: target below the food so it sits in the upper half,
     clear of the mods drawer; aware of stack height when there is one */
  heroFocus() {
    const top = this.stack ? this.stack.topY() : 0.5;
    const y = THREE.MathUtils.clamp(top * 0.85 - 1.25, -0.85, -0.3);
    return {
      point: new THREE.Vector3(this.group.position.x, y, this.group.position.z),
      dist: 5.4,
    };
  }

  dispose(scene) { scene.remove(this.group); }
}

/* ------------------------------------------------------------ burger view */

export class BurgerView extends FoodView {
  constructor(fx, lineId) {
    super(fx, lineId);
    this.stack = new LayerStack(this.group, fx);
    this.jitterSeed = Math.random() * 100;
  }

  setItems(items, { cinematic = false } = {}) {
    const keys = burgerRecipe(items);
    const targets = [];
    let y = 0;
    for (const key of keys) {
      targets.push(y);
      y += (LAYER[key]?.advance ?? 0.05);
    }
    let i = 0;
    this.stack.setLayers(keys, targets, {
      cinematic,
      makeObj: (key) => {
        const wrap = new THREE.Group();
        const m = instance(key);
        // tiny per-layer variance so stacks look hand-made
        m.rotation.y = Math.sin(this.jitterSeed + i * 12.9898) * Math.PI;
        m.position.x = Math.sin(this.jitterSeed * 3 + i * 4.1) * 0.022;
        m.position.z = Math.cos(this.jitterSeed * 7 + i * 7.3) * 0.022;
        i++;
        wrap.add(m);
        return wrap;
      },
    });
  }

  focusPoint() {
    return new THREE.Vector3(this.group.position.x, Math.max(0.4, this.stack.topY() * 0.6), this.group.position.z);
  }

  update(dt) {
    this.baseUpdate(dt);
    this.stack.update(dt);
  }

  dispose(scene) {
    this.stack.dispose();
    super.dispose(scene);
  }
}

/* ------------------------------------------------------------- fries view */

const COOK_TINT = {
  "Light": 1.18,
  "Regular": 1.0,
  "Well Done": 0.72,
  "Extra Well Done": 0.52,
};

export class FriesView extends FoodView {
  constructor(fx, lineId) {
    super(fx, lineId);
    this.stack = new LayerStack(this.group, fx);
    this.fryMats = [];
    this.cook = "Regular";
  }

  setItems(items, opts = {}) {
    const keys = ["fries_base"];
    const targets = [0];
    let y = 0.42;
    const top = [];
    for (let i = 0; i < Math.min(items.cheese || 0, 6); i++) top.push("cheese");
    if (items.spread) top.push("spread");
    for (let i = 0; i < Math.min(items.grilled_onion || 0, 4); i++) top.push("grilled_onion");
    if (items.chiles) top.push("chiles");
    for (const k of top) {
      keys.push(k);
      targets.push(y);
      y += k === "cheese" ? 0.045 : 0.05;
    }
    let i = 0;
    this.stack.setLayers(keys, targets, {
      ...opts,
      makeObj: (key) => {
        const wrap = new THREE.Group();
        let m;
        if (key === "fries_base") {
          m = instance("fries", { cloneMaterials: true });
          m.traverse((o) => {
            if (o.isMesh && o.material.name === "fry") this.fryMats.push(o.material);
          });
        } else {
          m = instance(key);
          const s = key === "cheese" ? 0.95 : 0.8;
          m.scale.setScalar(s);
          m.rotation.y = Math.random() * Math.PI;
          m.rotation.z = (Math.random() - 0.5) * 0.18;
          m.position.x = (Math.random() - 0.5) * 0.2;
        }
        i++;
        wrap.add(m);
        return wrap;
      },
    });
    this.applyCook(this.cook);
  }

  applyCook(cook) {
    this.cook = cook;
    const f = COOK_TINT[cook] ?? 1;
    for (const m of this.fryMats) {
      m.color.setRGB(Math.min(1, f), Math.min(1, 0.62 * (f * 0.85 + 0.15)), 0.35 * (f * 0.7 + 0.3));
      // keep the texture; tint multiplies it
      m.color.multiplyScalar(0.95);
    }
  }

  update(dt) {
    this.baseUpdate(dt);
    this.stack.update(dt);
  }

  dispose(scene) {
    this.stack.dispose();
    super.dispose(scene);
  }
}

/* ----------------------------------------------------- drink / side views */

const FLAVOR_COLORS = {
  "vanilla-shake": 0xf3e7c8,
  "chocolate-shake": 0x6b4226,
  "strawberry-shake": 0xee6e8e,
  "neapolitan-shake": 0xd9a08a,
};

export class CupView extends FoodView {
  constructor(fx, lineId, extraKey) {
    super(fx, lineId);
    this.stack = new LayerStack(this.group, fx);
    const isShake = extraKey.includes("shake");
    const model = isShake ? "shake" : "drink";
    this.stack.setLayers(["cup"], [0], {
      makeObj: () => {
        const wrap = new THREE.Group();
        const m = instance(model, { cloneMaterials: isShake });
        if (isShake) {
          const col = FLAVOR_COLORS[extraKey] ?? 0xf3e7c8;
          m.traverse((o) => {
            if (o.isMesh && o.name.toLowerCase().includes("flavor")) o.material.color.set(col);
          });
        }
        m.scale.setScalar(0.85);
        wrap.add(m);
        return wrap;
      },
    });
  }

  update(dt) {
    this.baseUpdate(dt);
    this.stack.update(dt);
  }

  dispose(scene) {
    this.stack.dispose();
    super.dispose(scene);
  }
}

export class SideView extends FoodView {
  constructor(fx, lineId, compKey) {
    super(fx, lineId);
    this.stack = new LayerStack(this.group, fx);
    const model = ["patty", "cheese", "tomato", "lettuce", "onion",
      "grilled_onion", "spread", "pickle", "chiles"].includes(compKey) ? compKey : "spread";
    this.stack.setLayers(["side_boat", model], [0, 0.06], {
      makeObj: (key) => {
        const wrap = new THREE.Group();
        const m = instance(key);
        if (key !== "side_boat") m.scale.setScalar(0.62);
        wrap.add(m);
        return wrap;
      },
    });
  }

  update(dt) {
    this.baseUpdate(dt);
    this.stack.update(dt);
  }

  dispose(scene) {
    this.stack.dispose();
    super.dispose(scene);
  }
}

/* ------------------------------------------------------------ tray scene */

export class TrayScene {
  constructor(stage) {
    this.stage = stage;
    this.views = new Map(); // lineId -> view
    this.selectedId = null;

    this.tray = instance("tray");
    this.tray.scale.set(1.25, 1, 1.25);
    stage.scene.add(this.tray);

    this.raycaster = new THREE.Raycaster();
  }

  /* Reconcile 3D views with the order array. */
  sync(order, DATA, { cinematicId = null } = {}) {
    const seen = new Set();
    for (const line of order) {
      seen.add(line.id);
      let v = this.views.get(line.id);
      const cinematic = line.id === cinematicId;
      if (!v) {
        if (line.kind === "food" && line.cat === "burger") {
          v = new BurgerView(this.stage, line.id);
          v.setItems(line.items, { cinematic });
        } else if (line.kind === "food" && line.cat === "fries") {
          v = new FriesView(this.stage, line.id);
          v.setItems(line.items, { cinematic });
          v.applyCook(line.cook || "Regular");
        } else if (line.kind === "extra") {
          v = new CupView(this.stage, line.id, line.key);
        } else {
          v = new SideView(this.stage, line.id, line.key);
        }
        this.stage.scene.add(v.group);
        this.views.set(line.id, v);
      } else if (line.kind === "food") {
        if (v.setItems && line._dirty) v.setItems(line.items);
        if (v.applyCook && line.cook) v.applyCook(line.cook);
        line._dirty = false;
      }
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) {
        v.dispose(this.stage.scene);
        this.views.delete(id);
        if (this.selectedId === id) this.selectedId = null;
      }
    }
    this.layout(order);
  }

  /* Foods front row, cups & sides back row, centered on the tray. */
  layout(order) {
    const front = order.filter((l) => l.kind === "food");
    const back = order.filter((l) => l.kind !== "food");
    const place = (lines, z, gap, max) => {
      const n = lines.length;
      const spacing = n > 1 ? Math.min(gap, max / (n - 1)) : 0;
      lines.forEach((line, i) => {
        const v = this.views.get(line.id);
        if (!v) return;
        const x = (i - (n - 1) / 2) * spacing;
        const isNew = v.group.position.lengthSq() === 0 && v.slot.lengthSq() === 0;
        v.setSlot(new THREE.Vector3(x, 0, z));
        if (isNew) v.group.position.set(x, 0.12, z); // spawn at slot, layers drop in
      });
    };
    place(front, 0.55, 1.55, 3.6);
    place(back, -0.78, 0.95, 3.6);
  }

  select(id, { focus = true } = {}) {
    this.selectedId = id;
    for (const [vid, v] of this.views) v.setSelected(vid === id);
    if (!focus) return;
    const v = id != null ? this.views.get(id) : null;
    if (v) {
      const h = v.heroFocus();
      this.stage.focus(h.point, h.dist);
    } else {
      this.stage.focus(new THREE.Vector3(0, 0.45, 0), 6.5);
    }
  }

  /* frame the exploded stack while it assembles, then settle in on the result */
  cinematicFocus(id) {
    const v = this.views.get(id);
    if (!v) return;
    const p = v.slot;
    this.stage.focus(new THREE.Vector3(p.x, 1.6, p.z), 8.2);
    this.pendingFocusId = id;
  }

  pick(clientX, clientY) {
    const ndc = new THREE.Vector2(
      (clientX / innerWidth) * 2 - 1,
      -(clientY / innerHeight) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.stage.camera);
    const roots = [...this.views.values()].map((v) => v.group);
    const hits = this.raycaster.intersectObjects(roots, true);
    for (const h of hits) {
      let o = h.object;
      while (o) {
        if (o.userData.lineId != null) return o.userData.lineId;
        o = o.parent;
      }
    }
    return null;
  }

  update(dt) {
    for (const v of this.views.values()) v.update(dt);
    if (this.pendingFocusId != null) {
      const v = this.views.get(this.pendingFocusId);
      if (!v) this.pendingFocusId = null;
      else if (v.stack?.settled) {
        // assembly finished — glide down to a hero shot of the result
        const h = v.heroFocus();
        this.stage.focus(h.point, h.dist);
        this.onSettled?.(this.pendingFocusId);
        this.pendingFocusId = null;
      }
    }
  }
}
