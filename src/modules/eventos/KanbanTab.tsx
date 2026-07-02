import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { parseYmd, pad2 } from "../../core/utils/date";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import type { LeadEvento, LeadEventoStatus, PacoteEvento } from "../../core/types";
import { LeadDrawer } from "./LeadDrawer";
import { NovoLeadManualModal } from "./NovoLeadManualModal";
import { RelatorioEventosModal } from "./RelatorioEventosModal";

const STATUS_LABEL: Record<LeadEventoStatus, string> = {
  novo: "Novo",
  qualificado: "Qualificado",
  proposta_enviada: "Proposta",
  sinal_recebido: "Sinal",
  confirmado: "Confirmado",
  realizado: "Realizado",
  perdido: "Perdido",
};

const STATUS_COR: Record<LeadEventoStatus, { bg: string; border: string; text: string }> = {
  novo:             { bg: "bg-blue-50 dark:bg-blue-900/20",       border: "border-blue-300 dark:border-blue-700",       text: "text-blue-800 dark:text-blue-300" },
  qualificado:      { bg: "bg-indigo-50 dark:bg-indigo-900/20",   border: "border-indigo-300 dark:border-indigo-700",   text: "text-indigo-800 dark:text-indigo-300" },
  proposta_enviada: { bg: "bg-purple-50 dark:bg-purple-900/20",   border: "border-purple-300 dark:border-purple-700",   text: "text-purple-800 dark:text-purple-300" },
  sinal_recebido:   { bg: "bg-amber-50 dark:bg-amber-900/20",     border: "border-amber-300 dark:border-amber-700",     text: "text-amber-800 dark:text-amber-300" },
  confirmado:       { bg: "bg-emerald-50 dark:bg-emerald-900/20", border: "border-emerald-300 dark:border-emerald-700", text: "text-emerald-800 dark:text-emerald-300" },
  realizado:        { bg: "bg-gray-100 dark:bg-gray-800/40",      border: "border-gray-300 dark:border-gray-700",       text: "text-gray-700 dark:text-gray-300" },
  perdido:          { bg: "bg-rose-50 dark:bg-rose-900/20",       border: "border-rose-300 dark:border-rose-700",       text: "text-rose-800 dark:text-rose-300" },
};

const COLUNAS: LeadEventoStatus[] = [
  "novo", "qualificado", "proposta_enviada", "sinal_recebido", "confirmado", "realizado",
];

