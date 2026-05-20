// ════════════════════════════════════════════════════════════════════════════
//  Limpa o campo `admissaoKanbanColunas` (e outros campos do template de
//  admissão que possam ter sido salvos pelos editores antigos) de TODOS os
//  restaurantes — força a UI a usar os defaults atualizados de formTemplate.
//
//  Uso:
//    node migration/limpar-kanban-colunas-restaurante.mjs            # todos
//    node migration/limpar-kanban-colunas-restaurante.mjs <ridX>     # só um
// ════════════════════════════════════════════════════════════════════════════
import admin from "firebase-admin";

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: "gestaocentral-85b13",
});
const db = admin.firestore();

const ridFiltro = process.argv[2];

console.log(ridFiltro
  ? `🧹 Limpando admissaoKanbanColunas + admissaoSubtarefasTemplate do restaurante "${ridFiltro}"…`
  : "🧹 Limpando admissaoKanbanColunas + admissaoSubtarefasTemplate de TODOS os restaurantes…");

const ref = db.collection("restaurants");
const snap = ridFiltro
  ? await db.doc(`restaurants/${ridFiltro}`).get().then((d) => ({ docs: d.exists ? [d] : [], size: d.exists ? 1 : 0 }))
  : await ref.get();

if (!snap.size) {
  console.log("Nenhum restaurante encontrado.");
  process.exit(0);
}

let mexidos = 0;
for (const d of snap.docs) {
  const data = d.data();
  const temCol = !!data?.admissaoKanbanColunas;
  const temSub = !!data?.admissaoSubtarefasTemplate;
  if (!temCol && !temSub) {
    console.log(`  • ${d.id} (${data?.nome || "?"}) — sem campos salvos, pulando.`);
    continue;
  }
  console.log(`  • ${d.id} (${data?.nome || "?"}) — removendo: ${[temCol && "colunas", temSub && "subtarefas"].filter(Boolean).join(" + ")}`);
  await d.ref.update({
    admissaoKanbanColunas:     admin.firestore.FieldValue.delete(),
    admissaoSubtarefasTemplate: admin.firestore.FieldValue.delete(),
  });
  mexidos++;
}

console.log(`✓ ${mexidos} restaurante(s) atualizado(s).`);
process.exit(0);
