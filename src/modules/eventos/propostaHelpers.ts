// Helpers de Proposta de Evento
//
// Cria proposta a partir de um pacote-base (ou do zero pra personalizada),
// monta parcelas default por tipo de cliente (PF = 50/50, PJ = parcela única
// "à combinar"), e congela snapshot na hora de gravar.

import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type {
  AjusteProposta, EspacoEvento, LeadEvento, LinhaProposta, PacoteEvento,
  ParcelaProposta, PropostaEvento,
} from "../../core/types";
import { linhaPropostaTotal, pacoteValorTotal } from "../../core/types";

export type CriarPropostaParams = {
  lead: LeadEvento;
  pacote: PacoteEvento | null;
  espaco: EspacoEvento | null;
  // Editáveis pelo vendedor (defaults vêm do lead+pacote)
  numConvidados?: number;
  precoPorPessoaOverride?: number;
  ajustes?: AjusteProposta[];
  // Linhas customizáveis (locação fixa + itens por pessoa). Quando presente,
  // são a fonte do preço: total = base do pacote + Σ linhas.
  linhas?: LinhaProposta[];
  arredondamento?: number;           // ajuste manual pra fechar valor redondo
  parcelas?: ParcelaProposta[];      // override do 50/50 (sinal/saldo editados)
  observacoes?: string;
  criadoPorId: string;
};

// Calcula total da proposta dado pacote, pax, ajustes
export function calcularTotalProposta(
  precoPorPessoa: number,
  numConvidados: number,
  ajustes: AjusteProposta[],
): number {
  const base = precoPorPessoa * numConvidados;
  const totalAjustes = ajustes.reduce((s, a) => s + a.valor, 0);
  return Math.round((base + totalAjustes) * 100) / 100;
}

// Default de parcelas pra PF: 50% no ato + 50% 1 dia antes
export function parcelasDefaultPF(total: number, dataEvento: string): ParcelaProposta[] {
  const meio = Math.round((total / 2) * 100) / 100;
  const saldo = Math.round((total - meio) * 100) / 100;
  // Vencimento do saldo = 1 dia antes do evento
  const dt = new Date(dataEvento + "T12:00:00");
  dt.setDate(dt.getDate() - 1);
  const vencimentoSaldo = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  return [
    {
      ordem: 1,
      descricao: "Sinal — 50% no ato da reserva",
      valor: meio,
    },
    {
      ordem: 2,
      descricao: "Saldo — 50% até 1 dia antes do evento",
      valor: saldo,
      vencimentoEm: vencimentoSaldo,
    },
  ];
}

// Default pra PJ: parcela única "a combinar" (depende de contrato/nota fiscal)
export function parcelasDefaultPJ(total: number): ParcelaProposta[] {
  return [
    {
      ordem: 1,
      descricao: "Faturamento (contrato + nota fiscal)",
      valor: total,
    },
  ];
}

// Calcula próxima versão pra um lead (lista todas as propostas existentes)
export async function proximaVersaoProposta(leadId: string): Promise<number> {
  const q = query(collection(db, "propostasEvento"), where("leadId", "==", leadId));
  const snap = await getDocs(q);
  if (snap.empty) return 1;
  const versoes = snap.docs
    .map(d => (d.data() as PropostaEvento).versao || 0);
  return Math.max(0, ...versoes) + 1;
}

// Texto-snapshot da política de cancelamento (vai pra proposta)
export function politicaCancelamentoTexto(espaco: EspacoEvento | null): string {
  if (!espaco) return "Política de cancelamento: a combinar.";
  const faixas = [...espaco.politicaCancelamento.faixas]
    .sort((a, b) => b.diasAntesMin - a.diasAntesMin);
  const linhas = faixas.map(f => {
    if (f.diasAntesMin === 0) return `• Menos de 1 dia: ${f.percentDevolucao}% de devolução`;
    return `• ≥ ${f.diasAntesMin} dias antes: ${f.percentDevolucao}% de devolução`;
  });
  linhas.push(`• No-show (não comparecer): ${espaco.politicaCancelamento.noShowPercent}% de devolução`);
  return ["Cancelamento — devolução do sinal:", ...linhas].join("\n");
}

