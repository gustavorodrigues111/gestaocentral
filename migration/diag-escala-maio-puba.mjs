import { execSync } from "node:child_process";
const TOKEN = execSync("gcloud auth application-default print-access-token", { encoding: "utf8" }).trim();
const BASE = "https://firestore.googleapis.com/v1/projects/gestaocentral-85b13/databases/(default)/documents";

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
async function getDoc(coll, id) {
  const r = await fetch(`${BASE}/${coll}/${id}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) return null;
  const j = await r.json();
  return j.fields ? fromFs({ mapValue: { fields: j.fields } }) : null;
}
async function listAll(coll) {
  const docs = [];
  let next = null;
  do {
    const url = `${BASE}/${coll}?pageSize=300${next ? `&pageToken=${encodeURIComponent(next)}` : ""}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) return docs;
    const j = await r.json();
    (j.documents || []).forEach((d) => {
      const id = d.name.split("/").pop();
      const data = d.fields ? fromFs({ mapValue: { fields: d.fields } }) : null;
      docs.push({ id, ...data });
    });
    next = j.nextPageToken || null;
  } while (next);
  return docs;
}

const rests = await listAll("restaurants");
const puba = rests.find(r => /puba/i.test(r.nome || ""));

const escala = await getDoc("escalas", `${puba.id}_2026-05`);
if (!escala) { console.log("Escala maio/26 do Puba: NÃO EXISTE"); process.exit(0); }

console.log(`Escala maio/26 do Puba — previstaFechada=${!!escala.previstaFechadaEm}`);
console.log(`Empregados na prevista: ${Object.keys(escala.prevista || {}).length}`);

const emps = await listAll("empregados");
const joelson = emps.find(e => /joelson/i.test(e.nome || ""));
const wendell = emps.find(e => /wendell/i.test(e.nome || ""));

for (const e of [joelson, wendell].filter(Boolean)) {
  console.log(`\n=== ${e.nome} ===`);
  const prev = escala.prevista?.[e.id] || {};
  const real = escala.real?.[e.id] || {};
  console.log(`prevista (${Object.keys(prev).length} células):`);
  const counts = {};
  for (const [d, st] of Object.entries(prev)) counts[st] = (counts[st] || 0) + 1;
  console.log(`  status counts:`, counts);
  console.log(`real (${Object.keys(real).length} células):`);
  const counts2 = {};
  for (const [d, st] of Object.entries(real)) counts2[st] = (counts2[st] || 0) + 1;
  console.log(`  status counts:`, counts2);
}
