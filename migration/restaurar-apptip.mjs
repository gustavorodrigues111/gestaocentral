// ════════════════════════════════════════════════════════════════════════════
//  RESTAURAÇÃO do doc appdata/v4:employees do AppTip (gorjeta-app)
//
//  Reconstrói o doc a partir de:
//    • os 28 sobreviventes (Sororoca) — mantidos intactos
//    • as cópias do Planejamento (Lobozó + Puba) — reconstruídas no schema do
//      AppTip, com os IDs ORIGINAIS (_migracaoAppTipEmpId)
//    • os 10 órfãos — registros-esqueleto pra gorjeta/escala não ficarem com
//      referência quebrada (você corrige nome/CPF na UI depois)
//
//  SEGURANÇA:
//    • DRY-RUN por padrão. Só escreve com --executar.
//    • Antes de escrever, salva backup do estado atual num .json local.
//    • Mexe APENAS em appdata/v4:employees. Nada de managers/pessoas.
//
//  Uso:
//    node restaurar-apptip.mjs              → dry-run (não escreve)
//    node restaurar-apptip.mjs --executar   → escreve de verdade
// ════════════════════════════════════════════════════════════════════════════
import admin from "firebase-admin";
import { writeFileSync } from "node:fs";

const DRY = !process.argv.includes("--executar");

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
const getVal = async (p) => {
  const s = await aDb.doc(p).get();
  return s.exists ? (s.data()?.value ?? null) : null;
};

// ── Config dos órfãos (do diagnóstico identificar-orfaos / cacar-nomes) ──
// Edite aqui se souber nome/CPF de algum.
const ORFAOS = {
  emp_mofwug1bf04: { restaurantId: "1777204146548", area: "Cozinha", nome: "⚠️ RECUPERAR — Puba matriz / Cozinha (ativo abr-mai)" },
  emp_mofwwdg1oku: { restaurantId: "1777204191993", area: "Bar",     nome: "⚠️ RECUPERAR — Puba Filial / Bar (ativo abr-mai)" },
  emp_mofwwdg1iy8: { restaurantId: "1777204191993", area: "Cozinha", nome: "⚠️ RECUPERAR — Puba Filial / Cozinha (ativo abr-mai)" },
  emp_mofwwdg1pnr: { restaurantId: "1777204191993", area: "Cozinha", nome: "⚠️ RECUPERAR — Puba Filial / Cozinha (ativo abr-mai)" },
  emp_morfrq6buxd: { restaurantId: "",              area: "Salão",   nome: "⚠️ RECUPERAR — restaurante? / Salão (ativo abr-mai)" },
  emp_moo9la2ul2a: { restaurantId: "1775792314382", area: "",        nome: "⚠️ RECUPERAR — Lobozó (sem gorjetas)" },
  emp_mordl32od8y: { restaurantId: "1775792314382", area: "",        nome: "Veronica de Cassia Macedo Stivanim" },
  emp_morlq5zwedi: { restaurantId: "1775792279549", area: "",        nome: "⚠️ RECUPERAR — Sororoca (sem gorjetas)" },
  "1775830282844": { restaurantId: "1775792279549", area: "",        nome: "⚠️ RECUPERAR — Sororoca (ID antigo)" },
  "1775830410477": { restaurantId: "1775792279549", area: "",        nome: "⚠️ RECUPERAR — Sororoca (ID antigo)" },
};

// ── Carrega tudo ──
const survivors = (await getVal("appdata/v4:employees")) || [];
const roles = (await getVal("appdata/v4:roles")) || [];
const restaurants = (await getVal("appdata/v4:restaurants")) || [];
const restNome = {};
restaurants.forEach((r) => (restNome[r.id] = r.name || r.nome || r.id));

