// READ-ONLY — identifica os empregados órfãos cruzando docs intactos do AppTip.
import admin from "firebase-admin";

const apptip = admin.initializeApp(
  { credential: admin.credential.applicationDefault(), projectId: "gorjeta-app" },
  "apptip",
);
const aDb = admin.firestore(apptip);
const getVal = async (p) => {
  const s = await aDb.doc(p).get();
  return s.exists ? (s.data()?.value ?? null) : null;
};

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
const SET = new Set(ORPHANS);

const restaurants = (await getVal("appdata/v4:restaurants")) || [];
const restNome = {};
restaurants.forEach((r) => (restNome[r.id] = r.name || r.nome || r.id));

const tips = (await getVal("appdata/v4:tips")) || [];
const schedules = (await getVal("appdata/v4:schedules")) || {};
const scheduleVersions = (await getVal("appdata/v4:scheduleVersions")) || {};
const vtConfig = (await getVal("appdata/v4:vtConfig")) || {};
const workSchedules = (await getVal("appdata/v4:workSchedules")) || {};
const pessoas = (await getVal("appdata/v4:pessoas")) || [];
const managers = (await getVal("appdata/v4:managers")) || [];
const notifications = (await getVal("appdata/v4:notifications")) || [];
const incidents = (await getVal("appdata/v4:incidents")) || [];
const delays = (await getVal("appdata/v4:delays")) || [];
const meetingActions = (await getVal("appdata/v4:meetingActions")) || [];
const roles = (await getVal("appdata/v4:roles")) || [];
const roleById = {};
roles.forEach((r) => (roleById[r.id] = r));

// perfil acumulado por órfão
const prof = {};
ORPHANS.forEach((id) => {
  prof[id] = { id, names: new Set(), rests: new Set(), areas: new Set(), tipDates: [], dailyRates: new Set(), roleIds: new Set(), foundIn: new Set() };
});

// ── tips: employeeId, area, date ──
for (const t of tips) {
  const eid = String(t.employeeId ?? "");
  if (!SET.has(eid)) continue;
  const p = prof[eid];
  p.foundIn.add("tips");
  if (t.area) p.areas.add(t.area);
  if (t.date) p.tipDates.push(t.date);
  if (t.employeeName || t.name) p.names.add(t.employeeName || t.name);
}

// ── docs object {rid: {empId: ...}} ──
function scanRidEmp(doc, label, onHit) {
  for (const [rid, sub] of Object.entries(doc || {})) {
    if (!sub || typeof sub !== "object") continue;
    // pode ser {empId:...} ou {month:{empId:...}}
    const lvl1 = Object.keys(sub);
    for (const k1 of lvl1) {
      if (SET.has(k1)) {
        prof[k1].rests.add(rid);
        prof[k1].foundIn.add(label);
        if (onHit) onHit(k1, rid, sub[k1]);
      }
      const v1 = sub[k1];
      if (v1 && typeof v1 === "object") {
        for (const k2 of Object.keys(v1)) {
          if (SET.has(k2)) {
            prof[k2].rests.add(rid);
            prof[k2].foundIn.add(label);
            if (onHit) onHit(k2, rid, v1[k2]);
          }
        }
      }
    }
  }
}
scanRidEmp(schedules, "schedules");
scanRidEmp(scheduleVersions, "scheduleVersions");
scanRidEmp(workSchedules, "workSchedules");
scanRidEmp(vtConfig, "vtConfig", (id, rid, val) => {
  if (val && typeof val.dailyRate === "number") prof[id].dailyRates.add(val.dailyRate);
});

// ── pessoas / managers: procura nome ──
for (const pessoa of pessoas) {
  const blob = JSON.stringify(pessoa);
  for (const id of ORPHANS) {
    if (blob.includes(id)) {
      prof[id].names.add(pessoa.name || pessoa.nome || "(pessoa s/ nome)");
      prof[id].foundIn.add("pessoas");
    }
  }
}
for (const m of managers) {
  const blob = JSON.stringify(m);
  for (const id of ORPHANS) {
    if (blob.includes(id)) {
      prof[id].names.add((m.name || m.nome || "(manager)") + " [manager]");
      prof[id].foundIn.add("managers");
    }
  }
}

// ── scan genérico: notifications, incidents, delays, meetingActions ──
// Normaliza pra lista de itens, seja array ou objeto {rid:[...]} ou {rid:{...}}
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
function deepNameScan(raw, label) {
  const arr = toItems(raw);
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const blob = JSON.stringify(item);
    for (const id of ORPHANS) {
      if (!blob.includes(id)) continue;
      prof[id].foundIn.add(label);
      // pega qualquer campo *name/*nome do item
      for (const [k, v] of Object.entries(item)) {
        if (/name|nome/i.test(k) && typeof v === "string" && v.length > 1) {
          prof[id].names.add(v + ` (${label})`);
        }
      }
    }
  }
}
deepNameScan(notifications, "notifications");
deepNameScan(incidents, "incidents");
deepNameScan(delays, "delays");
deepNameScan(meetingActions, "meetingActions");

// ── relatório ──
console.log("══════════════════════════════════════════════════════════════════");
console.log(" ÓRFÃOS — empregados referenciados mas não recuperáveis");
console.log("══════════════════════════════════════════════════════════════════\n");
for (const id of ORPHANS) {
  const p = prof[id];
  const dates = p.tipDates.sort();
  const periodo = dates.length
    ? `${dates[0]} → ${dates[dates.length - 1]} (${dates.length} gorjetas)`
    : "sem gorjetas";
  const rests = [...p.rests].map((r) => restNome[r] || r).join(", ") || "—";
  const nomes = [...p.names].join(" | ") || "❓ NOME NÃO ENCONTRADO";
  console.log(`▸ ${id}`);
  console.log(`    nome:        ${nomes}`);
  console.log(`    restaurante: ${rests}`);
  console.log(`    área:        ${[...p.areas].join(", ") || "—"}`);
  console.log(`    atividade:   ${periodo}`);
  if (p.dailyRates.size) console.log(`    VT/dia:      ${[...p.dailyRates].join(", ")}`);
  console.log(`    aparece em:  ${[...p.foundIn].join(", ")}`);
  console.log("");
}
process.exit(0);
