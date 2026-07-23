import { useState } from "react";
import { doc, getDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { logAudit } from "../../core/audit/versionedChange";
import { REUNIAO_TIPO_LABEL } from "../../core/types";
import type { PautaItem, Reuniao } from "../../core/types";
import { PuxarIdeiaOcorrenciaModal } from "../_shared/PuxarIdeiaOcorrenciaModal";
import { VirarAcaoModal, type ItemCriado } from "../planoDeAcao/VirarAcaoModal";

type Props = {
  reuniao: Reuniao;
  restaurantId: string;
  podeConfig: boolean;
  onClose: () => void;
};

// A reunião gira 100% em torno da PAUTA. Cada tópico é um assunto: nasce livre
// ou puxado de uma ideia/ocorrência aberta; durante a reunião você o resolve
// (com observação opcional — vira a "ata" do tópico) ou o transforma em tarefa.
// Não há aba de Ata nem lista de tarefas separada — a pauta é o registro.
export function ReuniaoDetalheModal({ reuniao, restaurantId, podeConfig, onClose }: Props) {
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

  return (
    <Modal title={`${reuniao.titulo} — ${REUNIAO_TIPO_LABEL[reuniao.tipo]}`} onClose={onClose} maxWidth="max-w-3xl">
      <div className="space-y-3">
        {/* Cabeçalho */}
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 text-sm">
          <div className="flex items-center gap-3 flex-wrap">
            <span>📅 {new Date(reuniao.data + "T12:00:00").toLocaleDateString("pt-BR")}</span>
            {reuniao.horario && <span>⏰ {reuniao.horario}</span>}
            {reuniao.local && <span>📍 {reuniao.local}</span>}
            <span>·</span>
            <span>👥 {reuniao.participantes?.length || 0} participantes</span>
          </div>
          {podeConfig && (
            <div className="flex gap-2 mt-2.5 flex-wrap">
              {isPlanejada && (
                <>
                  <Button size="sm" onClick={marcarRealizada} disabled={saving} className="!bg-emerald-600 hover:!bg-emerald-700 !border-emerald-600 !text-white">✅ Realizada</Button>
                  <Button variant="danger" size="sm" onClick={cancelarReuniao} disabled={saving}>🚫 Cancelada</Button>
                </>
              )}
              {(isRealizada || isCancelada) && (
                <Button variant="secondary" size="sm" onClick={reabrirComoPlanejada} disabled={saving}>↻ Voltar pra planejada</Button>
              )}
              {isCancelada && me?.isMaster && (
                <Button variant="danger" size="sm" onClick={excluirDefinitivo} disabled={saving}>🗑 Excluir definitivo</Button>
              )}
            </div>
          )}
        </div>

        {/* Pauta — única lista da reunião */}
        <div className="space-y-2">
          {pauta.length === 0 && (
            <div className="text-sm text-gray-500 italic">Sem tópicos ainda. Adicione abaixo ou puxe de ideias/ocorrências abertas.</div>
          )}
          {pauta.map((t) => {
            const virou = !!(t.acaoIdGerada || t.tarefaIdGerada);
            return (
              <div key={t.id} className={`border rounded-lg p-3 ${t.discutido ? "bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-800" : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800"}`}>
                <div className="flex items-start gap-2">
                  {t.discutido && <span className="text-emerald-500 mt-0.5 shrink-0">✔</span>}
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium ${t.discutido ? "line-through text-gray-400" : "text-gray-900 dark:text-gray-100"}`}>
                      {t.ideiaId ? "💡 " : t.ocorrenciaId ? "🚨 " : ""}{t.titulo}
                    </div>
                    {t.descricao && !t.discutido && <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.descricao}</div>}
                    {t.notas && <div className="text-[13px] text-gray-600 dark:text-gray-300 mt-1 whitespace-pre-wrap">{t.notas}</div>}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {t.ideiaId && <span className="text-[10px] text-indigo-600 dark:text-indigo-400">💡 do Banco de Ideias</span>}
                      {t.ocorrenciaId && <span className="text-[10px] text-rose-600 dark:text-rose-400">🚨 de Ocorrências</span>}
                      {virou && <span className="text-[10px] text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 rounded">🎯 Virou tarefa</span>}
                    </div>
                  </div>
                  {podeConfig && t.discutido && (
                    <button type="button" onClick={() => reabrirTopico(t.id)} title="Reabrir" className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0 whitespace-nowrap">↺ reabrir</button>
                  )}
                </div>

                {podeConfig && !t.discutido && resolvendo !== t.id && (
                  <div className="flex gap-1.5 flex-wrap mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                    <Button size="sm" onClick={() => abrirResolver(t)} className="!bg-emerald-600 hover:!bg-emerald-700 !border-emerald-600 !text-white">✔ Resolvida</Button>
                    {!virou && <Button variant="secondary" size="sm" onClick={() => setVirarAcaoPauta(t)}>🎯 Virar tarefa</Button>}
                  </div>
                )}
                {podeConfig && resolvendo === t.id && (
                  <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 space-y-2">
                    <textarea value={obsResolver} onChange={(e) => setObsResolver(e.target.value)} rows={2} placeholder="Observação (opcional) — o que foi tratado…" className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 resize-y" autoFocus />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => void resolverTopico(t)} disabled={saving}>Concluir tópico</Button>
                      <Button variant="secondary" size="sm" onClick={() => { setResolvendo(null); setObsResolver(""); }}>Cancelar</Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {podeConfig && (
            <div className="space-y-2 pt-2 border-t border-gray-200 dark:border-gray-800">
              <div className="flex gap-2">
                <Input value={novoTopico} onChange={(e) => setNovoTopico(e.target.value)} placeholder="+ Novo tópico de pauta" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionarTopico(); } }} className="flex-1 min-w-0" />
                <Button onClick={adicionarTopico} disabled={!novoTopico.trim()} className="shrink-0">Adicionar</Button>
              </div>
              <Button variant="secondary" onClick={() => setPuxarAberto(true)} className="w-full">📋 Puxar de ideia / ocorrência aberta</Button>
            </div>
          )}
        </div>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
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
    </Modal>
  );
}
