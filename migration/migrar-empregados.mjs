// ════════════════════════════════════════════════════════════════════════════
//  Migra Empregados do AppTip → Planejamento
//
//  Lê de:  gorjeta-app   /appdata/v4:employees, v4:roles, v4:vtConfig
//  Escreve em: gestaocentral-85b13   /empregados
//
//  Pré-requisito: rodar `migrar-pessoas.mjs` antes — empregado é vinculado
//  a Pessoa existente (matched por CPF; fallback nome se sem CPF).
//
//  Mapeamento de unidade (caso Puba Bar com Matriz/Filial/Cozinha):
//   - Cargo com area="Cozinha" → unidade "Cozinha de Produção" (se existir)
//   - Senão se rid origem é Matriz (--from-tipo=matriz)  → "Cidade Velha"
//   - Senão se rid origem é Filial (--from-tipo=filial)  → "Porto Futuro"
//   - Senão (restaurante single-unit) → primeira unidade ativa do destino
//
//  Detecta duplicata: se Pessoa já tem empregado no rid destino → skip.
//
//  Uso:
//    node migrar-empregados.mjs --from=<rid-apptip> --to=<rid-planejamento>
//                               [--from-tipo=matriz|filial]
//                               [--admissao-default=2024-01-01]
//                               [--dry-run]
// ════════════════════════════════════════════════════════════════════════════

import admin from "firebase-admin";

const APPTIP_PROJECT = "gorjeta-app";
const PLAN_PROJECT = "gestaocentral-85b13";

// Parse args
const args = Object.fromEntries(
  process.argv.slice(2).flatMap(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [[m[1], m[2] ?? true]] : [];
  })
);

const ridApptip = args.from;
const ridPlan = args.to;
const fromTipo = args["from-tipo"];   // "matriz" | "filial" | undefined
const admissaoDefault = args["admissao-default"] || "2024-01-01";
const dryRun = !!args["dry-run"];

if (!ridApptip || !ridPlan) {
  console.error("❌ Uso: node migrar-empregados.mjs --from=<rid-apptip> --to=<rid-planejamento>");
  console.error("        [--from-tipo=matriz|filial] [--admissao-default=YYYY-MM-DD] [--dry-run]");
  process.exit(1);
}

// Init apps
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

