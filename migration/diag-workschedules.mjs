// READ-ONLY — checa quais empregados do Planejamento têm workSchedules
// e quais têm sundayCycle.
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
const restNome = Object.fromEntries(rests.map((r) => [r.id, r.nome || r.id]));

const linhas = [];
for (const e of emps) {
  const ws = Array.isArray(e.workSchedules) ? e.workSchedules : [];
  const tem = ws.length > 0;
  const ciclos = ws.filter((s) => s && s.sundayCycle && s.sundayCycle.workCount > 0);
  const alternating = ws.filter((s) => s && s.type === "alternating");
  linhas.push({
    rest: restNome[e.restaurantId] || e.restaurantId,
    nome: e.nome || "?",
    versoes: ws.length,
    ativos: ws.filter((s) => s && (s.days || s.weeks)).length,
    temCiclo: ciclos.length > 0,
    temAlt: alternating.length > 0,
    ultimoValidFrom: ws.length ? (ws[ws.length - 1].validFrom || "?") : "—",
  });
}
linhas.sort((a, b) => (a.rest + a.nome).localeCompare(b.rest + b.nome));

console.log("══════════════════════════════════════════════════════════════════");
console.log(" WORKSCHEDULES POR EMPREGADO (Planejamento)");
console.log("══════════════════════════════════════════════════════════════════\n");
let semWs = 0, comCiclo = 0, comAlt = 0;
const porRest = {};
for (const l of linhas) {
  porRest[l.rest] = porRest[l.rest] || { total: 0, comWs: 0, comCiclo: 0, comAlt: 0 };
  porRest[l.rest].total++;
  if (l.versoes === 0) semWs++;
  else porRest[l.rest].comWs++;
  if (l.temCiclo) { comCiclo++; porRest[l.rest].comCiclo++; }
  if (l.temAlt) { comAlt++; porRest[l.rest].comAlt++; }
}

console.log("── Resumo por restaurante ──");
for (const [r, s] of Object.entries(porRest)) {
  console.log(`  ${r.padEnd(22)} total:${String(s.total).padStart(2)} c/ workSchedule:${String(s.comWs).padStart(2)} c/ ciclo-dom:${String(s.comCiclo).padStart(2)} c/ alternating:${String(s.comAlt).padStart(2)}`);
}
console.log(`  ── geral: ${linhas.length} empregados, ${linhas.length - semWs} c/ workSchedule, ${comCiclo} c/ ciclo-dom, ${comAlt} c/ alternating\n`);

console.log("── Detalhe Lobozó (todos) ──");
linhas.filter((l) => l.rest === "Lobozó").forEach((l) =>
  console.log(`  ${(l.nome).padEnd(36)} versões:${l.versoes} ciclo-dom:${l.temCiclo?"✓":"·"} alt:${l.temAlt?"✓":"·"} ultimo:${l.ultimoValidFrom}`)
);

console.log("\n── Quem TEM ciclo-dom (qualquer rest) ──");
const comC = linhas.filter((l) => l.temCiclo);
if (comC.length === 0) console.log("  (NENHUM)");
else comC.forEach((l) => console.log(`  ${l.rest.padEnd(22)} ${l.nome}`));

// Amostra: 1 workSchedule completo com ciclo-dom
const sample = emps.find((e) => Array.isArray(e.workSchedules) && e.workSchedules.some((s) => s && s.sundayCycle && s.sundayCycle.workCount > 0));
if (sample) {
  const ws = sample.workSchedules.find((s) => s && s.sundayCycle && s.sundayCycle.workCount > 0);
  console.log(`\n── Amostra workSchedule c/ sundayCycle (${sample.nome}) ──`);
  console.log("  " + JSON.stringify(ws, null, 2).split("\n").join("\n  "));
}

process.exit(0);