const planEmpSnap = await pDb.collection("empregados").get();
const planEmps = planEmpSnap.docs.map((d) => ({ docId: d.id, ...d.data() }));
const planCargoSnap = await pDb.collection("cargos").get();
const cargoById = {};
planCargoSnap.docs.forEach((d) => (cargoById[d.id] = d.data()));

// ── Reverse-map de cargo → roleId do AppTip ──
const norm = (s) => (s || "").trim().toLowerCase();
const roleByRidNomeArea = new Map();
const roleByRidNome = new Map();
const roleByNomeArea = new Map();
for (const r of roles) {
  const rid = String(r.restaurantId || "");
  roleByRidNomeArea.set(`${rid}|${norm(r.name)}|${norm(r.area)}`, r.id);
  if (!roleByRidNome.has(`${rid}|${norm(r.name)}`)) roleByRidNome.set(`${rid}|${norm(r.name)}`, r.id);
  if (!roleByNomeArea.has(`${norm(r.name)}|${norm(r.area)}`)) roleByNomeArea.set(`${norm(r.name)}|${norm(r.area)}`, r.id);
}
function acharRoleId(rid, nome, area) {
  return (
    roleByRidNomeArea.get(`${rid}|${norm(nome)}|${norm(area)}`) ||
    roleByRidNome.get(`${rid}|${norm(nome)}`) ||
    roleByNomeArea.get(`${norm(nome)}|${norm(area)}`) ||
    ""
  );
}
function primeiroRolePorArea(rid, area) {
  if (!area) return "";
  const r = roles.find((x) => String(x.restaurantId) === String(rid) && norm(x.area) === norm(area));
  return r ? r.id : "";
}

// ── Reconstrói 1 empregado do AppTip a partir de 1 empregado do Planejamento ──
let roleOk = 0;
let roleMiss = 0;
function reconstruir(pe) {
  const id = String(pe._migracaoAppTipEmpId || "");
  const rid = String(pe._migracaoRidApptip || pe.restaurantId || "");
  const cpfDigits = (pe.cpf || "").replace(/\D/g, "");
  const cargo = cargoById[pe.cargoId];
  const roleId = cargo ? acharRoleId(rid, cargo.nome, cargo.area) : "";
  if (roleId) roleOk += 1;
  else roleMiss += 1;
  const ativo = pe.estaAtivo !== false;
  const emp = {
    id,
    name: pe.nome || "",
    cpf: pe.cpf || "",
    restaurantId: rid,
    roleId,
    empCode: pe._migracaoAppTipEmpCode || pe.empCode || "",
    codigoContabil: pe.codigoContabil || "",
    admission: pe.admissaoAtual || pe.periodos?.[0]?.admissao || "",
    pin: cpfDigits.slice(0, 4).padEnd(4, "0"),
    mustChangePin: true,
    email: pe.email || null,
    phone: pe.telefone || null,
    emergencyName: pe.emergenciaNome || null,
    emergencyPhone: pe.emergenciaTelefone || null,
    createdAt: pe.createdAt || new Date().toISOString(),
    _restauradoDoPlanejamento: true,
  };
  if (!ativo) {
    emp.inactive = true;
    emp.inactiveFrom = pe.demitidoEm || pe.admissaoAtual || "";
  }
  return emp;
}

function skeletonOrfao(id, cfg) {
  return {
    id,
    name: cfg.nome,
    cpf: "",
    restaurantId: cfg.restaurantId || "",
    roleId: cfg.area ? primeiroRolePorArea(cfg.restaurantId, cfg.area) : "",
    empCode: "",
    codigoContabil: "",
    admission: "",
    pin: "0000",
    mustChangePin: true,
    _restauradoComoEsqueleto: true,
  };
}

// ── Monta o array final ──
const final = [...survivors];
const have = new Set(survivors.map((e) => String(e.id)));

