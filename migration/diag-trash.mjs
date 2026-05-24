// READ-ONLY — inspeciona appdata/v4:trash do AppTip.
import admin from "firebase-admin";

const apptip = admin.initializeApp(
  { credential: admin.credential.applicationDefault(), projectId: "gorjeta-app" },
  "apptip",
);
const db = admin.firestore(apptip);

const snap = await db.doc("appdata/v4:trash").get();
const trash = snap.data()?.value || {};
console.log("trash.value chaves:", Object.keys(trash).join(", "));

for (const k of Object.keys(trash)) {
  const v = trash[k];
  const n = Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : "?";
  console.log(`\n── trash.${k}  (${n} itens) ──`);
  const arr = Array.isArray(v) ? v : [];
  if (k === "employees" && arr.length) {
    // Quantos por restaurante + nomes
    const porRest = {};
    for (const e of arr) {
      const r = e.restaurantId || "(sem rid)";
      porRest[r] = (porRest[r] || 0) + 1;
    }
    console.log("  por restaurantId:", JSON.stringify(porRest));
    console.log("  nomes:", arr.map((e) => e.name || e.nome || "?").join(", "));
    console.log("  amostra item:", JSON.stringify(arr[0]).slice(0, 400));
  } else if (arr.length) {
    console.log("  amostra:", JSON.stringify(arr[0]).slice(0, 200));
  } else {
    console.log("  (vazio ou não-array):", JSON.stringify(v).slice(0, 200));
  }
}

process.exit(0);
