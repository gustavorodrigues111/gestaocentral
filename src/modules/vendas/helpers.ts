// Helpers do módulo de Vendas.
import type { Venda, VendaCliente, VendaPagamento, VendaStatus } from "../../core/types";

// ─── Moeda ────────────────────────────────────────────────────────────────
// Máscara "centavos da direita": "1621" → "16,21"; "162100" → "1.621,00".
export function maskMoeda(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return (parseInt(digits, 10) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function parseMoeda(masked: string): number {
  const digits = (masked || "").replace(/\D/g, "");
  return digits ? parseInt(digits, 10) / 100 : 0;
}
export function fmtMoeda(n: number): string {
  return (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ─── Datas ──────────────────────────────────────────────────────────────
export function hojeYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Numeração sequencial ─────────────────────────────────────────────────
// "VENDA-2026-001" / "COB-2026-001" — sequencial por empresa e ano.
export function proximoNumero(prefixo: string, ano: number, numerosExistentes: string[]): string {
  const re = new RegExp(`^${prefixo}-${ano}-(\\d+)$`);
  let max = 0;
  for (const n of numerosExistentes) {
    const m = re.exec(n || "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefixo}-${ano}-${String(max + 1).padStart(3, "0")}`;
}

// ─── Cálculo de pago/saldo/status ──────────────────────────────────────────
export function calcPago(pagamentos: VendaPagamento[]): number {
  return Math.round(pagamentos.reduce((s, p) => s + (p.valor || 0), 0) * 100) / 100;
}
// Status derivado dos pagamentos. Preserva "cobranca_enviada" enquanto não quita.
export function statusDerivado(valorTotal: number, valorPago: number, cobrancaId?: string | null): VendaStatus {
  const saldo = Math.round((valorTotal - valorPago) * 100) / 100;
  if (saldo <= 0.005) return "quitada";
  return cobrancaId ? "cobranca_enviada" : "aberta";
}

// Recalcula os campos derivados de uma venda a partir dos pagamentos.
export function recomputarVenda(v: Venda): Venda {
  const valorPago = calcPago(v.pagamentos || []);
  const saldo = Math.round((v.valorTotal - valorPago) * 100) / 100;
  const status = statusDerivado(v.valorTotal, valorPago, v.cobrancaId);
  return {
    ...v,
    valorPago,
    saldo: saldo < 0 ? 0 : saldo,
    status,
    quitadoEm: status === "quitada" ? (v.quitadoEm || new Date().toISOString()) : null,
  };
}

// ─── Permuta interna: acha vendas recíprocas disponíveis ────────────────────
// Quitando a venda A (empresa X vende pro cliente-interno Y), as permutas
// disponíveis são as vendas ABERTAS em que Y é a vendedora e o cliente-interno
// é X — ou seja, o que X "comprou" de Y e ainda deve.
export function vendasReciprocasDisponiveis(
  vendaA: Venda,
  todasVendas: Venda[],
): Venda[] {
  if (vendaA.clienteTipo !== "interna" || !vendaA.clienteRestauranteVinculadoId) return [];
  const empresaX = vendaA.restaurantId;               // vendedora de A
  const empresaY = vendaA.clienteRestauranteVinculadoId; // cliente interno de A
  return todasVendas.filter(v =>
    v.id !== vendaA.id
    && v.restaurantId === empresaY                    // Y é a vendedora
    && v.clienteTipo === "interna"
    && v.clienteRestauranteVinculadoId === empresaX   // cliente interno = X
    && v.status !== "quitada"
    && v.saldo > 0.005,
  );
}

// ─── Mensagem de cobrança (WhatsApp) ────────────────────────────────────────
export function montarMensagemCobranca(
  empresaVendedora: string,
  cliente: VendaCliente | null,
  vendas: Venda[],
): string {
  const nomeCli = cliente?.nome || vendas[0]?.clienteNomeSnapshot || "";
  const linhas: string[] = [];
  linhas.push(`Olá${nomeCli ? `, ${nomeCli.split(" ")[0]}` : ""}! Segue a cobrança referente a ${empresaVendedora}:`);
  linhas.push("");
  let total = 0;
  for (const v of vendas) {
    const saldo = v.saldo > 0 ? v.saldo : v.valorTotal;
    total += saldo;
    const dataBr = v.data ? v.data.split("-").reverse().join("/") : "";
    const resumo = v.itens?.map(i => i.descricao).filter(Boolean).slice(0, 3).join(", ");
    linhas.push(`• ${v.numero}${dataBr ? ` (${dataBr})` : ""}: ${fmtMoeda(saldo)}${resumo ? ` — ${resumo}` : ""}`);
  }
  linhas.push("");
  linhas.push(`*Total: ${fmtMoeda(Math.round(total * 100) / 100)}*`);
  return linhas.join("\n");
}
