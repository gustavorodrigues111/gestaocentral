// READ-ONLY — detecta o "gap pós-migração": o que mudou no AppTip entre a
// migração rodar e o estrago (13/05 17:51 UTC).
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
const getVal = async (p) => {
  const s = await aDb.doc(p).get();
  return s.exists ? (s.data()?.value ?? null) : null;
};

const LOSS = "2026-05-13T17:51:11Z";

// ── Planejamento: empregados migrados ──
const planSnap = await pDb.collection("empregados").get();
const planEmps = planSnap.docs.map((d) => ({ docId: d.id, ...d.data() }));

// quando a migração rodou? (createdAt dos empregados)
const createdAts = planEmps.map((e) => e.createdAt).filter(Boolean).sort();
const migInicio = createdAts[0];
const migFim = createdAts[createdAts.length - 1];

// ── AppTip intactos ──
const vtConfig = (await getVal("appdata/v4:vtConfig")) || {};
const tips = (await getVal("appdata/v4:tips")) || [];

// vtConfig: achata pra { empIdOuCode: dailyRate }
const vtByKey = {};
for (const [, sub] of Object.entries(vtConfig)) {
  if (!sub || typeof sub !== "object") continue;
  for (const [empKey, v] of Object.entries(sub)) {
    if (v && typeof v.dailyRate === "number") vtByKey[empKey] = v.dailyRate;
  }
}

// tips: última data por empKey
const lastTip = {};
const firstTip = {};
for (const t of tips) {
  const k = String(t.employeeId ?? "");
  if (!k || !t.date) continue;
  if (!lastTip[k] || t.date > lastTip[k]) lastTip[k] = t.date;
  if (!firstTip[k] || t.date < firstTip[k]) firstTip[k] = t.date;
}

console.log("══════════════════════════════════════════════════════════════════");
console.log(" CHECK DO GAP PÓS-MIGRAÇÃO");
console.log("══════════════════════════════════════════════════════════════════\n");
console.log("Janela do gap:");
console.log(`  migração rodou:  ${migInicio}  →  ${migFim}`);
console.log(`  estrago no AppTip: ${LOSS}`);
console.log(
  `  → gap = qualquer mudança no AppTip entre ${(migFim || "").slice(0, 16)} e ${LOSS.slice(0, 16)}\n`,
);

// ── 1) VT: AppTip (intacto) vs Planejamento (cópia) ──
console.log("── 1) VT mudou no gap? (vtConfig do AppTip vs Planejamento) ──");
let vtDiffs = 0;
for (const e of planEmps) {
  const k1 = e._migracaoAppTipEmpId ? String(e._migracaoAppTipEmpId) : null;
  const k2 = e._migracaoAppTipEmpCode ? String(e._migracaoAppTipEmpCode) : null;
  const appVt = (k1 && vtByKey[k1] != null) ? vtByKey[k1] : (k2 && vtByKey[k2] != null ? vtByKey[k2] : null);
  if (appVt == null) continue;
  const planVt =
    (Number(e.vtPassagensPorDia) || 0) * (Number(e.vtValorPassagem) || 0);
  // compara com tolerância
  if (Math.abs(appVt - planVt) > 0.05) {
    vtDiffs += 1;
    console.log(
      `  ⚠ ${(e.nome || "?").padEnd(34)} AppTip=R$${appVt.toFixed(2)}/dia  Planejamento=R$${planVt.toFixed(2)}/dia`,
    );
  }
}
if (vtDiffs === 0) console.log("  ✓ nenhum VT divergente — VT não mudou no gap (ou foi migrado igual)");
console.log("");

// ── 2) Atividade: quem trabalhou DEPOIS da migração? (confirma roster ativo) ──
console.log("── 2) Empregados migrados — última gorjeta no AppTip ──");
const semAtividade = [];
let ativosPosMig = 0;
for (const e of planEmps) {
  const k1 = e._migracaoAppTipEmpId ? String(e._migracaoAppTipEmpId) : null;
  const k2 = e._migracaoAppTipEmpCode ? String(e._migracaoAppTipEmpCode) : null;
  const lt = (k1 && lastTip[k1]) || (k2 && lastTip[k2]) || null;
  if (!lt) {
    semAtividade.push(e.nome || e.docId);
    continue;
  }
  if (migFim && lt > migFim.slice(0, 10)) ativosPosMig += 1;
}
console.log(`  ${planEmps.length} migrados — ${ativosPosMig} com gorjeta DEPOIS da migração (roster ativo confirmado)`);
console.log(`  ${semAtividade.length} sem nenhuma gorjeta no AppTip:`);
if (semAtividade.length) console.log(`    ${semAtividade.join(", ")}`);
console.log("");

// ── 3) Possíveis ADMISSÕES no gap: empKeys ativos no AppTip que NÃO estão no Planejamento ──
console.log("── 3) Possíveis admissões no gap (ativos no AppTip, ausentes do Planejamento) ──");
const planKeys = new Set();
planEmps.forEach((e) => {
  if (e._migracaoAppTipEmpId) planKeys.add(String(e._migracaoAppTipEmpId));
  if (e._migracaoAppTipEmpCode) planKeys.add(String(e._migracaoAppTipEmpCode));
});
// survivors do AppTip
const survivors = (await getVal("appdata/v4:employees")) || [];
survivors.forEach((e) => {
  planKeys.add(String(e.id));
  if (e.empCode) planKeys.add(String(e.empCode));
});
const candidatos = [];
for (const k of Object.keys(lastTip)) {
  if (planKeys.has(k)) continue;
  candidatos.push({ k, first: firstTip[k], last: lastTip[k] });
}
candidatos.sort((a, b) => (a.first || "").localeCompare(b.first || ""));
for (const c of candidatos) {
  const novoNoGap = migFim && c.first > migFim.slice(0, 10);
  console.log(
    `  ${c.k.padEnd(20)} 1ª gorjeta ${c.first}  última ${c.last}  ${novoNoGap ? "🆕 ADMITIDO NO GAP" : "(já existia antes da migração — foi pulado)"}`,
  );
}
if (candidatos.length === 0) console.log("  ✓ nenhum");
console.log("");

console.log("── Resumo ──");
console.log(`  • Gap = ${(migFim || "?").slice(0, 16)} até ${LOSS.slice(0, 16)}`);
console.log(`  • VT divergente: ${vtDiffs}`);
console.log(`  • Admissões no gap: ${candidatos.filter((c) => migFim && c.first > migFim.slice(0, 10)).length}`);
console.log(`  • Órfãos que já existiam (pulados, não é gap): ${candidatos.filter((c) => !(migFim && c.first > migFim.slice(0, 10))).length}`);

process.exit(0);
