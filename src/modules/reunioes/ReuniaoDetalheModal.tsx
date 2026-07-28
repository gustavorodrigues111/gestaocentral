import { useState } from "react";
import { doc, getDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { logAudit } from "../../core/audit/versionedChange";
import { REUNIAO_TIPO_LABEL } from "../../core/types";
import type { PautaItem, Reuniao } from "../../core/types";
import { PuxarIdeiaOcorrenciaModal } from "../_shared/PuxarIdeiaOcorrenciaModal";
import { VirarAcaoModal, type ItemCriado } from "../planoDeAcao/VirarAcaoModal";

// Avatar do participante: iniciais + cor estável por nome.
const AV_CORES = ["#4f46e5", "#0f7a43", "#b45309", "#0284c7", "#7c3aed", "#db2777", "#0d9488", "#c026d3"];
function avatarCor(s: string): string {
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AV_CORES[h % AV_CORES.length];
}
function iniciais(nome: string): string {
  const p = (nome || "").trim().split(/\s+/);
  return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase() || "?";
}

type Props = {
  reuniao: Reuniao;
  restaurantId: string;
  podeConfig: boolean;
  onClose: () => void;
  onEditar?: () => void;   // abre o editor completo (título, data, participantes)
};

// A reunião gira 100% em torno da PAUTA. Cada tópico é um assunto: nasce livre
// ou puxado de uma ideia/ocorrência aberta; durante a reunião você o resolve
// (com observação opcional — vira a "ata" do tópico) ou o transforma em tarefa.
// Não há aba de Ata nem lista de tarefas separada — a pauta é o registro.
export function ReuniaoDetalheModal({ reuniao, restaurantId, podeConfig, onClose, onEditar }: Props) {
  const { pessoa: me } = useAuth();
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [novoTopico, setNovoTopico] = useState("");
  const [puxarAberto, setPuxarAberto] = useState(false);
  const [virarAcaoPauta, setVirarAcaoPauta] = useState<PautaItem | null>(null);
  const [resolvendo, setResolvendo] = useState<string | null>(null);
  const [obsResolver, setObsResolver] = useState("");

  async function patchReuniao(patch: Partial<Reuniao>) {
    setSaving(true);
    setErr("");
    try {
      await updateDoc(doc(db, "reunioes", reuniao.id), sanitizeForFirestore({ ...patch, atualizadoEm: new Date().toISOString() }));
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  // ── Pauta ────────────────────────────────────────────────────────────────
  async function adicionarTopico() {
    const t = novoTopico.trim();
    if (!t) return;
    const novo: PautaItem = { id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, titulo: t, ordem: (reuniao.pauta?.length || 0) + 1, discutido: false };
    await patchReuniao({ pauta: [...(reuniao.pauta || []), novo] });
    setNovoTopico("");
  }

  // Puxa uma ideia/ocorrência ABERTA pra pauta + marca a origem como em discussão.
  async function puxarParaPauta(item: { tipo: "ideia" | "ocorrencia"; id: string; titulo: string; descricao?: string }) {
    const novo: PautaItem = {
      id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      titulo: item.titulo, descricao: item.descricao, ordem: (reuniao.pauta?.length || 0) + 1, discutido: false,
      ideiaId: item.tipo === "ideia" ? item.id : null,
      ocorrenciaId: item.tipo === "ocorrencia" ? item.id : null,
    };
    await patchReuniao({ pauta: [...(reuniao.pauta || []), novo] });
    try {
      const col = item.tipo === "ideia" ? "ideias" : "ocorrencias";
      await updateDoc(doc(db, col, item.id), {
        status: item.tipo === "ideia" ? "em_discussao" : "em_apuracao",
        reuniaoId: reuniao.id, atualizadoEm: new Date().toISOString(), atualizadaEm: new Date().toISOString(),
      });
    } catch (e) { console.error("[reuniao] marcar origem em discussão:", e); }
    setPuxarAberto(false);
  }

  function abrirResolver(t: PautaItem) { setResolvendo(t.id); setObsResolver(t.notas || ""); }
  async function resolverTopico(t: PautaItem) {
    const obs = obsResolver.trim();
    await patchReuniao({ pauta: (reuniao.pauta || []).map(p => p.id === t.id ? { ...p, discutido: true, notas: obs || p.notas || undefined } : p) });
    setResolvendo(null); setObsResolver("");
  }
  async function reabrirTopico(id: string) {
    await patchReuniao({ pauta: (reuniao.pauta || []).map(p => p.id === id ? { ...p, discutido: false } : p) });
  }

  // Depois de virar tarefa: marca o item + registra no log da ideia/ocorrência de origem.
  async function aposVirarAcaoPauta(t: PautaItem, acao: ItemCriado) {
    await patchReuniao({ pauta: (reuniao.pauta || []).map(x => x.id === t.id ? { ...x, acaoIdGerada: acao.id, discutido: true } : x) });
    const now = new Date().toISOString();
    const lg = { id: `lg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, em: now, autorId: me?.id, autorNome: me?.nome, tipo: "comentario" as const, texto: `Virou tarefa na reunião "${reuniao.titulo}": "${acao.titulo}"${acao.responsavelNome ? ` — resp. ${acao.responsavelNome}` : ""}` };
    const alvo = t.ocorrenciaId ? { col: "ocorrencias", id: t.ocorrenciaId, ts: "atualizadaEm" } : t.ideiaId ? { col: "ideias", id: t.ideiaId, ts: "atualizadoEm" } : null;
    if (alvo) {
      try {
        const ref = doc(db, alvo.col, alvo.id);
        const snap = await getDoc(ref);
        const prev = snap.exists() ? ((snap.data() as { log?: unknown[] }).log || []) : [];
        await updateDoc(ref, sanitizeForFirestore({ log: [...prev, lg], acaoIdGerada: acao.id, [alvo.ts]: now }));
      } catch { /* origem pode ter sumido — segue */ }
    }
  }

  // ── Ciclo de vida — só Realizada / Cancelada ──────────────────────────────
  async function marcarRealizada() {
    if (!confirm("Marcar essa reunião como realizada?")) return;
    if (!me) return;
    setSaving(true); setErr("");
    try {
      await updateDoc(doc(db, "reunioes", reuniao.id), sanitizeForFirestore({ status: "realizada", atualizadoEm: new Date().toISOString() }));
      const idsLinkadas = (reuniao.pauta || []).map(p => p.ideiaId).filter((x): x is string => !!x);
      for (const ideiaId of idsLinkadas) {
        try { await updateDoc(doc(db, "ideias", ideiaId), { status: "discutida", atualizadoEm: new Date().toISOString() }); } catch (e) { console.error(e); }
      }
      await logAudit({ entityType: "restaurant", entityId: restaurantId, restaurantId, acao: "alterado", diff: { reuniaoStatus: { antes: reuniao.status, depois: "realizada" } }, motivo: `Reunião realizada: ${reuniao.titulo}`, registradoPor: me.id });
    } catch (e) { console.error(e); setErr(e instanceof Error ? e.message : "Erro"); } finally { setSaving(false); }
  }

  async function cancelarReuniao() {
    if (!confirm("Cancelar essa reunião? Ideias linkadas voltam pra 'Aberta'.")) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "reunioes", reuniao.id), { status: "cancelada", atualizadoEm: new Date().toISOString() });
      const idsLinkadas = (reuniao.pauta || []).map(p => p.ideiaId).filter((x): x is string => !!x);
      for (const ideiaId of idsLinkadas) {
        try { await updateDoc(doc(db, "ideias", ideiaId), { status: "aberta", reuniaoId: null, atualizadoEm: new Date().toISOString() }); } catch (e) { console.error(e); }
      }
    } finally { setSaving(false); }
  }

  async function reabrirComoPlanejada() {
    if (!confirm("Voltar essa reunião pra 'Planejada'?")) return;
    await patchReuniao({ status: "planejada" });
  }

  async function excluirDefinitivo() {
    if (!confirm(`Excluir DEFINITIVAMENTE a reunião "${reuniao.titulo}"?\n\nNão pode ser desfeito.`)) return;
    setSaving(true);
    try { await deleteDoc(doc(db, "reunioes", reuniao.id)); onClose(); }
    catch (e) { alert("Erro ao excluir: " + (e instanceof Error ? e.message : "?")); setSaving(false); }
  }

  const isPlanejada = reuniao.status === "planejada";
  const isRealizada = reuniao.status === "realizada";
  const isCancelada = reuniao.status === "cancelada";
  const pauta = reuniao.pauta || [];
  const parts = reuniao.participantes || [];
  const total = pauta.length;
  const feitos = pauta.filter((p) => p.discutido).length;
  const statusPill = isRealizada
    ? { txt: "Realizada", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" }
    : isCancelada
    ? { txt: "Cancelada", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" }
    : { txt: "Planejada", cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4" onClick={onClose}>
        <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
          {/* ── Cabeçalho ── */}
          <div className="px-5 pt-4 pb-3.5 border-b border-gray-200 dark:border-gray-800">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${statusPill.cls}`}>{statusPill.txt}</span>
                  <span className="text-[12px] text-gray-400 dark:text-gray-500">👥 {REUNIAO_TIPO_LABEL[reuniao.tipo]}</span>
                </div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 leading-snug break-words">{reuniao.titulo}</h2>
                <div className="flex items-center gap-2.5 flex-wrap mt-1.5 text-[12.5px] text-gray-500 dark:text-gray-400">
                  <span>📅 {new Date(reuniao.data + "T12:00:00").toLocaleDateString("pt-BR")}</span>
                  {reuniao.horario && <><span className="text-gray-300 dark:text-gray-700">·</span><span>⏰ {reuniao.horario}</span></>}
                  {reuniao.local && <><span className="text-gray-300 dark:text-gray-700">·</span><span>📍 {reuniao.local}</span></>}
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-none">
                {podeConfig && isPlanejada && (
                  <button onClick={marcarRealizada} disabled={saving} className="px-2.5 py-1.5 rounded-lg text-[12.5px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60 whitespace-nowrap">✅ Marcar realizada</button>
                )}
                {podeConfig && (isRealizada || isCancelada) && (
                  <button onClick={reabrirComoPlanejada} disabled={saving} className="px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 whitespace-nowrap">↻ Voltar pra planejada</button>
                )}
                {podeConfig && onEditar && (
                  <button onClick={onEditar} title="Editar reunião (título, data, participantes)" className="w-8 h-8 grid place-items-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800">✎</button>
                )}
                <button onClick={onClose} title="Fechar" className="w-8 h-8 grid place-items-center rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 text-lg leading-none">×</button>
              </div>
            </div>

            {/* ações secundárias/destrutivas */}
            {podeConfig && (isPlanejada || (isCancelada && me?.isMaster)) && (
              <div className="flex gap-4 mt-2">
                {isPlanejada && <button onClick={cancelarReuniao} disabled={saving} className="text-[12px] text-gray-400 hover:text-rose-600 dark:hover:text-rose-400">🚫 Cancelar reunião</button>}
                {isCancelada && me?.isMaster && <button onClick={excluirDefinitivo} disabled={saving} className="text-[12px] text-rose-500 hover:text-rose-700 dark:hover:text-rose-400">🗑 Excluir definitivo</button>}
              </div>
            )}

            {/* participantes */}
            <div className="flex items-center gap-2.5 flex-wrap mt-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 shrink-0">Participantes</span>
              {parts.length === 0 ? (
                <span className="text-[12px] text-gray-400 italic">ninguém adicionado</span>
              ) : (
                <>
                  <div className="flex">
                    {parts.slice(0, 6).map((p, i) => (
                      <span key={i} title={p.nome} style={{ background: avatarCor(p.nome) }} className="-ml-1.5 first:ml-0 w-6 h-6 rounded-full border-2 border-white dark:border-gray-900 grid place-items-center text-[10px] font-bold text-white">{iniciais(p.nome)}</span>
                    ))}
                    {parts.length > 6 && <span className="-ml-1.5 w-6 h-6 rounded-full border-2 border-white dark:border-gray-900 grid place-items-center text-[10px] font-bold bg-gray-300 dark:bg-gray-700 text-gray-700 dark:text-gray-200">+{parts.length - 6}</span>}
                  </div>
                  <span className="text-[12px] text-gray-500 dark:text-gray-400 min-w-0 truncate">{parts.map((p) => p.nome).join(", ")}</span>
                </>
              )}
            </div>
          </div>

          {/* ── Corpo: pauta ── */}
          <div className="px-5 py-4 overflow-y-auto">
            <div className="flex items-center gap-3 mb-1">
              <span className="text-[12px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 shrink-0">Pauta</span>
              {total > 0 && (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden flex-1 max-w-[220px]"><div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${(feitos / total) * 100}%` }} /></div>
                  <span className="text-[11px] text-gray-400 tabular-nums shrink-0">{feitos} de {total} resolvidos</span>
                </div>
              )}
            </div>

            {pauta.length === 0 && <div className="text-sm text-gray-500 italic py-3">Sem tópicos ainda. Adicione abaixo ou puxe de ideias/ocorrências abertas.</div>}

            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {pauta.map((t) => {
                const virou = !!(t.acaoIdGerada || t.tarefaIdGerada);
                return (
                  <div key={t.id} className="flex gap-3 py-3">
                    <button type="button" disabled={!podeConfig} title={t.discutido ? "Reabrir" : "Marcar resolvida"}
                      onClick={() => { if (!podeConfig) return; if (t.discutido) reabrirTopico(t.id); else abrirResolver(t); }}
                      className={`shrink-0 w-5 h-5 mt-0.5 rounded-full border-2 grid place-items-center text-[12px] transition-colors ${t.discutido ? "bg-emerald-500 border-emerald-500 text-white" : "border-gray-300 dark:border-gray-600 text-transparent hover:border-emerald-500"} ${podeConfig ? "cursor-pointer" : "cursor-default"}`}>✓</button>
                    <div className="flex-1 min-w-0">
                      <div className={`text-[14.5px] font-medium ${t.discutido ? "line-through text-gray-400 dark:text-gray-500" : "text-gray-900 dark:text-gray-100"}`}>{t.titulo}</div>
                      {t.descricao && !t.discutido && <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.descricao}</div>}
                      <div className="flex items-center gap-2 mt-1 flex-wrap empty:hidden">
                        {t.ideiaId && <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">💡 do Banco de Ideias</span>}
                        {t.ocorrenciaId && <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300">🚨 de Ocorrências</span>}
                        {virou && <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">🎯 Virou tarefa</span>}
                      </div>
                      {t.discutido && t.notas && <div className="mt-1.5 text-[12.5px] text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-2 border-l-2 border-emerald-300 dark:border-emerald-700 whitespace-pre-wrap">{t.notas}</div>}
                      {podeConfig && resolvendo === t.id && (
                        <div className="mt-2 space-y-2">
                          <textarea value={obsResolver} onChange={(e) => setObsResolver(e.target.value)} rows={2} placeholder="Observação (opcional) — o que foi tratado…" className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 resize-y" autoFocus />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => void resolverTopico(t)} disabled={saving}>Concluir tópico</Button>
                            <Button variant="secondary" size="sm" onClick={() => { setResolvendo(null); setObsResolver(""); }}>Cancelar</Button>
                          </div>
                        </div>
                      )}
                    </div>
                    {podeConfig && resolvendo !== t.id && (
                      <div className="shrink-0">
                        {!t.discutido && !virou && (
                          <button type="button" onClick={() => setVirarAcaoPauta(t)} className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 whitespace-nowrap">🎯 Virar tarefa</button>
                        )}
                        {t.discutido && (
                          <button type="button" onClick={() => reabrirTopico(t.id)} className="text-[11.5px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 whitespace-nowrap">↺ reabrir</button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {podeConfig && (
              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-800 space-y-2">
                <div className="flex gap-2">
                  <input value={novoTopico} onChange={(e) => setNovoTopico(e.target.value)} placeholder="+ Adicionar tópico de pauta" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionarTopico(); } }}
                    className="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500" />
                  <Button onClick={adicionarTopico} disabled={!novoTopico.trim()} className="shrink-0">Adicionar</Button>
                </div>
                <Button variant="secondary" onClick={() => setPuxarAberto(true)} className="w-full">📋 Puxar de ideia / ocorrência aberta</Button>
              </div>
            )}

            {err && <div className="text-sm text-rose-600 mt-3">{err}</div>}
          </div>
        </div>
      </div>

      {puxarAberto && (
        <PuxarIdeiaOcorrenciaModal
          restaurantId={restaurantId}
          pessoaIdAtual={me?.id}
          titulo="Puxar pra pauta desta reunião"
          onClose={() => setPuxarAberto(false)}
          onEscolher={puxarParaPauta}
        />
      )}
      {virarAcaoPauta && (
        <VirarAcaoModal
          rid={restaurantId} meId={me?.id} meNome={me?.nome}
          origem={{ tipo: "reuniao", refId: reuniao.id, reuniaoId: reuniao.id, label: virarAcaoPauta.titulo }}
          tituloInicial={virarAcaoPauta.titulo} descricaoInicial={virarAcaoPauta.descricao}
          destino="tarefa"
          onClose={() => setVirarAcaoPauta(null)}
          onCriada={(acao) => aposVirarAcaoPauta(virarAcaoPauta, acao)}
        />
      )}
    </>
  );
}
