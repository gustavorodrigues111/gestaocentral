// ════════════════════════════════════════════════════════════════════════════
//  Inspeção: lista restaurantes dos 2 projetos e mostra contagem de pessoas
//  do AppTip. Ajuda a decidir mapeamento antes de rodar a migração.
//
//  Roda com: npm run listar
// ════════════════════════════════════════════════════════════════════════════

import admin from "firebase-admin";

const APPTIP_PROJECT = "gorjeta-app";
const PLAN_PROJECT = "gestaocentral-85b13";

// Inicializa 2 apps Firebase Admin separados (1 por projeto)
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

async function main() {
  // ── AppTip: restaurantes vivem em /appdata/v4:restaurants (campo value: array)
  console.log("\n📥 Buscando dados do AppTip...");
  const restApptipDoc = await apptipDb.doc("appdata/v4:restaurants").get();
  if (!restApptipDoc.exists) {
    console.error("❌ Doc /appdata/v4:restaurants não existe no AppTip");
    process.exit(1);
  }
  const restApptip = restApptipDoc.data()?.value || [];

  // ── AppTip: pessoas em /appdata/v4:pessoas (campo value: array)
  const pessoasApptipDoc = await apptipDb.doc("appdata/v4:pessoas").get();
  const pessoasApptip = pessoasApptipDoc.exists ? (pessoasApptipDoc.data()?.value || []) : [];

  // ── AppTip: employees em /appdata/v4:employees
  const employeesApptipDoc = await apptipDb.doc("appdata/v4:employees").get();
  const employeesApptip = employeesApptipDoc.exists ? (employeesApptipDoc.data()?.value || []) : [];

  // ── Planejamento: restaurantes em /restaurants (coleção normal)
  console.log("📥 Buscando dados do Planejamento...");
  const restPlanSnap = await planDb.collection("restaurants").get();
  const restPlan = restPlanSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // ─── Resumo AppTip ─────────────────────────────────────────────────────────
  console.log(`\n┌─ ${"━".repeat(56)}`);
  console.log("│ 🏠 RESTAURANTES NO APPTIP");
  console.log(`├─ ${"━".repeat(56)}`);
  if (restApptip.length === 0) {
    console.log("│   (nenhum)");
  } else {
    restApptip.forEach(r => {
      const pessoasRest = pessoasApptip.filter(p => p.isTeam && p.isTeam[r.id] === true).length;
      const empregadosRest = employeesApptip.filter(e => e.restaurantId === r.id).length;
      console.log(`│   ${r.id}  →  ${r.name || r.nome || "(sem nome)"}`);
      console.log(`│   ${" ".repeat(13)}     pessoas: ${pessoasRest}, employees: ${empregadosRest}`);
    });
  }

  // ─── Resumo Planejamento ───────────────────────────────────────────────────
  console.log(`├─ ${"━".repeat(56)}`);
  console.log("│ 🎯 RESTAURANTES NO PLANEJAMENTO");
  console.log(`├─ ${"━".repeat(56)}`);
  if (restPlan.length === 0) {
    console.log("│   (nenhum)");
  } else {
    restPlan.forEach(r => {
      const unidades = r.unidades || [];
      console.log(`│   ${r.id}  →  ${r.nome || "(sem nome)"}`);
      console.log(`│   ${" ".repeat(13)}     unidades: ${unidades.length > 0 ? unidades.map(u => u.nome).join(", ") : "(nenhuma)"}`);
    });
  }

  // ─── Totais gerais ─────────────────────────────────────────────────────────
  console.log(`├─ ${"━".repeat(56)}`);
  console.log("│ 📊 TOTAIS");
  console.log(`├─ ${"━".repeat(56)}`);
  console.log(`│   AppTip:        ${pessoasApptip.length} pessoas, ${employeesApptip.length} employees`);
  console.log(`│   Planejamento:  ${(await planDb.collection("pessoas").get()).size} pessoas, ${(await planDb.collection("empregados").get()).size} empregados`);
  console.log(`└─ ${"━".repeat(56)}\n`);

  // ─── Sample de 1 pessoa do AppTip pra ver estrutura ─────────────────────
  if (pessoasApptip.length > 0) {
    console.log("📋 Exemplo de pessoa no AppTip (campos disponíveis):");
    const sample = pessoasApptip[0];
    Object.keys(sample).forEach(k => {
      let val = sample[k];
      if (typeof val === "object" && val !== null) {
        val = JSON.stringify(val).slice(0, 60);
      } else if (typeof val === "string" && val.length > 60) {
        val = val.slice(0, 60) + "...";
      }
      console.log(`   ${k.padEnd(20)} ${val ?? "(null)"}`);
    });
    console.log();
  }

  console.log("✅ Inspeção concluída.\n");
  console.log("📝 Pra migrar pessoas, anote os 2 IDs (AppTip + Planejamento) do");
  console.log("   restaurante que quer migrar e rode:");
  console.log("\n   node migrar-pessoas.mjs --from=<rid-apptip> --to=<rid-planejamento>\n");
  console.log("   Adicione --dry-run pra simular sem escrever:");
  console.log("   node migrar-pessoas.mjs --from=... --to=... --dry-run\n");

  process.exit(0);
}

main().catch(err => {
  console.error("❌ Erro:", err.message);
  console.error(err);
  process.exit(1);
});
