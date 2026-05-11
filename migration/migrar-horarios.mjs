// ════════════════════════════════════════════════════════════════════════════
//  Migra workSchedules do AppTip → empregados.workSchedules[] no Planejamento
//
//  Lê de:  gorjeta-app   /appdata/v4:workSchedules
//  Escreve em: gestaocentral-85b13   /empregados/{id} (campo workSchedules[])
//
//  Estrutura AppTip:
//    value: { [rid]: { [empKey]: [schedule, ...] } }
//    empKey pode ser emp.id ou emp.empCode (varia por empregado).
//
//  Cada schedule AppTip tem: { validFrom, days{0-6: {in, out, break}}, totalContract, createdAt, createdBy, id }
//  No Planejamento adiciona `active: true` aos dias presentes + `type: "single"` se não tiver.
//
//  Match com empregado do Planejamento: usa campos auxiliares
//  `_migracaoAppTipEmpId` e `_migracaoAppTipEmpCode` adicionados por
//  migrar-empregados.mjs. Por isso, RODE empregados ANTES.
//
//  Uso:
//    node migrar-horarios.mjs --from=<rid-apptip> --to=<rid-planejamento>
//                             [--dry-run]
// ════════════════════════════════════════════════════════════════════════════

import admin from "firebase-admin";

const APPTIP_PROJECT = "gorjeta-app";
const PLAN_PROJECT = "gestaocentral-85b13";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [[m[1], m[2] ?? true]] : [];
  })
);

const ridApptip = args.from;
const ridPlan = args.to;
const dryRun = !!args["dry-run"];

if (!ridApptip || !ridPlan) {
  console.error("❌ Uso: node migrar-horarios.mjs --from=<rid-apptip> --to=<rid-planejamento> [--dry-run]");
  process.exit(1);
}

const apptip = admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: APPTIP_PROJECT,
}, "apptip");
const plan = admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: PLAN_PROJECT,
}, "plan");
const apptipDb = admin.firestore(apptip);
const planDb = admin.firestore(plan);

// Converte 1 schedule do AppTip pro schema do Planejamento
function convertSchedule(s) {
  const daysOut = {};
  if (s.days) {
    for (const [k, v] of Object.entries(s.days)) {
      if (!v || typeof v !== "object") continue;
      daysOut[k] = {
        active: true,
        in: v.in || undefined,
        out: v.out || undefined,
        break: typeof v.break === "number" ? v.break : 0,
      };
      // Limpa undefined
      if (!daysOut[k].in) delete daysOut[k].in;
      if (!daysOut[k].out) delete daysOut[k].out;
    }
  }
  return {
    validFrom: s.validFrom || "2024-01-01",
    type: s.type || "single",
    totalContract: typeof s.totalContract === "number" ? s.totalContract : 0,
    days: daysOut,
    registradoEm: s.createdAt || new Date().toISOString(),
    registradoPor: "migration-script",
    motivo: s.createdBy ? `Importado do AppTip (criado por ${s.createdBy})` : "Importado do AppTip",
  };
}

async function main() {
  console.log(`\n🔄 Migrando horários: AppTip[${ridApptip}] → Planejamento[${ridPlan}]`);
  if (dryRun) console.log("⚠️ DRY-RUN: nada será escrito.\n");

  // ── Lê workSchedules do AppTip ──
  const wsDoc = await apptipDb.doc("appdata/v4:workSchedules").get();
  if (!wsDoc.exists) {
    console.error("❌ /appdata/v4:workSchedules não existe.");
    process.exit(1);
  }
  const wsAll = wsDoc.data()?.value || {};
  const wsRest = wsAll[ridApptip] || {};
  const empKeys = Object.keys(wsRest);
  console.log(`📋 ${empKeys.length} empregados com workSchedule no AppTip pra este restaurante.`);

  // ── Lê empregados do Planejamento ──
  const empsSnap = await planDb.collection("empregados").where("restaurantId", "==", ridPlan).get();
  console.log(`📋 ${empsSnap.size} empregados no Planejamento pra este restaurante.`);

  // Mapa: chave → docId. A chave pode ser appTipEmpId OU appTipEmpCode.
  const empPorChave = new Map();
  empsSnap.docs.forEach(d => {
    const data = d.data();
    if (data._migracaoAppTipEmpId)   empPorChave.set(data._migracaoAppTipEmpId, { id: d.id, data });
    if (data._migracaoAppTipEmpCode) empPorChave.set(data._migracaoAppTipEmpCode, { id: d.id, data });
  });

  // ── Processa cada empKey do AppTip ──
  let atualizados = 0, semEmpregado = 0, semSchedules = 0;
  const erros = [];

  for (const empKey of empKeys) {
    try {
      const schedules = wsRest[empKey];
      if (!Array.isArray(schedules) || schedules.length === 0) {
        semSchedules++;
        continue;
      }
      const match = empPorChave.get(empKey);
      if (!match) {
        semEmpregado++;
        erros.push({ empKey, motivo: "Empregado não encontrado no Planejamento (rode migrar-empregados primeiro?)" });
        continue;
      }

      // Converte todos os schedules versionados
      const convertidos = schedules
        .map(convertSchedule)
        .sort((a, b) => (a.validFrom || "").localeCompare(b.validFrom || ""));

      if (!dryRun) {
        await planDb.doc(`empregados/${match.id}`).update({
          workSchedules: convertidos,
        });
      }
      atualizados++;
      console.log(`  ✓ ${match.data.nome || "?"} (${empKey}): ${convertidos.length} schedule(s) versionado(s)`);
    } catch (e) {
      erros.push({ empKey, motivo: e.message });
      console.error(`  ❌ ${empKey}: ${e.message}`);
    }
  }

  // ── Resumo ──
  console.log(`\n┌─ ${"━".repeat(56)}`);
  console.log("│ 📊 RESUMO");
  console.log(`├─ ${"━".repeat(56)}`);
  console.log(`│  ✅ Empregados com horário atualizado: ${atualizados}`);
  console.log(`│  ⚠ Sem empregado correspondente:       ${semEmpregado}`);
  console.log(`│  ⚠ Schedules vazios:                    ${semSchedules}`);
  console.log(`│  ❌ Erros:                              ${erros.length - semEmpregado}`);
  console.log(`└─ ${"━".repeat(56)}`);

  if (erros.length) {
    console.log("\n❌ ERROS:");
    erros.forEach(e => console.log(`  • ${e.empKey}: ${e.motivo}`));
  }

  if (dryRun) {
    console.log("\n⚠️ DRY-RUN — nada foi escrito. Roda sem --dry-run pra fazer de verdade.");
  } else {
    console.log("\n✅ Migração de horários concluída.");
  }
  process.exit(0);
}

main().catch(err => {
  console.error("❌ Erro fatal:", err.message);
  console.error(err);
  process.exit(1);
});
