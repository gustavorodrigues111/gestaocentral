// ════════════════════════════════════════════════════════════════════════════
//  Migração: corrige escalas em que dias de UM MÊS foram gravados no doc
//  de OUTRO mês (bug antigo do lote de férias multi-mês — uma versão
//  anterior do `setStatusCelula` não resolvia o doc pelo mês do ymdDate).
//
//  Detecção: pra cada doc /escalas/{id} (com id no formato "rid_YYYY-MM"),
//  varre prevista/real/unidadesPrevistas/unidadesReais procurando chaves
//  de data (YYYY-MM-DD) cujo mês NÃO bate com o mês do doc.
//
//  Correção: move cada chave fora-do-mês pro doc do mês correto (criando
//  se não existir), na MESMA versão (prevista/real). Conflito (mesma chave
//  já existe no destino) → preserva o destino, descarta a origem com aviso.
//
//  Uso:
//    node migration/recuperar-ferias-perdidas.mjs                 # dry-run
//    node migration/recuperar-ferias-perdidas.mjs --apply         # aplica
//    node migration/recuperar-ferias-perdidas.mjs --apply <rid>   # só rest X
// ════════════════════════════════════════════════════════════════════════════
import admin from "firebase-admin";

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: "gestaocentral-85b13",
});
const db = admin.firestore();

const apply = process.argv.includes("--apply");
const ridFiltro = process.argv.find((a, i) => i > 1 && !a.startsWith("--"));

console.log(apply
  ? "🔧 APLICANDO mudanças no Firestore"
  : "👀 DRY-RUN — nada será gravado. Rode com --apply pra valer.");
if (ridFiltro) console.log(`Filtro restaurantId="${ridFiltro}"`);
console.log();

const ref = db.collection("escalas");
const q = ridFiltro ? ref.where("restaurantId", "==", ridFiltro) : ref;
const snap = await q.get();
console.log(`${snap.size} doc(s) de escala\n`);

// Coleta TODAS as gravações pendentes antes de aplicar, agrupadas pelo doc
// destino. Assim cada doc afetado tem 1 update só no fim.
const updatesPorDoc = new Map(); // docId → { updates: {}, ano, mes, restaurantId }
const deletesNaOrigem = new Map(); // docId → []
const conflitos = [];

const VERSOES_E_UNIDADES = [
  { campo: "prevista", unidades: "unidadesPrevistas" },
  { campo: "real", unidades: "unidadesReais" },
];

for (const d of snap.docs) {
  const data = d.data();
  const ano = data.ano;
  const mes = data.mes;
  if (!ano || !mes) continue;
  const mesEsperado = `${ano}-${String(mes).padStart(2, "0")}`;

  for (const { campo, unidades } of VERSOES_E_UNIDADES) {
    const cellsPorEmp = data[campo] || {};
    const unitsPorEmp = data[unidades] || {};
    for (const [empId, cells] of Object.entries(cellsPorEmp)) {
      if (typeof cells !== "object" || !cells) continue;
      for (const [ymd, status] of Object.entries(cells)) {
        const mesDoYmd = ymd.slice(0, 7);
        if (mesDoYmd === mesEsperado) continue;
        // Achou um dia fora do mês do doc → mover pro mês correto
        const docDestinoId = `${data.restaurantId}_${mesDoYmd}`;
        const anoDest = parseInt(mesDoYmd.slice(0, 4), 10);
        const mesDest = parseInt(mesDoYmd.slice(5, 7), 10);
        if (!updatesPorDoc.has(docDestinoId)) {
          updatesPorDoc.set(docDestinoId, {
            updates: {},
            ano: anoDest,
            mes: mesDest,
            restaurantId: data.restaurantId,
            existing: null, // preenchido depois
          });
        }
        const target = updatesPorDoc.get(docDestinoId);
        target.updates[`${campo}.${empId}.${ymd}`] = status;
        const u = unitsPorEmp[empId]?.[ymd];
        if (u) target.updates[`${unidades}.${empId}.${ymd}`] = u;

        // Marca pra deletar da origem
        const arr = deletesNaOrigem.get(d.id) || [];
        arr.push({ campo, unidades, empId, ymd, status, mesDoYmd });
        deletesNaOrigem.set(d.id, arr);
      }
    }
  }
}