function onlyDigits(s) {
  return String(s || "").replace(/\D/g, "");
}
function clean(s) {
  if (s == null) return undefined;
  const t = String(s).trim();
  return t || undefined;
}
function sanitize(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

async function main() {
  console.log(`\n🔄 Migrando empregados: AppTip[${ridApptip}] → Planejamento[${ridPlan}]`);
  if (fromTipo) console.log(`   Tipo do rid origem: ${fromTipo}`);
  if (dryRun) console.log("⚠️  DRY-RUN: nada será escrito.\n");

  // ── Lê dados do AppTip ──
  const [empsDoc, rolesDoc, vtConfigDoc] = await Promise.all([
    apptipDb.doc("appdata/v4:employees").get(),
    apptipDb.doc("appdata/v4:roles").get(),
    apptipDb.doc("appdata/v4:vtConfig").get(),
  ]);

  const allEmps = empsDoc.exists ? (empsDoc.data()?.value || []) : [];
  const allRoles = rolesDoc.exists ? (rolesDoc.data()?.value || []) : [];

  // vtConfig é array de [rid, {empKey: {dailyRate}}]
  const vtConfigRaw = vtConfigDoc.exists ? (vtConfigDoc.data()?.value || []) : [];
  const vtConfigMap = new Map();
  for (const pair of vtConfigRaw) {
    if (Array.isArray(pair) && pair.length >= 2) {
      vtConfigMap.set(pair[0], pair[1]);
    }
  }
  const vtRest = vtConfigMap.get(ridApptip) || {};

  // Filtra employees do rid origem
  const emps = allEmps.filter(e => e.restaurantId === ridApptip);
  console.log(`📋 ${emps.length} employees no AppTip pra este restaurante (de ${allEmps.length} totais).`);

  // Map de roles do rid origem (por id e por nome)
  const rolesRest = allRoles.filter(r => r.restaurantId === ridApptip);
  const rolesByIdApptip = new Map(rolesRest.map(r => [r.id, r]));

  // ── Lê dados do Planejamento ──
  console.log("📥 Buscando pessoas e cargos do Planejamento...");
  const [pessoasPlanSnap, cargosPlanSnap, empsPlanSnap, restPlanDoc] = await Promise.all([
    planDb.collection("pessoas").get(),
    planDb.collection("cargos").where("restaurantId", "==", ridPlan).get(),
    planDb.collection("empregados").where("restaurantId", "==", ridPlan).get(),
    planDb.doc(`restaurants/${ridPlan}`).get(),
  ]);

  // Mapa de Pessoas por CPF (limpo) e por nome (lowercase)
  const pessoasPorCpf = new Map();
  const pessoasPorNome = new Map();
  pessoasPlanSnap.docs.forEach(d => {
    const data = { id: d.id, ...d.data() };
    const cpf = onlyDigits(data.cpf);
    if (cpf) pessoasPorCpf.set(cpf, data);
    if (data.nome) pessoasPorNome.set(data.nome.trim().toLowerCase(), data);
  });

  // Cargos do Planejamento por (nome+area) — case-insensitive
  const cargosByKey = new Map();
  cargosPlanSnap.docs.forEach(d => {
    const data = { id: d.id, ...d.data() };
    const key = `${(data.nome || "").trim().toLowerCase()}|${(data.area || "").trim().toLowerCase()}`;
    cargosByKey.set(key, data);
  });

  // Empregados existentes no destino (pra detectar duplicata)
  const empsExistentesPorPessoa = new Set();
  empsPlanSnap.docs.forEach(d => {
    const data = d.data();
    if (data.pessoaId) empsExistentesPorPessoa.add(data.pessoaId);
  });

  // Restaurante destino: unidades
  const restPlanData = restPlanDoc.exists ? restPlanDoc.data() : null;
  const unidades = (restPlanData?.unidades || []).filter(u => u.ativa);
  const unidadePorNome = new Map(unidades.map(u => [u.nome.trim().toLowerCase(), u]));
  const unidadeProducao = unidades.find(u => u.tipo === "producao");
  const primeiraAtendimento = unidades.find(u => u.tipo === "atendimento");

  // Resolve unidade padrão pra um empregado, dado seu role
  function resolverUnidadePadrao(role) {
    if (!unidades.length) return null;
    const areaCozinha = role && (role.area || "").toLowerCase() === "cozinha";
    if (areaCozinha && unidadeProducao) return unidadeProducao.id;
    if (fromTipo === "matriz") {
      const m = unidadePorNome.get("cidade velha");
      if (m) return m.id;
    }
    if (fromTipo === "filial") {
      const f = unidadePorNome.get("porto futuro");
      if (f) return f.id;
    }
    // Single-unit ou default: primeira de atendimento
    return primeiraAtendimento?.id || unidades[0].id;
  }

  // ── Processa cada employee ──
  let criados = 0, pulados = 0, semPessoa = 0, semCargo = 0, jaTinha = 0;
  const erros = [];
  const avisos = [];

  for (const emp of emps) {
    try {
      // 1. Acha Pessoa correspondente
      const cpfClean = onlyDigits(emp.cpf);
      let pessoa = cpfClean ? pessoasPorCpf.get(cpfClean) : null;
      if (!pessoa) {
        // Fallback: nome (case-insensitive)
        pessoa = pessoasPorNome.get((emp.name || "").trim().toLowerCase()) || null;
      }
      if (!pessoa) {
        semPessoa++;
        erros.push({ nome: emp.name, motivo: "Pessoa não encontrada (CPF nem nome bateram)" });
        continue;
      }

      // 2. Já tem empregado? skip
      if (empsExistentesPorPessoa.has(pessoa.id)) {
        jaTinha++;
        console.log(`  = Já vinculado: ${emp.name} → ${pessoa.nome}`);
        continue;
      }

      // 3. Acha Cargo correspondente
      const role = rolesByIdApptip.get(emp.roleId);
      if (!role) {
        semCargo++;
        erros.push({ nome: emp.name, motivo: `roleId ${emp.roleId} não encontrado no AppTip` });
        continue;
      }
      const cargoKey = `${(role.name || "").trim().toLowerCase()}|${(role.area || "").trim().toLowerCase()}`;
      const cargo = cargosByKey.get(cargoKey);
      if (!cargo) {
        semCargo++;
        erros.push({ nome: emp.name, motivo: `Cargo "${role.name} · ${role.area}" não existe no Planejamento` });
        continue;
      }

      // 4. Resolve unidade padrão
      const unidadePadraoId = resolverUnidadePadrao(role);

      // 5. VT: busca dailyRate na vtConfig. Chave pode ser emp.id ou emp.empCode
      const vtEntry = vtRest[emp.id] || vtRest[emp.empCode] || null;
      const dailyRate = vtEntry?.dailyRate ?? 0;
      const vtAtivo = dailyRate > 0;

      // 6. Admissão: usa do AppTip se preenchida, senão default
      let admissao = clean(emp.admission);
      if (!admissao) {
        admissao = admissaoDefault;
        avisos.push(`  ⚠ ${emp.name}: sem admissão no AppTip — usando default ${admissaoDefault}`);
      }

      // 7. Monta doc do empregado
      const now = new Date().toISOString();
      const novo = {
        restaurantId: ridPlan,
        pessoaId: pessoa.id,
        nome: pessoa.nome || emp.name,
        cpf: pessoa.cpf || cpfClean || null,
        cargoId: cargo.id,
        unidadePadraoId: unidadePadraoId || null,
        empCode: clean(emp.empCode) || null,
        codigoContabil: null,
        emergenciaNome: null,
        emergenciaTelefone: null,
        periodos: [{
          admissao,
          demissao: null,
          registradoEm: now,
          registradoPor: "migration-script",
        }],
        estaAtivo: true,
        admissaoAtual: admissao,
        demitidoEm: null,
        vtAtivo,
        vtPassagensPorDia: vtAtivo ? 1 : null,        // AppTip não distingue passagens/valor, usa dailyRate inteiro
        vtValorPassagem: vtAtivo ? dailyRate : null,
        email: pessoa.email || null,
        telefone: pessoa.whatsapp || null,
        // Campos auxiliares pra migração de horários depois
        _migracaoAppTipEmpId: emp.id,
        _migracaoAppTipEmpCode: emp.empCode || null,
        _migracaoRidApptip: ridApptip,
        createdAt: now,
        createdBy: "migration-script",
      };

      if (!dryRun) {
        const ref = await planDb.collection("empregados").add(sanitize(novo));
        empsExistentesPorPessoa.add(pessoa.id);
        void ref;
      }
      criados++;
      const unidNome = unidades.find(u => u.id === unidadePadraoId)?.nome || "?";
      console.log(`  + ${emp.name} → ${pessoa.nome} | ${cargo.nome}/${cargo.area} | unidade ${unidNome}${vtAtivo ? ` | VT R$${dailyRate}/dia` : ""}${admissao === admissaoDefault ? " | ⚠ admissão default" : ""}`);
    } catch (e) {
      erros.push({ nome: emp.name, motivo: e.message });
      console.error(`  ❌ ${emp.name}: ${e.message}`);
    }
  }

  // ── Resumo ──
  console.log(`\n┌─ ${"━".repeat(56)}`);
  console.log("│ 📊 RESUMO");
  console.log(`├─ ${"━".repeat(56)}`);
  console.log(`│  ✅ Empregados criados:        ${criados}`);
  console.log(`│  =  Já vinculados (skip):       ${jaTinha}`);
  console.log(`│  ❌ Sem Pessoa cadastrada:      ${semPessoa}`);
  console.log(`│  ❌ Cargo não encontrado:        ${semCargo}`);
  console.log(`│  ❌ Outros erros:                ${erros.length - semPessoa - semCargo}`);
  console.log(`│  ⚠ Pulados (não Pessoa/Cargo):  ${pulados}`);
  console.log(`└─ ${"━".repeat(56)}`);

  if (avisos.length) {
    console.log("\n⚠ AVISOS:");
    avisos.slice(0, 20).forEach(a => console.log(a));
    if (avisos.length > 20) console.log(`   ... e mais ${avisos.length - 20}`);
  }

  if (erros.length) {
    console.log("\n❌ ERROS (não migrados):");
    erros.forEach(e => console.log(`  • ${e.nome}: ${e.motivo}`));
  }

  if (dryRun) {
    console.log("\n⚠️ DRY-RUN — nada foi escrito. Roda sem --dry-run pra fazer de verdade.");
  } else {
    console.log("\n✅ Migração concluída.");
    console.log("\n📝 Próximo passo: rodar `node migrar-horarios.mjs --from=... --to=...` pra trazer os horários.");
  }
  process.exit(0);
}

main().catch(err => {
  console.error("❌ Erro fatal:", err.message);
  console.error(err);
  process.exit(1);
});
