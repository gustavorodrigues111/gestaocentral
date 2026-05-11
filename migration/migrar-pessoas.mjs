// ════════════════════════════════════════════════════════════════════════════
//  Migra Pessoas do AppTip → Planejamento
//
//  Lê de:  gorjeta-app          /appdata/v4:pessoas (campo value: array)
//  Escreve em: gestaocentral-85b13   /pessoas (1 doc por pessoa, auto-id)
//
//  Filtra pessoas que são equipe DO restaurante AppTip selecionado
//  (isTeam[ridApptip] === true).
//
//  Match com Pessoa existente no Planejamento por CPF (limpo).
//  - Existe → atualiza nome/email/whatsapp + adiciona ridPlan em restaurantIds
//  - Não existe → cria nova Pessoa
//
//  NUNCA cria empregados — esses são vinculados manualmente depois pelo admin.
//
//  Uso:
//    node migrar-pessoas.mjs --from=<rid-apptip> --to=<rid-planejamento>
//    node migrar-pessoas.mjs --from=... --to=... --dry-run
// ════════════════════════════════════════════════════════════════════════════

import admin from "firebase-admin";

const APPTIP_PROJECT = "gorjeta-app";
const PLAN_PROJECT = "gestaocentral-85b13";

// ── Parse args ──
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
  console.error("❌ Uso: node migrar-pessoas.mjs --from=<rid-apptip> --to=<rid-planejamento> [--dry-run]");
  console.error("\n   Rode `node listar.mjs` primeiro pra ver os IDs disponíveis.");
  process.exit(1);
}

// ── Inicializa apps ──
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

// ── Helpers ──
function onlyDigits(s) {
  return String(s || "").replace(/\D/g, "");
}

function cleanString(s) {
  if (s == null) return undefined;
  const t = String(s).trim();
  return t || undefined;
}

function pessoaFromApptip(p) {
  const cpfLimpo = onlyDigits(p.cpf);
  // cadastroIncompleto = true quando não tem CPF (pode ser completado depois)
  return {
    nome: cleanString(p.nome || p.name) || "(sem nome)",
    cpf: cpfLimpo || undefined,
    email: cleanString(p.email) || undefined,
    whatsapp: cleanString(p.whatsapp || p.telefone) || undefined,
    isMaster: false,
    ativa: true,
    restaurantIds: [ridPlan],
    permissions: {},
    cadastroIncompleto: !cpfLimpo,
    createdAt: p.createdAt || new Date().toISOString(),
  };
}

