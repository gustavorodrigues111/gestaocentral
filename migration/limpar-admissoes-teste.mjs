// ════════════════════════════════════════════════════════════════════════════
//  Limpa TODAS as admissões em andamento — usado uma vez pra apagar os
//  testes do Sororoca depois da refatoração estrutural do módulo Admissão.
//  Filtra por restaurantId quando passado como arg; sem arg apaga tudo.
//
//  Uso:
//    node migration/limpar-admissoes-teste.mjs                  # apaga todas
//    node migration/limpar-admissoes-teste.mjs <restaurantId>   # só do rest X
// ════════════════════════════════════════════════════════════════════════════
import admin from "firebase-admin";

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: "gestaocentral-85b13",
});
const db = admin.firestore();

const ridFiltro = process.argv[2];

console.log(ridFiltro
  ? `🧹 Apagando admissões do restaurantId "${ridFiltro}"…`
  : "🧹 Apagando TODAS as admissões…");

const ref = db.collection("admissoes");
const query = ridFiltro
  ? ref.where("restaurantId", "==", ridFiltro)
  : ref;

const snap = await query.get();
console.log(`Encontradas ${snap.size} admissão(ões).`);

if (snap.empty) {
  console.log("Nada a apagar.");
  process.exit(0);
}

// Lista o que vai apagar pra o usuário conferir
for (const d of snap.docs) {
  const data = d.data();
  console.log(`  • ${d.id} — ${data.candidato?.nome || "(sem nome)"} (status: ${data.status}) — restaurantId: ${data.restaurantId}`);
}

const batch = db.batch();
for (const d of snap.docs) batch.delete(d.ref);
await batch.commit();

console.log(`✓ ${snap.size} admissão(ões) apagada(s).`);
process.exit(0);
