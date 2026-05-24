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
const puba = rests.find((r) => /puba/i.test(r.nome || ""));
console.log("Puba:", puba?.id, puba?.nome);
console.log("\nUnidades do Puba:");
for (const u of puba?.unidades || []) {
  console.log(`  ${u.tipo === "producao" ? "🏭" : "🏪"} ${u.nome} (${u.tipo}) — id=${u.id} ativa=${u.ativa}`);
}

const emps = await listAll("empregados");
const cargos = await listAll("cargos");
const cargoById = Object.fromEntries(cargos.map(c => [c.id, c]));

const empsPuba = emps.filter(e => e.restaurantId === puba.id && e.estaAtivo);
console.log(`\n${empsPuba.length} empregados ATIVOS no Puba.`);

// Pra cada unidade do Puba, lista empregados que têm aquela unidadePadraoId
for (const u of puba.unidades || []) {
  const emps = empsPuba.filter(e => e.unidadePadraoId === u.id);
  console.log(`\n=== Empregados com unidadePadraoId = "${u.nome}" (${u.tipo}, id=${u.id}) ===`);
  console.log(`  Total: ${emps.length}`);
  for (const e of emps.slice(0, 10)) {
    const cargo = cargoById[e.cargoId];
    console.log(`  - ${e.nome} (${cargo?.nome || "?"}, área=${cargo?.area}, recebeProducao=${cargo?.recebeProducao}, pontos=${cargo?.pontos}, semGorjeta=${cargo?.semGorjeta})`);
  }
}

// Empregados SEM unidadePadraoId
const semUnidade = empsPuba.filter(e => !e.unidadePadraoId);
console.log(`\n=== Empregados SEM unidadePadraoId ===`);
console.log(`  Total: ${semUnidade.length}`);
for (const e of semUnidade.slice(0, 10)) {
  const cargo = cargoById[e.cargoId];
  console.log(`  - ${e.nome} (${cargo?.nome}, área=${cargo?.area})`);
}
