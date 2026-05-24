// ════════════════════════════════════════════════════════════════════════════
//  REGENERA appdata/v4:pessoas — modo aditivo.
//
//  Replica a função pessoasMigrate(employees, managers) do AppTip (lendo direto
//  do código fonte, idêntica) e mescla:
//    • Mantém TODAS as 31 pessoas atuais byte-a-byte (preserva edições)
//    • ADICIONA as pessoas que faltam (employees novos que não têm pes_emp_*)
//
//  Não modifica nenhuma pessoa existente.
//
//  SEGURANÇA:
//    • DRY-RUN por padrão. Só escreve com --executar.
//    • Backup do estado atual num .json local antes de escrever.
//    • Mexe APENAS em appdata/v4:pessoas. Nada de employees/managers.
//
//  Uso:
//    node regenerar-pessoas.mjs              → dry-run
//    node regenerar-pessoas.mjs --executar   → escreve
// ════════════════════════════════════════════════════════════════════════════
import admin from "firebase-admin";
import { writeFileSync } from "node:fs";

const DRY = !process.argv.includes("--executar");

const apptip = admin.initializeApp(
  { credential: admin.credential.applicationDefault(), projectId: "gorjeta-app" },
  "apptip",
);
const aDb = admin.firestore(apptip);
const getVal = async (p) => {
  const s = await aDb.doc(p).get();
  return s.exists ? (s.data()?.value ?? null) : null;
};

// ── pessoasMigrate — réplica EXATA do AppTip src/App.js linha 21691 ──
function pessoasMigrate(employees, managers) {
  const pessoas = [];
  (employees || []).forEach((emp) => {
    const rid = emp.restaurantId;
    const pinFromCpf = (emp.cpf || "").replace(/\D/g, "").slice(0, 4).padEnd(4, "0");
    const p = {
      id: `pes_emp_${emp.id}`,
      restaurantIds: rid ? [rid] : [],
      name: emp.name || "",
      cpf: emp.cpf || "",
      pin: pinFromCpf,
      mustChangePin: true,
      email: emp.email || null,
      whatsapp: emp.whatsapp || null,
      isTeam: rid ? { [rid]: true } : {},
      teamData: rid
        ? {
            [rid]: {
              empCode: emp.empCode ?? null,
              roleId: emp.roleId ?? null,
              admission: emp.admission ?? null,
              inactive: !!emp.inactive,
              inactiveFrom: emp.inactiveFrom ?? null,
              demitidoEm: emp.demitidoEm ?? null,
              isFreela: !!emp.isFreela,
            },
          }
        : {},
      linkedEmployeeId: emp.id,
      permissions: rid
        ? { [rid]: { operational: emp.operationalAreas || {}, admin: {}, special: {} } }
        : {},
      createdAt: emp.createdAt || new Date().toISOString(),
    };
    pessoas.push(p);
  });
  (managers || []).forEach((mgr) => {
    let target = null;
    if (mgr.linkedEmpId) target = pessoas.find((p) => p.linkedEmployeeId === mgr.linkedEmpId);
    if (!target && mgr.cpf) {
      const cpfDigits = mgr.cpf.replace(/\D/g, "");
      if (cpfDigits.length > 0) {
        target = pessoas.find((p) => (p.cpf || "").replace(/\D/g, "") === cpfDigits);
      }
    }
    if (!target) {
      const pinFromCpf = (mgr.cpf || "").replace(/\D/g, "").slice(0, 4).padEnd(4, "0");
      target = {
        id: `pes_mgr_${mgr.id}`,
        restaurantIds: [],
        name: mgr.name || "",
        cpf: mgr.cpf || "",
        pin: pinFromCpf,
        mustChangePin: true,
        email: mgr.email || null,
        whatsapp: mgr.whatsapp || null,
        isTeam: {},
        teamData: {},
        linkedManagerId: mgr.id,
        permissions: {},
        createdAt: mgr.createdAt || new Date().toISOString(),
      };
      pessoas.push(target);
    } else {
      target.linkedManagerId = mgr.id;
    }
    const mgrRids = mgr.restaurantIds ?? (mgr.restaurantId ? [mgr.restaurantId] : []);
    mgrRids.forEach((rid) => {
      if (!target.restaurantIds.includes(rid)) target.restaurantIds.push(rid);
      if (!target.permissions[rid]) target.permissions[rid] = { operational: {}, admin: {}, special: {} };
      const perms = target.permissions[rid];
      if (mgr.perms?.tips) perms.admin.tips = true;
      if (mgr.perms?.schedule) perms.admin.schedule = true;
      if (mgr.perms?.vt !== false) perms.admin.vt = true;
      if (mgr.perms?.roles !== false) perms.admin.roles = true;
      if (mgr.perms?.employees !== false) perms.admin.employees = true;
      if (mgr.perms?.comunicados !== false) perms.admin.comunicados = true;
      if (mgr.perms?.faq !== false) perms.admin.faq = true;
      if (mgr.perms?.config !== false) perms.admin.config = true;
      if (mgr.isDP) perms.special.isDP = true;
      if (mgr.profile === "lider") {
        perms.special.profile = "lider";
        perms.special.areas = mgr.areas || [];
      }
      if (mgr.isMaster) perms.special.isMaster = true;
      if (mgr.pin && typeof mgr.pin === "string" && mgr.pin.length === 4) {
        target.pin = mgr.pin;
        target.mustChangePin = !!mgr.mustChangePin;
      }
    });
  });
  return pessoas;
}

