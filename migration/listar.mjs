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

  // ─── Sample de 1 employee do AppTip ─────────────────────────────────────
  if (employeesApptip.length > 0) {
    console.log("📋 Exemplo de employee no AppTip (campos disponíveis):");
    const sampleEmp = employeesApptip[0];
    Object.keys(sampleEmp).forEach(k => {
      let val = sampleEmp[k];
      if (typeof val === "object" && val !== null) {
        val = JSON.stringify(val).slice(0, 80);
      } else if (typeof val === "string" && val.length > 80) {
        val = val.slice(0, 80) + "...";
      }
      console.log(`   ${k.padEnd(20)} ${val ?? "(null)"}`);
    });
    console.log();
  }

  // ─── Sample de 1 role do AppTip ──────────────────────────────────────────
  const rolesApptipDoc = await apptipDb.doc("appdata/v4:roles").get();
  const rolesApptip = rolesApptipDoc.exists ? (rolesApptipDoc.data()?.value || []) : [];
  console.log(`📋 ${rolesApptip.length} cargos no AppTip.`);
  if (rolesApptip.length > 0) {
    console.log("    Exemplo de cargo:");
    const sampleRole = rolesApptip[0];
    Object.keys(sampleRole).forEach(k => {
      let val = sampleRole[k];
      if (typeof val === "object" && val !== null) {
        val = JSON.stringify(val).slice(0, 80);
      }
      console.log(`       ${k.padEnd(18)} ${val ?? "(null)"}`);
    });
    console.log();
  }

  // ─── Lista TODOS os docs em /appdata pra descobrir nomes reais ───────────
  console.log("📋 Todos os docs em /appdata (pra descobrir chaves):");
  const appdataSnap = await apptipDb.collection("appdata").get();
  const allDocIds = appdataSnap.docs.map(d => d.id).sort();
  // Filtra os que parecem relevantes pra migração
  const interessantes = allDocIds.filter(id =>
    /work|schedule|horario|vt|tip|employee|cargo|role|pessoa|empregado/i.test(id)
  );
  console.log("    Docs relevantes:");
  interessantes.forEach(id => console.log(`       ${id}`));
  console.log(`    (total: ${allDocIds.length} docs em /appdata)`);
  console.log();

  // ─── workSchedules: lê bruto e mostra a estrutura (array OU map) ─────────
  const wsDoc = await apptipDb.doc("appdata/v4:workSchedules").get();
  let wsApptip = [];
  if (wsDoc.exists) {
    const data = wsDoc.data() || {};
    console.log(`📋 Doc /appdata/v4:workSchedules — top-level keys: ${Object.keys(data).join(", ")}`);
    const raw = data.value;
    if (Array.isArray(raw)) {
      wsApptip = raw;
      console.log(`    Formato: array com ${raw.length} itens`);
    } else if (raw && typeof raw === "object") {
      const entries = Object.entries(raw);
      console.log(`    Formato: objeto/map com ${entries.length} chaves`);
      // Converte pra array adicionando o key como _key
      wsApptip = entries.map(([k, v]) => ({ _key: k, ...(typeof v === "object" ? v : { value: v }) }));
    } else {
      console.log(`    Formato inesperado: ${typeof raw}`);
    }
    if (wsApptip.length > 0) {
      console.log("    Primeiro item (JSON completo):");
      console.log("    " + JSON.stringify(wsApptip[0], null, 2).split("\n").join("\n    "));
      console.log();
      if (wsApptip.length > 1) {
        console.log("    Segundo item (pra ver se varia):");
        console.log("    " + JSON.stringify(wsApptip[1], null, 2).split("\n").join("\n    "));
        console.log();
      }
    }
  } else {
    console.log("⚠️ Doc /appdata/v4:workSchedules não existe.\n");
  }

  // ─── VT config: ver se existe estrutura ────────────────────────────────
  const vtCfgDoc = await apptipDb.doc("appdata/v4:vtConfig").get();
  if (vtCfgDoc.exists) {
    const data = vtCfgDoc.data() || {};
    console.log(`📋 Doc /appdata/v4:vtConfig — top-level keys: ${Object.keys(data).join(", ")}`);
    const raw = data.value;
    if (raw) {
      const sample = Array.isArray(raw) ? raw[0] : (typeof raw === "object" ? Object.entries(raw)[0] : raw);
      console.log("    Sample:");
      console.log("    " + JSON.stringify(sample, null, 2).split("\n").join("\n    "));
      console.log();
    }
  }

  // ─── Compatibilidade: contagem por restaurante ──────────────────────────
  console.log("📊 Por restaurante do AppTip:");
  for (const r of restApptip) {
    const emps = employeesApptip.filter(e => e.restaurantId === r.id);
    const empIds = new Set(emps.map(e => e.id));
    const wsCount = Array.isArray(wsApptip)
      ? wsApptip.filter(w => empIds.has(w.employeeId) || empIds.has(w.empId) || empIds.has(w.id)).length
      : 0;
    console.log(`   ${(r.name || r.nome || "?").padEnd(28)} employees: ${emps.length}, com horário: ${wsCount}`);
  }
  console.log();

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
