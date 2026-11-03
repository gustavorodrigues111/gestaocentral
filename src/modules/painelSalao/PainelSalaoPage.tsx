// PainelSalaoPage — container do Painel do Salão para o NAVEGADOR AUTENTICADO
// (rota /r/:rid/painel). Lê o Firestore ao vivo (onSnapshot) filtrando por
// restaurantId e normaliza tudo pro componente de apresentação <PainelColunas>.
// A estação de parede usa a PainelEstacaoPage (mesma tela, dados via feed).
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, query, where, onSnapshot, orderBy, limit } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { PainelColunas, type PainelData } from "./PainelColunas";

function todayYmd(): string { const d = new Date(); const p = (n: number) => (n < 10 ? `0${n}` : `${n}`); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function hhmmToMin(s?: string): number { if (!s) return -1; const [h, m] = s.split(":").map(Number); return (h || 0) * 60 + (m || 0); }
function daysBetween(a: string, b: string): number { const da = new Date(a + "T12:00:00").getTime(); const dbt = new Date(b + "T12:00:00").getTime(); return Math.round((dbt - da) / 86400000); }
function foneKey(waId?: string): string { let d = String(waId || "").replace(/\D/g, ""); if (d.startsWith("55")) d = d.slice(2); if (d.length >= 10) d = d.slice(0, 2) + d.slice(-8); return d; }

export function PainelSalaoPage() {
  const { rid = "" } = useParams();
  const { activeRestaurant } = useRestaurant();
  const [now, setNow] = useState(Date.now()); // só pra reavaliar "hoje" ao virar o dia
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 300000); return () => clearInterval(t); }, []);

  // Reservas: /reservas + /reservasPII (nome)
  const [reservasBase, setReservasBase] = useState<any[]>([]);
  const [reservasPii, setReservasPii] = useState<Record<string, any>>({});
  useEffect(() => {
    if (!rid) return;
    const hoje = todayYmd();
    const qb = query(collection(db, "reservas"), where("restaurantId", "==", rid), where("data", "==", hoje));
    const qp = query(collection(db, "reservasPII"), where("restaurantId", "==", rid), where("data", "==", hoje));
    const u1 = onSnapshot(qb, (s) => setReservasBase(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {});
    const u2 = onSnapshot(qp, (s) => { const m: Record<string, any> = {}; s.docs.forEach((d) => { m[d.id] = d.data(); }); setReservasPii(m); }, () => {});
    return () => { u1(); u2(); };
  }, [rid, now]);

  // Freelas & turnos
  const [shifts, setShifts] = useState<any[]>([]);
  useEffect(() => { if (!rid) return; const q = query(collection(db, "freelaShifts"), where("restaurantId", "==", rid)); return onSnapshot(q, (s) => setShifts(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {}); }, [rid]);

  // Checklists
  const [tmpls, setTmpls] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  useEffect(() => { if (!rid) return; const q = query(collection(db, "checklistTemplates"), where("restaurantId", "==", rid)); return onSnapshot(q, (s) => setTmpls(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {}); }, [rid]);
  useEffect(() => { if (!rid) return; const q = query(collection(db, "checklistRuns"), where("restaurantId", "==", rid)); return onSnapshot(q, (s) => setRuns(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {}); }, [rid]);

  // WhatsApp
  const [waNumeros, setWaNumeros] = useState<any[]>([]);
  const [waMsgs, setWaMsgs] = useState<any[]>([]);
  useEffect(() => { const q = collection(db, "whatsappNumeros"); return onSnapshot(q, (s) => setWaNumeros(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {}); }, []);
  useEffect(() => {
    const cutoff = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
    const q = query(collection(db, "whatsappMensagens"), where("timestamp", ">=", cutoff), orderBy("timestamp", "desc"), limit(1500));
    return onSnapshot(q, (s) => setWaMsgs(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {});
  }, []);

  const data: PainelData = useMemo(() => {
    const hoje = todayYmd();
    const dow = new Date(hoje + "T12:00:00").getDay();
    // Reservas
    const reservas = reservasBase
      .filter((r) => r.status !== "cancelada" && r.status !== "no_show")
      .map((r) => ({ id: r.id, horario: r.horario, status: r.status, nome: reservasPii[r.id]?.clienteNomeSnapshot || r.clienteNomeSnapshot, pessoas: r.pessoas, mesas: (r.mesasNomesSnapshot || []).join(" + ") || r.mesaNomeSnapshot || "" }));
    // Freelas
    const freelasAbertos = shifts.filter((s) => s.status === "aberto" && !s.saida).sort((a, b) => hhmmToMin(a.entrada) - hhmmToMin(b.entrada)).map((s) => ({ id: s.id, nome: s.nomeSnapshot, area: s.area, entrada: s.entrada }));
    const freelasProgramados = shifts.filter((s) => s.status === "agendado" && s.date === hoje).sort((a, b) => hhmmToMin(a.entradaPrevista) - hhmmToMin(b.entradaPrevista)).map((s) => ({ id: s.id, nome: s.nomeSnapshot, area: s.area, entradaPrevista: s.entradaPrevista, saidaPrevista: s.saidaPrevista }));
    // Checklists
    const runHoje = new Map<string, any>();
    const ultimoRun = new Map<string, string>();
    for (const r of runs) {
      if (r.data === hoje && !runHoje.has(r.templateId)) runHoje.set(r.templateId, r);
      const prev = ultimoRun.get(r.templateId);
      if (!prev || (r.data || "") > prev) ultimoRun.set(r.templateId, r.data || "");
    }
    const checklists = tmpls.filter((t) => {
      if (t.ativo === false) return false;
      const f = t.frequencia;
      if (f === "diaria") return !t.diasSemana || t.diasSemana.length === 0 || t.diasSemana.includes(dow);
      if (f === "semanal") { const lr = ultimoRun.get(t.id); return !lr || daysBetween(lr, hoje) >= 7; }
      if (f === "mensal") { const lr = ultimoRun.get(t.id); return !lr || lr.slice(0, 7) !== hoje.slice(0, 7); }
      return runHoje.has(t.id);
    }).map((t) => {
      const run = runHoje.get(t.id);
      const pct = run ? Math.round(((run.feitos || 0) / Math.max(1, run.totalItens || 1)) * 100) : 0;
      return { id: t.id, nome: t.nome || "Checklist", turno: t.turno, area: t.area, hora: t.horarioReferencia, pct, completo: run?.status === "completo" };
    }).sort((a, b) => (a.hora || "99:99").localeCompare(b.hora || "99:99"));
    // WhatsApp
    const numIds = new Set(waNumeros.filter((n) => (n.restaurantIds || []).includes(rid) && n.ativo !== false).map((n) => n.id));
    const conv = new Map<string, any>();
    for (const m of waMsgs) {
      if (!m.numeroId || !numIds.has(m.numeroId) || m.ehGrupo) continue;
      const k = foneKey(m.waId);
      let c = conv.get(k);
      if (!c) { c = { key: k, nome: undefined, _ts: m.timestamp || "", preview: m.texto || (m.tipo ? `[${m.tipo}]` : ""), naoLidas: 0 }; conv.set(k, c); }
      if ((m.timestamp || "") > c._ts) { c._ts = m.timestamp || ""; c.preview = m.texto || (m.tipo ? `[${m.tipo}]` : ""); }
      if (m.nome && m.direcao === "in" && !c.nome) c.nome = m.nome;
      if (m.direcao === "in" && !m.lido) c.naoLidas++;
    }
    const waList = [...conv.values()].filter((c) => c.naoLidas > 0).sort((a, b) => (b._ts || "").localeCompare(a._ts || ""));
    return {
      nome: activeRestaurant?.nome || "Restaurante",
      reservas, freelasAbertos, freelasProgramados, checklists,
      wa: { list: waList, total: waList.reduce((s, c) => s + c.naoLidas, 0) },
    };
  }, [reservasBase, reservasPii, shifts, tmpls, runs, waNumeros, waMsgs, rid, activeRestaurant, now]);

  return <PainelColunas rid={rid} data={data} />;
}
