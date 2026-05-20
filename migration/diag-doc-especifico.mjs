// Inspeciona um doc específico de escala — todas as chaves de prevista por empregado.
import admin from "firebase-admin";

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: "gestaocentral-85b13",
});
const db = admin.firestore();

const docId = process.argv[2] || "SEmad7GK0ZI298S1CFzb_2026-05";

const snap = await db.doc(`escalas/${docId}`).get();
if (!snap.exists) {
  console.log(`Doc ${docId} não existe.`);
  process.exit(0);
}
const data = snap.data();
console.log(`Doc ${docId}`);
console.log(`  restaurantId: ${data.restaurantId}`);
console.log(`  ano/mes:      ${data.ano}/${data.mes}`);
console.log(`  fechada:      ${data.previstaFechadaEm || "—"}`);
console.log();

const prev = data.prevista || {};
const real = data.real || {};

const empMaisDias = Object.entries(prev)
  .map(([empId, cells]) => [empId, Object.keys(cells || {}).length])
  .sort((a, b) => b[1] - a[1])[0];

if (empMaisDias) {
  const [empId] = empMaisDias;
  console.log(`Empregado com mais dias (${empId}):`);
  const cells = prev[empId];
  const datas = Object.keys(cells).sort();
  for (const d of datas) {
    const mesDoDia = d.slice(0, 7);
    const inconsistente = mesDoDia !== `${data.ano}-${String(data.mes).padStart(2, "0")}`;
    console.log(`  ${d} → ${cells[d]} ${inconsistente ? "⚠ FORA DO MÊS" : ""}`);
  }
}

const totalForaDoMes = Object.values(prev).reduce((acc, cells) => {
  return acc + Object.keys(cells || {}).filter((d) => d.slice(0, 7) !== `${data.ano}-${String(data.mes).padStart(2, "0")}`).length;
}, 0);

console.log(`\n⚠ Total de entradas em "prevista" fora do mês deste doc: ${totalForaDoMes}`);

// Lista todos empregados que têm entrada fora do mês
const empsComProblema = [];
for (const [empId, cells] of Object.entries(prev)) {
  const fora = Object.keys(cells || {}).filter((d) => d.slice(0, 7) !== `${data.ano}-${String(data.mes).padStart(2, "0")}`);
  if (fora.length > 0) empsComProblema.push({ empId, fora });
}
console.log(`\nEmpregados com dias gravados em mês errado:`);
for (const { empId, fora } of empsComProblema) {
  console.log(`  ${empId} → ${fora.length} dias: ${fora.slice(0, 3).join(", ")}${fora.length > 3 ? "..." : ""}`);
}

process.exit(0);
