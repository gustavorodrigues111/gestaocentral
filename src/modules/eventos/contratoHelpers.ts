// Gerador do TEXTO do contrato de evento (modelo aprovado pelo usuário).
// 3 quadros preenchidos com os dados (contratante/contratada/evento+proposta)
// + cláusulas gerais fixas. Retorna markdown-ish editável; o PDF é renderizado
// a partir deste texto (api/contrato-pdf).
import type { LeadEvento, PropostaEvento, Restaurant } from "../../core/types";

const fmtBRL = (n: number) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
function dBR(ymd?: string): string { const m = (ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : "—"; }
function duracaoTxt(h?: number): string {
  if (!h) return "—";
  return Number.isInteger(h) ? `${h}h` : `${Math.floor(h)}h${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
}

export type OpcoesContrato = { encerramento?: string };

export function montarContratoTexto(lead: LeadEvento, proposta: PropostaEvento | null, restaurant: Restaurant | null, opc: OpcoesContrato = {}): string {
  const c = lead.cliente;
  const dc = restaurant?.eventosConfig?.dadosContratada || {};
  const encerramento = (opc.encerramento || "23h").trim();

  // QUADRO I — Contratante
  const contratante = c.tipoPessoa === "PJ"
    ? [
        `Razão social: ${c.razaoSocial || "—"}`,
        `CNPJ: ${c.cnpj || "—"}`,
        `Endereço: ${c.endereco || "—"}`,
        `Representante legal: ${c.representanteLegal?.nome || "—"}${c.representanteLegal?.cpf ? ` (CPF ${c.representanteLegal.cpf})` : ""}`,
        `Contato: ${c.whatsapp || "—"}${c.email ? ` · ${c.email}` : ""}`,
      ]
    : [
        `Nome: ${c.nome || "—"}`,
        `CPF: ${c.cpf || "—"}`,
        `Endereço: ${c.endereco || "—"}`,
        `Contato: ${c.whatsapp || "—"}${c.email ? ` · ${c.email}` : ""}`,
      ];

  // QUADRO II — Contratada (a casa)
  const contratada = [
    `Razão social: ${dc.razaoSocial || restaurant?.nome || "—"}`,
    `CNPJ: ${dc.cnpj || "—"}`,
    `Endereço: ${dc.endereco || "—"}`,
    `Representante: ${dc.representanteNome || "—"}${dc.representanteCpf ? ` (CPF ${dc.representanteCpf})` : ""}`,
  ];

  // QUADRO III — Evento + proposta (dados do LEAD atual + preço da proposta)
  const slot = lead.slot === "almoco" ? "Almoço" : "Jantar";
  const horario = lead.horaInicio ? `${lead.horaInicio}${lead.horaFim ? `–${lead.horaFim}` : ""}` : "—";
  const formato = lead.modeloEvento === "locacao_consumo_livre" ? "Locação (consumo em comanda)" : "Pacote por pessoa";
  const linhas = (proposta?.linhas || []).map((l) => {
    const tot = l.tipo === "por_pessoa" ? (l.valor || 0) * (l.numPessoas || proposta?.numConvidados || 0) : (l.valor || 0);
    const desc = l.tipo === "por_pessoa" ? `${l.descricao} (${fmtBRL(l.valor)}/pessoa × ${l.numPessoas || proposta?.numConvidados || 0})` : l.descricao;
    return `  • ${desc}: ${fmtBRL(tot)}`;
  });
  const total = proposta ? fmtBRL(proposta.precoTotal) : "—";
  const parcelas = (proposta?.parcelas || []).map((p) => `  • ${p.descricao}: ${fmtBRL(p.valor)}${p.vencimentoEm ? ` (vence ${dBR(p.vencimentoEm)})` : ""}`);
  const nConv = lead.numConvidados ?? proposta?.numConvidados ?? "—";
  const dur = duracaoTxt(lead.duracaoEstimadaHoras || proposta?.duracaoHoras);

  const evento = [
    `Data: ${dBR(lead.dataDesejada)}`,
    `Período: ${slot}`,
    `Horário: ${horario} (duração prevista de consumo: ${dur})`,
    `Espaço: ${lead.espacoId ? "conforme combinado" : "—"}`,
    `Nº de convidados: até ${nConv}`,
    `Formato: ${formato}`,
    "",
    "Itens e valores:",
    ...(linhas.length ? linhas : ["  • —"]),
    `Total: ${total}`,
    "",
    "Forma de pagamento:",
    ...(parcelas.length ? parcelas : ["  • 50% de sinal na assinatura + 50% de saldo até 1 dia antes do evento"]),
  ];

  const clausulas = [
    `**1. Objeto.** A CONTRATADA prestará os serviços do evento descrito no Quadro III, no espaço e data ali indicados.`,
    `**2. Preço e pagamento.** O valor total é o do Quadro III, pago na forma ali prevista. O sinal confirma a reserva da data; sem o pagamento do sinal, a data não fica bloqueada.`,
    `**3. Data, horário, duração e consumo.** O evento ocorre na data e horário do Quadro III, com tempo de consumo previsto de ${dur}. O consumo incluído no pacote aplica-se estritamente dentro desse tempo. Há tolerância de 30 (trinta) minutos para início/encerramento. Havendo disponibilidade, a CONTRATADA poderá permitir que os convidados permaneçam além do tempo previsto, sem qualquer cobrança adicional pelo uso do espaço; porém todo consumo (comidas e bebidas) que ultrapassar o tempo do pacote será cobrado à parte, pelos preços de cardápio vigentes.`,
    `**4. Número de convidados.** O pacote é contratado para até ${nConv} convidados. Não haverá devolução nem ajuste de valor caso compareçam menos pessoas que o contratado, pois a estrutura já está preparada para o número fechado. A CONTRATADA se empenha em atender convidados além do número contratado, havendo condições; nesse caso, cada pessoa adicional será cobrada pelo valor por pessoa vigente.`,
    `**5. Cancelamento e reembolso.** Em caso de cancelamento pelo CONTRATANTE: com 30 (trinta) dias ou mais de antecedência, devolução de 100% do sinal; com 14 (quatorze) dias ou mais, 75%; com 7 (sete) dias ou mais, 50%; com menos de 7 (sete) dias ou em caso de não comparecimento, sem devolução.`,
    `**6. Alterações.** Mudança de data, cardápio ou espaço é possível mediante disponibilidade e pode impactar o valor, devendo ser acordada por escrito entre as partes (WhatsApp ou e-mail).`,
    `**7. Caso fortuito e força maior.** Eventos em área externa poderão ser remanejados para área interna em caso de chuva ou mau tempo. Impedimentos por força maior (interdição, determinação de autoridade e afins) permitem remarcação sem ônus para as partes.`,
    `**8. Responsabilidade e danos.** O CONTRATANTE responde por danos ao espaço, mobiliário e equipamentos causados por ele ou por seus convidados, obrigando-se à respectiva reparação.`,
    `**9. Encerramento e vizinhança.** O evento encerra às ${encerramento}. Os níveis de som respeitarão a legislação local e o sossego da vizinhança.`,
    `**10. Disposições gerais e foro.** Os casos omissos serão resolvidos de comum acordo entre as partes. Fica eleito o foro da comarca da sede da CONTRATADA para dirimir eventuais controvérsias.`,
    `**11. Assinaturas.** As partes assinam este instrumento eletronicamente, por meio da plataforma ClickSign, para todos os fins de direito.`,
  ];

  return [
    "# CONTRATO DE PRESTAÇÃO DE SERVIÇOS PARA EVENTO",
    "",
    "## QUADRO I — CONTRATANTE",
    ...contratante,
    "",
    "## QUADRO II — CONTRATADA",
    ...contratada,
    "",
    "## QUADRO III — DO EVENTO E DA PROPOSTA",
    ...evento,
    "",
    "## CLÁUSULAS",
    ...clausulas,
    "",
    `Local e data: ______________________, ${dBR(new Date().toISOString().slice(0, 10))}`,
    "",
    "_____________________________________",
    `CONTRATANTE — ${c.tipoPessoa === "PJ" ? (c.representanteLegal?.nome || c.razaoSocial || c.nome) : c.nome}`,
    "",
    "_____________________________________",
    `CONTRATADA — ${dc.representanteNome || dc.razaoSocial || restaurant?.nome || ""}`,
  ].join("\n");
}
