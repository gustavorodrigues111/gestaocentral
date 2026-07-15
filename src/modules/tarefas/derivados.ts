// Itens DERIVADOS ao vivo de outros módulos, exibidos como card leve no Gestor
// de Tarefas (sem virar tarefa de verdade). Fase A: Contas Fixas.
//
// A conta fixa vira uma "tarefa virtual" (id sintético "cf::<id>::<comp>") com
// __derivado.setConcluida ligado ao pagamento no módulo Contas Fixas. Nenhum doc
// de tarefa é criado; o dado vive só no módulo dono.
import type { ContaFixa, Manutencao, Tarefa } from "../../core/types";
import { MANUTENCAO_TIPO_LABEL } from "../../core/types";
import type { Item as PrazoTrabItem } from "../prazosTrabalhistas/PrazosTrabalhistasPage";
import { proximoVencimentoContaFixa, ANTECEDENCIA_CONTA_FIXA_DIAS } from "./generator";

function diasEntre(a: string, b: string): number {
  return Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000);
}
const pad2 = (n: number) => String(n).padStart(2, "0");
const daysInMonth = (ano: number, mes: number) => new Date(ano, mes, 0).getDate();
// Vencimento de uma conta mensal numa competência "YYYY-MM" (clampa o dia ao mês).
function vencMensal(cf: ContaFixa, comp: string): string | null {
  if (!cf.diaDoMes) return null;
  const [a, m] = comp.split("-").map(Number);
  return `${comp}-${pad2(Math.min(cf.diaDoMes, daysInMonth(a, m)))}`;
}
function proxComp(comp: string): string {
  let [a, m] = comp.split("-").map(Number);
  m += 1; if (m > 12) { m = 1; a += 1; }
  return `${a}-${pad2(m)}`;
}

function cardContaFixa(cf: ContaFixa, comp: string, venc: string, abrir: (cf: ContaFixa, comp: string) => void): Tarefa {
  const paga = !!cf.pagamentos?.[comp];
  return {
    id: `cf::${cf.id}::${comp}`,
    projetoId: cf.projetoId,
    subprojetoId: cf.subprojetoId,
    titulo: cf.fornecedor?.trim() || cf.nome,
    responsavelId: cf.responsavelPadraoId,
    responsavelNome: cf.responsavelPadraoNome,
    restaurantIds: cf.restaurantIds,
    prazo: venc,
    status: paga ? "concluida" : "a_fazer",
    prioridade: "normal",
    origem: "conta_fixa",
    origemRefId: cf.id,
    origemRefLabel: `Conta Fixa: ${cf.nome}`,
    subtarefas: [],
    comentarios: [],
    criadoEm: cf.criadoEm,
    criadoPor: cf.criadoPor,
    atualizadoEm: cf.atualizadoEm,
    // Clicar abre o modal de detalhes (com botão marcar pago), não marca direto.
    __derivado: { tipo: "conta_fixa", refId: cf.id, competencia: comp, abrirModal: () => abrir(cf, comp) },
  };
}

// Deriva as contas fixas ATIVAS em tarefas virtuais.
// - Mensal: mostra SEMPRE a competência do mês atual (paga → concluída; pendente/
//   atrasada → a fazer). Se o mês atual já está pago e o próximo vencimento está
//   dentro da antecedência, mostra também o próximo.
// - Outras recorrências: o próximo vencimento dentro da antecedência.
export function derivarContasFixas(
  contas: ContaFixa[], hojeYmd: string, abrir: (cf: ContaFixa, comp: string) => void,
): Tarefa[] {
  const out: Tarefa[] = [];
  const compAtual = hojeYmd.slice(0, 7);
  for (const cf of contas) {
    if (!cf.ativo || cf.deletadoEm) continue;
    const antec = cf.diasAntecedencia ?? ANTECEDENCIA_CONTA_FIXA_DIAS;
    if (cf.recorrencia === "mensal" && cf.diaDoMes) {
      const vAtual = vencMensal(cf, compAtual);
      if (vAtual) out.push(cardContaFixa(cf, compAtual, vAtual, abrir));
      if (cf.pagamentos?.[compAtual]) {   // mês atual pago → antecipa o próximo se estiver perto
        const prox = proxComp(compAtual);
        const vProx = vencMensal(cf, prox);
        if (vProx && diasEntre(hojeYmd, vProx) <= antec) out.push(cardContaFixa(cf, prox, vProx, abrir));
      }
    } else {
      const venc = proximoVencimentoContaFixa(cf);
      if (!venc || diasEntre(hojeYmd, venc) > antec) continue;
      out.push(cardContaFixa(cf, venc.slice(0, 7), venc, abrir));
    }
  }
  return out;
}

