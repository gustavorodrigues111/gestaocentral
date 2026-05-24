// READ-ONLY — recontagem do Planejamento AGORA.
import admin from "firebase-admin";

const plan = admin.initializeApp(
  { credential: admin.credential.applicationDefault(), projectId: "gestaocentral-85b13" },
  "plan",
);
const db = admin.firestore(plan);

const empAll = await db.collection("empregados").get();
const pesAll = await db.collection("pessoas").get();
const restAll = await db.collection("restaurants").get();

console.log("─── PLANEJAMENTO (gestaocentral-85b13) — contagem AGORA ───");
console.log("  empregados (total):", empAll.size);
console.log("  pessoas (total):   ", pesAll.size);
console.log("  restaurants:       ", restAll.size);

console.log("\n─── empregados por restaurante ───");
const porRest = {};
empAll.docs.forEach((d) => {
  const r = d.data().restaurantId || "(sem rid)";
  porRest[r] = (porRest[r] || 0) + 1;
});
const restNome = {};
restAll.docs.forEach((d) => (restNome[d.id] = d.data().nome || "?"));
for (const [rid, n] of Object.entries(porRest)) {
  console.log(`  ${(restNome[rid] || rid).padEnd(20)} ${n}`);
}

console.log("\n─── amostra: 5 empregados (qualquer) ───");
empAll.docs.slice(0, 5).forEach((d) => {
  const e = d.data();
  console.log(`  ${e.nome || "?"}  rid=${e.restaurantId}  doc=${d.id}`);
});

process.exit(0);
