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

const emps = await listAll("empregados");
const rests = await listAll("restaurants");
const puba = rests.find(r => /puba/i.test(r.nome || ""));
const cozinhaUnit = puba.unidades.find(u => u.tipo === "producao");
console.log(`Cozinha de Produção id = ${cozinhaUnit.id}`);

const cozinheiros = emps.filter(e =>
  e.restaurantId === puba.id
  && e.unidadePadraoId === cozinhaUnit.id
  && e.estaAtivo
);
console.log(`\n${cozinheiros.length} cozinheiros ativos com unidadePadraoId=produção:\n`);

for (const e of cozinheiros) {
  const periodos = (e.periodos || []).map(p => `[${p.admissao}..${p.demissao || "..."}]`).join(", ");
  const ws = (e.workSchedules || []);
  console.log(`${e.nome}`);
  console.log(`  periodos: ${periodos}`);
  console.log(`  workSchedules: ${ws.length}`);
  if (ws.length > 0) {
    const last = ws[ws.length - 1];
    console.log(`    last validFrom=${last.validFrom} type=${last.type}`);
    if (last.days) {
      const ativos = Object.entries(last.days).filter(([, d]) => d?.active).map(([k]) => k);
      console.log(`    days ativos: ${ativos.join(", ")}`);
    }
  } else {
    console.log(`    ⚠ SEM horário → sistema assume TRABALHANDO TODOS OS DIAS`);
  }
}