// ── Carrega tudo ──
const pessoasAtuais = (await getVal("appdata/v4:pessoas")) || [];
const employees = (await getVal("appdata/v4:employees")) || [];
const managers = (await getVal("appdata/v4:managers")) || [];

// ── Roda o pessoasMigrate sobre o estado atual ──
const esperadas = pessoasMigrate(employees, managers);
const atuaisById = new Map(pessoasAtuais.map((p) => [p.id, p]));

const adicionadas = [];
for (const p of esperadas) {
  if (!atuaisById.has(p.id)) adicionadas.push(p);
}

const final = [...pessoasAtuais, ...adicionadas];
const finalIds = new Set(final.map((p) => p.id));

// ── Pessoas atuais que não correspondem a nenhum employee/manager hoje ──
const esperadasIds = new Set(esperadas.map((p) => p.id));
const orfasNaoLigadas = pessoasAtuais.filter((p) => !esperadasIds.has(p.id));

// ── Relatório ──
console.log("══════════════════════════════════════════════════════════════════");
console.log(` REGENERAR appdata/v4:pessoas  ${DRY ? "— DRY-RUN (não escreve)" : "— ⚠️  MODO EXECUÇÃO"}`);
console.log("══════════════════════════════════════════════════════════════════\n");

console.log("── Estado atual ──");
console.log(`  appdata/v4:pessoas:    ${pessoasAtuais.length} pessoas`);
console.log(`  appdata/v4:employees:  ${employees.length} empregados`);
console.log(`  appdata/v4:managers:   ${managers.length} managers`);
console.log("");

console.log("── O que pessoasMigrate produziria pra esse input ──");
console.log(`  total esperado:        ${esperadas.length} pessoas`);
console.log(`    pes_emp_*:           ${esperadas.filter((p) => p.id.startsWith("pes_emp_")).length}`);
console.log(`    pes_mgr_*:           ${esperadas.filter((p) => p.id.startsWith("pes_mgr_")).length}`);
console.log("");

console.log("── Merge aditivo ──");
console.log(`  mantidas (já existem, intactas):   ${pessoasAtuais.length}`);
console.log(`  adicionadas (faltavam):            ${adicionadas.length}`);
console.log(`  ─────────────────────────────────`);
console.log(`  TOTAL após merge:                  ${final.length}`);
console.log("");

if (orfasNaoLigadas.length) {
  console.log(`── ⚠ Pessoas existentes SEM employee/manager correspondente: ${orfasNaoLigadas.length} ──`);
  console.log("   (mantidas como estão — podem ser pessoas administrativas, criadas manualmente, etc.)");
  orfasNaoLigadas.slice(0, 20).forEach((p) => {
    console.log(`   ${p.id.padEnd(28)} ${p.name || "(s/ nome)"}`);
  });
  if (orfasNaoLigadas.length > 20) console.log(`   … +${orfasNaoLigadas.length - 20}`);
  console.log("");
}

console.log("── Pessoas ADICIONADAS (amostra) ──");
adicionadas.slice(0, 8).forEach((p) => {
  console.log(`  ${p.id.padEnd(28)} ${(p.name || "?").padEnd(34)} rest:${(p.restaurantIds[0] || "—").slice(-8)}`);
});
if (adicionadas.length > 8) console.log(`  … +${adicionadas.length - 8}`);
console.log("");

if (adicionadas.length > 0) {
  console.log("── Amostra: 1 pessoa adicionada (estrutura completa) ──");
  console.log("  " + JSON.stringify(adicionadas[0], null, 2).split("\n").join("\n  "));
  console.log("");
}

console.log("── Sanity check ──");
console.log(`  Pessoas atuais preservadas (mesmo id):  ${pessoasAtuais.every((p) => finalIds.has(p.id)) ? "✓ todas" : "✗ ALGUMA SUMIU"}`);
console.log(`  IDs duplicados no resultado:            ${final.length === new Set(final.map((p) => p.id)).size ? "✓ nenhum" : "✗ HÁ DUPLICADOS"}`);

if (DRY) {
  console.log("\n⚠️  DRY-RUN — nada foi escrito.");
  console.log("   Pra escrever:  node regenerar-pessoas.mjs --executar");
  process.exit(0);
}

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = `./backup-apptip-pessoas-${ts}.json`;
writeFileSync(backupPath, JSON.stringify(pessoasAtuais, null, 2));
console.log(`💾 Backup salvo em: ${backupPath}`);

await aDb.doc("appdata/v4:pessoas").set({ value: final });
console.log(`✅ appdata/v4:pessoas atualizado — ${final.length} pessoas gravadas (${adicionadas.length} novas).`);
process.exit(0);
