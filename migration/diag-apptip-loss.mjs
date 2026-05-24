// Diagnóstico READ-ONLY — investiga a perda de employees no AppTip.
import admin from "firebase-admin";

const apptip = admin.initializeApp(
  { credential: admin.credential.applicationDefault(), projectId: "gorjeta-app" },
  "apptip",
);
const db = admin.firestore(apptip);

async function inspect(path) {
  const snap = await db.doc(path).get();
  if (!snap.exists) {
    console.log(`  ${path.padEnd(28)} → NÃO EXISTE`);
    return null;
  }
  const data = snap.data() || {};
  const val = data.value;
  const count = Array.isArray(val)
    ? val.length
    : val && typeof val === "object"
      ? Object.keys(val).length
      : "(não-array)";
  console.log(
    `  ${path.padEnd(28)} → ${String(count).padStart(5)} itens   updateTime: ${snap.updateTime?.toDate().toISOString()}`,
  );
  return val;
}

console.log("─── Docs principais do AppTip (count + última escrita) ───");
const employees = await inspect("appdata/v4:employees");
await inspect("appdata/v4:pessoas");
await inspect("appdata/v4:managers");
await inspect("appdata/v4:roles");
await inspect("appdata/v4:restaurants");
await inspect("appdata/v4:workSchedules");
const trash = await inspect("appdata/v4:trash");

// Distribuição dos 28 employees restantes por restaurante
if (Array.isArray(employees)) {
  console.log("\n─── Employees restantes por restaurantId ───");
  const porRest = {};
  for (const e of employees) {
    const r = e.restaurantId || "(sem rid)";
    porRest[r] = (porRest[r] || 0) + 1;
  }
  for (const [r, n] of Object.entries(porRest)) {
    console.log(`  ${r.padEnd(22)} ${n}`);
  }
}

// O que tem na trash?
if (Array.isArray(trash) && trash.length > 0) {
  console.log("\n─── Conteúdo da trash (amostra) ───");
  const tipos = {};
  for (const t of trash) {
    const tipo = t.type || t.kind || t.collection || "(sem tipo)";
    tipos[tipo] = (tipos[tipo] || 0) + 1;
  }
  console.log("  tipos:", JSON.stringify(tipos));
  console.log("  primeiro item:", JSON.stringify(trash[0]).slice(0, 300));
} else if (trash && typeof trash === "object") {
  console.log("\n─── trash é objeto, chaves:", Object.keys(trash).join(", "));
}

// Lista TODOS os docs de /appdata com updateTime — pra ver o que mudou recente
console.log("\n─── Todos os docs /appdata ordenados por updateTime (mais recente) ───");
const all = await db.collection("appdata").get();
const rows = all.docs
  .map((d) => ({ id: d.id, t: d.updateTime?.toDate().toISOString() || "?" }))
  .sort((a, b) => b.t.localeCompare(a.t));
for (const r of rows.slice(0, 15)) {
  console.log(`  ${r.t}   ${r.id}`);
}

process.exit(0);
