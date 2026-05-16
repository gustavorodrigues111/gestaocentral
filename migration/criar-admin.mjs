// Cria /admins/gustavo@quibebe.com.br no Planejamento via REST API.
import { execSync } from "node:child_process";
const TOKEN = execSync("gcloud auth application-default print-access-token", { encoding: "utf8" }).trim();
const BASE = "https://firestore.googleapis.com/v1/projects/gestaocentral-85b13/databases/(default)/documents";

const EMAIL = "gustavo@quibebe.com.br";
const body = {
  fields: {
    since: { timestampValue: new Date().toISOString() },
    name:  { stringValue: "Gustavo Rodrigues" },
    note:  { stringValue: "Master inicial criado pelo script criar-admin.mjs" },
  },
};

const r = await fetch(`${BASE}/admins/${encodeURIComponent(EMAIL)}`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
if (!r.ok) {
  console.error("ERRO:", r.status, await r.text());
  process.exit(1);
}
console.log("✅ /admins/" + EMAIL + " criado/atualizado.");
process.exit(0);
