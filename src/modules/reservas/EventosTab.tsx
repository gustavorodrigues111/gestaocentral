// Aba "Eventos" do módulo Reservas — eventos especiais (jantar pago etc.).
// Reservas do evento são lançadas pela EQUIPE (ReservaModal com bloco de
// pagamento + comprovante). Pasta do Drive por evento (conta central, subpasta
// de uma pasta-raiz indicada pelo usuário).
import { useEffect, useMemo, useState } from "react";
import { PartyPopper, Plus, Settings, Trash2, X, Check, FileText, ChevronLeft, FolderOpen, CalendarDays } from "lucide-react";
import { useAuth } from "../../core/auth/AuthContext";
import { fmtBR } from "../../core/utils/date";
import { centralConfigured, centralEnsureFolder, parseDriveFolderId } from "../../core/google/driveCentral";
import type { Reserva, ReservaEvento, ReservaEventoConfig } from "../../core/types";
import { ouvirEventos, salvarEvento, excluirEvento, ouvirEventoConfig, salvarEventoConfig } from "./eventosRepo";

const uid = () => { try { return crypto.randomUUID(); } catch { return "ev" + Date.now() + Math.random().toString(36).slice(2); } };
const fmtR = (n: number) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const parseR = (s: string) => { const n = parseFloat((s || "").replace(/[R$\s.]/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; };
const periodoTxt = (e: ReservaEvento) => e.dataFim && e.dataFim !== e.dataInicio ? `${fmtBR(e.dataInicio)} – ${fmtBR(e.dataFim)}` : fmtBR(e.dataInicio);

export function EventosTab({ rid, reservas, podeEditar, onNovaReserva, onEditarReserva }: {
  rid: string; reservas: Reserva[]; podeEditar: boolean;
  onNovaReserva: (ev: ReservaEvento) => void;
  onEditarReserva: (r: Reserva, ev: ReservaEvento) => void;
}) {
  const [eventos, setEventos] = useState<ReservaEvento[]>([]);
  const [cfg, setCfg] = useState<ReservaEventoConfig | null>(null);
  const [central, setCentral] = useState<boolean | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ ev?: ReservaEvento } | null>(null);

  useEffect(() => ouvirEventos(rid, setEventos), [rid]);
  useEffect(() => ouvirEventoConfig(rid, setCfg), [rid]);
  useEffect(() => { centralConfigured().then(setCentral).catch(() => setCentral(false)); }, []);

  const sel = eventos.find((e) => e.id === selId) || null;
  const reservasDoEvento = useMemo(() => (ev: string) => reservas.filter((r) => r.eventoId === ev), [reservas]);

  function totais(evId: string) {
    const rs = reservas.filter((r) => r.eventoId === evId && r.status !== "cancelada");
    let recebido = 0, pendente = 0;
    for (const r of rs) { const v = r.pagamento?.valor || 0; if (r.pagamento?.pago) recebido += v; else pendente += v; }
    return { n: rs.length, recebido, pendente };
  }

  if (sel) return <PainelEvento ev={sel} reservas={reservasDoEvento(sel.id)} podeEditar={podeEditar} onVoltar={() => setSelId(null)} onNovaReserva={onNovaReserva} onEditarReserva={onEditarReserva} onEditarEvento={() => setModal({ ev: sel })} totais={totais(sel.id)} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-[13px] text-gray-600 dark:text-gray-300 inline-flex items-center gap-1.5"><PartyPopper size={15} className="text-indigo-500" /> Eventos especiais — reservas pagas lançadas pela equipe.</div>
        <div className="flex-1" />
        {podeEditar && <button onClick={() => setModal({})} className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-sm font-semibold inline-flex items-center gap-1"><Plus size={15} /> Novo evento</button>}
      </div>

      {eventos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center">
          <PartyPopper size={38} className="mx-auto text-gray-300 mb-2" />
          <div className="font-semibold text-gray-700 dark:text-gray-300">Nenhum evento ainda</div>
          <div className="text-sm text-gray-500 mt-1">Crie um evento (ex.: "Jantar harmonizado") pra lançar reservas com pagamento.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {eventos.map((e) => {
            const t = totais(e.id);
            return (
              <button key={e.id} onClick={() => setSelId(e.id)} className="text-left rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
                <div className="font-extrabold text-[15px]">{e.nome}</div>
                <div className="text-[12px] text-gray-500 inline-flex items-center gap-1 mt-0.5"><CalendarDays size={12} /> {periodoTxt(e)}{e.horarioPadrao ? ` · ${e.horarioPadrao}` : ""}</div>
                {e.valorPorPessoa ? <div className="text-[12px] text-gray-500 mt-0.5">{fmtR(e.valorPorPessoa)}/pessoa</div> : null}
                <div className="flex items-center gap-3 mt-2 text-[12px]">
                  <span className="text-gray-600 dark:text-gray-300">{t.n} reserva(s)</span>
                  <span className="text-emerald-600 font-semibold">{fmtR(t.recebido)} recebido</span>
                  {t.pendente > 0 && <span className="text-amber-600">{fmtR(t.pendente)} pendente</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {modal && <EventoModal rid={rid} ev={modal.ev} central={central} cfg={cfg} onClose={() => setModal(null)} onSaved={(id) => { setModal(null); setSelId(id); }} />}
    </div>
  );
}

function PainelEvento({ ev, reservas, podeEditar, onVoltar, onNovaReserva, onEditarReserva, onEditarEvento, totais }: {
  ev: ReservaEvento; reservas: Reserva[]; podeEditar: boolean; onVoltar: () => void;
  onNovaReserva: (ev: ReservaEvento) => void; onEditarReserva: (r: Reserva, ev: ReservaEvento) => void; onEditarEvento: () => void;
  totais: { n: number; recebido: number; pendente: number };
}) {
  const ordenadas = [...reservas].sort((a, b) => (a.data + a.horario).localeCompare(b.data + b.horario));
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onVoltar} className="h-9 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm inline-flex items-center gap-1"><ChevronLeft size={15} /> Eventos</button>
        <div className="min-w-0">
          <div className="font-extrabold text-[15px] truncate">{ev.nome}</div>
          <div className="text-[12px] text-gray-500 inline-flex items-center gap-1"><CalendarDays size={12} /> {periodoTxt(ev)}{ev.horarioPadrao ? ` · ${ev.horarioPadrao}` : ""}{ev.valorPorPessoa ? ` · ${fmtR(ev.valorPorPessoa)}/pessoa` : ""}</div>
        </div>
        <div className="flex-1" />
        {podeEditar && <button onClick={onEditarEvento} className="h-9 w-9 grid place-items-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500" title="Editar evento"><Settings size={16} /></button>}
        <button onClick={() => onNovaReserva(ev)} className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-sm font-semibold inline-flex items-center gap-1"><Plus size={15} /> Nova reserva</button>
      </div>

      <div className="flex items-center gap-3 text-[13px] flex-wrap">
        <span className="px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800">{totais.n} reserva(s)</span>
        <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300 font-semibold">{fmtR(totais.recebido)} recebido</span>
        {totais.pendente > 0 && <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">{fmtR(totais.pendente)} pendente</span>}
        {!ev.pastaDriveId && <span className="text-[12px] text-amber-600 inline-flex items-center gap-1"><FolderOpen size={13} /> sem pasta do Drive — edite o evento</span>}
      </div>

      {/* Mobile: cards */}
      <div className="sm:hidden space-y-2">
        {ordenadas.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-gray-400 text-sm">Nenhuma reserva nesse evento. Toque em "Nova reserva".</div>
        ) : ordenadas.map((r) => (
          <button key={r.id} onClick={() => onEditarReserva(r, ev)} className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
            <div className="flex items-center gap-2">
              <div className="font-semibold text-gray-900 dark:text-gray-100 flex-1 min-w-0 truncate">{r.clienteNomeSnapshot || "—"}{r.status === "cancelada" && <span className="text-[11px] text-rose-500 ml-1">(cancelada)</span>}</div>
              {r.pagamento?.pago ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">Pago</span> : <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">Pendente</span>}
            </div>
            <div className="text-[12px] text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
              <span><CalendarDays size={11} className="inline align-[-1px]" /> {fmtBR(r.data)} · {r.horario}</span>
              <span>· {r.pessoas} pessoa(s)</span>
              {r.pagamento?.valor ? <span>· {fmtR(r.pagamento.valor)}{r.pagamento.forma ? ` (${r.pagamento.forma})` : ""}</span> : null}
            </div>
            {r.pagamento?.comprovanteUrl && <a href={r.pagamento.comprovanteUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[12px] text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1 mt-1"><FileText size={12} /> ver comprovante</a>}
          </button>
        ))}
      </div>

      {/* Desktop: tabela */}
      <div className="hidden sm:block border border-gray-200 dark:border-gray-800 rounded-2xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-400 text-[11px] uppercase tracking-wider">
            <tr><th className="text-left px-4 py-2.5">Cliente</th><th className="text-left px-4 py-2.5">Data/hora</th><th className="text-center px-4 py-2.5">Pessoas</th><th className="text-left px-4 py-2.5">Pagamento</th><th className="text-right px-4 py-2.5">Valor</th><th className="text-center px-4 py-2.5">Comprov.</th><th className="px-2 py-2.5"></th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800/70">
            {ordenadas.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Nenhuma reserva nesse evento. Clique em "Nova reserva".</td></tr>
            ) : ordenadas.map((r) => (
              <tr key={r.id} className="hover:bg-indigo-50/40 dark:hover:bg-gray-800/40">
                <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">{r.clienteNomeSnapshot || "—"}{r.status === "cancelada" && <span className="text-[11px] text-rose-500 ml-1">(cancelada)</span>}</td>
                <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{fmtBR(r.data)} · {r.horario}</td>
                <td className="px-4 py-2.5 text-center">{r.pessoas}</td>
                <td className="px-4 py-2.5">{r.pagamento?.pago ? <span className="text-emerald-600 font-semibold">Pago</span> : <span className="text-amber-600">Pendente</span>}{r.pagamento?.forma ? <span className="text-gray-400 text-[12px]"> · {r.pagamento.forma}</span> : null}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.pagamento?.valor ? fmtR(r.pagamento.valor) : "—"}</td>
                <td className="px-4 py-2.5 text-center">{r.pagamento?.comprovanteUrl ? <a href={r.pagamento.comprovanteUrl} target="_blank" rel="noreferrer" className="text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1 text-[12px]"><FileText size={13} /> ver</a> : <span className="text-gray-300">—</span>}</td>
                <td className="px-2 py-2.5 text-right"><button onClick={() => onEditarReserva(r, ev)} className="text-[12px] text-indigo-600 dark:text-indigo-400 hover:underline">editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EventoModal({ rid, ev, central, cfg, onClose, onSaved }: {
  rid: string; ev?: ReservaEvento; central: boolean | null; cfg: ReservaEventoConfig | null;
  onClose: () => void; onSaved: (id: string) => void;
}) {
  const { pessoa: me } = useAuth();
  const [nome, setNome] = useState(ev?.nome || "");
  const [dataInicio, setDataInicio] = useState(ev?.dataInicio || new Date().toISOString().slice(0, 10));
  const [dataFim, setDataFim] = useState(ev?.dataFim || "");
  const [horario, setHorario] = useState(ev?.horarioPadrao || "20:00");
  const [valorPP, setValorPP] = useState(ev?.valorPorPessoa != null ? String(ev.valorPorPessoa).replace(".", ",") : "");
  const [rootInput, setRootInput] = useState("");
  const [editRoot, setEditRoot] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const precisaRoot = central === true && (!cfg?.driveRootId || editRoot);

  async function salvar() {
    if (!nome.trim()) { setErro("Dê um nome ao evento."); return; }
    if (!dataInicio) { setErro("Informe a data."); return; }
    setSalvando(true); setErro("");
    try {
      let pastaDriveId = ev?.pastaDriveId, pastaDriveNome = ev?.pastaDriveNome;
      if (central === true) {
        let rootId = cfg?.driveRootId;
        if (!rootId || editRoot) {
          const parsed = parseDriveFolderId(rootInput);
          if (!parsed) { setErro("Cole o link ou o ID da pasta-raiz no Drive central."); setSalvando(false); return; }
          await salvarEventoConfig({ id: rid, restaurantId: rid, driveRootId: parsed });
          rootId = parsed;
        }
        const subId = await centralEnsureFolder(rootId, nome.trim());
        pastaDriveId = subId; pastaDriveNome = nome.trim();
      }
      const now = new Date().toISOString();
      const e: ReservaEvento = {
        id: ev?.id || uid(), restaurantId: rid, nome: nome.trim(),
        dataInicio, dataFim: dataFim && dataFim !== dataInicio ? dataFim : undefined,
        horarioPadrao: horario || undefined, valorPorPessoa: parseR(valorPP) || undefined,
        pastaDriveId, pastaDriveNome, ativo: true,
        criadoEm: ev?.criadoEm || now, criadoPor: ev?.criadoPor || (me?.id || ""),
      };
      await salvarEvento(e);
      onSaved(e.id);
    } catch (e) { setErro("Falha ao salvar: " + (e instanceof Error ? e.message : "erro")); setSalvando(false); }
  }
  async function excluir() { if (!ev) return; if (!confirm(`Excluir o evento "${ev.nome}"? As reservas não são apagadas.`)) return; await excluirEvento(ev.id); onClose(); }

  const inp = "w-full h-10 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm";
  const lbl = "text-[11px] font-bold text-gray-500 uppercase tracking-wide";
  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-[480px] max-h-[92vh] overflow-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3"><div className="font-extrabold text-[15px]">{ev ? "Editar evento" : "Novo evento"}</div><div className="flex-1" /><button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-lg bg-gray-100 dark:bg-gray-800"><X size={16} /></button></div>
        <label className={lbl}>Nome</label>
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Jantar harmonizado" autoFocus className={inp + " mt-1 mb-3"} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div><label className={lbl}>Data início</label><input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className={inp + " mt-1"} /></div>
          <div><label className={lbl}>Data fim <span className="text-gray-400 normal-case">(opcional)</span></label><input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className={inp + " mt-1"} /></div>
          <div><label className={lbl}>Horário padrão</label><input type="time" value={horario} onChange={(e) => setHorario(e.target.value)} className={inp + " mt-1"} /></div>
          <div><label className={lbl}>Valor por pessoa</label><input value={valorPP} onChange={(e) => setValorPP(e.target.value)} placeholder="0,00" className={inp + " mt-1"} /></div>
        </div>

        {central === true ? (
          <>
            <label className={lbl}>Pasta-raiz no Drive (conta central)</label>
            {!precisaRoot ? (
              <div className="mt-1 text-[12px] text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5"><Check size={14} /> Configurada — cada evento vira uma subpasta. <button type="button" onClick={() => { setEditRoot(true); setRootInput(""); }} className="text-indigo-600 dark:text-indigo-400 underline">trocar</button></div>
            ) : (
              <>
                <input value={rootInput} onChange={(e) => setRootInput(e.target.value)} placeholder="Cole o link ou ID da pasta-raiz" className={inp + " mt-1"} />
                <div className="text-[11px] text-gray-400 mt-1">Pasta no Drive da conta central (a mesma do Recebimento). Configura uma vez; cada evento cria uma subpasta. Sem popup.</div>
              </>
            )}
          </>
        ) : central === false ? (
          <div className="text-[12px] text-amber-600">Conta central do Drive não configurada — o evento é criado sem pasta (anexo de comprovante indisponível).</div>
        ) : <div className="text-[12px] text-gray-400">Verificando Drive…</div>}

        {erro && <div className="text-[12px] text-rose-600 mt-2">{erro}</div>}
        <div className="flex gap-2 mt-4">
          {ev && <button onClick={() => void excluir()} className="px-3 py-2 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 text-sm font-semibold inline-flex items-center gap-1"><Trash2 size={14} /> Excluir</button>}
          <div className="flex-1" />
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold">Cancelar</button>
          <button onClick={() => void salvar()} disabled={salvando || !nome.trim() || central === null} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-50">{salvando ? "Salvando…" : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}
