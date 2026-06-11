/* Nutrition math — ported from the original calculator, same data.json. */

export const MACROS = ["cal", "fat", "carb", "protein", "sodium"];

export function sumComponents(DATA, items, salt) {
  const mult = DATA.salt[salt || "regular"]?.mult ?? 1;
  const t = { cal: 0, fat: 0, carb: 0, protein: 0, sodium: 0 };
  for (const [k, n] of Object.entries(items)) {
    const c = DATA.components[k];
    if (!c) continue;
    for (const m of MACROS) t[m] += m === "sodium" ? c[m] * n * mult : c[m] * n;
  }
  return t;
}

export function lineTotals(DATA, line) {
  if (line.kind === "food") return sumComponents(DATA, line.items, line.salt);
  const src = line.kind === "side" ? DATA.components[line.key] : DATA.extras[line.key];
  return { cal: src.cal, fat: src.fat, carb: src.carb, protein: src.protein, sodium: src.sodium };
}

export function orderTotals(DATA, order) {
  const t = { cal: 0, fat: 0, carb: 0, protein: 0, sodium: 0 };
  for (const line of order) {
    const lt = lineTotals(DATA, line);
    for (const m of MACROS) t[m] += lt[m];
  }
  for (const m of MACROS) t[m] = Math.round(t[m]);
  return t;
}

export const isProteinStyle = (line) => (line.items.wrap || 0) > 0;

export function foodName(DATA, line) {
  const p = DATA.presets[line.preset];
  let n = p ? p.name : "Custom";
  if (line.cat === "burger" && isProteinStyle(line) && !n.includes("Protein")) n += " · Protein Style";
  if (line.cat === "fries" && line.cook && line.cook !== "Regular") n += " · " + line.cook;
  if (line.salt && line.salt !== "regular") n += " · " + DATA.salt[line.salt].name;
  return n;
}

/* Closure self-test: base presets must match official In-N-Out totals (±2). */
export function runSelfTest(DATA) {
  let pass = true;
  for (const [key, exp] of Object.entries(DATA.official)) {
    const p = DATA.presets[key];
    if (!p) continue;
    const got = sumComponents(DATA, p.items, "regular");
    for (const m of MACROS)
      if (Math.abs(Math.round(got[m]) - exp[m]) > 2) {
        pass = false;
        console.warn(`✗ ${key} ${m}: got ${Math.round(got[m])}, official ${exp[m]}`);
      }
  }
  console.log(
    pass
      ? "%c✓ closure test passed — base items match official In-N-Out totals (±2)"
      : "%c✗ closure test FAILED",
    `color:${pass ? "green" : "red"};font-weight:bold`
  );
  return pass;
}
