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

const emps = await listAll("empregados");
const cargos = await listAll("cargos");
const cargoById = Object.fromEntries(cargos.map(c => [c.id, c]));

// Empregados do Puba
const empsPuba = emps.filter(e => e.restaurantId === puba.id);
console.log(`\n${empsPuba.length} empregados no Puba total.\n`);

// Lucas Pinheiro?
const lucasMatches = empsPuba.filter(e => /lucas.*pinheiro|pinheiro.*lucas/i.test(e.nome || ""));
console.log("=== Lucas Pinheiro matches ===");
for (const e of lucasMatches) {
  const cargo = cargoById[e.cargoId];
  console.log({
    nome: e.nome,
    cargo: cargo?.nome,
    area: cargo?.area,
    vtAtivo: e.vtAtivo,
    vtAuxFixo: e.vtAuxilioFixoMensal,
    vtPassagens: e.vtPassagensPorDia,
    vtValor: e.vtValorPassagem,
    estaAtivo: e.estaAtivo,
    admissaoAtual: e.admissaoAtual,
    demitidoEm: e.demitidoEm,
    periodos: e.periodos,
    unidadePadraoId: e.unidadePadraoId,
  });
}

// Quem tá ATIVO e SEM VT no bar?
console.log("\n=== Empregados ativos no Bar do Puba SEM vtAtivo (não vão aparecer no VT) ===");
const ativosNoBar = empsPuba.filter(e => {
  const c = cargoById[e.cargoId];
  if (c?.area !== "Bar") return false;
  if (!e.estaAtivo) return false;
  return true;
});
for (const e of ativosNoBar) {
  console.log({
    nome: e.nome,
    cargo: cargoById[e.cargoId]?.nome,
    vtAtivo: e.vtAtivo,
    auxFixo: e.vtAuxilioFixoMensal,
    passagens: e.vtPassagensPorDia,
    valor: e.vtValorPassagem,
  });
}

// Quem tem VT no Bar do Puba
console.log("\n=== Bar do Puba com VT ativo ===");
const comVT = empsPuba.filter(e => {
  const c = cargoById[e.cargoId];
  if (c?.area !== "Bar") return false;
  return e.vtAtivo === true || (e.vtAuxilioFixoMensal && e.vtAuxilioFixoMensal > 0);
});
for (const e of comVT) {
  console.log(`  ${e.nome} (cargo ${cargoById[e.cargoId]?.nome}, vtAtivo=${e.vtAtivo}, auxFixo=${e.vtAuxilioFixoMensal})`);
}
