/*
 * Export the DermaScores datasets out of index.html into data/*.json.
 *
 * index.html stays the single source of truth — this script only reads it, so
 * the JSON can never drift: re-run `npm run export-data` after editing the app.
 *
 * The calculator entries carry form()/calc() functions, which JSON cannot hold.
 * Those are dropped and the fact is recorded per entry via "hasLogic", so a
 * consumer knows the scoring code lives in index.html rather than in the JSON.
 * The diagnostic-criteria entries are pure data and export in full.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");

/* Pull a top-level `const NAME = <literal>;` out of the script and evaluate it.
   Nothing inside these literals runs at definition time — the helper calls all
   sit inside method bodies — so they evaluate standalone. */
function literal(name, endsBefore) {
  const start = html.indexOf(`const ${name}=`);
  if (start === -1) throw new Error(`${name} not found in index.html`);
  const from = start + `const ${name}=`.length;
  const end = html.indexOf(endsBefore, from);
  if (end === -1) throw new Error(`terminator for ${name} not found`);
  /* +2 keeps the closing "\n}" or "\n]" that the terminator starts with */
  const src = html.slice(from, end + 2).trim();
  try {
    return (0, eval)(`(${src})`);
  } catch (e) {
    throw new Error(`${name} failed to evaluate: ${e.message}`);
  }
}

const BANNER = "/* =====================================================================";
const UI        = literal("UI", "\n};") ?? {};
const CRIT_UI   = literal("CRIT_UI", "\n};");
const CATS      = literal("CATS", "\n};");
const CRIT_CATS = literal("CRIT_CATS", "\n};");
const CALCS     = literal("CALCS", `\n];\n\n${BANNER}`);
const CRITERIA  = literal("CRITERIA", `\n];\n\n${BANNER}`);

/* [tr,en] pairs and {tr,en} objects both become {tr,en} in the JSON */
const pair = v => Array.isArray(v) ? { tr: v[0], en: v[1] } : { tr: v.tr, en: v.en };
const pairs = a => (a || []).map(pair);

const catMap = src => Object.fromEntries(
  Object.entries(src).map(([k, [tr, en, color]]) => [k, { tr, en, color }]));

const calculators = CALCS.map(c => ({
  id: c.id,
  category: c.cat,
  name: c.name,
  full: pair(c.full),
  about: pair(c.about),
  range: c.range,
  /* form()/calc() cannot be represented in JSON — the scoring logic stays in index.html */
  hasLogic: typeof c.form === "function" && typeof c.calc === "function",
}));

const criteria = CRITERIA.map(d => ({
  id: d.id,
  category: d.cat,
  name: pair(d.name),
  full: pair(d.full),
  relatedCalculators: d.relatedCalcs || [],
  sets: d.sets.map(s => {
    const out = {
      key: s.key,
      tab: pair(s.tab),
      name: s.name,
      year: s.year,
      scoringType: s.scoringType,
    };
    if (s.applicabilityNote) out.applicabilityNote = pair(s.applicabilityNote);
    const item = it => {
      const o = { id: it.id, label: pair(it.label) };
      if (it.hint) o.hint = pair(it.hint);
      if (it.type === "choice") {
        o.type = "choice";
        o.options = it.options.map(([tr, en, points]) => ({ label: { tr, en }, points }));
      } else {
        o.type = "checkbox";
        if (it.points !== undefined) o.points = it.points;
        if (it.optional) o.optional = true;
      }
      return o;
    };
    const group = g => ({ key: g.key, label: pair(g.label), short: pair(g.short),
                          need: g.need, items: g.items.map(item) });
    if (s.scoringType === "major-minor") out.groups = s.groups.map(group);
    else if (s.scoringType === "mandatory-plus-n") {
      out.mandatory = { label: pair(s.mandatory.label), short: pair(s.mandatory.short),
                        items: s.mandatory.items.map(item) };
      out.additional = { label: pair(s.additional.label), short: pair(s.additional.short),
                         need: s.additional.need, items: s.additional.items.map(item) };
    } else {
      out.items = s.items.map(item);
      if (s.scoringType === "points-threshold") out.threshold = s.threshold;
      else out.bands = s.bands.map(b => ({ max: b.max ?? null, label: pair(b.label), met: !!b.met }));
    }
    return out;
  }),
  differentials: pairs(d.differentials),
  nextSteps: {
    workup: pairs(d.nextSteps.workup),
    treatmentOrientation: pairs(d.nextSteps.treatmentOrientation),
    referralFlags: pairs(d.nextSteps.referralFlags),
  },
  references: d.references,
}));

const strings = Object.fromEntries(
  [...Object.entries(UI).map(([k, v]) => ["ui." + k, v]),
   ...Object.entries(CRIT_UI).map(([k, v]) => ["criteria." + k, v])]
    .map(([k, v]) => [k, pair(v)]));

const out = join(root, "data");
mkdirSync(out, { recursive: true });
const write = (file, obj) => {
  writeFileSync(join(out, file), JSON.stringify(obj, null, 2) + "\n");
  console.log(`  data/${file}  ${JSON.stringify(obj).length.toLocaleString()} bytes`);
};

const categories = { calculators: catMap(CATS), criteria: catMap(CRIT_CATS) };
const criteriaDoc = {
  count: criteria.length,
  setCount: criteria.reduce((n, d) => n + d.sets.length, 0),
  criteria,
};

write("calculators.json", { count: calculators.length, calculators });
write("criteria.json", criteriaDoc);
write("categories.json", categories);
write("strings.json", strings);
/* one file to drag into another project when four separate ones are a nuisance */
write("dermascores.bundle.json", {
  source: "https://github.com/RedrockMD/dermascores",
  note: "Generated from index.html by tools/export-data.mjs — do not edit by hand.",
  categories,
  calculators: { count: calculators.length, calculators },
  criteria: criteriaDoc,
  strings,
});

console.log(`\nexported ${calculators.length} calculators and ${criteria.length} criteria entries`);