// Deriva manutenções (prazos técnicos) ativas com vencimento próximo. Concluir
// NÃO é um simples check (exige apontamento/laudo) → o card abre o modal do
// módulo (ApontamentoModal) via `abrirModal`. Status = realizado ? concluída.
export function derivarManutencoes(
  manutencoes: Manutencao[], hojeYmd: string, abrir: (m: Manutencao) => void,
): Tarefa[] {
  const out: Tarefa[] = [];
  for (const m of manutencoes) {
    if (!m.ativo || m.deletadoEm) continue;
    if (!m.proximoVencimento) continue;
    // Janela generosa pro Gestor: pelo menos 60 dias à frente (+ atrasadas), pra
    // laudos/licenças aparecerem com antecedência de planejamento.
    const antec = Math.max(m.diasAntecedencia ?? 30, 60);
    if (diasEntre(hojeYmd, m.proximoVencimento) > antec) continue;
    const realizado = m.statusCiclo === "realizado";
    const nome = MANUTENCAO_TIPO_LABEL[m.tipo] || m.tipo;
    out.push({
      id: `mt::${m.id}`,
      projetoId: m.projetoId,
      subprojetoId: m.subprojetoId,
      titulo: nome,
      responsavelId: m.responsavelPadraoId,
      responsavelNome: m.responsavelPadraoNome,
      restaurantIds: m.restaurantIds,
      prazo: m.proximoVencimento,
      status: realizado ? "concluida" : "a_fazer",
      prioridade: "normal",
      origem: "manutencao",
      origemRefId: m.id,
      origemRefLabel: `Manutenção: ${nome}`,
      subtarefas: [],
      comentarios: [],
      criadoEm: m.criadoEm || "",
      criadoPor: m.criadoPor || "",
      atualizadoEm: m.atualizadoEm || "",
      __derivado: { tipo: "manutencao", refId: m.id, abrirModal: () => abrir(m) },
    });
  }
  return out;
}

// Deriva os prazos trabalhistas (experiência/exame/uniforme/EPI) em tarefas
// virtuais no projeto "Pessoas". Sem responsável — visíveis por acesso ao
// projeto. Concluir abre o modal do módulo (resolver/dar baixa/decisão).
export function derivarPrazosTrab(
  itens: PrazoTrabItem[], hojeYmd: string, resolvidos: Set<string>,
  projetoId: string, subprojetoId: string, abrir: (it: PrazoTrabItem) => void,
): Tarefa[] {
  const out: Tarefa[] = [];
  for (const it of itens) {
    if (diasEntre(hojeYmd, it.data) > 45) continue;   // limita ~45 dias à frente (+ atrasados)
    const resolvido = resolvidos.has(it.id);
    out.push({
      id: `pt::${it.id}`,
      projetoId, subprojetoId,
      // Inclui de QUEM é (it.sub = nome do empregado) — senão vira vários
      // "Coprocultura" iguais sem dá pra saber a pessoa.
      titulo: it.sub ? `${it.titulo} — ${it.sub}` : it.titulo,
      responsavelId: "",
      restaurantIds: it.restaurantId ? [it.restaurantId] : undefined,
      prazo: it.data,
      status: resolvido ? "concluida" : "a_fazer",
      prioridade: "normal",
      origem: "admissao",
      origemRefId: it.empregadoId || it.exameId || it.id,
      origemRefLabel: it.sub,
      subtarefas: [], comentarios: [],
      criadoEm: "", criadoPor: "", atualizadoEm: "",
      __derivado: { tipo: "prazo_trabalhista", refId: it.id, abrirModal: () => abrir(it) },
    });
  }
  return out;
}
