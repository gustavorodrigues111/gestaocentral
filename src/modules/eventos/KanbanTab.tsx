import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { parseYmd, pad2 } from "../../core/utils/date";
import type { LeadEvento, LeadEventoStatus, PacoteEvento } from "../../core/types";
import { LeadDrawer } from "./LeadDrawer";

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

type Props = {
  rid: string;
  podeEditar: boolean;
};

export function KanbanTab({ rid, podeEditar }: Props) {
  const [leads, setLeads] = useState<LeadEvento[]>([]);
  const [pacotes, setPacotes] = useState<PacoteEvento[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string>("");
  const [leadAbertoId, setLeadAbertoId] = useState<string | null>(null);
  const [mostrarPerdidos, setMostrarPerdidos] = useState(false);

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
        // Mensagem mais útil pra erro de permissão (rules não publicadas)
        if (err.code === "permission-denied") {
          setErro("permission_denied");
        } else {
          setErro(err.message || "Erro ao carregar leads");
        }
      },
    );
    return () => unsub();
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "pacotesEvento"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setPacotes(snap.docs.map(d => ({ id: d.id, ...d.data() }) as PacoteEvento));
      },
      () => { /* silent — KanbanTab usa pacotes só como nice-to-have */ },
    );
    return () => unsub();
  }, [rid]);

  const leadsPorStatus = useMemo(() => {
    const acc: Record<LeadEventoStatus, LeadEvento[]> = {
      novo: [], qualificado: [], proposta_enviada: [], sinal_recebido: [],
      confirmado: [], realizado: [], perdido: [],
    };
    for (const l of leads) acc[l.status].push(l);
    return acc;
  }, [leads]);

  // Conflito de data: marca leads que dividem data com outro confirmado/sinal_recebido
  const datasConfirmadas = useMemo(() => {
    const m = new Map<string, LeadEvento[]>();
    for (const l of leads) {
      if (l.status === "confirmado" || l.status === "sinal_recebido") {
        const key = `${l.dataDesejada}|${l.slot}`;
        if (!m.has(key)) m.set(key, []);
        m.get(key)!.push(l);
      }
    }
    return m;
  }, [leads]);

  const leadAberto = useMemo(
    () => leads.find(l => l.id === leadAbertoId) || null,
    [leads, leadAbertoId],
  );

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  if (erro === "permission_denied") {
    return (
      <div className="rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-4 text-sm">
        <p className="font-semibold text-rose-900 dark:text-rose-200 mb-1">
          ⚠ Regras do Firestore não publicadas
        </p>
        <p className="text-rose-800 dark:text-rose-300 text-[13px]">
          As regras de acesso pras coleções de Eventos ainda não foram publicadas.
          Rode no terminal:
        </p>
        <code className="block mt-2 text-[12px] bg-white dark:bg-gray-900 px-3 py-2 rounded border border-rose-200 dark:border-rose-700 text-rose-900 dark:text-rose-200">
          firebase deploy --only firestore:rules --project gestaocentral
        </code>
      </div>
    );
  }
  if (erro) {
    return (
      <div className="rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-4 text-sm text-rose-800 dark:text-rose-300">
        ⚠ {erro}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-gray-600 dark:text-gray-400">
          <strong>{leads.length}</strong> lead(s) no funil
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={mostrarPerdidos}
              onChange={(e) => setMostrarPerdidos(e.target.checked)}
              className="accent-indigo-600"
            />
            Mostrar perdidos ({leadsPorStatus.perdido.length})
          </label>
        </div>
      </div>

      {leads.length === 0 ? (
        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/30 border border-gray-200 dark:border-gray-700 p-6 text-center">
          <div className="text-3xl mb-2">🎉</div>
          <p className="text-sm text-gray-700 dark:text-gray-300 font-medium">
            Nenhum lead ainda
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            Compartilhe a URL pública pra começar a receber interesses:
          </p>
          <code className="block mt-2 text-xs bg-white dark:bg-gray-900 px-3 py-2 rounded border border-gray-200 dark:border-gray-700 text-indigo-700 dark:text-indigo-400">
            {window.location.origin}/eventos/{rid}
          </code>
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 px-4 pb-2">
          <div className="flex gap-3 min-w-fit">
            {COLUNAS.map(status => {
              const itens = leadsPorStatus[status];
              const cor = STATUS_COR[status];
              return (
                <div key={status} className="w-64 shrink-0">
                  <div className={`px-3 py-2 rounded-t-lg ${cor.bg} ${cor.border} border-b-2 flex items-center justify-between`}>
                    <span className={`text-[11px] font-bold uppercase tracking-wider ${cor.text}`}>
                      {STATUS_LABEL[status]}
                    </span>
                    <span className={`text-xs ${cor.text} font-semibold tabular-nums`}>
                      {itens.length}
                    </span>
                  </div>
                  <div className="space-y-2 pt-2 min-h-[100px]">
                    {itens.map(l => (
                      <LeadCardMini
                        key={l.id}
                        lead={l}
                        pacotes={pacotes}
                        datasConfirmadas={datasConfirmadas}
                        onClick={() => setLeadAbertoId(l.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Lista de perdidos */}
      {mostrarPerdidos && leadsPorStatus.perdido.length > 0 && (
        <div className="mt-6">
          <div className="text-[11px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 mb-2">
            Perdidos
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {leadsPorStatus.perdido.map(l => (
              <LeadCardMini
                key={l.id}
                lead={l}
                pacotes={pacotes}
                datasConfirmadas={datasConfirmadas}
                onClick={() => setLeadAbertoId(l.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Drawer com detalhe do lead */}
      {leadAberto && (
        <LeadDrawer
          lead={leadAberto}
          pacotes={pacotes}
          podeEditar={podeEditar}
          onClose={() => setLeadAbertoId(null)}
        />
      )}
    </div>
  );
}

function LeadCardMini({
  lead, pacotes, datasConfirmadas, onClick,
}: {
  lead: LeadEvento;
  pacotes: PacoteEvento[];
  datasConfirmadas: Map<string, LeadEvento[]>;
  onClick: () => void;
}) {
  const cor = STATUS_COR[lead.status];
  const pacote = lead.pacoteSugeridoId ? pacotes.find(p => p.id === lead.pacoteSugeridoId) : null;
  const data = parseYmd(lead.dataDesejada);
  const conflitaKey = `${lead.dataDesejada}|${lead.slot}`;
  const conflitos = datasConfirmadas.get(conflitaKey) || [];
  const conflita = conflitos.length > 0 && !conflitos.some(c => c.id === lead.id);
  const temDuvida = !!lead.duvidaPraGestor && !lead.duvidaPraGestor.respondidoEm;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-lg border ${cor.border} bg-white dark:bg-gray-900 hover:shadow-md transition-shadow`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate flex-1">
          {lead.cliente.nome}
        </span>
        <span className="text-[9px] uppercase tracking-wider font-bold text-gray-400">
          {lead.cliente.tipoPessoa}
        </span>
      </div>
      <div className="text-[11px] text-gray-600 dark:text-gray-400 mt-1 tabular-nums">
        {pad2(data.getDate())}/{pad2(data.getMonth() + 1)} ·{" "}
        {lead.slot === "almoco" ? "🌞" : lead.slot === "jantar" ? "🌙" : "🕒"} ·{" "}
        {lead.numConvidados} pax
      </div>
      {pacote && (
        <div className="text-[11px] text-indigo-700 dark:text-indigo-400 mt-0.5 truncate">
          {pacote.nome}
        </div>
      )}
      {(lead.ocasiao === "outros" ? lead.ocasiaoOutros : lead.ocasiao) && (
        <div className="text-[10px] text-gray-500 dark:text-gray-500 mt-0.5 truncate italic">
          {lead.ocasiao === "outros" ? lead.ocasiaoOutros : lead.ocasiao}
        </div>
      )}
      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
        {temDuvida && (
          <span className="text-[9px] uppercase font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            🙋 dúvida
          </span>
        )}
        {conflita && (
          <span className="text-[9px] uppercase font-bold px-1 py-0.5 rounded bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">
            ⚠ data ocupada
          </span>
        )}
        {lead.origem === "publico" && (
          <span className="text-[9px] uppercase font-bold px-1 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            público
          </span>
        )}
      </div>
    </button>
  );
}
