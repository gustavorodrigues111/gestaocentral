// Itens DERIVADOS ao vivo de outros módulos, exibidos como card leve no Gestor
// de Tarefas (sem virar tarefa de verdade). Fase A: Contas Fixas.
//
// A conta fixa vira uma "tarefa virtual" (id sintético "cf::<id>::<comp>") com
// __derivado.setConcluida ligado ao pagamento no módulo Contas Fixas. Nenhum doc
// de tarefa é criado; o dado vive só no módulo dono.
import { doc, updateDoc, deleteField } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import type { ContaFixa, Tarefa } from "../../core/types";
import { proximoVencimentoContaFixa, ANTECEDENCIA_CONTA_FIXA_DIAS } from "./generator";

function diasEntre(a: string, b: string): number {
  return Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000);
}

// Marca/desmarca a conta como paga na competência (mesma lógica do togglePago).
export async function setContaFixaPaga(cf: ContaFixa, competencia: string, paga: boolean, pessoa: { id: string }): Promise<void> {
  const ref = doc(db, "contasFixas", cf.id);
  if (paga) {
    await updateDoc(ref, { [`pagamentos.${competencia}`]: { pagoEm: new Date().toISOString(), pagoPor: pessoa.id }, atualizadoEm: new Date().toISOString() });
  } else {
    await updateDoc(ref, { [`pagamentos.${competencia}`]: deleteField(), atualizadoEm: new Date().toISOString() });
  }
}

// Deriva as contas fixas ATIVAS com vencimento próximo (dentro da antecedência)
// em tarefas virtuais. Uma por conta (competência do próximo vencimento).
export function derivarContasFixas(
  contas: ContaFixa[], pessoa: { id: string; nome: string }, hojeYmd: string,
): Tarefa[] {
  const out: Tarefa[] = [];
  for (const cf of contas) {
    if (!cf.ativo || cf.deletadoEm) continue;
    const venc = proximoVencimentoContaFixa(cf);
    if (!venc) continue;
    const antec = cf.diasAntecedencia ?? ANTECEDENCIA_CONTA_FIXA_DIAS;
    if (diasEntre(hojeYmd, venc) > antec) continue;   // ainda longe
    const comp = venc.slice(0, 7);
    const paga = !!cf.pagamentos?.[comp];
    out.push({
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
      __derivado: {
        tipo: "conta_fixa",
        refId: cf.id,
        competencia: comp,
        setConcluida: (v: boolean) => setContaFixaPaga(cf, comp, v, pessoa),
      },
    });
  }
  return out;
}
