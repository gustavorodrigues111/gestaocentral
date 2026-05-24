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
const paulo = emps.find((e) => /paulo sergio/i.test(e.nome || ""));
if (!paulo) { console.log("Paulo não encontrado"); process.exit(1); }

console.log("══════════════════════════════════════════════════════════════════");
console.log(" PAULO SERGIO — diagnóstico");
console.log("══════════════════════════════════════════════════════════════════\n");
console.log(`nome: ${paulo.nome}`);
console.log(`id:   ${paulo.id}`);
console.log(`rid:  ${paulo.restaurantId}`);
console.log(`workSchedules versões: ${(paulo.workSchedules || []).length}`);
console.log();

(paulo.workSchedules || []).forEach((s, i) => {
  console.log(`▸ versão #${i+1}`);
  console.log(`  validFrom: ${s.validFrom}`);
  console.log(`  type:      ${s.type}`);
  console.log(`  totalContract (min): ${s.totalContract}`);
  console.log(`  registradoEm: ${s.registradoEm || "?"}`);
  if (s.days) {
    console.log(`  days:`);
    for (const dow of ["0","1","2","3","4","5","6"]) {
      const d = s.days[dow];
      if (!d) { console.log(`    dia ${dow}: (não definido)`); continue; }
      const dia = ["DOM","SEG","TER","QUA","QUI","SEX","SÁB"][parseInt(dow)];
      console.log(`    ${dia} (${dow}): active=${d.active} in=${d.in||"-"} out=${d.out||"-"} break=${d.break ?? 0}`);
    }
  }
  if (s.sundayCycle) {
    console.log(`  🔁 sundayCycle:`);
    console.log(`    workCount: ${s.sundayCycle.workCount}`);
    console.log(`    offCount:  ${s.sundayCycle.offCount}`);
    console.log(`    refDate:   ${s.sundayCycle.refDate}`);
    // refDate é domingo?
    const ref = new Date(s.sundayCycle.refDate + "T12:00:00");
    console.log(`    refDate é domingo? ${ref.getDay() === 0 ? "✓ SIM" : "✗ NÃO — refDate cai em "+["DOM","SEG","TER","QUA","QUI","SEX","SÁB"][ref.getDay()]}`);
  } else {
    console.log(`  sundayCycle: (não definido)`);
  }
  console.log();
});

// Simula derivedScheduleForEmpregado pra maio/2026
console.log("── Simulação: maio/2026, domingos ──");
const sundays = ["2026-05-03","2026-05-10","2026-05-17","2026-05-24","2026-05-31"];
const ws = paulo.workSchedules || [];
const ativo = [...ws].filter((s) => !s.validFrom || s.validFrom <= "2026-05-31").sort((a,b)=>(a.validFrom||"").localeCompare(b.validFrom||"")).pop();
console.log(`  workSchedule ativo pra maio/2026: validFrom=${ativo?.validFrom || "—"}`);
if (ativo?.days?.["0"]) {
  console.log(`  domingo (days.0): active=${ativo.days["0"].active}`);
}
if (ativo?.sundayCycle) {
  const c = ativo.sundayCycle;
  for (const ds of sundays) {
    const d = new Date(ds + "T12:00:00");
    const ref = new Date(c.refDate + "T12:00:00");
    const diffWeeks = Math.round((d.getTime() - ref.getTime()) / (7 * 24 * 60 * 60 * 1000));
    const cycleLen = (c.workCount||0) + (c.offCount||1);
    const pos = ((diffWeeks % cycleLen) + cycleLen) % cycleLen;
    const isOff = pos < (c.offCount||1);
    console.log(`  ${ds}: posCiclo=${pos}/${cycleLen} → ${isOff ? "FOLGA" : "TRABALHO"}`);
  }
} else {
  console.log("  (sem sundayCycle no schedule ativo)");
}

process.exit(0);
