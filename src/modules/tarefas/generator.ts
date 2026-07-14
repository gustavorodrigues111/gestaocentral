// Gerador de tarefas a partir dos cadastros mestres (Contas Fixas, Manutenções)
// e cascatas de processos (Admissão). Idempotente — usa `recorrenciaKey` pra
// evitar duplicar tarefa do mesmo vencimento.
//
// Fase 0 (atual): chamado lazy on-app-load + manual por botão master.
// Fase 1+: chamado por cron (Vercel Cron Jobs ou Cloud Scheduler).

import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { criarTarefa, aplicarAutomacaoNoPayload, atualizarTarefa } from "./repository";
import type {
  ContaFixa, Manutencao, Tarefa, TarefaSubprojeto, Subtarefa,
} from "../../core/types";

const ANTECEDENCIA_DEFAULT_DIAS = 3;

/** Dias entre duas datas (YYYY-MM-DD). Positivo se b > a. */
function diasEntre(a: string, b: string): number {
  const da = new Date(a + "T00:00:00");
  const db_ = new Date(b + "T00:00:00");
  return Math.round((db_.getTime() - da.getTime()) / (1000 * 60 * 60 * 24));
}

function addDias(yyyymmdd: string, dias: number): string {
  const d = new Date(yyyymmdd + "T00:00:00");
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Carrega observadoresPadraoIds de um subprojeto. Retorna [] em falha
// pra não quebrar a criação da tarefa.
async function loadObservadoresPadraoSub(subprojetoId: string): Promise<string[]> {
  try {
    const snap = await getDoc(doc(db, "tarefaSubprojetos", subprojetoId));
    if (!snap.exists()) return [];
    const data = snap.data() as { observadoresPadraoIds?: string[] };
    return data.observadoresPadraoIds || [];
  } catch {
    return [];
  }
}

/** Próximo vencimento de uma Conta Fixa a partir de hoje. */
export const ANTECEDENCIA_CONTA_FIXA_DIAS = ANTECEDENCIA_DEFAULT_DIAS;
export function proximoVencimentoContaFixa(cf: ContaFixa): string | null {
  const hoje = new Date();
  if (cf.recorrencia === "mensal" && cf.diaDoMes) {
    let alvo = new Date(hoje.getFullYear(), hoje.getMonth(), cf.diaDoMes);
    if (alvo < hoje) alvo = new Date(hoje.getFullYear(), hoje.getMonth() + 1, cf.diaDoMes);
    return alvo.toISOString().slice(0, 10);
  }
  if (cf.recorrencia === "semanal" && cf.diaDaSemana !== undefined) {
    const diff = (cf.diaDaSemana - hoje.getDay() + 7) % 7 || 7;
    const alvo = new Date(hoje.getTime() + diff * 24 * 60 * 60 * 1000);
    return alvo.toISOString().slice(0, 10);
  }
  // Anual/trimestral/semestral: usar mesDoAno + diaDoMes
  if (cf.diaDoMes && cf.mesDoAno) {
    let alvo = new Date(hoje.getFullYear(), cf.mesDoAno - 1, cf.diaDoMes);
    if (alvo < hoje) alvo = new Date(hoje.getFullYear() + 1, cf.mesDoAno - 1, cf.diaDoMes);
    return alvo.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Roda o gerador completo:
 *   1. Contas Fixas ativas com vencimento próximo → gera tarefa
 *   2. Manutenções ativas com vencimento próximo → gera tarefa
 * Retorna contagens.
 */
export async function gerarTarefasDoDia(autor: { id: string; nome: string }): Promise<{
  contasGeradas: number;
  manutencoesGeradas: number;
  jaExistiam: number;
}> {
  let contasGeradas = 0;
  let manutencoesGeradas = 0;
  let jaExistiam = 0;
  const hoje = new Date().toISOString().slice(0, 10);

  // ── Contas Fixas ──
  // DESATIVADO: contas fixas agora aparecem no Gestor como CARD DERIVADO ao vivo
  // (ver derivados.ts), não mais como cópia de tarefa. Fonte única = módulo Contas
  // Fixas. Loop preservado abaixo (não itera) — fase A da integração.
  const cfSnap = { docs: [] as { id: string; data: () => Record<string, unknown> }[] };
  for (const d of cfSnap.docs) {
    const cf = { id: d.id, ...d.data() } as ContaFixa;
    if (cf.deletadoEm) continue;
    const venc = proximoVencimentoContaFixa(cf);
    if (!venc) continue;
    const dias = diasEntre(hoje, venc);
    const antec = cf.diasAntecedencia ?? ANTECEDENCIA_DEFAULT_DIAS;
    if (dias > antec) continue; // ainda longe
    const chave = `cf-${cf.id}-${venc}`;
    if (cf.ultimaGeracaoChave === chave) { jaExistiam++; continue; }
    // Idempotência extra: verifica se já existe tarefa com essa recorrenciaKey
    const existSnap = await getDocs(query(collection(db, "tarefas"), where("recorrenciaKey", "==", chave)));
    if (!existSnap.empty) { jaExistiam++; continue; }
    const notes = [
      cf.fornecedor && `Fornecedor: ${cf.fornecedor}`,
      cf.valorEstimado && `Valor estimado: R$ ${cf.valorEstimado.toFixed(2)}`,
      cf.pix && `PIX: ${cf.pix}`,
      cf.banco && `Banco: ${cf.banco}`,
      cf.titular && `Titular: ${cf.titular}`,
      cf.observacoes && `\n${cf.observacoes}`,
    ].filter(Boolean).join("\n");
    const obsCF = await loadObservadoresPadraoSub(cf.subprojetoId);
    const tBase: Omit<Tarefa, "id" | "criadoEm" | "atualizadoEm"> = {
      projetoId: cf.projetoId,
      subprojetoId: cf.subprojetoId,
      titulo: cf.fornecedor?.trim() || cf.nome,
      descricao: notes || undefined,
      responsavelId: cf.responsavelPadraoId,
      responsavelNome: cf.responsavelPadraoNome,
      observadoresIds: obsCF.length > 0 ? obsCF : undefined,
      restaurantIds: cf.restaurantIds,
      prazo: venc,
      status: "a_fazer",
      prioridade: "normal",
      origem: "conta_fixa",
      origemRefId: cf.id,
      origemRefLabel: `Conta Fixa: ${cf.nome}`,
      recorrenciaKey: chave,
      criadoPor: autor.id,
      criadoPorNome: autor.nome,
    };
    // Override pela config Automações se houver — admin define no Gestor
    // de Tarefas → Admin Projetos → Automações. Restaurante: usa o 1º do
    // array (conta fixa pode estar em N restaurantes; config é por restaurante).
    const t = await aplicarAutomacaoNoPayload(tBase, cf.restaurantIds[0] || "", "conta_fixa");
    await criarTarefa(t);
    contasGeradas++;
  }

  // ── Manutenções ──
  // DESATIVADO: manutenções (prazos técnicos) agora aparecem no Gestor como CARD
  // DERIVADO ao vivo (derivados.ts), abrindo o ApontamentoModal do módulo. Loop
  // preservado abaixo (não itera) — fase B da integração.
  const mtSnap = { docs: [] as { id: string; data: () => Record<string, unknown> }[] };
  for (const d of mtSnap.docs) {
    const m = { id: d.id, ...d.data() } as Manutencao;
    if (m.deletadoEm) continue;
    const venc = m.proximoVencimento;
    const dias = diasEntre(hoje, venc);
    const antec = m.diasAntecedencia ?? 30;
    if (dias > antec) continue;
    const chave = `mt-${m.id}-${venc}`;
    if (m.ultimaGeracaoChave === chave) { jaExistiam++; continue; }
    const existSnap = await getDocs(query(collection(db, "tarefas"), where("recorrenciaKey", "==", chave)));
    if (!existSnap.empty) { jaExistiam++; continue; }
    const obsM = await loadObservadoresPadraoSub(m.subprojetoId);
    const tBase: Omit<Tarefa, "id" | "criadoEm" | "atualizadoEm"> = {
      projetoId: m.projetoId,
      subprojetoId: m.subprojetoId,
      titulo: `${nomeTipo(m.tipo)} — vence ${venc}${m.fornecedor ? ` (${m.fornecedor})` : ""}`,
      descricao: [
        m.descricao,
        m.fornecedor && `Fornecedor: ${m.fornecedor}`,
        m.pastaDrive && `Drive: ${m.pastaDrive}`,
        m.observacoes,
      ].filter(Boolean).join("\n"),
      responsavelId: m.responsavelPadraoId,
      responsavelNome: m.responsavelPadraoNome,
      observadoresIds: obsM.length > 0 ? obsM : undefined,
      restaurantIds: m.restaurantIds,
      prazo: venc,
      status: "a_fazer",
      prioridade: dias < 0 ? "urgente" : "alta",
      origem: "manutencao",
      origemRefId: m.id,
      origemRefLabel: `Manutenção: ${nomeTipo(m.tipo)}`,
      recorrenciaKey: chave,
      criadoPor: autor.id,
      criadoPorNome: autor.nome,
    };
    const t = await aplicarAutomacaoNoPayload(tBase, m.restaurantIds[0] || "", "manutencao");
    await criarTarefa(t);
    manutencoesGeradas++;
  }

  return { contasGeradas, manutencoesGeradas, jaExistiam };
}

function nomeTipo(tipo: string): string {
  return tipo.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
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
