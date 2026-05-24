import admin from "firebase-admin";

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: "gorjeta-app",
});

const db = admin.firestore();

const EMP_ID = "emp_morg7c1rs5b";
const EMP_CODE = "SRC0028";
const RID = "1775792279549";

// Cargo
const empDoc = await db.doc("appdata/v4:employees").get();
const employees = empDoc.data()?.value || [];
const kayna = employees.find(e => e.id === EMP_ID);
console.log("=== Employee completo (Kaynã) ===");
console.log(JSON.stringify(kayna, null, 2));

// Cargo (role) referenciado
const rolesDoc = await db.doc("appdata/v4:roles").get();
const roles = rolesDoc.data()?.value || [];
if (kayna?.roleId) {
  const role = roles.find(r => r.id === kayna.roleId);
  console.log("\n=== Cargo dela ===");
  console.log(JSON.stringify(role, null, 2));
}

// workSchedule
const wsDoc = await db.doc("appdata/v4:workSchedules").get();
const wsAll = wsDoc.data()?.value || {};
const wsRest = wsAll[RID] || {};
const wsKayna = wsRest[EMP_ID] || wsRest[EMP_CODE];
console.log("\n=== workSchedules dela ===");
if (!wsKayna) {
  console.log("  (nenhum)");
} else {
  console.log(JSON.stringify(wsKayna, null, 2));
}

process.exit(0);
