import admin from "firebase-admin";
process.stderr.write("0: import OK\n");
const app = admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: "gorjeta-app",
}, "t");
process.stderr.write("1: initializeApp OK\n");
const db = admin.firestore(app);
process.stderr.write("2: firestore() OK\n");
process.stderr.write("3: about to call get()...\n");
setTimeout(() => { process.stderr.write("⏰ TIMEOUT 20s\n"); process.exit(2); }, 20000).unref();
const s = await db.doc("appdata/v4:pessoas").get();
process.stderr.write("4: get returned, " + (s.data()?.value?.length ?? "?") + " pessoas\n");
process.exit(0);
