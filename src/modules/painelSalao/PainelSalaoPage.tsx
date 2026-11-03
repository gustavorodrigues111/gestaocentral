// PainelSalaoPage — container do Painel do Salão para o NAVEGADOR AUTENTICADO
// (rota /r/:rid/painel). Lê o Firestore ao vivo (onSnapshot) filtrando por
// restaurantId e normaliza tudo pro componente de apresentação <PainelColunas>.
// Suporta navegação de dia (dataSel) e seletor de número do WhatsApp. A estação
// de parede usa a PainelEstacaoPage (mesma tela, dados via feed).
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, query, where, onSnapshot, orderBy, limit } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { PainelColunas, type PainelData } from "./PainelColunas";

function todayYmd(): string { const d = new Date(); const p = (n: number) => (n < 10 ? `0${n}` : `${n}`); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function hhmmToMin(s?: string): number { if (!s) return -1; const [h, m] = s.split(":").map(Number); return (h || 0) * 60 + (m || 0); }
function daysBetween(a: string, b: string): number { const da = new Date(a + "T12:00:00").getTime(); const dbt = new Date(b + "T12:00:00").getTime(); return Math.round((dbt - da) / 86400000); }
function turnoDe(horario?: string): string | undefined { const m = hhmmToMin(horario); if (m < 0) return undefined; return m < 17 * 60 ? "Almoço" : "Jantar"; }
function foneKey(waId?: string): string { let d = String(waId || "").replace(/\D/g, ""); if (d.startsWith("55")) d = d.slice(2); if (d.length >= 10) d = d.slice(0, 2) + d.slice(-8); return d; }
function nomeNumero(n: any): string { return n.nome || n.rotulo || n.label || n.numero || n.telefone || n.phone || n.id; }

export function PainelSalaoPage() {
  const { rid = "" } = useParams();
  const { activeRestaurant } = useRestaurant();
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 300000); return () => clearInterval(t); }, []);
  const [dataSel, setDataSel] = useState<string>(() => todayYmd());
  const [waSel, setWaSel] = useState<string | null>(() => { try { return localStorage.getItem(`painel_wa_num_${rid}`); } catch { return null; } });

  // Reservas do dia selecionado (/reservas + /reservasPII p/ nome)
  const [reservasBase, setReservasBase] = useState<any[]>([]);
  const [reservasPii, setReservasPii] = useState<Record<string, any>>({});
  useEffect(() => {
    if (!rid) return;
    const qb = query(collection(db, "reservas"), where("restaurantId", "==", rid), where("data", "==", dataSel));
    const qp = query(collection(db, "reservasPII"), where("restaurantId", "==", rid), where("data", "==", dataSel));
    const u1 = onSnapshot(qb, (s) => setReservasBase(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {});
    const u2 = onSnapshot(qp, (s) => { const m: Record<string, any> = {}; s.docs.forEach((d) => { m[d.id] = d.data(); }); setReservasPii(m); }, () => {});
    return () => { u1(); u2(); };
  }, [rid, dataSel]);

  // Próximas reservas (a partir de hoje) — pra mostrar "a próxima" quando o dia não tem nenhuma
  const [reservasProx, setReservasProx] = useState<any[]>([]);
  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "reservas"), where("restaurantId", "==", rid), where("data", ">=", todayYmd()), orderBy("data", "asc"), limit(40));
    return onSnapshot(q, (s) => setReservasProx(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {});
  }, [rid, tick]);

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

  const waNumerosList = useMemo(() => waNumeros.filter((n) => (n.restaurantIds || []).includes(rid) && n.ativo !== false).map((n) => ({ id: n.id as string, nome: nomeNumero(n) })), [waNumeros, rid]);
  const waSelEff = waSel != null ? waSel : (waNumerosList.length > 1 ? waNumerosList[0].id : "");

  const data: PainelData = useMemo(() => {
    const hoje = todayYmd();
    const isHoje = dataSel === hoje;
    const dow = new Date(dataSel + "T12:00:00").getDay();
    // Reservas do dia
    const reservas = reservasBase
      .filter((r) => r.status !== "cancelada" && r.status !== "no_show")
      .map((r) => ({ id: r.id, horario: r.horario, status: r.status, nome: reservasPii[r.id]?.clienteNomeSnapshot || r.clienteNomeSnapshot, pessoas: r.pessoas, mesas: (r.mesasNomesSnapshot || []).join(" + ") || r.mesaNomeSnapshot || "" }));
    // Próxima reserva (quando o dia selecionado está vazio)
    const nowD = new Date();
    const nowMin = nowD.getHours() * 60 + nowD.getMinutes();
    const prox = reservasProx
      .filter((r) => r.status !== "cancelada" && r.status !== "no_show")
      .filter((r) => r.data > hoje || (r.data === hoje && hhmmToMin(r.horario) >= nowMin))
      .filter((r) => r.data !== dataSel) // já teria aparecido na lista do dia
      .sort((a, b) => (a.data + (a.horario || "")).localeCompare(b.data + (b.horario || "")))[0];
    const proximaReserva = prox ? { data: prox.data, horario: prox.horario, turno: turnoDe(prox.horario), nome: reservasPii[prox.id]?.clienteNomeSnapshot || prox.clienteNomeSnapshot, pessoas: prox.pessoas } : null;
    // Freelas
    const freelasAbertos = isHoje ? shifts.filter((s) => s.status === "aberto" && !s.saida).sort((a, b) => hhmmToMin(a.entrada) - hhmmToMin(b.entrada)).map((s) => ({ id: s.id, nome: s.nomeSnapshot, area: s.area, entrada: s.entrada })) : [];
    const freelasProgramados = shifts.filter((s) => s.status === "agendado" && s.date === dataSel).sort((a, b) => hhmmToMin(a.entradaPrevista) - hhmmToMin(b.entradaPrevista)).map((s) => ({ id: s.id, nome: s.nomeSnapshot, area: s.area, entradaPrevista: s.entradaPrevista, saidaPrevista: s.saidaPrevista }));
    // Checklists do dia
    const runDia = new Map<string, any>();
    const ultimoRun = new Map<string, string>();
    for (const r of runs) {
      if (r.data === dataSel && !runDia.has(r.templateId)) runDia.set(r.templateId, r);
      const prev = ultimoRun.get(r.templateId);
      if (!prev || (r.data || "") > prev) ultimoRun.set(r.templateId, r.data || "");
    }
    const checklists = tmpls.filter((t) => {
      if (t.ativo === false) return false;
      const f = t.frequencia;
      if (f === "diaria") return !t.diasSemana || t.diasSemana.length === 0 || t.diasSemana.includes(dow);
      if (f === "semanal") { const lr = ultimoRun.get(t.id); return !lr || daysBetween(lr, dataSel) >= 7; }
      if (f === "mensal") { const lr = ultimoRun.get(t.id); return !lr || lr.slice(0, 7) !== dataSel.slice(0, 7); }
      return runDia.has(t.id);
    }).map((t) => {
      const run = runDia.get(t.id);
      const pct = run ? Math.round(((run.feitos || 0) / Math.max(1, run.totalItens || 1)) * 100) : 0;
      return { id: t.id, nome: t.nome || "Checklist", turno: t.turno, area: t.area, hora: t.horarioReferencia, pct, completo: run?.status === "completo" };
    }).sort((a, b) => (a.hora || "99:99").localeCompare(b.hora || "99:99"));
    // WhatsApp (filtrado pelo número selecionado)
    const numIds = new Set(waNumerosList.filter((n) => !waSelEff || n.id === waSelEff).map((n) => n.id));
    const conv = new Map<string, any>();
    for (const m of waMsgs) {
      if (!m.numeroId || !numIds.has(m.numeroId) || m.ehGrupo) continue;
      const k = foneKey(m.waId);
      let c = conv.get(k);
      if (!c) { c = { key: k, nome: undefined, _ts: m.timestamp || "", preview: m.texto || (m.tipo ? `[${m.tipo}]` : ""), naoLidas: 0, numeroId: m.numeroId, waId: m.waId }; conv.set(k, c); }
      if ((m.timestamp || "") > c._ts) { c._ts = m.timestamp || ""; c.preview = m.texto || (m.tipo ? `[${m.tipo}]` : ""); c.waId = m.waId || c.waId; }
      if (m.nome && m.direcao === "in" && !c.nome) c.nome = m.nome;
      if (m.direcao === "in" && !m.lido) c.naoLidas++;
    }
    const waList = [...conv.values()].filter((c) => c.naoLidas > 0).sort((a, b) => (b._ts || "").localeCompare(a._ts || ""));
    return {
      nome: activeRestaurant?.nome || "Restaurante",
      reservas, proximaReserva, freelasAbertos, freelasProgramados, checklists,
      wa: { list: waList, total: waList.reduce((s, c) => s + c.naoLidas, 0) },
    };
  }, [reservasBase, reservasPii, reservasProx, shifts, tmpls, runs, waNumerosList, waMsgs, waSelEff, rid, activeRestaurant, dataSel]);

  return (
    <PainelColunas
      rid={rid}
      data={data}
      dataSel={dataSel}
      onDataSel={setDataSel}
      waNumeros={waNumerosList}
      waNumeroSel={waSelEff}
      onWaNumero={(id) => { setWaSel(id); try { localStorage.setItem(`painel_wa_num_${rid}`, id); } catch { /* */ } }}
    />
  );
}
