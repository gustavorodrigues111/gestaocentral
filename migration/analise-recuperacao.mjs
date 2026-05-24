// ════════════════════════════════════════════════════════════════════════════
//  ANÁLISE READ-ONLY — não escreve nada.
//  Cruza os docs INTACTOS do AppTip (tips, schedules, vt, etc) com o que dá
//  pra recuperar (28 sobreviventes + cópias no Planejamento) e responde:
//   "se eu restaurar os empregados, as gorjetas e escalas re-conectam?"
// ════════════════════════════════════════════════════════════════════════════
import admin from "firebase-admin";

const apptip = admin.initializeApp(
  { credential: admin.credential.applicationDefault(), projectId: "gorjeta-app" },
  "apptip",
);
const plan = admin.initializeApp(
  { credential: admin.credential.applicationDefault(), projectId: "gestaocentral-85b13" },
  "plan",
);
const aDb = admin.firestore(apptip);
const pDb = admin.firestore(plan);

async function getVal(db, path) {
  const s = await db.doc(path).get();
  return s.exists ? (s.data()?.value ?? null) : null;
}

// ── AppTip (docs intactos) ──
const employees = (await getVal(aDb, "appdata/v4:employees")) || [];
const roles = (await getVal(aDb, "appdata/v4:roles")) || [];
const restaurants = (await getVal(aDb, "appdata/v4:restaurants")) || [];
const tips = (await getVal(aDb, "appdata/v4:tips")) || [];
const splits = (await getVal(aDb, "appdata/v4:splits")) || [];
const schedules = (await getVal(aDb, "appdata/v4:schedules")) || [];
const scheduleVersions = (await getVal(aDb, "appdata/v4:scheduleVersions")) || {};
const schedulePrevista = (await getVal(aDb, "appdata/v4:schedulePrevista")) || {};
const vtConfig = (await getVal(aDb, "appdata/v4:vtConfig")) || {};
const vtMonthly = (await getVal(aDb, "appdata/v4:vtMonthly")) || {};
const workSchedules = (await getVal(aDb, "appdata/v4:workSchedules")) || {};

// ── Planejamento (cópias migradas) ──
const planEmpSnap = await pDb.collection("empregados").get();
const planEmps = planEmpSnap.docs.map((d) => ({ docId: d.id, ...d.data() }));

const restNome = {};
restaurants.forEach((r) => (restNome[r.id] = r.name || r.nome || r.id));
const restIds = new Set(restaurants.map((r) => String(r.id)));

// ── Conjunto recuperável: 28 sobreviventes + cópias do Planejamento ──
const survivingIds = new Set(employees.map((e) => String(e.id)));
const survivingCodes = new Set(employees.filter((e) => e.empCode).map((e) => String(e.empCode)));
const recById = new Map(); // appTipEmpId  -> planEmp
const recByCode = new Map(); // appTipEmpCode -> planEmp
for (const pe of planEmps) {
  if (pe._migracaoAppTipEmpId) recById.set(String(pe._migracaoAppTipEmpId), pe);
  if (pe._migracaoAppTipEmpCode) recByCode.set(String(pe._migracaoAppTipEmpCode), pe);
}
const recuperavel = (token) => {
  const t = String(token);
  return (
    survivingIds.has(t) || survivingCodes.has(t) || recById.has(t) || recByCode.has(t)
  );
};
const ondeEsta = (token) => {
  const t = String(token);
  if (survivingIds.has(t) || survivingCodes.has(t)) return "sobrevivente";
  if (recById.has(t) || recByCode.has(t)) return "planejamento";
  return "ORFAO";
};

// ── Heurística: um token "parece" id/código de empregado? ──
const EMP_ID_RE = /^(emp_[a-z0-9]+|[A-Z]{2,5}\d{2,}|\d{10,}(-[a-z0-9]+)?)$/;
function pareceEmpId(tok) {
  if (typeof tok !== "string" && typeof tok !== "number") return false;
  const t = String(tok);
  if (restIds.has(t)) return false; // restaurantId também parece número longo — exclui
  return EMP_ID_RE.test(t);
}

