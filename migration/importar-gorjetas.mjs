// ════════════════════════════════════════════════════════════════════════════
//  IMPORTA gorjetas DIÁRIAS (só valor bruto) do AppTip → Planejamento.
//  Período: Abr+Mai 2026. Sem divisaoSnapshot — todas como pendentes.
//
//  Sobrescreve qualquer gorjeta existente com mesmo (rid,date,unidadeId).
//
//  Mapeamento AppTip rid → Planejamento rid + unidadeId:
//   1775792279549 (Sororoca AppTip)  → ucPUFirPOjBZTU8jYbkf (Sororoca)        — sem unidade
//   1775792314382 (Lobozó AppTip)    → SEmad7GK0ZI298S1CFzb (Lobozó)          — sem unidade
//   1777204146548 (Puba matriz)      → T671zhYNYCeYDWt9vxTQ (Puba) / Cidade Velha
//   1777204191993 (Puba filial)      → T671zhYNYCeYDWt9vxTQ (Puba) / Porto Futuro
//
//  Dry-run por padrão. Só escreve com --executar.
// ════════════════════════════════════════════════════════════════════════════
import { execSync } from "node:child_process";
const DRY = !process.argv.includes("--executar");
const TOKEN = execSync("gcloud auth application-default print-access-token", { encoding: "utf8" }).trim();
const APP_BASE = "https://firestore.googleapis.com/v1/projects/gorjeta-app/databases/(default)/documents";
const PLAN_BASE = "https://firestore.googleapis.com/v1/projects/gestaocentral-85b13/databases/(default)/documents";

