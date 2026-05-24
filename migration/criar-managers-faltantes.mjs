// ════════════════════════════════════════════════════════════════════════════
//  CRIA managers faltantes pra pessoas com perms admin/special sem
//  linkedManagerId. Replica a lógica de auto-criação do AppTip (App.js:27773).
//
//  Lê e escreve via REST API (gRPC do SDK admin está travando).
//  DRY-RUN por padrão. Só escreve com --executar. Backup local antes.
// ════════════════════════════════════════════════════════════════════════════
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const DRY = !process.argv.includes("--executar");
const PROJECT = "gorjeta-app";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const TOKEN = execSync("gcloud auth application-default print-access-token", { encoding: "utf8" }).trim();

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
async function getDoc(path) {
  const r = await fetch(`${BASE}/${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${path}: HTTP ${r.status}`);
  const j = await r.json();
  return j.fields ? fromFs({ mapValue: { fields: j.fields } }) : null;
}
async function patchDoc(path, data) {
  const body = JSON.stringify({ fields: toFs(data).mapValue.fields });
  const r = await fetch(`${BASE}/${path}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body,
  });
  if (!r.ok) throw new Error(`PATCH ${path}: HTTP ${r.status} ${await r.text()}`);
}

// ── Carrega ──
process.stderr.write("lendo pessoas, managers, employees...\n");
const pessoas = (await getDoc("appdata/v4:pessoas"))?.value || [];
const managers = (await getDoc("appdata/v4:managers"))?.value || [];
const employees = (await getDoc("appdata/v4:employees"))?.value || [];
const restaurants = (await getDoc("appdata/v4:restaurants"))?.value || [];
const restNome = {};
restaurants.forEach((r) => (restNome[r.id] = r.name || r.nome || r.id));

// ── Quem precisa de manager? ──
const mgrById = new Map(managers.map((m) => [m.id, m]));
const sufix = () => Math.random().toString(36).slice(-4);

function pessoaPrecisaManager(pessoa) {
  // Sem linkedManagerId OU linkedManagerId aponta pra manager que não existe
  const hasValidMgr = pessoa.linkedManagerId && mgrById.has(pessoa.linkedManagerId);
  if (hasValidMgr) return false;
  // Tem alguma admin true ou special isLider/isDP/isMaster?
  const perms = pessoa.permissions || {};
  for (const rid of Object.keys(perms)) {
    const p = perms[rid] || {};
    const admin = p.admin || {};
    const special = p.special || {};
    const temAdmin = Object.values(admin).some((v) => v === true);
    const temSpecial = special.isLider === true || special.isDP === true || special.isMaster === true;
    if (temAdmin || temSpecial) return true;
  }
  return false;
}

function construirManager(pessoa) {
  const ridsComPerm = [];
  const permsUnion = {};
  let profile = "custom";
  let areas = [];
  let isDP = false;
  let isMaster = false;
  for (const [rid, p] of Object.entries(pessoa.permissions || {})) {
    const admin = p.admin || {};
    const special = p.special || {};
    const temAdmin = Object.values(admin).some((v) => v === true);
    const temSpecial = special.isLider === true || special.isDP === true || special.isMaster === true;
    if (!temAdmin && !temSpecial) continue;
    ridsComPerm.push(rid);
    for (const [k, v] of Object.entries(admin)) if (v === true) permsUnion[k] = true;
    if (special.isLider === true) {
      profile = "lider";
      if (Array.isArray(special.areas) && special.areas.length) areas = [...new Set([...areas, ...special.areas])];
    }
    if (special.isDP === true) isDP = true;
    if (special.isMaster === true) isMaster = true;
  }
  const id = `mgr_auto_${pessoa.id}_${sufix()}`;
  return {
    id,
    name: pessoa.name || "",
    cpf: pessoa.cpf || "",
    pin: pessoa.pin || "0000",
    mustChangePin: !!pessoa.mustChangePin,
    restaurantIds: ridsComPerm,
    perms: permsUnion,
    profile,
    areas,
    isDP,
    isMaster,
    linkedPessoaId: pessoa.id,
    createdAt: new Date().toISOString(),
  };
}

const candidatas = pessoas.filter(pessoaPrecisaManager);
const novosManagers = candidatas.map(construirManager);

// pessoas atualizadas com linkedManagerId
const linkPorPessoaId = new Map(candidatas.map((p, i) => [p.id, novosManagers[i].id]));
const pessoasAtualizadas = pessoas.map((p) =>
  linkPorPessoaId.has(p.id) ? { ...p, linkedManagerId: linkPorPessoaId.get(p.id) } : p,
);
const managersFinal = [...managers, ...novosManagers];

// ── Relatório ──
console.log("══════════════════════════════════════════════════════════════════");
console.log(` MANAGERS FALTANTES  ${DRY ? "— DRY-RUN" : "— ⚠️  MODO EXECUÇÃO"}`);
console.log("══════════════════════════════════════════════════════════════════\n");
console.log(`pessoas:   ${pessoas.length}`);
console.log(`managers:  ${managers.length}  →  ${managersFinal.length} (+${novosManagers.length})\n`);

console.log("── Pessoas que precisam de manager (vão ganhar linkedManagerId) ──");
candidatas.forEach((p, i) => {
  const m = novosManagers[i];
  const rests = m.restaurantIds.map((r) => restNome[r] || r).join(", ") || "—";
  const sinais = [];
  if (m.profile === "lider") sinais.push(`🌟 ${m.profile}`);
  if (m.isDP) sinais.push("💬 DP");
  if (m.isMaster) sinais.push("👑 master");
  const perms = Object.keys(m.perms).filter((k) => m.perms[k]).join(",") || "—";
  console.log(`  ${(p.name || "(s/ nome)").padEnd(36)} ${rests.padEnd(28)} ${sinais.join(" ").padEnd(16)} perms: ${perms}`);
});
console.log("");

console.log("── Sanity ──");
const idsAntes = new Set(managers.map((m) => m.id));
const dupes = novosManagers.filter((m) => idsAntes.has(m.id));
console.log(`  managers atuais preservados:    ${managersFinal.slice(0, managers.length).every((m, i) => m === managers[i]) ? "✓ byte-a-byte" : "✗"}`);
console.log(`  IDs duplicados:                 ${dupes.length === 0 ? "✓ nenhum" : "✗ " + dupes.length}`);
console.log(`  pessoas tocadas:                ${candidatas.length}`);
console.log(`  pessoas preservadas (restantes): ${pessoas.length - candidatas.length}`);

if (DRY) {
  console.log("\n⚠️  DRY-RUN — nada foi escrito.");
  console.log("   Pra escrever:  node criar-managers-faltantes.mjs --executar");
  process.exit(0);
}

const ts = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(`./backup-apptip-managers-${ts}.json`, JSON.stringify(managers, null, 2));
writeFileSync(`./backup-apptip-pessoas-${ts}.json`, JSON.stringify(pessoas, null, 2));
console.log(`💾 Backups: backup-apptip-managers-${ts}.json + backup-apptip-pessoas-${ts}.json`);

await patchDoc("appdata/v4:managers", { value: managersFinal });
console.log(`✅ managers gravado: ${managersFinal.length} (+${novosManagers.length})`);
await patchDoc("appdata/v4:pessoas", { value: pessoasAtualizadas });
console.log(`✅ pessoas gravado: ${pessoasAtualizadas.length} (${candidatas.length} com linkedManagerId atualizado)`);
process.exit(0);
