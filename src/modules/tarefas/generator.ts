// Gerador de tarefas a partir dos cadastros mestres (Contas Fixas, Manutenções)
// e cascatas de processos (Admissão). Idempotente — usa `recorrenciaKey` pra
// evitar duplicar tarefa do mesmo vencimento.
//
// Fase 0 (atual): chamado lazy on-app-load + manual por botão master.
// Fase 1+: chamado por cron (Vercel Cron Jobs ou Cloud Scheduler).

import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { criarTarefa, atualizarTarefa } from "./repository";
import type { Tarefa, TarefaSubprojeto, Subtarefa } from "../../core/types";

function addDias(yyyymmdd: string, dias: number): string {
  const d = new Date(yyyymmdd + "T00:00:00");
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

// ── Auto-clone de rotinas ────────────────────────────────────────────────
// Chamado quando uma tarefa é concluída. Se o subprojeto dela é auto:true
// + recorrenciaTipo definida, agenda próxima ocorrência com prazo recalculado.
// Idempotente: usa recorrenciaKey pra não duplicar próxima ocorrência.

export async function tentarAgendarProximaRecorrencia(
  tarefaConcluida: Tarefa,
  autor: { id: string; nome: string },
): Promise<boolean> {
  // Carrega subprojeto e checa se tem recorrência
  const subSnap = await getDoc(doc(db, "tarefaSubprojetos", tarefaConcluida.subprojetoId));
  if (!subSnap.exists()) return false;
  const sub = { id: subSnap.id, ...subSnap.data() } as TarefaSubprojeto;
  const tipo = sub.recorrenciaTipo;
  if (!tipo || tipo === "nenhuma" || !sub.auto) return false;

  // Calcula próximo prazo
  const proxPrazo = calcularProximoPrazo(tipo, sub.recorrenciaDia, sub.recorrenciaMes);
  if (!proxPrazo) return false;

  // Idempotência: chave baseada em subprojeto + prazo da próxima
  const chave = `rec-${sub.id}-${proxPrazo}`;
  const existSnap = await getDocs(query(collection(db, "tarefas"), where("recorrenciaKey", "==", chave)));
  if (!existSnap.empty) return false; // já agendada

  // Subtarefas a partir do template, com prazo resolvido a partir de prazoOffset.
  const { resolverPrazoOffset } = await import("./prazoOffset");
  const subtarefas: Subtarefa[] | undefined = (sub.tarefasTemplate || []).length > 0
    ? (sub.tarefasTemplate || []).map((t, i) => ({
        id: Math.random().toString(36).slice(2, 11),
        texto: t.titulo,
        feito: false,
        prazo: resolverPrazoOffset(t.prazoOffset, proxPrazo),
        ordem: i + 1,
      }))
    : undefined;

  // Herda observadores padrão do sub + os que a tarefa concluída tinha
  // (próxima rotina geralmente mantém o mesmo conjunto de observadores).
  const obsRec = Array.from(new Set([
    ...(sub.observadoresPadraoIds || []),
    ...(tarefaConcluida.observadoresIds || []),
  ]));
  await criarTarefa({
    projetoId: tarefaConcluida.projetoId,
    subprojetoId: tarefaConcluida.subprojetoId,
    titulo: nomeProximoCiclo(tarefaConcluida.titulo, tipo, proxPrazo),
    descricao: tarefaConcluida.descricao,
    responsavelId: sub.responsavelPadraoId || tarefaConcluida.responsavelId,
    responsavelNome: sub.responsavelPadraoNome || tarefaConcluida.responsavelNome,
    observadoresIds: obsRec.length > 0 ? obsRec : undefined,
    restaurantIds: tarefaConcluida.restaurantIds,
    prazo: proxPrazo,
    status: "a_fazer",
    prioridade: "normal",
    subtarefas,
    origem: "recorrencia",
    origemRefId: sub.id,
    origemRefLabel: `Rotina: ${sub.nome}`,
    recorrenciaKey: chave,
    corHerdada: tarefaConcluida.corHerdada,
    criadoPor: autor.id,
    criadoPorNome: autor.nome,
  });
  return true;
}

function calcularProximoPrazo(
  tipo: NonNullable<TarefaSubprojeto["recorrenciaTipo"]>,
  dia?: number,
  mes?: number,
): string | null {
  const hoje = new Date();
  if (tipo === "semanal" && dia !== undefined) {
    const diff = ((dia - hoje.getDay() + 7) % 7) || 7;
    const d = new Date(hoje.getTime() + diff * 86400000);
    return d.toISOString().slice(0, 10);
  }
  if (tipo === "mensal" && dia) {
    let d = new Date(hoje.getFullYear(), hoje.getMonth() + 1, dia);
    return d.toISOString().slice(0, 10);
  }
  if ((tipo === "trimestral" || tipo === "semestral" || tipo === "anual") && dia) {
    const meses = tipo === "anual" ? 12 : tipo === "semestral" ? 6 : 3;
    const baseMes = mes ? mes - 1 : hoje.getMonth();
    let d = new Date(hoje.getFullYear(), baseMes + meses, dia);
    if (d <= hoje) d = new Date(d.getFullYear() + (mes ? 1 : 0), d.getMonth(), dia);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function nomeProximoCiclo(tituloOriginal: string, tipo: string, prazo: string): string {
  // Se o título já tem padrão "| Mês Ano" tipo "Fechamento Financeiro Mensal | Maio 26",
  // substitui pelo mês/ano novo. Senão, mantém + sufixo do prazo.
  const meses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const d = new Date(prazo + "T00:00:00");
  const mesNome = meses[d.getMonth()];
  const anoCurto = String(d.getFullYear()).slice(-2);
  const sufixo = `${mesNome} ${anoCurto}`;
  // Se já tem " | " separador, troca o último segmento
  const idx = tituloOriginal.lastIndexOf(" | ");
  if (idx > 0 && tipo === "mensal") {
    return tituloOriginal.slice(0, idx) + ` | ${sufixo}`;
  }
  return `${tituloOriginal} (${sufixo})`;
}

// ── Cascata de Admissão ──────────────────────────────────────────────────
// Chamado quando uma admissão é concluída (kanban move pra coluna final).
// Cria as tarefas-prazo trabalhistas (Experiência 1ª/2ª) baseado na data
// de admissão.
//
// 1ª Experiência:    admissão + 40 dias  (avaliação)
// 2ª Experiência:    admissão + 85 dias  (avaliação final)
//
// EXAMES MÉDICOS: a partir da Fase 7, exames (Clínico, Coprocultura) NÃO são
// criados como tarefa one-shot aqui. São cadastros mestres em /examesEmpregado
// criados pela cascata `gerarExamesParaAdmissao` em modules/exames/gerador.ts.

export type AdmissaoFinalizadaInput = {
  pessoaNome: string;
  empregadoId: string;
  restaurantId: string;
  admissaoData: string;          // YYYY-MM-DD
  // Mantido por retrocompat. O módulo Exames também deriva do cargo
  // independentemente (e considera só pra Coprocultura).
  manipulaAlimentos?: boolean;
  responsavelPadraoId: string;
  responsavelPadraoNome?: string;
  autorId: string;
  autorNome: string;
};

export async function gerarCascataAdmissao(_input: AdmissaoFinalizadaInput): Promise<number> {
  // DESATIVADO: as decisões de experiência (1ª/2ª) NÃO viram mais tarefa de
  // verdade. Aparecem como prazo derivado ao vivo no módulo Prazos Trabalhistas
  // (e espelhado no Gestor), com botões prorrogar/demitir no próprio modal.
  // Fonte única = empregados.admissaoAtual. No-op pra não quebrar as chamadas.
  return 0;
}

// ─── Recalcular prazos de Experiência quando admissão muda ───────────────
// Quando RH edita a data de admissão de um empregado, as tarefas de
// experiência criadas pela cascata ficam com prazo desatualizado. Esta
// função recalcula os prazos das tarefas em aberto (1ª e 2ª etapas) e
// das subtarefas internas (D-5, D-3, etc) com base na nova data.
// Idempotente: chama 2× com a mesma data e nada acontece.
//
// Retorna { afetadas } pra mostrar no toast/confirm. Tarefas concluídas
// ou canceladas não são tocadas — histórico preservado.
export async function recalcularPrazosExperiencia(
  empregadoId: string,
  novaAdmissao: string,
  autor: { id: string; nome: string },
): Promise<{ afetadas: number }> {
  const snap = await getDocs(query(
    collection(db, "tarefas"),
    where("origemRefId", "==", empregadoId),
    where("origem", "==", "admissao"),
  ));
  // Mesmo cálculo do cascata original
  const NOVO_PRAZO_POR_KEY: Record<string, string> = {
    exp1: addDias(novaAdmissao, 40),
    exp2: addDias(novaAdmissao, 85),
  };
  const { resolverPrazoOffset } = await import("./prazoOffset");
  // Mesmos offsets do checklist default da cascata. Como o template pode
  // ter sido customizado depois, preserva os textos atuais e só recalcula
  // os prazos das subtarefas — assumindo offsets D-5/D-3/D-2/D-1/D+0 pela
  // ordem original. Subtarefas adicionadas manualmente depois ficam intactas
  // (sem prazo recalculado), o que é seguro: mantém a edição do RH.
  const offsetsDefault = ["D-5", "D-3", "D-2", "D-1", "D+0"];
  let afetadas = 0;
  await Promise.all(snap.docs.map(async d => {
    const t = d.data() as Tarefa;
    if (t.status === "concluida" || t.status === "cancelada" || t.deletadoEm) return;
    // Identifica 1ª/2ª pela recorrenciaKey "adm-{id}-exp1" ou "adm-{id}-exp2"
    const sufixo = t.recorrenciaKey?.split("-").pop() || "";
    const novoPrazo = NOVO_PRAZO_POR_KEY[sufixo];
    if (!novoPrazo) return; // não é tarefa de experiência identificável
    if (t.prazo === novoPrazo) return; // já está no prazo certo
    // Recalcula prazo de subtarefas existentes — preserva textos e ordem.
    // Aplica offset default pela posição (ordem-1); se a tarefa tem mais
    // subtarefas que o template, as extras ficam sem prazo recalculado.
    const subs = (t.subtarefas || []).map((s, i) => ({
      ...s,
      prazo: i < offsetsDefault.length ? resolverPrazoOffset(offsetsDefault[i], novoPrazo) : s.prazo,
    }));
    await atualizarTarefa(d.id, {
      prazo: novoPrazo,
      subtarefas: subs,
    }, autor, {
      acao: "editada",
      campo: "prazo",
      detalhe: `Recalculado por mudança de data de admissão: ${t.prazo} → ${novoPrazo}`,
    });
    afetadas += 1;
  }));
  return { afetadas };
}
