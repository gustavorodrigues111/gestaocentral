// Criar / editar uma Ação (Plano de Ação). Avulsa por padrão; ações vindas de
// ocorrência/ideia/reunião chegam com `origem` preenchida (fases seguintes).
// Guarda um log imutável de tratativas (criação, andamento, mudança de status).
import { useMemo, useState } from "react";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { Acao, AcaoLog, AcaoPrioridade, PlanoAcaoStatus, Pessoa } from "../../core/types";
import { ACAO_STATUS_LABEL } from "../../core/types";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";

const uid = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const fmtDT = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };
const PRIOS: [AcaoPrioridade, string, string][] = [
  ["baixa", "Baixa", "text-gray-500"],
  ["media", "Média", "text-amber-600 dark:text-amber-400"],
  ["alta", "Alta", "text-rose-600 dark:text-rose-400"],
];
const ORIGEM_LABEL: Record<string, string> = { ocorrencia: "🚨 de ocorrência", ideia: "💡 de ideia", reuniao: "🗣️ de reunião", avulsa: "✍️ avulsa" };

export function AcaoModal({ acao, rid, pessoas, meId, meNome, onClose }: {
  acao: Acao | null; rid: string; pessoas: Pessoa[]; meId?: string; meNome?: string; onClose: () => void;
}) {
  const novo = !acao;
  const [titulo, setTitulo] = useState(acao?.titulo || "");
  const [descricao, setDescricao] = useState(acao?.descricao || "");
  const [responsavelId, setResponsavelId] = useState(acao?.responsavelId || "");
  const [prazo, setPrazo] = useState(acao?.prazo || "");
  const [prioridade, setPrioridade] = useState<AcaoPrioridade>(acao?.prioridade || "media");
  const [status, setStatus] = useState<PlanoAcaoStatus>(acao?.status || "aberta");
  const [andamento, setAndamento] = useState("");
  const [salvando, setSalvando] = useState(false);
  const pessoasOrd = useMemo(() => [...pessoas].sort((a, b) => a.nome.localeCompare(b.nome)), [pessoas]);

  async function salvar() {
    if (!titulo.trim()) { alert("Dê um título à ação."); return; }
    setSalvando(true);
    const now = new Date().toISOString();
    const respNome = pessoasOrd.find(p => p.id === responsavelId)?.nome || "";
    try {
      if (novo) {
        const id = uid("acao");
        const log: AcaoLog[] = [{ id: uid("lg"), em: now, autorId: meId, autorNome: meNome, tipo: "criada", texto: "Ação criada" }];
        const a: Acao = {
          id, restaurantId: rid, titulo: titulo.trim(), descricao: descricao.trim(),
          responsavelId: responsavelId || null, responsavelNome: respNome,
          prazo: prazo || null, status: "aberta", prioridade, origem: { tipo: "avulsa" }, log,
          criadoEm: now, criadoPor: meId, criadoPorNome: meNome, atualizadoEm: now, ativo: true,
        };
        await setDoc(doc(db, "acoes", id), sanitizeForFirestore(a));
      } else {
        const log = [...(acao!.log || [])];
        if (andamento.trim()) log.push({ id: uid("lg"), em: now, autorId: meId, autorNome: meNome, tipo: "andamento", texto: andamento.trim() });
        if (status !== acao!.status) log.push({ id: uid("lg"), em: now, autorId: meId, autorNome: meNome, tipo: "status", texto: `${ACAO_STATUS_LABEL[acao!.status]} → ${ACAO_STATUS_LABEL[status]}` });
        await updateDoc(doc(db, "acoes", acao!.id), sanitizeForFirestore({
          titulo: titulo.trim(), descricao: descricao.trim(),
          responsavelId: responsavelId || null, responsavelNome: respNome,
          prazo: prazo || null, prioridade, status, log, atualizadoEm: now,
          concluidoEm: status === "concluida" ? (acao!.concluidoEm || now) : null,
          concluidoPor: status === "concluida" ? (acao!.concluidoPor || meId || null) : null,
        }));
      }
      onClose();
    } catch (e) { alert("Erro ao salvar: " + (e instanceof Error ? e.message : String(e))); setSalvando(false); }
  }

  return (
    <Modal title={novo ? "🎯 Nova ação" : "🎯 Ação"} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        {!novo && acao && (
          <div className="flex items-center gap-2 flex-wrap text-[11px] text-gray-500">
            <span className="px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800">{ORIGEM_LABEL[acao.origem?.tipo || "avulsa"]}</span>
            {acao.criadoPorNome && <span>criada por {acao.criadoPorNome}</span>}
            {acao.criadoEm && <span>· {fmtDT(acao.criadoEm)}</span>}
          </div>
        )}
        <Input label="Título *" value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="ex: Trocar fornecedor de embalagem" />
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Descrição</span>
          <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={3} placeholder="Detalhe o que precisa ser feito…" className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100 resize-y" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Responsável</span>
            <select value={responsavelId} onChange={e => setResponsavelId(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100">
              <option value="">— sem responsável —</option>
              {responsavelId && !pessoasOrd.some(p => p.id === responsavelId) && <option value={responsavelId}>{acao?.responsavelNome || "?"}</option>}
              {pessoasOrd.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Prazo</span>
            <input type="date" value={prazo} onChange={e => setPrazo(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" />
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Prioridade:</span>
          <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
            {PRIOS.map(([p, l, cor]) => (
              <button key={p} type="button" onClick={() => setPrioridade(p)} className={`px-3 py-1.5 text-xs font-medium rounded-md ${prioridade === p ? `bg-white dark:bg-gray-900 shadow-sm ${cor}` : "text-gray-500"}`}>{l}</button>
            ))}
          </div>
        </div>

        {!novo && (
          <>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Status:</span>
              <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5 flex-wrap">
                {(["aberta", "em_andamento", "concluida", "cancelada"] as PlanoAcaoStatus[]).map(s => (
                  <button key={s} type="button" onClick={() => setStatus(s)} className={`px-3 py-1.5 text-xs font-medium rounded-md ${status === s ? "bg-white dark:bg-gray-900 text-indigo-700 dark:text-indigo-300 shadow-sm" : "text-gray-500"}`}>{ACAO_STATUS_LABEL[s]}</button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Registrar andamento (opcional)</span>
              <textarea value={andamento} onChange={e => setAndamento(e.target.value)} rows={2} placeholder="O que evoluiu? (vai pro log)" className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100 resize-y" />
            </div>
            {(acao?.log?.length || 0) > 0 && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/30 p-2 max-h-40 overflow-y-auto space-y-1">
                <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Histórico</div>
                {[...(acao!.log || [])].reverse().map(l => (
                  <div key={l.id} className="text-[11px] text-gray-600 dark:text-gray-300 flex gap-2">
                    <span className="text-gray-400 tabular-nums shrink-0">{fmtDT(l.em)}</span>
                    <span className="flex-1">{l.texto}{l.autorNome ? <span className="text-gray-400"> — {l.autorNome}</span> : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-1 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando…" : novo ? "Criar ação" : "Salvar"}</Button>
        </div>
      </div>
    </Modal>
  );
}
