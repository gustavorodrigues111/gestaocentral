// Gerador de tarefas a partir dos cadastros mestres (Contas Fixas, Manutenções)
// e cascatas de processos (Admissão). Idempotente — usa `recorrenciaKey` pra
// evitar duplicar tarefa do mesmo vencimento.
//
// Fase 0 (atual): chamado lazy on-app-load + manual por botão master.
// Fase 1+: chamado por cron (Vercel Cron Jobs ou Cloud Scheduler).

import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { criarTarefa } from "./repository";
import type {
  ContaFixa, Manutencao, Tarefa, Empregado, Cargo, TarefaSubprojeto, Subtarefa,
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

/** Próximo vencimento de uma Conta Fixa a partir de hoje. */
function proximoVencimentoContaFixa(cf: ContaFixa): string | null {
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
  const cfSnap = await getDocs(query(collection(db, "contasFixas"), where("ativo", "==", true)));
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
    const t: Omit<Tarefa, "id" | "criadoEm" | "atualizadoEm"> = {
      projetoId: cf.projetoId,
      subprojetoId: cf.subprojetoId,
      titulo: `Pagar — ${cf.nome}`,
      descricao: notes || undefined,
      responsavelId: cf.responsavelPadraoId,
      responsavelNome: cf.responsavelPadraoNome,
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
    await criarTarefa(t);
    contasGeradas++;
  }

  // ── Manutenções ──
  const mtSnap = await getDocs(query(collection(db, "manutencoes"), where("ativo", "==", true)));
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
    const t: Omit<Tarefa, "id" | "criadoEm" | "atualizadoEm"> = {
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

  await criarTarefa({
    projetoId: tarefaConcluida.projetoId,
    subprojetoId: tarefaConcluida.subprojetoId,
    titulo: nomeProximoCiclo(tarefaConcluida.titulo, tipo, proxPrazo),
    descricao: tarefaConcluida.descricao,
    responsavelId: sub.responsavelPadraoId || tarefaConcluida.responsavelId,
    responsavelNome: sub.responsavelPadraoNome || tarefaConcluida.responsavelNome,
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
// Cria 4-5 tarefas-prazo trabalhistas baseado na data de admissão.
//
// 1ª Experiência:    admissão + 40 dias  (avaliação)
// 2ª Experiência:    admissão + 85 dias  (avaliação final)
// Exame Clínico:     admissão + 335 dias (1 ano − 30 dias antecedência)
// Exame Complementar:admissão + 180 dias (6 meses)
// Coprocultura:      admissão + 180 dias (semestral — só pra cargos manipuladores)

export type AdmissaoFinalizadaInput = {
  pessoaNome: string;
  empregadoId: string;
  restaurantId: string;
  admissaoData: string;          // YYYY-MM-DD
  // Se não fornecido, sistema busca o cargo do empregado e deriva
  // de cargo.area ∈ {"Bar","Cozinha"}.
  manipulaAlimentos?: boolean;
  responsavelPadraoId: string;
  responsavelPadraoNome?: string;
  autorId: string;
  autorNome: string;
};

// Heurística pra derivar "manipula alimentos" do cargo do empregado.
// Áreas Bar e Cozinha → manipulador → exige Coprocultura semestral.
async function deriveManipulaAlimentos(empregadoId: string): Promise<boolean> {
  try {
    const empSnap = await getDoc(doc(db, "empregados", empregadoId));
    if (!empSnap.exists()) return false;
    const emp = empSnap.data() as Empregado;
    if (!emp.cargoId) return false;
    const cargoSnap = await getDoc(doc(db, "cargos", emp.cargoId));
    if (!cargoSnap.exists()) return false;
    const cargo = cargoSnap.data() as Cargo;
    return cargo.area === "Cozinha" || cargo.area === "Bar";
  } catch (e) {
    console.warn("[gerador] falha ao derivar manipula alimentos:", e);
    return false;
  }
}

export async function gerarCascataAdmissao(input: AdmissaoFinalizadaInput): Promise<number> {
  const {
    pessoaNome, empregadoId, restaurantId, admissaoData,
    responsavelPadraoId, responsavelPadraoNome,
    autorId, autorNome,
  } = input;

  // Se não vier definido, deriva do cargo
  const manipulaAlimentos = input.manipulaAlimentos
    ?? await deriveManipulaAlimentos(empregadoId);

  // Idempotência: usa origemRefId+tipo na chave pra evitar duplicar
  // mesmo se chamar 2× pra mesma admissão.
  const existSnap = await getDocs(query(
    collection(db, "tarefas"),
    where("origemRefId", "==", empregadoId),
    where("origem", "==", "admissao"),
  ));
  if (existSnap.size >= 4) return 0; // já gerou tudo

  const tarefas = [
    {
      titulo: `Avaliação 1ª etapa Experiência | ${pessoaNome}`,
      prazo: addDias(admissaoData, 40),
      origemKey: "exp1",
    },
    {
      titulo: `Avaliação 2ª etapa Experiência | ${pessoaNome}`,
      prazo: addDias(admissaoData, 85),
      origemKey: "exp2",
    },
    {
      titulo: `Exame Clínico (anual) | ${pessoaNome}`,
      prazo: addDias(admissaoData, 335),
      origemKey: "examec",
    },
    {
      titulo: `Exame Complementar (semestral) | ${pessoaNome}`,
      prazo: addDias(admissaoData, 180),
      origemKey: "examex",
    },
    ...(manipulaAlimentos ? [{
      titulo: `Coprocultura | ${pessoaNome}`,
      prazo: addDias(admissaoData, 180),
      origemKey: "copro",
    }] : []),
  ];

  // Filtra os que já existem
  const chavesExistentes = new Set(existSnap.docs.map(d => (d.data() as Tarefa).recorrenciaKey));
  let criadas = 0;
  for (const t of tarefas) {
    const chave = `adm-${empregadoId}-${t.origemKey}`;
    if (chavesExistentes.has(chave)) continue;
    await criarTarefa({
      projetoId: "proj-pessoas-rot",
      subprojetoId: t.origemKey.startsWith("exp") ? "sub-pessoas-experiencia" : "sub-pessoas-prazos",
      titulo: t.titulo,
      responsavelId: responsavelPadraoId,
      responsavelNome: responsavelPadraoNome,
      restaurantIds: [restaurantId],
      prazo: t.prazo,
      status: "a_fazer",
      prioridade: "normal",
      origem: "admissao",
      origemRefId: empregadoId,
      origemRefLabel: `Admissão: ${pessoaNome}`,
      recorrenciaKey: chave,
      criadoPor: autorId,
      criadoPorNome: autorNome,
    });
    criadas++;
  }
  return criadas;
}
