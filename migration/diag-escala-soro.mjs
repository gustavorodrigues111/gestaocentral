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
const soro = rests.find((r) => /sororoca/i.test(r.nome || ""));
console.log("Sororoca:", soro?.id, soro?.nome);

const escalaMaio = await getDoc("escalas", `${soro.id}_2026-05`);
const escalaAbr = await getDoc("escalas", `${soro.id}_2026-04`);
const escalaMar = await getDoc("escalas", `${soro.id}_2026-03`);

console.log("\n=== Escala 2026-05 ===");
if (!escalaMaio) console.log("NÃO EXISTE");
else {
  const prev = escalaMaio.prevista || {};
  const real = escalaMaio.real || {};
  const empsPrev = Object.keys(prev);
  const empsReal = Object.keys(real);
  console.log(`prevista: ${empsPrev.length} empregados`);
  console.log(`real: ${empsReal.length} empregados`);
  if (empsPrev.length > 0) {
    const e0 = empsPrev[0];
    console.log(`exemplo prevista[${e0}]:`, Object.entries(prev[e0]).slice(0, 5));
  }
  if (empsReal.length > 0) {
    const e0 = empsReal[0];
    console.log(`exemplo real[${e0}]:`, Object.entries(real[e0]).slice(0, 5));
  }
}

console.log("\n=== Escala 2026-04 ===");
if (!escalaAbr) console.log("NÃO EXISTE");
else {
  const prev = escalaAbr.prevista || {};
  const real = escalaAbr.real || {};
  console.log(`prevista: ${Object.keys(prev).length} empregados`);
  console.log(`real: ${Object.keys(real).length} empregados`);
  if (Object.keys(real).length > 0) {
    const e0 = Object.keys(real)[0];
    const dias = real[e0];
    const trab = Object.values(dias).filter(s => s === "trabalho" || s === "comp_trab" || s === "freela").length;
    const naoTrab = Object.values(dias).filter(s => s !== "trabalho" && s !== "comp_trab" && s !== "freela").length;
    console.log(`exemplo real[${e0}]: ${trab} trabalho, ${naoTrab} outros (total=${Object.keys(dias).length})`);
  }
}

console.log("\n=== Escala 2026-03 (refMes pra desconto sugerido) ===");
if (!escalaMar) console.log("NÃO EXISTE");
else {
  const real = escalaMar.real || {};
  console.log(`real: ${Object.keys(real).length} empregados`);
  if (Object.keys(real).length > 0) {
    const e0 = Object.keys(real)[0];
    const dias = real[e0];
    const counts = {};
    for (const s of Object.values(dias)) counts[s] = (counts[s] || 0) + 1;
    console.log(`exemplo real[${e0}] status counts:`, counts);
  }
}
