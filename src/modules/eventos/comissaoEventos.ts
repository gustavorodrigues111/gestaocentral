// Cálculo de comissão dos eventos realizados/finalizados.
//
// Base = fechamento.faturamentoBrutoSemGorjeta. Percentuais vêm de
// eventosConfig.comissao (configuráveis). A comissão é atribuída à PESSOA que
// realizou cada atividade, conforme registrado no fechamento:
//   INBOUND  (cliente procurou):  negociação/fechamento + acompanhamento
//   OUTBOUND (captação ativa):    captação + negociação/fechamento + acompanhamento
import type { LeadEvento } from "../../core/types";
import { COMISSAO_DEFAULT } from "./ComercialConfigTab";

export type ComissaoConfig = typeof COMISSAO_DEFAULT;

export type LinhaComissaoPessoa = {
  pessoaId: string;
  pessoaNome: string;
  eventos: number;          // nº de eventos em que participou
  comissao: number;         // R$ total
};

export type ComissaoEventoDetalhe = {
  leadId: string;
  clienteNome: string;
  dataEvento: string;
  classificacao: "inbound" | "outbound";
  faturamento: number;
  itens: { pessoaId: string; pessoaNome: string; atividade: string; percent: number; valor: number }[];
};

export type RelatorioComissao = {
  detalhes: ComissaoEventoDetalhe[];
  porPessoa: LinhaComissaoPessoa[];
  totalFaturamento: number;
  totalComissao: number;
};

export function calcularComissoes(leads: LeadEvento[], cfg?: ComissaoConfig | null): RelatorioComissao {
  const c = cfg || COMISSAO_DEFAULT;
  const detalhes: ComissaoEventoDetalhe[] = [];
  const acc = new Map<string, LinhaComissaoPessoa>();
  const participouNoEvento = new Map<string, Set<string>>(); // pessoaId → set(leadId)
  let totalFaturamento = 0;
  let totalComissao = 0;

  const addItem = (
    det: ComissaoEventoDetalhe,
    pessoaId: string | undefined,
    pessoaNome: string | undefined,
    atividade: string,
    percent: number,
    base: number,
  ) => {
    if (!pessoaId || !percent) return;
    const valor = Math.round(base * (percent / 100) * 100) / 100;
    det.itens.push({ pessoaId, pessoaNome: pessoaNome || "?", atividade, percent, valor });
    const linha = acc.get(pessoaId) || { pessoaId, pessoaNome: pessoaNome || "?", eventos: 0, comissao: 0 };
    linha.comissao = Math.round((linha.comissao + valor) * 100) / 100;
    linha.pessoaNome = pessoaNome || linha.pessoaNome;
    acc.set(pessoaId, linha);
    if (!participouNoEvento.has(pessoaId)) participouNoEvento.set(pessoaId, new Set());
    participouNoEvento.get(pessoaId)!.add(det.leadId);
    totalComissao = Math.round((totalComissao + valor) * 100) / 100;
  };

  for (const l of leads) {
    const f = l.fechamento;
    if (!f) continue;
    const base = f.faturamentoBrutoSemGorjeta || 0;
    const classif = f.classificacao || l.classificacaoPrevia || "inbound";
    totalFaturamento = Math.round((totalFaturamento + base) * 100) / 100;
    const det: ComissaoEventoDetalhe = {
      leadId: l.id, clienteNome: l.cliente.nome, dataEvento: l.dataDesejada,
      classificacao: classif, faturamento: base, itens: [],
    };
    if (classif === "outbound") {
      if (f.captacaoAtiva?.ativo) addItem(det, f.captacaoAtiva.pessoaId, f.captacaoAtiva.pessoaNome, "Captação ativa", c.outbound.captacao, base);
      addItem(det, f.negociacaoPor?.pessoaId, f.negociacaoPor?.pessoaNome, "Negociação/fechamento", c.outbound.negociacaoFechamento, base);
      if (f.acompanhamentoPresencial?.ativo) addItem(det, f.acompanhamentoPresencial.pessoaId, f.acompanhamentoPresencial.pessoaNome, "Acompanhamento", c.outbound.acompanhamento, base);
    } else {
      addItem(det, f.negociacaoPor?.pessoaId, f.negociacaoPor?.pessoaNome, "Negociação/fechamento", c.inbound.negociacaoFechamento, base);
      if (f.acompanhamentoPresencial?.ativo) addItem(det, f.acompanhamentoPresencial.pessoaId, f.acompanhamentoPresencial.pessoaNome, "Acompanhamento", c.inbound.acompanhamento, base);
    }
    detalhes.push(det);
  }

  for (const [pid, set] of participouNoEvento) {
    const linha = acc.get(pid);
    if (linha) linha.eventos = set.size;
  }

  const porPessoa = Array.from(acc.values()).sort((a, b) => b.comissao - a.comissao);
  return { detalhes, porPessoa, totalFaturamento, totalComissao };
}
