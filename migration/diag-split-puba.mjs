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

const PUBA = "T671zhYNYCeYDWt9vxTQ";
const splits = await listAll("splitVersions");
console.log(`Total splitVersions: ${splits.length}\n`);
console.log("── Por restaurantId ──");
const pubaSplits = splits.filter((s) => s.restaurantId === PUBA);
console.log(`  Puba: ${pubaSplits.length}`);
console.log("  Conteúdo da(s) splitVersion(s) do Puba:");
pubaSplits.forEach((s) => {
  console.log("  " + JSON.stringify(s, null, 2).split("\n").join("\n  "));
});

// Restaurante (taxRate top-level?)
const rests = await listAll("restaurants");
const puba = rests.find((r) => r.id === PUBA);
console.log("\n── Restaurant Puba ──");
console.log(`  nome: ${puba?.nome}`);
console.log(`  taxRate: ${puba?.taxRate}`);
console.log(`  unidades: ${(puba?.unidades || []).map(u => u.nome).join(", ")}`);

// Amostra de uma gorjeta do Puba importada
const allG = await listAll("gorjetas");
const pubaG = allG.filter((g) => g.restaurantId === PUBA);
console.log(`\n── Gorjetas Puba importadas: ${pubaG.length} ──`);
if (pubaG[0]) {
  console.log("  Amostra:");
  console.log("  taxRate:", pubaG[0].taxRate, "valorBruto:", pubaG[0].valorBruto, "valorLiquido:", pubaG[0].valorLiquido);
  // taxRates distintos
  const taxes = [...new Set(pubaG.map(g => g.taxRate))];
  console.log("  taxRates únicos nas gorjetas:", taxes);
}

// Cargos do Puba com pontos
const cargos = await listAll("cargos");
const pubaC = cargos.filter((c) => c.restaurantId === PUBA && c.ativo);
console.log(`\n── Cargos ativos Puba: ${pubaC.length} ──`);
pubaC.forEach((c) => {
  console.log(`  ${c.nome.padEnd(20)} area=${c.area.padEnd(8)} pontos=${c.pontos} semGorjeta=${c.semGorjeta} prod=${c.recebeProducao}`);
});

process.exit(0);