// Lê o estado atual dos docs destino pra detectar conflitos
for (const [docId, info] of updatesPorDoc) {
  const destSnap = await db.doc(`escalas/${docId}`).get();
  info.existing = destSnap.exists ? destSnap.data() : null;
  if (!destSnap.exists) continue;
  // Pra cada update, checa se já existe valor diferente no destino
  for (const path of Object.keys(info.updates)) {
    const parts = path.split(".");
    if (parts.length !== 3) continue;
    const [campo, empId, ymd] = parts;
    const atual = info.existing[campo]?.[empId]?.[ymd];
    if (atual !== undefined && atual !== info.updates[path]) {
      conflitos.push({
        docId, campo, empId, ymd,
        destino: atual,
        origem: info.updates[path],
      });
      // Remove do updates — preserva destino
      delete info.updates[path];
    }
  }
}

console.log("=== MOVIMENTAÇÕES POR DOC DESTINO ===\n");
for (const [docId, info] of updatesPorDoc) {
  const n = Object.keys(info.updates).filter((k) => k.startsWith("prevista.") || k.startsWith("real.")).length;
  console.log(`  → ${docId} (rest ${info.restaurantId} ${info.ano}/${String(info.mes).padStart(2, "0")}) — ${n} dia(s)${info.existing ? "" : "  [criar doc]"}`);
}

console.log("\n=== DELEÇÕES NA ORIGEM ===\n");
for (const [docId, arr] of deletesNaOrigem) {
  console.log(`  ← ${docId} — ${arr.length} chave(s) fora-do-mês`);
}

if (conflitos.length > 0) {
  console.log(`\n⚠ ${conflitos.length} conflito(s) — origem descartada (destino preservado):`);
  for (const c of conflitos.slice(0, 5)) {
    console.log(`  • ${c.docId} ${c.campo}.${c.empId.slice(0, 8)}.${c.ymd} — destino="${c.destino}" origem="${c.origem}"`);
  }
  if (conflitos.length > 5) console.log(`  …+${conflitos.length - 5}`);
}

console.log();
if (!apply) {
  console.log("ℹ️  Dry-run. Pra aplicar, rode com --apply");
  process.exit(0);
}

console.log("🔧 Aplicando…");

// 1. Cria docs destino que não existem
for (const [docId, info] of updatesPorDoc) {
  if (info.existing) continue;
  await db.doc(`escalas/${docId}`).set({
    id: docId,
    restaurantId: info.restaurantId,
    ano: info.ano,
    mes: info.mes,
    prevista: {},
    real: {},
    updatedAt: new Date().toISOString(),
  });
  console.log(`  ✓ criado ${docId}`);
}

// 2. Aplica os updates nos docs destino
for (const [docId, info] of updatesPorDoc) {
  if (Object.keys(info.updates).length === 0) continue;
  info.updates.updatedAt = new Date().toISOString();
  await db.doc(`escalas/${docId}`).update(info.updates);
  console.log(`  ✓ migrado ${Object.keys(info.updates).length - 1} chave(s) pra ${docId}`);
}

// 3. Deleta as origens fora-do-mês
for (const [docId, arr] of deletesNaOrigem) {
  const deleteUpdates = {};
  for (const { campo, unidades, empId, ymd } of arr) {
    deleteUpdates[`${campo}.${empId}.${ymd}`] = admin.firestore.FieldValue.delete();
    deleteUpdates[`${unidades}.${empId}.${ymd}`] = admin.firestore.FieldValue.delete();
  }
  deleteUpdates.updatedAt = new Date().toISOString();
  await db.doc(`escalas/${docId}`).update(deleteUpdates);
  console.log(`  ✓ limpado ${arr.length} chave(s) de ${docId}`);
}

console.log("\n✓ Migração concluída.");
process.exit(0);
