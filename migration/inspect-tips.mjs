// Inspeção rápida da estrutura de v4:tips do AppTip.
import { execSync } from "node:child_process";
const TOKEN = execSync("gcloud auth application-default print-access-token", { encoding: "utf8" }).trim();
const BASE = "https://firestore.googleapis.com/v1/projects/gorjeta-app/databases/(default)/documents";

function fromFs(v) {
  if (v == null) return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromFs);
  if ("mapValue" in v) {
    const o = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) o[k] = fromFs(val);
    return o;
  }
  return null;
}
async function getDoc(p) {
  const r = await fetch(`${BASE}/${p}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) return null;
  const j = await r.json();
  return j.fields ? fromFs({ mapValue: { fields: j.fields } }) : null;
}

const tipsDoc = await getDoc("appdata/v4:tips");
const tips = tipsDoc?.value || [];
console.log("Total tips:", tips.length);

// Primeira tip completa (todos os campos)
console.log("\nPrimeira tip:");
console.log(JSON.stringify(tips[0], null, 2));

// Range de datas + restaurantes
const dates = new Set();
const rids = new Set();
const monthlyCount = {};
for (const t of tips) {
  if (t.date) dates.add(t.date);
  if (t.restaurantId) rids.add(t.restaurantId);
  if (t.monthKey) monthlyCount[t.monthKey] = (monthlyCount[t.monthKey] || 0) + 1;
}
const sortedDates = [...dates].sort();
console.log("\nRange de datas:", sortedDates[0], "→", sortedDates[sortedDates.length - 1]);
console.log("Tem restaurantId direto na tip?", rids.size > 0 ? `SIM (${rids.size} rids)` : "NÃO (precisa derivar do employee)");
console.log("rids encontrados:", [...rids]);
console.log("Tips por monthKey:");
for (const [m, n] of Object.entries(monthlyCount).sort()) {
  console.log(`  ${m}: ${n}`);
}

// Checa abril+maio especificamente
const abrMai = tips.filter(t => t.monthKey === "2026-04" || t.monthKey === "2026-05");
console.log("\nTips em Abr+Mai 2026:", abrMai.length);

// Pra cada (rid, date), todas as tips têm o mesmo poolTotal? (sanity)
const byKey = {};
for (const t of abrMai) {
  if (!t.date) continue;
  const rid = t.restaurantId || "(sem rid na tip)";
  const k = `${rid}|${t.date}`;
  if (!byKey[k]) byKey[k] = [];
  byKey[k].push(t);
}
let diffs = 0;
for (const [k, arr] of Object.entries(byKey)) {
  const pools = new Set(arr.map(t => t.poolTotal));
  const rates = new Set(arr.map(t => t.taxRate));
  if (pools.size > 1) diffs++;
  if (rates.size > 1) diffs++;
}
console.log(`Sanity: ${diffs === 0 ? "✓ poolTotal/taxRate consistentes por (rid,date)" : `⚠ ${diffs} grupos divergentes`}`);
console.log(`Grupos únicos (rid,date) em Abr+Mai: ${Object.keys(byKey).length}`);

// Por restaurante
const porRid = {};
for (const k of Object.keys(byKey)) {
  const rid = k.split("|")[0];
  porRid[rid] = (porRid[rid] || 0) + 1;
}
console.log("Dias-gorjeta por restaurantId:");
for (const [rid, n] of Object.entries(porRid)) console.log(`  ${rid}: ${n} dias`);

// Tips SEM restaurantId — quantas?
const semRid = abrMai.filter(t => !t.restaurantId).length;
console.log(`\nTips sem restaurantId direto (Abr+Mai): ${semRid}`);
if (semRid > 0) {
  const sample = abrMai.find(t => !t.restaurantId);
  console.log("Amostra sem rid:", JSON.stringify(sample, null, 2));
}

process.exit(0);
