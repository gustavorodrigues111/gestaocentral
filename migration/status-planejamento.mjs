// READ-ONLY — status atual do projeto Planejamento via REST.
import { execSync } from "node:child_process";

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

const collections = [
  "restaurants", "pessoas", "empregados", "cargos", "escalas",
  "gorjetas", "splitVersions", "vtFolhas", "comunicados", "ocorrencias",
  "ideias", "reunioes", "trilhaEventos", "reservas", "clientes", "mesas",
  "checklistTemplates", "checklistRuns", "contagens", "insumos", "fornecedores",
  "pedidos", "permissionTemplates", "historico", "auditLog",
];

console.log("══════════════════════════════════════════════════════════════════");
console.log(" STATUS — planejamento.app (gestaocentral-85b13)");
console.log("══════════════════════════════════════════════════════════════════\n");

const counts = {};
for (const c of collections) {
  const docs = await listAll(c);
  counts[c] = docs.length;
  if (c === "restaurants") {
    console.log("── Restaurantes ──");
    docs.forEach((r) => {
      const uns = (r.unidades || []).length;
      console.log(`  ${(r.nome || r.id).padEnd(20)}  ${(r.shortCode || "?").padEnd(5)}  ${(r.subdomain || "—").padEnd(14)} unidades:${uns}  ativo:${r.ativo !== false ? "✓" : "✗"}`);
    });
    console.log("");
  }
}

console.log("── Coleções (contagem) ──");
Object.entries(counts).forEach(([c, n]) => {
  if (n > 0) console.log(`  ${c.padEnd(22)} ${n}`);
});
console.log("\n── Coleções vazias ──");
Object.entries(counts).forEach(([c, n]) => {
  if (n === 0) console.log(`  ${c}`);
});

process.exit(0);
