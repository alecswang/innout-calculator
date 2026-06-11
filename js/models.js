/* GLB loading, caching and per-instance cloning. */

import * as THREE from "three";
import { GLTFLoader } from "../vendor/GLTFLoader.js";

export const MODEL_NAMES = [
  "tray", "bun_top", "bun_heel", "patty", "cheese", "lettuce", "wrap",
  "tomato", "onion", "grilled_onion", "pickle", "spread", "ketchup",
  "mustard", "chiles", "fries", "side_boat", "drink", "shake",
];

const templates = new Map();

export async function loadAll(onProgress) {
  const loader = new GLTFLoader();
  let done = 0;
  await Promise.all(
    MODEL_NAMES.map(async (name) => {
      const gltf = await loader.loadAsync(`assets/models/${name}.glb`);
      gltf.scene.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          if (o.material?.transparent) o.castShadow = false;
        }
      });
      templates.set(name, gltf.scene);
      done++;
      onProgress?.(done / MODEL_NAMES.length);
    })
  );
}

/* Clone a template. Materials stay shared unless cloneMaterials is set. */
export function instance(name, { cloneMaterials = false } = {}) {
  const tpl = templates.get(name);
  if (!tpl) throw new Error("model not loaded: " + name);
  const obj = tpl.clone(true);
  if (cloneMaterials) {
    obj.traverse((o) => {
      if (o.isMesh) o.material = o.material.clone();
    });
  }
  return obj;
}

/* Visual stacking config for burger layers (heights tuned by eye). */
export const LAYER = {
  bun_heel:      { advance: 0.125, mass: 0.7 },
  wrap:          { advance: 0.13,  mass: 0.5 },
  spread:        { advance: 0.028, mass: 0.15 },
  ketchup:       { advance: 0.018, mass: 0.12 },
  mustard:       { advance: 0.016, mass: 0.12 },
  chiles:        { advance: 0.026, mass: 0.15 },
  lettuce:       { advance: 0.05,  mass: 0.25 },
  tomato:        { advance: 0.068, mass: 0.45 },
  patty:         { advance: 0.125, mass: 1.0 },
  cheese:        { advance: 0.026, mass: 0.3 },
  onion:         { advance: 0.042, mass: 0.3 },
  grilled_onion: { advance: 0.03,  mass: 0.25 },
  pickle:        { advance: 0.048, mass: 0.25 },
  bun_top:       { advance: 0.34,  mass: 0.8 },
};

/* Build the bottom-to-top visual recipe for a burger's item counts. */
export function burgerRecipe(items) {
  const n = (k) => items[k] || 0;
  const layers = [];
  const protein = n("wrap") > 0;

  if (protein) layers.push("wrap");
  else if (n("bun") > 0) layers.push("bun_heel"); // Flying Dutchman has no bun at all
  for (let i = 0; i < n("spread"); i++) layers.push("spread");
  if (n("ketchup")) layers.push("ketchup");
  if (n("mustard")) layers.push("mustard");
  for (let i = 0; i < n("lettuce"); i++) layers.push("lettuce");
  for (let i = 0; i < n("tomato"); i++) layers.push("tomato");

  let cheeses = n("cheese");
  const patties = n("patty");
  for (let i = 0; i < patties; i++) {
    layers.push("patty");
    if (cheeses > 0) { layers.push("cheese"); cheeses--; }
  }
  for (let i = 0; i < cheeses; i++) layers.push("cheese"); // cheese w/o patty (grilled cheese)

  for (let i = 0; i < n("grilled_onion"); i++) layers.push("grilled_onion");
  for (let i = 0; i < n("onion"); i++) layers.push("onion");
  if (n("chiles")) layers.push("chiles");
  if (n("pickle")) layers.push("pickle");

  if (n("bun") > 0) layers.push("bun_top");
  else if (protein) layers.push("lettuce"); // lettuce cover for protein style
  return layers;
}
