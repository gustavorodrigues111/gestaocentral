// READ-ONLY — varre TODOS os docs /appdata do AppTip + Planejamento atrás dos
// nomes dos órfãos.
import admin from "firebase-admin";

const apptip = admin.initializeApp(
  { credential: admin.credential.applicationDefault(), projectId: "gorjeta-app" },
  "apptip",
);
const plan = admin.initializeApp(
  { credential: admin.credential.applicationDefault(), projectId: "gestaocentral-85b13" },
  "plan",
);
const aDb = admin.firestore(apptip);
const pDb = admin.firestore(plan);

const ORPHANS = [
  "emp_mofwug1bf04",
  "emp_mofwwdg1oku",
  "emp_mofwwdg1iy8",
  "emp_mofwwdg1pnr",
  "emp_morfrq6buxd",
  "emp_moo9la2ul2a",
  "emp_mordl32od8y",
  "emp_morlq5zwedi",
  "1775830282844",
  "1775830410477",
];
const hits = {};
ORPHANS.forEach((id) => (hits[id] = new Set()));

// Acha objetos que CONTÊM o id (como chave ou valor) e captura campos *name/*nome próximos.
function walk(node, orphanId, found, depth = 0) {
  if (!node || depth > 10) return;
  if (Array.isArray(node)) {
    for (const x of node) walk(x, orphanId, found, depth + 1);
    return;
  }
  if (typeof node === "object") {
    const entries = Object.entries(node);
    const containsId = entries.some(
      ([k, v]) => k === orphanId || v === orphanId || (typeof v === "string" && v === orphanId),
    );
    if (containsId) {
      for (const [k, v] of entries) {
        if (/name|nome/i.test(k) && typeof v === "string" && v.trim().length > 1) {
          found.add(v.trim());
        }
      }
    }
    for (const [, v] of entries) walk(v, orphanId, found, depth + 1);
  }
}

// ── AppTip: todos os docs /appdata ──
const appdataSnap = await aDb.collection("appdata").get();
console.log(`Varrendo ${appdataSnap.size} docs /appdata do AppTip...\n`);
for (const d of appdataSnap.docs) {
  const val = d.data()?.value;
  if (val == null) continue;
  for (const id of ORPHANS) {
    const blob = JSON.stringify(val);
    if (!blob.includes(id)) continue;
    const found = new Set();
    walk(val, id, found);
    found.forEach((n) => hits[id].add(`${n}  [apptip/${d.id}]`));
    if (found.size === 0) hits[id].add(`(presente em apptip/${d.id}, sem nome no objeto)`);
  }
}

// ── Planejamento: pessoas + empregados ──
for (const col of ["pessoas", "empregados"]) {
  const snap = await pDb.collection(col).get();
  for (const doc of snap.docs) {
    const data = doc.data();
    const blob = JSON.stringify(data);
    for (const id of ORPHANS) {
      if (blob.includes(id)) {
        hits[id].add(`${data.nome || data.name || "(s/ nome)"}  [plan/${col}]`);
      }
    }
  }
}

console.log("══════════════════════════════════════════════════════════");
console.log(" CAÇA AOS NOMES DOS ÓRFÃOS");
console.log("══════════════════════════════════════════════════════════\n");
for (const id of ORPHANS) {
  console.log(`▸ ${id}`);
  if (hits[id].size === 0) {
    console.log("    ❓ nada encontrado em nenhum doc");
  } else {
    [...hits[id]].forEach((h) => console.log(`    ${h}`));
  }
  console.log("");
}
process.exit(0);
