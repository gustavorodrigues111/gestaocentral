// Aba PLANO DE AÇÃO do módulo Segurança Sanitária.
// Agrega as inconformidades de TODAS as avaliações do restaurante em duas
// colunas: Abertas (sem ação ou ação não concluída) e Resolvidas (ação
// concluída/cancelada). As abertas sem ação podem ser transformadas em ação
// (atribuída aos líderes da área) direto daqui.
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { Target, CircleCheckBig } from "lucide-react";
import { db } from "../../core/firebase/config";
import type { Tarefa, SegurancaAvaliacao, SegurancaModelo, SegLider } from "../../core/types";
import { segResParse, segLideresDe, segAreaCor, TAREFA_STATUS_LABEL } from "../../core/types";
import { ouvirAvaliacoes, ouvirModelos, criarAcaoSanitaria } from "./repository";

const dmy = (ymd?: string | null) => (ymd || "").split("-").reverse().join("/");

type Item = {
  avId: string;
  av: SegurancaAvaliacao;
  key: string;
  area?: string;
  texto: string;
  observacao?: string;
  tarefa?: Tarefa;
};

export function PlanoAcaoTab({ rid, autor, podeGerar }: {
  rid: string;
  autor: { id: string; nome: string };
  podeGerar: boolean;
}) {
  const [avaliacoes, setAvaliacoes] = useState<SegurancaAvaliacao[]>([]);
  const [modelos, setModelos] = useState<SegurancaModelo[]>([]);
  const [acoes, setAcoes] = useState<Tarefa[]>([]);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  useEffect(() => { if (rid) return ouvirAvaliacoes(rid, setAvaliacoes); }, [rid]);
  useEffect(() => { if (rid) return ouvirModelos(rid, setModelos); }, [rid]);
  useEffect(() => {
    if (!rid) return;
    return onSnapshot(query(collection(db, "tarefas"), where("origem", "==", "avaliacao_sanitaria")), (snap) => {
      setAcoes(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Tarefa).filter((a) => !a.deletadoEm && (a.restaurantIds || []).includes(rid)));
    }, () => setAcoes([]));
  }, [rid]);

  // Líderes efetivos de uma área numa avaliação: snapshot + fallback pro modelo
  // atual (mesma regra do Relatório — evita "área sem líder" pós-configuração).
  function lideresDaArea(av: SegurancaAvaliacao, area?: string): SegLider[] {
    const snap = (av.responsaveisAreaSnapshot || {}) as Record<string, SegLider[]>;
    const live = (modelos.find((m) => m.id === av.modeloId)?.responsaveisArea || {}) as Record<string, SegLider[]>;
    const merged: Record<string, SegLider[]> = { ...live };
    for (const [a, lst] of Object.entries(snap)) if (Array.isArray(lst) && lst.length) merged[a] = lst;
    return segLideresDe(merged, area);
  }

  // Tarefa amarrada a uma inconformidade: origemRefId === `${avId}:${resKey}`.
  const tarefaPorRef = useMemo(() => {
    const m = new Map<string, Tarefa>();
    for (const t of acoes) if (t.origemRefId) m.set(t.origemRefId, t);
    return m;
  }, [acoes]);

  const itens = useMemo(() => {
    const out: Item[] = [];
    for (const av of avaliacoes) {
      const itemById = new Map((av.itensSnapshot || []).map((i) => [i.id, i]));
      for (const [key, r] of Object.entries(av.resultado || {})) {
        if (r.resposta !== "nao_conforme") continue;
        const { itemId, area } = segResParse(key);
        const it = itemById.get(itemId);
        out.push({ avId: av.id, av, key, area, texto: it?.texto || "(item removido)", observacao: r.observacao || "", tarefa: tarefaPorRef.get(`${av.id}:${key}`) });
      }
    }
    return out.sort((a, b) => (b.av.data || "").localeCompare(a.av.data || ""));
  }, [avaliacoes, tarefaPorRef]);

  const resolvida = (t?: Tarefa) => !!t && (t.status === "concluida" || t.status === "cancelada");
  const abertas = itens.filter((i) => !resolvida(i.tarefa));
  const resolvidas = itens.filter((i) => resolvida(i.tarefa));

  async function virarAcao(i: Item) {
    const lideres = lideresDaArea(i.av, i.area);
    if (!lideres.length) {
      alert(`A área "${i.area || "—"}" não tem líder definido. Defina o(s) líder(es) na aba Configurações antes de gerar a ação.`);
      return;
    }
    setBusy((s) => new Set(s).add(i.key + i.avId));
    try {
      await criarAcaoSanitaria({ av: i.av, key: i.key, texto: i.texto, observacao: i.observacao, lideres, autor });
    } catch (e) {
      alert("Falha ao gerar a ação: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setBusy((s) => { const n = new Set(s); n.delete(i.key + i.avId); return n; });
    }
  }

  if (itens.length === 0) {
    return <p className="text-sm text-gray-400 py-12 text-center">Nenhuma inconformidade registrada nas avaliações ainda.</p>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Coluna titulo="Abertas" contador={abertas.length} tom="warn">
        {abertas.length === 0
          ? <p className="text-sm text-gray-400 py-6 text-center">Nada em aberto. 🎉</p>
          : abertas.map((i) => (
            <Card key={i.avId + i.key} i={i}>
              {i.tarefa
                ? <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{TAREFA_STATUS_LABEL[i.tarefa.status]}{i.tarefa.responsavelNome ? ` · ${i.tarefa.responsavelNome}` : ""}</span>
                : podeGerar
                  ? <button type="button" disabled={busy.has(i.key + i.avId)} onClick={() => void virarAcao(i)}
                      className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50">
                      <Target size={13} /> {busy.has(i.key + i.avId) ? "Gerando…" : "Virar ação"}
                    </button>
                  : <span className="text-[12px] text-gray-400">Sem ação</span>}
            </Card>
          ))}
      </Coluna>

      <Coluna titulo="Resolvidas" contador={resolvidas.length} tom="ok">
        {resolvidas.length === 0
          ? <p className="text-sm text-gray-400 py-6 text-center">Nada resolvido ainda.</p>
          : resolvidas.map((i) => (
            <Card key={i.avId + i.key} i={i}>
              <span className="inline-flex items-center gap-1 text-[12px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                <CircleCheckBig size={12} /> {TAREFA_STATUS_LABEL[i.tarefa!.status]}
              </span>
            </Card>
          ))}
      </Coluna>
    </div>
  );
}

function Coluna({ titulo, contador, tom, children }: { titulo: string; contador: number; tom: "warn" | "ok"; children: React.ReactNode }) {
  const dot = tom === "warn" ? "bg-amber-500" : "bg-emerald-500";
  return (
    <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/40 p-3">
      <div className="flex items-center gap-2 mb-2.5 px-1">
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{titulo}</span>
        <span className="text-[11px] font-semibold text-gray-400 tabular-nums">{contador}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Card({ i, children }: { i: Item; children: React.ReactNode }) {
  const cor = segAreaCor(i.area);
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
      <div className="flex items-center gap-2 mb-1">
        {i.area && <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded ${cor.bg} ${cor.fg}`}><span className="w-1.5 h-1.5 rounded-full" style={{ background: cor.dot }} /> {i.area}</span>}
        <span className="text-[11px] text-gray-400 tabular-nums ml-auto">{dmy(i.av.data)}</span>
      </div>
      <div className="text-sm text-gray-900 dark:text-gray-100 leading-snug">{i.texto}</div>
      {i.observacao && <div className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5 whitespace-pre-line">{i.observacao}</div>}
      <div className="mt-2">{children}</div>
    </div>
  );
}
