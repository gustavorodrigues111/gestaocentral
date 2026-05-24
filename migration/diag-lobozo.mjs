// Diagnóstico READ-ONLY — conta equipe do Lobozó nos 2 projetos.
import admin from "firebase-admin";

const APPTIP_RID = "1775792314382";
const PLAN_RID = "SEmad7GK0ZI298S1CFzb";

const apptip = admin.initializeApp(
  { credential: admin.credential.applicationDefault(), projectId: "gorjeta-app" },
  "apptip",
);
const plan = admin.initializeApp(
  { credential: admin.credential.applicationDefault(), projectId: "gestaocentral-85b13" },
  "plan",
);
const apptipDb = admin.firestore(apptip);
const planDb = admin.firestore(plan);

// ── AppTip ──
const empDoc = await apptipDb.doc("appdata/v4:employees").get();
const employees = empDoc.exists ? (empDoc.data()?.value || []) : [];
const empLobozo = employees.filter((e) => e.restaurantId === APPTIP_RID);

const pesDoc = await apptipDb.doc("appdata/v4:pessoas").get();
const pessoas = pesDoc.exists ? (pesDoc.data()?.value || []) : [];
const pesLobozo = pessoas.filter((p) => p.isTeam && p.isTeam[APPTIP_RID] === true);

console.log("┌─ APPTIP (gorjeta-app) ─ rid", APPTIP_RID);
console.log("│  employees total no doc:", employees.length);
console.log("│  employees do Lobozó:   ", empLobozo.length);
console.log("│  pessoas isTeam[Lobozó]:", pesLobozo.length);
if (empLobozo.length > 0) {
  console.log("│  nomes:", empLobozo.map((e) => e.name || e.nome || "?").join(", "));
}
console.log("└─");

// ── Planejamento ──
const empSnap = await planDb
  .collection("empregados")
  .where("restaurantId", "==", PLAN_RID)
  .get();
const pesSnap = await planDb
  .collection("pessoas")
  .where("restaurantIds", "array-contains", PLAN_RID)
  .get();

console.log("┌─ PLANEJAMENTO (gestaocentral-85b13) ─ rid", PLAN_RID);
console.log("│  empregados do Lobozó:", empSnap.size);
console.log("│  pessoas do Lobozó:   ", pesSnap.size);
if (empSnap.size > 0) {
  console.log("│  nomes:", empSnap.docs.map((d) => d.data().nome || "?").join(", "));
}
console.log("└─");

process.exit(0);
