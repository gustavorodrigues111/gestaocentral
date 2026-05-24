// READ-ONLY — investiga o Diego no AppTip via REST.
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
async function getDoc(path) {
  const r = await fetch(`${BASE}/${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${path}: ${r.status}`);
  const j = await r.json();
  return j.fields ? fromFs({ mapValue: { fields: j.fields } }) : null;
}

const employees = (await getDoc("appdata/v4:employees"))?.value || [];
const managers = (await getDoc("appdata/v4:managers"))?.value || [];
const pessoas = (await getDoc("appdata/v4:pessoas"))?.value || [];

const LOBOZO = "1775792314382";

console.log("══════════════════════════════════════════");
console.log(" DIEGO FERREIRA — diagnóstico");
console.log("══════════════════════════════════════════\n");

// ── Employee ──
const empMatch = employees.filter((e) => /diego/i.test(e.name || ""));
console.log("── employees com 'diego' ──");
empMatch.forEach((e) => {
  console.log(`  id=${e.id}  name=${e.name}  rid=${e.restaurantId}  roleId=${e.roleId}`);
});
if (!empMatch.length) console.log("  (nenhum)");
console.log("");

// ── Managers ──
console.log("── managers totais:", managers.length, "──");
managers.forEach((m) => {
  console.log(`  id=${m.id}  name=${m.name||"(s/ nome)"}  linkedEmpId=${m.linkedEmpId||"-"}  profile=${m.profile||"-"}  isDP=${!!m.isDP}  perms.schedule=${!!m.perms?.schedule}`);
});
console.log("");
const mgrDiego = managers.filter((m) => /diego/i.test(m.name || ""));
console.log("── managers com 'diego':", mgrDiego.length, "──");
mgrDiego.forEach((m) => console.log("  " + JSON.stringify(m, null, 2).replace(/\n/g, "\n  ")));
console.log("");

// ── Pessoas ──
const pesDiego = pessoas.filter((p) => /diego/i.test(p.name || ""));
console.log("── pessoas com 'diego':", pesDiego.length, "──");
pesDiego.forEach((p) => {
  console.log(`\n  ▸ ${p.id} — ${p.name}`);
  console.log(`    linkedEmployeeId: ${p.linkedEmployeeId || "-"}`);
  console.log(`    linkedManagerId:  ${p.linkedManagerId || "-"}`);
  console.log(`    restaurantIds:    ${(p.restaurantIds||[]).join(", ")}`);
  console.log(`    permissions[Lobozó]:`);
  console.log("      " + JSON.stringify(p.permissions?.[LOBOZO] || {}, null, 2).replace(/\n/g, "\n      "));
});

process.exit(0);
