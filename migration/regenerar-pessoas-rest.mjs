// ════════════════════════════════════════════════════════════════════════════
//  REGENERA appdata/v4:pessoas — via REST API direto (firebase-admin gRPC
//  está travando hoje). Mesmo comportamento aditivo do script original.
//
//  DRY-RUN por padrão. Só escreve com --executar. Backup local antes.
// ════════════════════════════════════════════════════════════════════════════
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const DRY = !process.argv.includes("--executar");
const PROJECT = "gorjeta-app";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// ── Token gcloud ──
const TOKEN = execSync("gcloud auth application-default print-access-token", { encoding: "utf8" }).trim();
if (!TOKEN) { console.error("Sem token gcloud"); process.exit(1); }

// ── Conversores Firestore REST ↔ JS ──
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
  if (typeof v === "number") {
    if (Number.isInteger(v)) return { integerValue: String(v) };
    return { doubleValue: v };
  }
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
  if (!r.ok) throw new Error(`GET ${path}: HTTP ${r.status} ${await r.text()}`);
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

// ── pessoasMigrate — réplica EXATA do AppTip src/App.js linha 21691 ──
function pessoasMigrate(employees, managers) {
  const pessoas = [];
  (employees || []).forEach((emp) => {
    const rid = emp.restaurantId;
    const pinFromCpf = (emp.cpf || "").replace(/\D/g, "").slice(0, 4).padEnd(4, "0");
    const p = {
      id: `pes_emp_${emp.id}`,
      restaurantIds: rid ? [rid] : [],
      name: emp.name || "",
      cpf: emp.cpf || "",
      pin: pinFromCpf,
      mustChangePin: true,
      email: emp.email || null,
      whatsapp: emp.whatsapp || null,
      isTeam: rid ? { [rid]: true } : {},
      teamData: rid
        ? { [rid]: {
            empCode: emp.empCode ?? null,
            roleId: emp.roleId ?? null,
            admission: emp.admission ?? null,
            inactive: !!emp.inactive,
            inactiveFrom: emp.inactiveFrom ?? null,
            demitidoEm: emp.demitidoEm ?? null,
            isFreela: !!emp.isFreela,
          } }
        : {},
      linkedEmployeeId: emp.id,
      permissions: rid
        ? { [rid]: { operational: emp.operationalAreas || {}, admin: {}, special: {} } }
        : {},
      createdAt: emp.createdAt || new Date().toISOString(),
    };
    pessoas.push(p);
  });
  (managers || []).forEach((mgr) => {
    let target = null;
    if (mgr.linkedEmpId) target = pessoas.find((p) => p.linkedEmployeeId === mgr.linkedEmpId);
    if (!target && mgr.cpf) {
      const d = mgr.cpf.replace(/\D/g, "");
      if (d.length > 0) target = pessoas.find((p) => (p.cpf || "").replace(/\D/g, "") === d);
    }
    if (!target) {
      const pinFromCpf = (mgr.cpf || "").replace(/\D/g, "").slice(0, 4).padEnd(4, "0");
      target = {
        id: `pes_mgr_${mgr.id}`,
        restaurantIds: [],
        name: mgr.name || "",
        cpf: mgr.cpf || "",
        pin: pinFromCpf,
        mustChangePin: true,
        email: mgr.email || null,
        whatsapp: mgr.whatsapp || null,
        isTeam: {},
        teamData: {},
        linkedManagerId: mgr.id,
        permissions: {},
        createdAt: mgr.createdAt || new Date().toISOString(),
      };
      pessoas.push(target);
    } else {
      target.linkedManagerId = mgr.id;
    }
    const mgrRids = mgr.restaurantIds ?? (mgr.restaurantId ? [mgr.restaurantId] : []);
    mgrRids.forEach((rid) => {
      if (!target.restaurantIds.includes(rid)) target.restaurantIds.push(rid);
      if (!target.permissions[rid]) target.permissions[rid] = { operational: {}, admin: {}, special: {} };
      const perms = target.permissions[rid];
      if (mgr.perms?.tips) perms.admin.tips = true;
      if (mgr.perms?.schedule) perms.admin.schedule = true;
      if (mgr.perms?.vt !== false) perms.admin.vt = true;
      if (mgr.perms?.roles !== false) perms.admin.roles = true;
      if (mgr.perms?.employees !== false) perms.admin.employees = true;
      if (mgr.perms?.comunicados !== false) perms.admin.comunicados = true;
      if (mgr.perms?.faq !== false) perms.admin.faq = true;
      if (mgr.perms?.config !== false) perms.admin.config = true;
      if (mgr.isDP) perms.special.isDP = true;
      if (mgr.profile === "lider") {
        perms.special.profile = "lider";
        perms.special.areas = mgr.areas || [];
      }
      if (mgr.isMaster) perms.special.isMaster = true;
      if (mgr.pin && typeof mgr.pin === "string" && mgr.pin.length === 4) {
        target.pin = mgr.pin;
        target.mustChangePin = !!mgr.mustChangePin;
      }
    });
  });
  return pessoas;
}