// Cria uma proposta nova ou nova versão de proposta de um lead.
// Retorna o doc gravado.
export async function criarProposta(params: CriarPropostaParams): Promise<PropostaEvento> {
  const { lead, pacote, espaco } = params;
  const pax = params.numConvidados ?? lead.numConvidados;
  // Override sempre ganha. Sem override:
  //  - pacote por pessoa → precoPorPessoa do pacote
  //  - pacote total_fixo → precoPorPessoa = 0 (valor inteiro vai no total via pacoteValorTotal)
  //  - pacote personalizado → 0 (vendedor preenche depois)
  const precoPorPessoa = params.precoPorPessoaOverride
    ?? (pacote && (pacote.precoModo || "por_pessoa") === "por_pessoa" ? pacote.precoPorPessoa : 0);
  const ajustes = params.ajustes || [];
  const linhas = params.linhas || [];
  const usaLinhas = linhas.length > 0;
  // Base = override*pax OU valor cheio do pacote (total_fixo) OU pacote por pessoa
  const baseDoPacote = pacote ? pacoteValorTotal(pacote, pax) : 0;
  const baseEfetiva = params.precoPorPessoaOverride != null
    ? params.precoPorPessoaOverride * pax
    : baseDoPacote;
  // Com linhas customizáveis: total = base do pacote (se houver) + Σ linhas.
  // Sem linhas: modelo legado (base + ajustes marcados).
  const arredondamento = Math.round((params.arredondamento || 0) * 100) / 100;
  const totalBase = usaLinhas
    ? baseDoPacote + linhas.reduce((s, l) => s + linhaPropostaTotal(l), 0)
    : baseEfetiva + ajustes.reduce((s, a) => s + a.valor, 0);
  const total = Math.round((totalBase + arredondamento) * 100) / 100;
  const versao = await proximaVersaoProposta(lead.id);
  const id = `prop_${lead.id}_v${versao}`;
  const now = new Date().toISOString();

  // Parcelas: usa as editadas (se vieram) — senão default 50/50 (PF) ou única (PJ).
  const parcelas = (params.parcelas && params.parcelas.length > 0)
    ? params.parcelas
    : lead.cliente.tipoPessoa === "PJ"
      ? parcelasDefaultPJ(total)
      : parcelasDefaultPF(total, lead.dataDesejada);

  const proposta: PropostaEvento = {
    id,
    restaurantId: lead.restaurantId,
    leadId: lead.id,
    versao,
    pacoteBaseId: pacote?.id,
    dataEvento: lead.dataDesejada,
    slot: lead.slot,
    horaInicio: lead.horaInicio || (lead.slot === "almoco" ? "12:00" : "19:00"),
    duracaoHoras: pacote?.duracaoHoras || 4,
    numConvidados: pax,
    // Snapshot dos PDFs no momento da proposta — se o admin trocar o
    // cardápio depois, o cliente ainda vê o que recebeu na mensagem.
    cardapios: pacote?.cardapios || [],
    inclusos: pacote?.inclusos || [],
    naoInclusos: pacote?.naoInclusos || [],
    ajustes,
    linhas: usaLinhas ? linhas : undefined,
    arredondamento: arredondamento || undefined,
    precoTotal: total,
    precoPorPessoa: usaLinhas ? 0 : precoPorPessoa,
    parcelas,
    politicaCancelamentoTexto: politicaCancelamentoTexto(espaco),
    observacoes: params.observacoes,
    createdAt: now,
    createdBy: params.criadoPorId,
  };
  await setDoc(doc(db, "propostasEvento", id), sanitizeForFirestore(proposta));
  return proposta;
}

// Mensagem-texto de proposta pra mandar via WhatsApp (sem PDF, primeira versão)
export function montarMensagemProposta(proposta: PropostaEvento, leadNome: string, restaurantNome: string): string {
  const data = new Date(proposta.dataEvento + "T12:00:00");
  const dataBR = `${String(data.getDate()).padStart(2, "0")}/${String(data.getMonth() + 1).padStart(2, "0")}/${data.getFullYear()}`;
  const slot = proposta.slot === "almoco" ? "almoço" : proposta.slot === "jantar" ? "jantar" : "dia inteiro";
  const linhas: string[] = [];
  linhas.push(`Oi ${leadNome.split(" ")[0]}, aqui está sua proposta:`);
  linhas.push("");
  linhas.push(`*Evento em ${restaurantNome}*`);
  linhas.push(`📅 ${dataBR} · ${slot}`);
  linhas.push(`👥 ${proposta.numConvidados} pessoas · ⏱ ${proposta.duracaoHoras}h`);
  linhas.push("");
  // Cardápios em PDF — manda os links direto no WhatsApp.
  if (proposta.cardapios && proposta.cardapios.length > 0) {
    linhas.push("*Cardápios*");
    for (const c of proposta.cardapios) {
      linhas.push(`📄 ${c.nome}: ${c.url}`);
    }
    linhas.push("");
  }
  if (proposta.inclusos.length > 0) {
    linhas.push("*Inclusos*: " + proposta.inclusos.map(i => `✓ ${i}`).join(", "));
    linhas.push("");
  }
  if (proposta.naoInclusos.length > 0) {
    linhas.push("*Não inclusos*: " + proposta.naoInclusos.join(", "));
    linhas.push("");
  }
  if (proposta.linhas && proposta.linhas.length > 0) {
    linhas.push("*Composição*");
    for (const l of proposta.linhas) {
      const tot = linhaPropostaTotal(l);
      const detalhe = l.tipo === "por_pessoa"
        ? ` (R$ ${l.valor.toFixed(2)}/pessoa × ${l.numPessoas || 0})`
        : " (valor fixo)";
      linhas.push(`• ${l.descricao}: R$ ${tot.toFixed(2)}${detalhe}`);
    }
    linhas.push("");
  } else if (proposta.ajustes.length > 0) {
    linhas.push("*Ajustes*");
    for (const a of proposta.ajustes) {
      linhas.push(`• ${a.descricao}: R$ ${a.valor.toFixed(2)}`);
    }
    linhas.push("");
  }
  linhas.push(`*Total: R$ ${proposta.precoTotal.toFixed(2)}*`);
  // Só mostra o "por pessoa" se tiver preço unitário definido — pacotes
  // de locação cheia gravam precoPorPessoa=0 e não fazem sentido linhar.
  if (proposta.precoPorPessoa > 0) {
    linhas.push(`(R$ ${proposta.precoPorPessoa.toFixed(2)} por pessoa)`);
  }
  linhas.push("");
  linhas.push("*Pagamento*");
  for (const p of proposta.parcelas) {
    linhas.push(`• ${p.descricao}: R$ ${p.valor.toFixed(2)}`);
  }
  linhas.push("");
  linhas.push(proposta.politicaCancelamentoTexto);
  return linhas.join("\n");
}

