// READ-ONLY — procura QUALQUER registro com timestamp dentro da janela do gap
// (2026-05-11T15:14 .. 2026-05-13T17:51) que toque em empregados.
import admin from "firebase-admin";

const apptip = admin.initializeApp(
  { credential: admin.credential.applicationDefault(), projectId: "gorjeta-app" },
  "apptip",
);
const aDb = admin.firestore(apptip);

const GAP_INI = "2026-05-11T15:14:54";
const GAP_FIM = "2026-05-13T17:51:11";

// docs que podem registrar eventos de RH / mudanças
const DOCS = [
  "v4:notifications",
  "v4:incidents",
  "v4:scheduleAdjustments",
  "v4:tipApprovals",
  "v4:delays",
  "v4:feedbacks",
  "v4:meetingActions",
  "v4:dpMessages",
  "v4:inbox",
  "v4:communications",
];

function toItems(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") {
    const out = [];
    for (const sub of Object.values(v)) {
      if (Array.isArray(sub)) out.push(...sub);
      else if (sub && typeof sub === "object") out.push(sub);
    }
    return out;
  }
  return [];
}

// extrai qualquer string que pareça timestamp ISO de um objeto
function timestamps(obj) {
  const out = [];
  const re = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
  function w(n, d = 0) {
    if (!n || d > 6) return;
    if (typeof n === "string" && re.test(n)) out.push(n);
    else if (Array.isArray(n)) n.forEach((x) => w(x, d + 1));
    else if (typeof n === "object") Object.values(n).forEach((x) => w(x, d + 1));
  }
  w(obj);
  return out;
}

console.log("══════════════════════════════════════════════════════════════════");
console.log(` EVENTOS NA JANELA DO GAP  (${GAP_INI}  ..  ${GAP_FIM})`);
console.log("══════════════════════════════════════════════════════════════════\n");

let totalNoGap = 0;
for (const docId of DOCS) {
  const snap = await aDb.doc(`appdata/${docId}`).get();
  if (!snap.exists) continue;
  const items = toItems(snap.data()?.value);
  const noGap = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const ts = timestamps(it).filter((t) => t >= GAP_INI && t <= GAP_FIM);
    if (ts.length) noGap.push({ it, ts: ts.sort()[0] });
  }
  if (noGap.length) {
    console.log(`▸ ${docId}: ${noGap.length} registro(s) no gap`);
    noGap
      .sort((a, b) => a.ts.localeCompare(b.ts))
      .forEach(({ it, ts }) => {
        const resumo =
          it.title || it.titulo || it.message || it.text || it.descricao ||
          it.tipo || it.type || it.note || JSON.stringify(it).slice(0, 120);
        console.log(`    ${ts}  ${String(resumo).slice(0, 110)}`);
      });
    console.log("");
    totalNoGap += noGap.length;
  }
}

if (totalNoGap === 0) {
  console.log("✓ NENHUM registro encontrado na janela do gap em nenhum desses docs.");
  console.log("  (não prova 100% que nada mudou — edições diretas no doc employees");
  console.log("   não geram esse tipo de registro — mas é um forte indício de gap vazio)");
} else {
  console.log(`Total: ${totalNoGap} registro(s) no gap — revisar acima se algum é de empregado.`);
}

process.exit(0);