const mesRefDe = (ymd: string) => (ymd || "").slice(0, 7);
const mesLabel = (ref: string) => {
  const [a, m] = ref.split("-");
  const nomes = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${nomes[Number(m)] || m}/${a}`;
};

type Props = {
  rid: string;
  podeEditar: boolean;
};

export function KanbanTab({ rid, podeEditar }: Props) {
  const { restaurants } = useRestaurant();
  const restaurant = restaurants.find(r => r.id === rid) || null;
  const comissaoCfg = restaurant?.eventosConfig?.comissao;

  const [leads, setLeads] = useState<LeadEvento[]>([]);
  const [pacotes, setPacotes] = useState<PacoteEvento[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string>("");
  const [leadAbertoId, setLeadAbertoId] = useState<string | null>(null);
  const [mostrarPerdidos, setMostrarPerdidos] = useState(false);
  const [criandoManual, setCriandoManual] = useState(false);

  // Drag-and-drop + histórico/fechamento mensal
  const [dragOver, setDragOver] = useState<LeadEventoStatus | null>(null);
  const [mesFechar, setMesFechar] = useState(() => new Date().toISOString().slice(0, 7));
  const [fechandoMes, setFechandoMes] = useState(false);
  const [relatorioMes, setRelatorioMes] = useState<string | null>(null);
  const [historicoAberto, setHistoricoAberto] = useState(false);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "leadsEvento"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as LeadEvento);
        list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setLeads(list);
        setLoading(false);
        setErro("");
      },
      (err) => {
        setLoading(false);
        if (err.code === "permission-denied") setErro("permission_denied");
        else setErro(err.message || "Erro ao carregar leads");
      },
    );
    return () => unsub();
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "pacotesEvento"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(
      q,
      (snap) => setPacotes(snap.docs.map(d => ({ id: d.id, ...d.data() }) as PacoteEvento)),
      () => { /* silent */ },
    );
    return () => unsub();
  }, [rid]);

  // Board ativo = tudo que não foi arquivado no fechamento mensal.
  const leadsAtivos = useMemo(() => leads.filter(l => !l.arquivadoEm), [leads]);
  const leadsArquivados = useMemo(() => leads.filter(l => !!l.arquivadoEm), [leads]);

  const leadsPorStatus = useMemo(() => {
    const acc: Record<LeadEventoStatus, LeadEvento[]> = {
      novo: [], qualificado: [], proposta_enviada: [], sinal_recebido: [],
      confirmado: [], realizado: [], perdido: [],
    };
    for (const l of leadsAtivos) acc[l.status].push(l);
    return acc;
  }, [leadsAtivos]);

  // Conflito por DIA (mesmo restaurante/espaço). Qualquer 2+ leads ativos
  // não-perdidos no mesmo dia entram no mapa.
  const leadsPorDia = useMemo(() => {
    const m = new Map<string, LeadEvento[]>();
    for (const l of leadsAtivos) {
      if (l.status === "perdido") continue;
      if (!m.has(l.dataDesejada)) m.set(l.dataDesejada, []);
      m.get(l.dataDesejada)!.push(l);
    }
    return m;
  }, [leadsAtivos]);

  const leadAberto = useMemo(() => leads.find(l => l.id === leadAbertoId) || null, [leads, leadAbertoId]);
  const conflitosDoLeadAberto = useMemo(() => {
    if (!leadAberto) return [];
    return (leadsPorDia.get(leadAberto.dataDesejada) || []).filter(o => o.id !== leadAberto.id);
  }, [leadAberto, leadsPorDia]);

  // Meses arquivados (histórico)
  const mesesArquivados = useMemo(() => {
    const m = new Map<string, LeadEvento[]>();
    for (const l of leadsArquivados) {
      const ref = l.arquivadoMesRef || mesRefDe(l.dataDesejada);
      if (!m.has(ref)) m.set(ref, []);
      m.get(ref)!.push(l);
    }
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [leadsArquivados]);

  // Elegíveis a fechar no mês selecionado: realizados, com fechamento, do mês, não arquivados.
  const elegiveisFecharMes = useMemo(
    () => leadsAtivos.filter(l => l.status === "realizado" && l.fechamento && mesRefDe(l.dataDesejada) === mesFechar),
    [leadsAtivos, mesFechar],
  );

  async function moverLead(leadId: string, novoStatus: LeadEventoStatus) {
    const l = leads.find(x => x.id === leadId);
    if (!l || l.status === novoStatus || !podeEditar) return;
    await updateDoc(doc(db, "leadsEvento", leadId), sanitizeForFirestore({
      status: novoStatus, updatedAt: new Date().toISOString(),
    }));
    // Realizado exige fechamento → abre o card pra completar dados de comissão.
    if (novoStatus === "realizado") setLeadAbertoId(leadId);
  }

  async function fecharMes() {
    if (fechandoMes || elegiveisFecharMes.length === 0) return;
    const ok = window.confirm(
      `Fechar ${mesLabel(mesFechar)}? ${elegiveisFecharMes.length} evento(s) realizado(s) vão pro histórico e saem do board.`,
    );
    if (!ok) return;
    setFechandoMes(true);
    try {
      const now = new Date().toISOString();
      await Promise.all(elegiveisFecharMes.map(l =>
        updateDoc(doc(db, "leadsEvento", l.id), sanitizeForFirestore({
          arquivadoEm: now, arquivadoMesRef: mesFechar, updatedAt: now,
        })),
      ));
      setRelatorioMes(mesFechar);
    } finally {
      setFechandoMes(false);
    }
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  if (erro === "permission_denied") {
    return (
      <div className="rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-4 text-sm">
        <p className="font-semibold text-rose-900 dark:text-rose-200 mb-1">⚠ Regras do Firestore não publicadas</p>
        <p className="text-rose-800 dark:text-rose-300 text-[13px]">Rode no terminal:</p>
        <code className="block mt-2 text-[12px] bg-white dark:bg-gray-900 px-3 py-2 rounded border border-rose-200 dark:border-rose-700 text-rose-900 dark:text-rose-200">
          firebase deploy --only firestore:rules --project gestaocentral
        </code>
      </div>
    );
  }
  if (erro) {
    return <div className="rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-4 text-sm text-rose-800 dark:text-rose-300">⚠ {erro}</div>;
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-gray-600 dark:text-gray-400">
          <strong>{leadsAtivos.length}</strong> lead(s) no funil
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
            <input type="checkbox" checked={mostrarPerdidos} onChange={(e) => setMostrarPerdidos(e.target.checked)} className="accent-indigo-600" />
            Mostrar perdidos ({leadsPorStatus.perdido.length})
          </label>
        </div>
      </div>

      {leadsAtivos.length === 0 && (
        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/30 border border-gray-200 dark:border-gray-700 p-4 text-center">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Nenhum lead ativo. Compartilhe a URL pública pra captar online, ou cadastre um lead manual.
          </p>
        </div>
      )}

      <div className="overflow-x-auto -mx-4 px-4 pb-2">
        <div className="flex gap-3 min-w-fit">
          {COLUNAS.map(status => {
            const itens = leadsPorStatus[status];
            const cor = STATUS_COR[status];
            const dropAtivo = dragOver === status;
            return (
              <div
                key={status}
                className="w-64 shrink-0"
                onDragOver={(e) => { if (podeEditar) { e.preventDefault(); setDragOver(status); } }}
                onDragLeave={() => setDragOver(d => (d === status ? null : d))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(null);
                  const id = e.dataTransfer.getData("text/plain");
                  if (id) moverLead(id, status);
                }}
              >
                <div className={`px-3 py-2 rounded-t-lg ${cor.bg} ${cor.border} border-b-2 flex items-center justify-between`}>
                  <span className={`text-[11px] font-bold uppercase tracking-wider ${cor.text}`}>{STATUS_LABEL[status]}</span>
                  <span className={`text-xs ${cor.text} font-semibold tabular-nums`}>{itens.length}</span>
                </div>
                <div className={`space-y-2 pt-2 min-h-[100px] rounded-b-lg transition-colors ${dropAtivo ? "bg-indigo-50/70 dark:bg-indigo-900/20 ring-2 ring-indigo-300 dark:ring-indigo-700" : ""}`}>
                  {itens.map(l => (
                    <LeadCardMini
                      key={l.id}
                      lead={l}
                      pacotes={pacotes}
                      leadsPorDia={leadsPorDia}
                      podeArrastar={podeEditar}
                      onClick={() => setLeadAbertoId(l.id)}
                    />
                  ))}
                  {status === "novo" && podeEditar && (
                    <button
                      type="button"
                      onClick={() => setCriandoManual(true)}
                      className="w-full text-left text-[11px] px-2 py-2 rounded-md border border-dashed border-indigo-300 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:border-indigo-500 transition-colors"
                    >
                      + Novo lead manual
                    </button>
                  )}
                  {itens.length === 0 && status !== "novo" && (
                    <div className="text-[10px] text-gray-400 dark:text-gray-600 italic text-center py-3">arraste um card aqui</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Perdidos */}
      {mostrarPerdidos && leadsPorStatus.perdido.length > 0 && (
        <div className="mt-6">
          <div className="text-[11px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 mb-2">Perdidos</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {leadsPorStatus.perdido.map(l => (
              <LeadCardMini key={l.id} lead={l} pacotes={pacotes} leadsPorDia={leadsPorDia} podeArrastar={false} onClick={() => setLeadAbertoId(l.id)} />
            ))}
          </div>
        </div>
      )}

      {/* Fechamento mensal + histórico */}
      <div className="mt-6 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">🗂️ Histórico mensal</h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Fecha o mês: eventos realizados e com fechamento preenchido vão pro histórico e geram o relatório de comissão.
            </p>
          </div>
          {podeEditar && (
            <div className="flex items-center gap-2">
              <input
                type="month"
                value={mesFechar}
                onChange={(e) => setMesFechar(e.target.value)}
                className="px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
              />
              <button
                type="button"
                onClick={fecharMes}
                disabled={fechandoMes || elegiveisFecharMes.length === 0}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-40"
                title={elegiveisFecharMes.length === 0 ? "Nenhum evento realizado+fechado neste mês" : ""}
              >
                {fechandoMes ? "Fechando…" : `Fechar mês (${elegiveisFecharMes.length})`}
              </button>
            </div>
          )}
        </div>

        {mesesArquivados.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setHistoricoAberto(v => !v)}
              className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              {historicoAberto ? "▾" : "▸"} Meses fechados ({mesesArquivados.length})
            </button>
            {historicoAberto && (
              <div className="mt-2 space-y-1.5">
                {mesesArquivados.map(([ref, ls]) => (
                  <div key={ref} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800">
                    <span className="text-sm text-gray-800 dark:text-gray-100 font-medium">{mesLabel(ref)}</span>
                    <span className="text-[11px] text-gray-500">{ls.length} evento(s)</span>
                    <button
                      type="button"
                      onClick={() => setRelatorioMes(ref)}
                      className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline ml-auto"
                    >
                      📊 Relatório
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Drawer */}
      {leadAberto && (
        <LeadDrawer
          lead={leadAberto}
          pacotes={pacotes}
          podeEditar={podeEditar}
          conflitosDoDia={conflitosDoLeadAberto}
          onClose={() => setLeadAbertoId(null)}
        />
      )}

      {/* Criação manual */}
      {criandoManual && (
        <NovoLeadManualModal rid={rid} onClose={() => setCriandoManual(false)} onCreated={(id) => setLeadAbertoId(id)} />
      )}

      {/* Relatório mensal */}
      {relatorioMes && (
        <RelatorioEventosModal
          leads={leads.filter(l => !!l.fechamento && (l.arquivadoMesRef || mesRefDe(l.dataDesejada)) === relatorioMes)}
          comissao={comissaoCfg}
          restaurantNome={restaurant?.nome || "Restaurante"}
          mesRef={relatorioMes}
          onClose={() => setRelatorioMes(null)}
        />
      )}
    </div>
  );
}

function LeadCardMini({
  lead, pacotes, leadsPorDia, podeArrastar, onClick,
}: {
  lead: LeadEvento;
  pacotes: PacoteEvento[];
  leadsPorDia: Map<string, LeadEvento[]>;
  podeArrastar: boolean;
  onClick: () => void;
}) {
  const cor = STATUS_COR[lead.status];
  const pacote = lead.pacoteSugeridoId ? pacotes.find(p => p.id === lead.pacoteSugeridoId) : null;
  const data = parseYmd(lead.dataDesejada);
  const doDia = (leadsPorDia.get(lead.dataDesejada) || []).filter(o => o.id !== lead.id);
  const conflita = doDia.length > 0;
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={podeArrastar}
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", lead.id); e.dataTransfer.effectAllowed = "move"; }}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
      className={`w-full text-left px-3 py-2 rounded-lg border ${cor.border} bg-white dark:bg-gray-900 hover:shadow-md transition-shadow ${podeArrastar ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate flex-1">{lead.cliente.nome}</span>
        <span className="text-[9px] uppercase tracking-wider font-bold text-gray-400">{lead.cliente.tipoPessoa}</span>
      </div>
      <div className="text-[11px] text-gray-600 dark:text-gray-400 mt-1 tabular-nums">
        {pad2(data.getDate())}/{pad2(data.getMonth() + 1)} ·{" "}
        {lead.slot === "almoco" ? "🌞" : lead.slot === "jantar" ? "🌙" : "🕒"} ·{" "}
        {lead.numConvidados} pax
      </div>
      {pacote && <div className="text-[11px] text-indigo-700 dark:text-indigo-400 mt-0.5 truncate">{pacote.nome}</div>}
      {(lead.ocasiao === "outros" ? lead.ocasiaoOutros : lead.ocasiao) && (
        <div className="text-[10px] text-gray-500 dark:text-gray-500 mt-0.5 truncate italic">
          {lead.ocasiao === "outros" ? lead.ocasiaoOutros : lead.ocasiao}
        </div>
      )}
      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
        {conflita && (
          <span className="text-[9px] uppercase font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            ⚠ {doDia.length + 1} no dia
          </span>
        )}
        {lead.origem === "publico" && (
          <span className="text-[9px] uppercase font-bold px-1 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            público
          </span>
        )}
      </div>
    </div>
  );
}
