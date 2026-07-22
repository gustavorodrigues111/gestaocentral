// Transforma uma origem (ocorrência, ideia ou item de reunião) numa Ação do
// Plano de Ação. Reutilizável: recebe a origem + textos iniciais e devolve a
// ação criada em onCriada (o chamador registra a tratativa de volta na origem).
import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { Acao, AcaoLog, AcaoOrigemTipo, AcaoPrioridade, Pessoa, TarefaOrigem, TarefaPrioridade } from "../../core/types";
import { criarTarefaOperacional } from "../tarefas/repository";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";

// O que o modal devolve ao chamador (a origem registra a tratativa de volta).
export type ItemCriado = { id: string; titulo: string; responsavelNome?: string };

const uid = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const ORIGEM_TXT: Record<AcaoOrigemTipo, string> = { ocorrencia: "ocorrência", ideia: "ideia", reuniao: "reunião", avulsa: "ação avulsa", avaliacao_sanitaria: "avaliação sanitária" };
const PRIOS: [AcaoPrioridade, string, string][] = [["baixa", "Baixa", "text-gray-500"], ["media", "Média", "text-amber-600 dark:text-amber-400"], ["alta", "Alta", "text-rose-600 dark:text-rose-400"]];

export function VirarAcaoModal({ rid, meId, meNome, origem, tituloInicial, descricaoInicial, destino = "acao", onClose, onCriada }: {
  rid: string; meId?: string; meNome?: string;
  origem: { tipo: AcaoOrigemTipo; refId?: string | null; reuniaoId?: string | null; label?: string };
  tituloInicial?: string; descricaoInicial?: string;
  destino?: "acao" | "tarefa";
  onClose: () => void; onCriada: (item: ItemCriado) => void | Promise<void>;
}) {
  const rotulo = destino === "tarefa" ? "tarefa" : "ação";
  const [titulo, setTitulo] = useState(tituloInicial || "");
  const [descricao, setDescricao] = useState(descricaoInicial || "");
  const [responsavelId, setResponsavelId] = useState("");
  const [prazo, setPrazo] = useState("");
  const [prioridade, setPrioridade] = useState<AcaoPrioridade>("media");
  const [salvando, setSalvando] = useState(false);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  useEffect(() => {
    if (!rid) return;
    const u = onSnapshot(query(collection(db, "pessoas"), where("restaurantIds", "array-contains", rid)), snap => setPessoas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Pessoa).filter(p => p.ativa !== false)));
    return () => u();
  }, [rid]);
  const pessoasOrd = useMemo(() => [...pessoas].sort((a, b) => a.nome.localeCompare(b.nome)), [pessoas]);

  async function criar() {
    if (!titulo.trim()) { alert(`Dê um título à ${rotulo}.`); return; }
    setSalvando(true);
    const now = new Date().toISOString();
    const respNome = pessoasOrd.find(p => p.id === responsavelId)?.nome || "";
    try {
      if (destino === "tarefa") {
        const origemT: TarefaOrigem = origem.tipo === "avulsa" ? "manual" : origem.tipo;
        const prioT: TarefaPrioridade = prioridade === "media" ? "normal" : prioridade;
        const id = await criarTarefaOperacional({
          rid, titulo: titulo.trim(), descricao: descricao.trim(),
          responsavelId: responsavelId || null, responsavelNome: respNome,
          prazo: prazo || null, prioridade: prioT, origem: origemT,
          origemRefId: origem.refId || undefined, origemRefLabel: origem.label,
          criadoPor: meId, criadoPorNome: meNome,
        });
        await onCriada({ id, titulo: titulo.trim(), responsavelNome: respNome });
        onClose();
        return;
      }
      const id = uid("acao");
      const log: AcaoLog[] = [{ id: uid("lg"), em: now, autorId: meId, autorNome: meNome, tipo: "criada", texto: `Ação criada a partir de ${ORIGEM_TXT[origem.tipo]}${origem.label ? `: "${origem.label}"` : ""}` }];
      const acao: Acao = {
        id, restaurantId: rid, titulo: titulo.trim(), descricao: descricao.trim(),
        responsavelId: responsavelId || null, responsavelNome: respNome,
        prazo: prazo || null, status: "aberta", prioridade,
        origem: { tipo: origem.tipo, refId: origem.refId || null, reuniaoId: origem.reuniaoId || null, label: origem.label },
        log, criadoEm: now, criadoPor: meId, criadoPorNome: meNome, atualizadoEm: now, ativo: true,
      };
      await setDoc(doc(db, "acoes", id), sanitizeForFirestore(acao));
      await onCriada(acao);
      onClose();
    } catch (e) { alert(`Erro ao criar ${rotulo}: ` + (e instanceof Error ? e.message : String(e))); setSalvando(false); }
  }

  return (
    <Modal title={`🎯 Virar ${rotulo} · de ${ORIGEM_TXT[origem.tipo]}`} onClose={onClose} maxWidth="max-w-xl">
      <div className="space-y-3">
        <Input label={`Título da ${rotulo} *`} value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="O que precisa ser feito" />
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Descrição</span>
          <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={3} className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100 resize-y" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Responsável</span>
            <select value={responsavelId} onChange={e => setResponsavelId(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100">
              <option value="">— sem responsável —</option>
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
        <p className="text-[11px] text-gray-400">{destino === "tarefa" ? "A tarefa vai pra lista da pessoa (lente enxuta) e a origem fica registrada." : "A ação vai pro Plano de Ação e a origem guarda no log que virou ação."}</p>
        <div className="flex justify-end gap-2 pt-1 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void criar()} disabled={salvando}>{salvando ? "Criando…" : `Criar ${rotulo}`}</Button>
        </div>
      </div>
    </Modal>
  );
}