function fromFs(v) {
  if (v == null) return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromFs);
  if ("mapValue" in v) {
    const o = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) o[k] = fromFs(val);
    return o;
  }
  return null;
}
function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  if (typeof v === "object") {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = toFs(val);
    return { mapValue: { fields } };
  }
  return { nullValue: null };
}
async function getDoc(base, p) {
  const r = await fetch(`${base}/${p}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) return null;
  const j = await r.json();
  return j.fields ? fromFs({ mapValue: { fields: j.fields } }) : null;
}
async function listAll(base, coll) {
  const docs = [];
  let next = null;
  do {
    const url = `${base}/${coll}?pageSize=300${next ? `&pageToken=${encodeURIComponent(next)}` : ""}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) return docs;
    const j = await r.json();
    (j.documents || []).forEach((d) => {
      const id = d.name.split("/").pop();
      const data = d.fields ? fromFs({ mapValue: { fields: d.fields } }) : null;
      docs.push({ id, ...data });
    });
    next = j.nextPageToken || null;
  } while (next);
  return docs;
}
async function patchPlanDoc(coll, id, data) {
  const r = await fetch(`${PLAN_BASE}/${coll}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: toFs(data).mapValue.fields }),
  });
  if (!r.ok) throw new Error(`PATCH ${coll}/${id}: HTTP ${r.status} ${await r.text()}`);
}

// ── Carrega ──
process.stderr.write("lendo dados (AppTip + Planejamento)...\n");
const tipsDoc = await getDoc(APP_BASE, "appdata/v4:tips");
const tips = tipsDoc?.value || [];
const planRests = await listAll(PLAN_BASE, "restaurants");
const planRestById = Object.fromEntries(planRests.map((r) => [r.id, r]));

// ── Acha unidades do Puba ──
const PUBA_ID = "T671zhYNYCeYDWt9vxTQ";
const puba = planRestById[PUBA_ID];
const pubaUnidades = puba?.unidades || [];
const cidadeVelha = pubaUnidades.find((u) => /cidade/i.test(u.nome || ""));
const portoFuturo = pubaUnidades.find((u) => /porto/i.test(u.nome || ""));
if (!cidadeVelha || !portoFuturo) {
  console.error("⚠ Não achei unidades 'Cidade Velha' e/ou 'Porto Futuro' no Puba.");
  console.error("Unidades atuais do Puba:", pubaUnidades.map((u) => u.nome));
  process.exit(1);
}

// AppTip rid → { restaurantId Planejamento, unidadeId (ou null) }
const MAP = {
  "1775792279549": { rid: "ucPUFirPOjBZTU8jYbkf", unidadeId: null, label: "Sororoca" },
  "1775792314382": { rid: "SEmad7GK0ZI298S1CFzb", unidadeId: null, label: "Lobozó" },
  "1777204146548": { rid: PUBA_ID, unidadeId: cidadeVelha.id, label: `Puba / ${cidadeVelha.nome}` },
  "1777204191993": { rid: PUBA_ID, unidadeId: portoFuturo.id, label: `Puba / ${portoFuturo.nome}` },
};

// ── Filtra Abr+Mai 2026 e agrupa por (rid AppTip, date) ──
const grupos = new Map(); // key = `${appRid}|${date}` → { tipsCount, valorBruto, taxRate, anyNote }
for (const t of tips) {
  if (t.monthKey !== "2026-04" && t.monthKey !== "2026-05") continue;
  if (!t.restaurantId || !t.date) continue;
  if (!MAP[t.restaurantId]) continue;
  const k = `${t.restaurantId}|${t.date}`;
  if (!grupos.has(k)) {
    grupos.set(k, {
      appRid: t.restaurantId,
      date: t.date,
      valorBruto: t.poolTotal,
      taxRate: t.taxRate,
      tipsCount: 0,
      notes: new Set(),
    });
  }
  const g = grupos.get(k);
  g.tipsCount += 1;
  if (t.note && t.note.trim()) g.notes.add(t.note.trim());
}

// ── Constrói Gorjetas ──
const now = new Date().toISOString();
const ME = "Ug4expnJl4DwRqADJvXB"; // pessoa Gustavo (de quem rodou a migração antes)
const gorjetas = [];
for (const g of grupos.values()) {
  const m = MAP[g.appRid];
  const valorBruto = Math.round(g.valorBruto * 100) / 100;
  const taxRate = g.taxRate || 0;
  const valorLiquido = Math.round(valorBruto * (1 - taxRate) * 100) / 100;
  const id = m.unidadeId ? `${m.rid}_${g.date}_${m.unidadeId}` : `${m.rid}_${g.date}`;
  const observacaoExtra = g.notes.size ? ` · notas AppTip: ${[...g.notes].join(" | ")}` : "";
  gorjetas.push({
    id,
    restaurantId: m.rid,
    unidadeId: m.unidadeId, // null pra single-rest
    date: g.date,
    valorBruto,
    taxRate,
    valorLiquido,
    observacao: `Importado do AppTip${observacaoExtra}`,
    divisaoSnapshot: null,
    paidAt: null,
    paidBy: null,
    createdAt: now,
    createdBy: ME,
    updatedAt: now,
    _origemAppTip: true,
  });
}
gorjetas.sort((a, b) => a.date.localeCompare(b.date) || a.restaurantId.localeCompare(b.restaurantId));

// ── Relatório ──
console.log("══════════════════════════════════════════════════════════════════");
console.log(` IMPORTAR GORJETAS — Abr+Mai 2026  ${DRY ? "— DRY-RUN" : "— ⚠️  MODO EXECUÇÃO"}`);
console.log("══════════════════════════════════════════════════════════════════\n");

console.log("── Mapeamento de unidades do Puba ──");
console.log(`  AppTip matriz  (1777204146548) → ${cidadeVelha.nome} (id ${cidadeVelha.id})`);
console.log(`  AppTip filial  (1777204191993) → ${portoFuturo.nome} (id ${portoFuturo.id})`);
console.log("");

const porRest = {};
let totalBruto = 0;
for (const g of gorjetas) {
  const k = MAP[g._origemAppTip && Object.keys(MAP).find((rid) => MAP[rid].rid === g.restaurantId && MAP[rid].unidadeId === g.unidadeId)]?.label || g.restaurantId;
  porRest[k] = porRest[k] || { dias: 0, bruto: 0, liquido: 0 };
  porRest[k].dias += 1;
  porRest[k].bruto += g.valorBruto;
  porRest[k].liquido += g.valorLiquido;
  totalBruto += g.valorBruto;
}
console.log("── Resumo por restaurante/unidade ──");
for (const [k, s] of Object.entries(porRest)) {
  console.log(`  ${k.padEnd(28)} ${String(s.dias).padStart(3)} dias  bruto: R$ ${s.bruto.toFixed(2).padStart(10)}  líquido: R$ ${s.liquido.toFixed(2).padStart(10)}`);
}
console.log(`  ── TOTAL                       ${String(gorjetas.length).padStart(3)} dias  bruto: R$ ${totalBruto.toFixed(2)}`);
console.log("");

console.log("── Amostra: 1 gorjeta que vai ser gravada ──");
console.log("  " + JSON.stringify(gorjetas[0], null, 2).split("\n").join("\n  "));

if (DRY) {
  console.log("\n⚠️  DRY-RUN — nada foi escrito.");
  console.log("   Pra escrever:  node importar-gorjetas.mjs --executar");
  process.exit(0);
}

// ── Execução real ──
console.log("\n💾 Gravando…");
let ok = 0;
let err = 0;
for (let i = 0; i < gorjetas.length; i++) {
  const g = gorjetas[i];
  // Remove campos internos antes de gravar
  const { _origemAppTip, ...payload } = g;
  void _origemAppTip;
  try {
    await patchPlanDoc("gorjetas", g.id, payload);
    ok += 1;
    if ((i + 1) % 25 === 0) process.stderr.write(`  ${i + 1}/${gorjetas.length}\n`);
  } catch (e) {
    err += 1;
    console.error(`  ERR ${g.id}: ${e.message}`);
  }
}
console.log(`\n✅ ${ok} gravadas, ${err} erros.`);
process.exit(0);