// Extrai refs de empregado de uma estrutura: (a) campos com nome ~employeeId,
// (b) chaves de objeto que parecem id de empregado.
function collectRefs(node, out, depth = 0) {
  if (!node || depth > 8) return;
  if (Array.isArray(node)) {
    for (const x of node) collectRefs(x, out, depth + 1);
    return;
  }
  if (typeof node === "object") {
    for (const [k, val] of Object.entries(node)) {
      if (
        /^(employeeId|empId|empregadoId|employee_id|empCode|funcionarioId)$/i.test(k) &&
        (typeof val === "string" || typeof val === "number")
      ) {
        out.add(String(val));
      }
      if (pareceEmpId(k)) out.add(String(k));
      collectRefs(val, out, depth + 1);
    }
  }
}

function analisa(nome, doc) {
  const refs = new Set();
  collectRefs(doc, refs);
  let ok = 0;
  let orfao = 0;
  const orfaos = [];
  for (const r of refs) {
    if (recuperavel(r)) ok += 1;
    else {
      orfao += 1;
      orfaos.push(r);
    }
  }
  const total = refs.size;
  const pct = total ? Math.round((ok / total) * 100) : 100;
  console.log(
    `  ${nome.padEnd(18)} ${String(total).padStart(4)} refs   ${String(ok).padStart(4)} re-conectam (${pct}%)   ${orfao} órfãs`,
  );
  if (orfaos.length) console.log(`     órfãs: ${orfaos.slice(0, 12).join(", ")}${orfaos.length > 12 ? " …" : ""}`);
  return { total, ok, orfao, orfaos };
}

console.log("══════════════════════════════════════════════════════════════════");
console.log(" ANÁLISE DE RECUPERAÇÃO — read-only");
console.log("══════════════════════════════════════════════════════════════════");

console.log("\n── Conjunto recuperável ──");
console.log(`  AppTip sobreviventes (employees doc): ${employees.length}`);
console.log(`  Planejamento empregados (cópias):     ${planEmps.length}`);
console.log(`    com _migracaoAppTipEmpId:           ${recById.size}`);
console.log(`    com _migracaoAppTipEmpCode:         ${recByCode.size}`);
const universoRecuperavel = new Set([
  ...survivingIds,
  ...survivingCodes,
  ...recById.keys(),
  ...recByCode.keys(),
]);
console.log(`  → universo de IDs/códigos recuperáveis: ${universoRecuperavel.size}`);

console.log("\n── Re-conexão: docs INTACTOS do AppTip apontando pra empregados ──");
analisa("tips (gorjetas)", tips);
analisa("splits", splits);
analisa("schedules (escala)", schedules);
analisa("scheduleVersions", scheduleVersions);
analisa("schedulePrevista", schedulePrevista);
analisa("vtConfig", vtConfig);
analisa("vtMonthly", vtMonthly);
analisa("workSchedules", workSchedules);

console.log("\n── Planejamento: empregados por restaurante ──");
const porRest = {};
planEmps.forEach((e) => {
  porRest[e.restaurantId] = (porRest[e.restaurantId] || 0) + 1;
});
const planRestSnap = await pDb.collection("restaurants").get();
const planRestNome = {};
planRestSnap.docs.forEach((d) => (planRestNome[d.id] = d.data().nome || d.id));
for (const [rid, n] of Object.entries(porRest)) {
  console.log(`  ${(planRestNome[rid] || rid).padEnd(22)} ${n}`);
}

console.log("\n── Fidelidade de campos: o que o Planejamento preservou ──");
const pe = planEmps[0];
if (pe) {
  console.log("  campos num empregado do Planejamento:");
  console.log("   ", Object.keys(pe).join(", "));
}
const ae = employees[0];
if (ae) {
  console.log("  campos num employee sobrevivente do AppTip:");
  console.log("   ", Object.keys(ae).join(", "));
}

console.log("\n── Estrutura (amostra) dos docs de referência ──");
function amostra(nome, v) {
  if (Array.isArray(v)) {
    console.log(`  ${nome}: array[${v.length}] — item[0]:`, JSON.stringify(v[0] || null).slice(0, 260));
  } else if (v && typeof v === "object") {
    const ks = Object.keys(v);
    console.log(`  ${nome}: object{${ks.length}} — chaves[0..2]: ${ks.slice(0, 3).join(", ")}`);
    if (ks[0]) console.log(`     valor[${ks[0]}]:`, JSON.stringify(v[ks[0]]).slice(0, 260));
  }
}
amostra("tips", tips);
amostra("schedules", schedules);
amostra("vtConfig", vtConfig);

process.exit(0);