function sanitize(obj) {
  // Remove campos undefined (Firestore não aceita)
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

async function main() {
  console.log(`\n🔄 Migrando pessoas: AppTip[${ridApptip}] → Planejamento[${ridPlan}]`);
  if (dryRun) console.log("⚠️  DRY-RUN: nada será escrito.\n");

  // ── Lê do AppTip ──
  const pessoasDoc = await apptipDb.doc("appdata/v4:pessoas").get();
  if (!pessoasDoc.exists) {
    console.error("❌ Doc /appdata/v4:pessoas não existe no AppTip");
    process.exit(1);
  }
  const todasPessoas = pessoasDoc.data()?.value || [];

  // Filtra: só as que são equipe do restaurante selecionado
  const pessoasDoRest = todasPessoas.filter(p => p.isTeam && p.isTeam[ridApptip] === true);
  console.log(`📋 ${pessoasDoRest.length} pessoa(s) do AppTip são equipe deste restaurante (de ${todasPessoas.length} totais).`);

  if (pessoasDoRest.length === 0) {
    console.log("⚠️  Nenhuma pessoa pra migrar. Verifica o --from.");
    process.exit(0);
  }

  // ── Lê pessoas existentes no Planejamento (pra detectar duplicatas por CPF)
  const pessoasPlanSnap = await planDb.collection("pessoas").get();
  const pessoasPlanMap = new Map();   // cpf-limpo → doc
  pessoasPlanSnap.docs.forEach(d => {
    const data = d.data();
    const cpf = onlyDigits(data.cpf);
    if (cpf) pessoasPlanMap.set(cpf, { id: d.id, data });
  });
  console.log(`📋 ${pessoasPlanSnap.size} pessoas já cadastradas no Planejamento (${pessoasPlanMap.size} com CPF).\n`);

  // ── Processa cada pessoa ──
  let novas = 0, atualizadas = 0, semCpf = 0, jaTinhaRid = 0;
  const erros = [];

  for (const pOld of pessoasDoRest) {
    const pNew = pessoaFromApptip(pOld);
    const cpf = pNew.cpf;

    try {
      if (!cpf) {
        // Sem CPF: cria nova mesmo (não tem como deduplicar)
        semCpf++;
        if (!dryRun) {
          await planDb.collection("pessoas").add(sanitize(pNew));
        }
        console.log(`  + Nova (sem CPF): ${pNew.nome}`);
        continue;
      }

      const existente = pessoasPlanMap.get(cpf);
      if (existente) {
        // Já existe — adiciona ridPlan em restaurantIds (se ainda não tem)
        // + adiciona em novosRestaurantes (vai virar badge "📨" no header dela)
        const restIdsAtual = existente.data.restaurantIds || [];
        if (restIdsAtual.includes(ridPlan)) {
          jaTinhaRid++;
          console.log(`  = Já vinculada: ${pNew.nome} (CPF ${cpf})`);
          continue;
        }
        const novosRestAtual = existente.data.novosRestaurantes || [];
        const patch = {
          restaurantIds: [...restIdsAtual, ridPlan],
          novosRestaurantes: Array.from(new Set([...novosRestAtual, ridPlan])),
        };
        // Atualiza nome/email/whatsapp só se o AppTip tem e o Planejamento não tem
        if (pNew.email && !existente.data.email) patch.email = pNew.email;
        if (pNew.whatsapp && !existente.data.whatsapp) patch.whatsapp = pNew.whatsapp;
        if (pNew.nome !== "(sem nome)" && !existente.data.nome) patch.nome = pNew.nome;

        if (!dryRun) {
          await planDb.doc(`pessoas/${existente.id}`).update(patch);
        }
        atualizadas++;
        console.log(`  ↻ Adiciona vínculo: ${pNew.nome} (CPF ${cpf}) → já era de ${restIdsAtual.length} rest, agora tb deste`);
        continue;
      }

      // Nova pessoa
      if (!dryRun) {
        const ref = await planDb.collection("pessoas").add(sanitize(pNew));
        pessoasPlanMap.set(cpf, { id: ref.id, data: pNew });
      }
      novas++;
      console.log(`  + Nova: ${pNew.nome}${pNew.email ? ` <${pNew.email}>` : ""}${pNew.email ? "" : "  ⚠ sem email"}`);
    } catch (e) {
      erros.push({ pessoa: pNew.nome, erro: e.message });
      console.error(`  ❌ Erro em "${pNew.nome}":`, e.message);
    }
  }

  // ── Resumo ──
  console.log(`\n┌─ ${"━".repeat(50)}`);
  console.log("│ 📊 RESUMO");
  console.log(`├─ ${"━".repeat(50)}`);
  console.log(`│  ✅ Novas pessoas criadas:        ${novas}`);
  console.log(`│  ↻  Pessoas atualizadas (vínculo): ${atualizadas}`);
  console.log(`│  =  Já vinculadas (skip):          ${jaTinhaRid}`);
  console.log(`│  ⚠️  Sem CPF (criadas mesmo assim): ${semCpf}`);
  console.log(`│  ❌ Erros:                         ${erros.length}`);
  console.log(`└─ ${"━".repeat(50)}\n`);

  if (erros.length > 0) {
    console.log("Detalhe dos erros:");
    erros.forEach(e => console.log(`  • ${e.pessoa}: ${e.erro}`));
  }

  if (dryRun) {
    console.log("\n⚠️  DRY-RUN — nada foi escrito. Roda sem --dry-run pra fazer de verdade.");
  } else {
    console.log("\n✅ Migração concluída.");
    console.log("\n📝 Próximo passo: vai em admin.planejamento.app → restaurante de destino");
    console.log("   → Pessoas → veja a lista nova e cria os Empregados (cargo + admissão + unidade).");
  }

  process.exit(0);
}

main().catch(err => {
  console.error("❌ Erro fatal:", err.message);
  console.error(err);
  process.exit(1);
});