// ── Carrega ──
process.stderr.write("lendo docs do AppTip (REST)...\n");
const pessoasDoc = await getDoc("appdata/v4:pessoas");
const employeesDoc = await getDoc("appdata/v4:employees");
const managersDoc = await getDoc("appdata/v4:managers");
const pessoasAtuais = pessoasDoc?.value || [];
const employees = employeesDoc?.value || [];
const managers = managersDoc?.value || [];
process.stderr.write(`carregado: ${pessoasAtuais.length} pessoas, ${employees.length} employees, ${managers.length} managers\n\n`);

// ── pessoasMigrate sobre o estado atual ──
const esperadas = pessoasMigrate(employees, managers);
const atuaisById = new Map(pessoasAtuais.map((p) => [p.id, p]));
const adicionadas = esperadas.filter((p) => !atuaisById.has(p.id));
const final = [...pessoasAtuais, ...adicionadas];
const esperadasIds = new Set(esperadas.map((p) => p.id));
const orfasNaoLigadas = pessoasAtuais.filter((p) => !esperadasIds.has(p.id));

// ── Relatório ──
console.log("══════════════════════════════════════════════════════════════════");
console.log(` REGENERAR appdata/v4:pessoas  ${DRY ? "— DRY-RUN" : "— ⚠️  MODO EXECUÇÃO"}`);
console.log("══════════════════════════════════════════════════════════════════\n");
console.log("── Estado atual ──");
console.log(`  pessoas:   ${pessoasAtuais.length}`);
console.log(`  employees: ${employees.length}`);
console.log(`  managers:  ${managers.length}\n`);

console.log("── Merge aditivo ──");
console.log(`  mantidas (já existem, intactas): ${pessoasAtuais.length}`);
console.log(`  adicionadas (faltavam):          ${adicionadas.length}`);
console.log(`  ───────────────────────────`);
console.log(`  TOTAL após merge:                ${final.length}\n`);

if (orfasNaoLigadas.length) {
  console.log(`── Pessoas atuais sem employee/manager correspondente: ${orfasNaoLigadas.length} (mantidas) ──`);
  orfasNaoLigadas.slice(0, 12).forEach((p) => console.log(`   ${p.id.padEnd(28)} ${p.name || "(s/ nome)"}`));
  if (orfasNaoLigadas.length > 12) console.log(`   … +${orfasNaoLigadas.length - 12}\n`);
  else console.log("");
}

console.log("── Pessoas ADICIONADAS (amostra) ──");
adicionadas.slice(0, 8).forEach((p) => console.log(`  ${p.id.padEnd(28)} ${(p.name || "?").padEnd(36)} rest:${(p.restaurantIds[0] || "—").slice(-8)}`));
if (adicionadas.length > 8) console.log(`  … +${adicionadas.length - 8}`);
console.log("");

if (adicionadas[0]) {
  console.log("── Amostra: 1 pessoa adicionada (estrutura completa) ──");
  console.log("  " + JSON.stringify(adicionadas[0], null, 2).split("\n").join("\n  ") + "\n");
}

console.log("── Sanity ──");
console.log(`  IDs únicos: ${new Set(final.map((p) => p.id)).size === final.length ? "✓ ok" : "✗ DUPLICADOS"}`);
console.log(`  Todas atuais preservadas: ${pessoasAtuais.every((p) => final.find((q) => q.id === p.id) === p) ? "✓ byte-a-byte" : "✗ ALTERAÇÃO"}`);

if (DRY) {
  console.log("\n⚠️  DRY-RUN — nada foi escrito.");
  console.log("   Pra escrever:  node regenerar-pessoas-rest.mjs --executar");
  process.exit(0);
}

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = `./backup-apptip-pessoas-${ts}.json`;
writeFileSync(backupPath, JSON.stringify(pessoasAtuais, null, 2));
console.log(`💾 Backup: ${backupPath}`);
await patchDoc("appdata/v4:pessoas", { value: final });
console.log(`✅ appdata/v4:pessoas gravado — ${final.length} pessoas (${adicionadas.length} novas).`);
process.exit(0);
