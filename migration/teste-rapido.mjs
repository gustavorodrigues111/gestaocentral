import admin from "firebase-admin";
console.log("0: import OK");
const app = admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: "gorjeta-app",
});
console.log("1: initializeApp OK");
const db = admin.firestore(app);
console.log("2: firestore() OK");
setTimeout(() => { console.error("TIMEOUT 25s"); process.exit(2); }, 25000);
const snap = await db.doc("appdata/v4:pessoas").get();
console.log("3: get OK,", snap.data()?.value?.length, "pessoas");
process.exit(0);
