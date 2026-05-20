// Read-only: lista todos os docs /escalas/{id} com info de previstaFechadaEm
// + contagem de entradas em prevista/real por empregado. Pra diagnosticar
// o bug de férias multi-mês.
import admin from "firebase-admin";

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: "gestaocentral-85b13",
});
const db = admin.firestore();

const snap = await db.collection("escalas").get();
console.log(`${snap.size} doc(s) de escala\n`);

const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
docs.sort((a, b) => `${a.restaurantId}_${a.ano}_${a.mes}`.localeCompare(`${b.restaurantId}_${b.ano}_${b.mes}`));

for (const d of docs) {
  const prev = d.prevista || {};
  const real = d.real || {};
  const cntPrev = Object.values(prev).reduce((acc, cells) => acc + Object.keys(cells || {}).length, 0);
  const cntReal = Object.values(real).reduce((acc, cells) => acc + Object.keys(cells || {}).length, 0);
  const empsPrev = Object.keys(prev).length;
  const empsReal = Object.keys(real).length;
  console.log(
    `${d.id}`,
    `  rest=${d.restaurantId}`,
    `  ${d.ano}/${String(d.mes).padStart(2, "0")}`,
    `  fechada=${d.previstaFechadaEm ? "✓" : "—"}`,
    `  prev=${cntPrev}d em ${empsPrev}emp`,
    `  real=${cntReal}d em ${empsReal}emp`,
  );

  // Lista cada empregado com seus dias por versão
  const allEmps = new Set([...Object.keys(prev), ...Object.keys(real)]);
  for (const empId of allEmps) {
    const datasPrev = Object.keys(prev[empId] || {}).sort();
    const datasReal = Object.keys(real[empId] || {}).sort();
    if (datasPrev.length === 0 && datasReal.length === 0) continue;
    const previewP = datasPrev.length ? `prev[${datasPrev.length}]: ${datasPrev[0]}...${datasPrev[datasPrev.length-1]}` : "";
    const previewR = datasReal.length ? `real[${datasReal.length}]: ${datasReal[0]}...${datasReal[datasReal.length-1]}` : "";
    console.log(`    ${empId.slice(0, 12)} → ${previewP} ${previewR}`);
  }
}
process.exit(0);
