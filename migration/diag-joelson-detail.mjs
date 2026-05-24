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

const emps = await listAll("empregados");
const joelson = emps.find(e => /joelson/i.test(e.nome || ""));
console.log("=== Joelson workSchedules detalhado ===");
console.log(JSON.stringify(joelson.workSchedules, null, 2));
