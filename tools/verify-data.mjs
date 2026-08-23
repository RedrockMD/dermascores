/*
 * Prove data/*.json is a faithful copy of what index.html actually runs.
 *
 * The exporter reads the file as text; this reads the datasets out of a real
 * browser that has loaded and rendered the app, then compares the two. Anything
 * the exporter mis-parsed shows up here as a mismatch.
 *
 * Usage: node tools/verify-data.mjs   (needs playwright + a chromium build)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
/* require() rather than import so a globally installed playwright on NODE_PATH resolves */
const { chromium } = createRequire(import.meta.url)("playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = f => JSON.parse(readFileSync(join(root, "data", f), "utf8"));
const calculators = read("calculators.json");
const criteria = read("criteria.json");
const categories = read("categories.json");

const problems = [];
const eq = (a, b, what) => { if (a !== b) problems.push(`${what}: json ${JSON.stringify(a)} vs app ${JSON.stringify(b)}`); };

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();
page.on("pageerror", e => problems.push("page error: " + e.message));
await page.goto("file://" + join(root, "index.html"));

/* the app's own view of its data */
const live = await page.evaluate(() => ({
  calcIds: CALCS.map(c => c.id),
  calcMeta: CALCS.map(c => ({ id: c.id, cat: c.cat, name: c.name, range: c.range,
                              full: c.full, about: c.about })),
  cats: Object.keys(CATS), critCats: Object.keys(CRIT_CATS),
  criteria: CRITERIA.map(d => ({
    id: d.id, cat: d.cat, related: d.relatedCalcs || [],
    sets: d.sets.map(s => ({
      key: s.key, name: s.name, year: s.year, type: s.scoringType,
      threshold: s.threshold ?? null,
      bands: (s.bands || []).map(b => [b.max ?? null, !!b.met]),
      items: (s.scoringType === "major-minor" ? s.groups.flatMap(g => g.items)
            : s.scoringType === "mandatory-plus-n" ? [...s.mandatory.items, ...s.additional.items]
            : s.items).map(it => ({
              id: it.id,
              points: it.type === "choice" ? it.options.map(o => o[2]) : (it.points ?? null),
            })),
      needs: s.scoringType === "major-minor" ? s.groups.map(g => [g.key, g.need])
           : s.scoringType === "mandatory-plus-n" ? [["add", s.additional.need]] : [],
    })),
    diffCount: d.differentials.length,
    steps: [d.nextSteps.workup.length, d.nextSteps.treatmentOrientation.length, d.nextSteps.referralFlags.length],
    refs: d.references.length,
  })),
}));
await browser.close();

/* ---- calculators ---- */
eq(calculators.count, live.calcIds.length, "calculator count");
const jsonCalcIds = calculators.calculators.map(c => c.id).join(",");
eq(jsonCalcIds, live.calcIds.join(","), "calculator ids/order");
calculators.calculators.forEach((c, i) => {
  const m = live.calcMeta[i]; if (!m) return;
  eq(c.category, m.cat, `${c.id}.category`);
  eq(c.name, m.name, `${c.id}.name`);
  eq(c.range, m.range, `${c.id}.range`);
  eq(c.full.tr, m.full[0], `${c.id}.full.tr`);
  eq(c.full.en, m.full[1], `${c.id}.full.en`);
  eq(c.about.tr, m.about[0], `${c.id}.about.tr`);
  if (!c.hasLogic) problems.push(`${c.id}: hasLogic should be true`);
});

/* ---- categories ---- */
eq(Object.keys(categories.calculators).join(","), live.cats.join(","), "calculator categories");
eq(Object.keys(categories.criteria).join(","), live.critCats.join(","), "criteria categories");

/* ---- diagnostic criteria ---- */
eq(criteria.count, live.criteria.length, "criteria count");
criteria.criteria.forEach((d, i) => {
  const m = live.criteria[i];
  if (!m) return problems.push(`criteria[${i}] missing in app`);
  eq(d.id, m.id, `criteria[${i}].id`);
  eq(d.category, m.cat, `${d.id}.category`);
  eq(d.relatedCalculators.join(","), m.related.join(","), `${d.id}.relatedCalculators`);
  eq(d.sets.length, m.sets.length, `${d.id}.sets.length`);
  eq(d.differentials.length, m.diffCount, `${d.id}.differentials.length`);
  eq(d.references.length, m.refs, `${d.id}.references.length`);
  eq(d.nextSteps.workup.length, m.steps[0], `${d.id}.workup.length`);
  eq(d.nextSteps.treatmentOrientation.length, m.steps[1], `${d.id}.treatment.length`);
  eq(d.nextSteps.referralFlags.length, m.steps[2], `${d.id}.referral.length`);

  d.sets.forEach((s, j) => {
    const ms = m.sets[j]; if (!ms) return problems.push(`${d.id}/set${j} missing in app`);
    const w = `${d.id}/${s.key}`;
    eq(s.key, ms.key, `${w}.key`);
    eq(s.name, ms.name, `${w}.name`);
    eq(s.year, ms.year, `${w}.year`);
    eq(s.scoringType, ms.type, `${w}.scoringType`);
    eq(s.threshold ?? null, ms.threshold, `${w}.threshold`);
    eq(JSON.stringify((s.bands || []).map(b => [b.max, b.met])), JSON.stringify(ms.bands), `${w}.bands`);

    const jsonItems = s.scoringType === "major-minor" ? s.groups.flatMap(g => g.items)
      : s.scoringType === "mandatory-plus-n" ? [...s.mandatory.items, ...s.additional.items]
      : s.items;
    eq(jsonItems.length, ms.items.length, `${w}.items.length`);
    jsonItems.forEach((it, k) => {
      const mi = ms.items[k]; if (!mi) return;
      eq(it.id, mi.id, `${w}/item${k}.id`);
      const pts = it.type === "choice" ? it.options.map(o => o.points) : (it.points ?? null);
      eq(JSON.stringify(pts), JSON.stringify(mi.points), `${w}/${it.id}.points`);
    });

    const jsonNeeds = s.scoringType === "major-minor" ? s.groups.map(g => [g.key, g.need])
      : s.scoringType === "mandatory-plus-n" ? [["add", s.additional.need]] : [];
    eq(JSON.stringify(jsonNeeds), JSON.stringify(ms.needs), `${w}.needs`);
  });
});

/* every relatedCalculators id must point at a calculator that exists */
criteria.criteria.forEach(d => d.relatedCalculators.forEach(id => {
  if (!live.calcIds.includes(id)) problems.push(`${d.id}: relatedCalculators "${id}" does not exist`);
}));

const items = criteria.criteria.reduce((n, d) => n + d.sets.reduce((m, s) =>
  m + (s.groups ? s.groups.reduce((x, g) => x + g.items.length, 0)
     : s.mandatory ? s.mandatory.items.length + s.additional.items.length
     : s.items.length), 0), 0);

if (problems.length) {
  console.log("MISMATCHES:");
  problems.forEach(p => console.log("  x " + p));
  process.exit(1);
}
console.log(`data/*.json matches index.html`);
console.log(`  ${calculators.count} calculators, ${criteria.count} criteria entries, ` +
            `${criteria.setCount} criteria sets, ${items} criterion items`);
