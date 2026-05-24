// ════════════════════════════════════════════════════════════════════════════
//  Limpa as gorjetas importadas: zera taxRate e valorLiquido (snapshot só
//  faz sentido quando paga). Mantém valorBruto e demais campos.
//
//  Critério de filtro:
//   - paidAt == null (não foi paga)
//   - observacao começa com "Importado do AppTip" (foi importada por mim)
//
//  Dry-run por padrão. Só escreve com --executar.
// ════════════════════════════════════════════════════════════════════════════
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const DRY = !process.argv.includes("--executar");
const TOKEN = execSync("gcloud auth application-default print-access-token", { encoding: "utf8" }).trim();
const BASE = "https://firestore.googleapis.com/v1/projects/gestaocentral-85b13/databases/(default)/documents";

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
async function listAll(coll) {
  const docs = [];
  let next = null;
  do {
    const url = `${BASE}/${coll}?pageSize=300${next ? `&pageToken=${encodeURIComponent(next)}` : ""}`;
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
async function patchDoc(coll, id, data) {
  const r = await fetch(`${BASE}/${coll}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: toFs(data).mapValue.fields }),
  });
  if (!r.ok) throw new Error(`PATCH ${coll}/${id}: HTTP ${r.status} ${await r.text()}`);
}

process.stderr.write("lendo gorjetas...\n");
const all = await listAll("gorjetas");
const alvo = all.filter((g) =>
  g.paidAt == null &&
  typeof g.observacao === "string" &&
  g.observacao.startsWith("Importado do AppTip")
);
const naoElegiveis = all.length - alvo.length;

console.log("══════════════════════════════════════════════════════════════════");
console.log(` LIMPAR gorjetas importadas — ${DRY ? "DRY-RUN" : "⚠️  MODO EXECUÇÃO"}`);
console.log("══════════════════════════════════════════════════════════════════\n");
console.log(`Total gorjetas: ${all.length}`);
console.log(`Pendentes importadas do AppTip (alvo): ${alvo.length}`);
console.log(`Não elegíveis (já pagas ou criadas na UI): ${naoElegiveis}\n`);

if (alvo.length === 0) {
  console.log("Nada a fazer.");
  process.exit(0);
}

console.log("── Estado ANTES (amostra) ──");
const sample = alvo[0];
console.log(`  id:           ${sample.id}`);
console.log(`  date:         ${sample.date}`);
console.log(`  valorBruto:   R$ ${sample.valorBruto}   (preservado)`);
console.log(`  taxRate:      ${sample.taxRate}        → vai virar 0`);
console.log(`  valorLiquido: R$ ${sample.valorLiquido} → vai virar 0`);
console.log("");

console.log("── Estado DEPOIS (mesma amostra) ──");
console.log(`  valorBruto:   R$ ${sample.valorBruto}   ✓`);
console.log(`  taxRate:      0`);
console.log(`  valorLiquido: 0`);
console.log("");

// Soma o que seria zerado (curiosidade)
const totalTax = alvo.reduce((s, g) => s + (g.valorBruto * g.taxRate || 0), 0);
const totalLiquido = alvo.reduce((s, g) => s + (g.valorLiquido || 0), 0);
console.log("── Massa de dados ──");
console.log(`  Soma valorBruto:  R$ ${alvo.reduce((s, g) => s + g.valorBruto, 0).toFixed(2)} (preservado)`);
console.log(`  Soma taxRate snapshot zerado: R$ ${totalTax.toFixed(2)}`);
console.log(`  Soma valorLiquido zerado:    R$ ${totalLiquido.toFixed(2)}\n`);

if (DRY) {
  console.log("⚠️  DRY-RUN — nada foi escrito.");
  console.log("   Pra escrever:  node limpar-gorjetas-importadas.mjs --executar");
  process.exit(0);
}

// Backup antes
const ts = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(`./backup-gorjetas-pre-limpeza-${ts}.json`, JSON.stringify(alvo, null, 2));
console.log(`💾 Backup: backup-gorjetas-pre-limpeza-${ts}.json\n`);

console.log("💾 Gravando…");
let ok = 0;
let err = 0;
for (let i = 0; i < alvo.length; i++) {
  const g = alvo[i];
  const payload = { ...g, taxRate: 0, valorLiquido: 0, updatedAt: new Date().toISOString() };
  delete payload.id; // não persiste no doc — vem do nome
  try {
    await patchDoc("gorjetas", g.id, payload);
    ok += 1;
    if ((i + 1) % 25 === 0) process.stderr.write(`  ${i + 1}/${alvo.length}\n`);
  } catch (e) {
    err += 1;
    console.error(`  ERR ${g.id}: ${e.message}`);
  }
}
console.log(`\n✅ ${ok} atualizadas, ${err} erros.`);
process.exit(0);