let addPlan = 0;
let skipJaSobrevivente = 0;
let skipSemId = 0;
const semIdList = [];
for (const pe of planEmps) {
  const id = String(pe._migracaoAppTipEmpId || "");
  if (!id) { skipSemId += 1; semIdList.push(pe.nome || pe.docId); continue; }
  if (have.has(id)) { skipJaSobrevivente += 1; continue; }
  final.push(reconstruir(pe));
  have.add(id);
  addPlan += 1;
}

let addOrfaos = 0;
for (const [oid, cfg] of Object.entries(ORFAOS)) {
  if (have.has(oid)) continue;
  final.push(skeletonOrfao(oid, cfg));
  have.add(oid);
  addOrfaos += 1;
}

// ── Relatório ──
console.log("══════════════════════════════════════════════════════════════════");
console.log(` RESTAURAÇÃO appdata/v4:employees  ${DRY ? "— DRY-RUN (não escreve)" : "— ⚠️  MODO EXECUÇÃO"}`);
console.log("══════════════════════════════════════════════════════════════════\n");

console.log("── Composição do array final ──");
console.log(`  sobreviventes mantidos (Sororoca):     ${survivors.length}`);
console.log(`  reconstruídos do Planejamento:          ${addPlan}`);
console.log(`  órfãos como esqueleto:                  ${addOrfaos}`);
console.log(`  ─────────────────────────────────────`);
console.log(`  TOTAL no doc restaurado:                ${final.length}`);
console.log(`  (antes: ${survivors.length}  →  depois: ${final.length})`);
console.log("");
console.log(`  Planejamento pulados (já eram sobreviventes): ${skipJaSobrevivente}`);
if (skipSemId) console.log(`  Planejamento SEM _migracaoAppTipEmpId (não dá pra restaurar): ${skipSemId} → ${semIdList.join(", ")}`);
console.log("");

console.log("── Por restaurante (resultado final) ──");
const porRest = {};
final.forEach((e) => {
  const r = e.restaurantId || "(sem rid)";
  porRest[r] = (porRest[r] || 0) + 1;
});
for (const [rid, n] of Object.entries(porRest)) {
  console.log(`  ${(restNome[rid] || rid).padEnd(26)} ${n}`);
}
console.log("");

console.log("── roleId (cargo) remapeado ──");
console.log(`  com roleId encontrado:  ${roleOk}`);
console.log(`  sem roleId (cargo não casou — fica vazio, ajustar na UI): ${roleMiss}`);
console.log("");

console.log("── Órfãos incluídos como esqueleto ──");
for (const [oid, cfg] of Object.entries(ORFAOS)) {
  console.log(`  ${oid.padEnd(20)} ${(restNome[cfg.restaurantId] || cfg.restaurantId || "?").padEnd(24)} ${cfg.nome}`);
}
console.log("");

console.log("── Amostra: 1 registro reconstruído do Planejamento ──");
const amostra = final.find((e) => e._restauradoDoPlanejamento);
console.log("  " + JSON.stringify(amostra, null, 2).split("\n").join("\n  "));
console.log("");

if (DRY) {
  console.log("⚠️  DRY-RUN — nada foi escrito.");
  console.log("   Revise os números acima. Pra escrever de verdade:");
  console.log("   node restaurar-apptip.mjs --executar");
  process.exit(0);
}

// ── Execução real ──
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = `./backup-apptip-employees-${ts}.json`;
writeFileSync(backupPath, JSON.stringify(survivors, null, 2));
console.log(`💾 Backup do estado atual salvo em: ${backupPath}`);

await aDb.doc("appdata/v4:employees").set({ value: final });
console.log(`✅ appdata/v4:employees restaurado — ${final.length} empregados gravados.`);
console.log("");
console.log("📋 Próximos passos:");
console.log("   • Conferir no AppTip (Equipe) se os empregados voltaram");
console.log("   • Corrigir nome/CPF dos órfãos marcados com ⚠️ RECUPERAR");
console.log("   • Verificar managers e pessoas (não foram tocados por este script)");
process.exit(0);
