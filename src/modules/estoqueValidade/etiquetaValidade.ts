// Regras e layout da etiqueta de validade (Tipo A). Sem React: testável.
import type { BlocoEtiqueta } from "../../core/impressao/etiquetaTermica";

const pad = (n: number) => String(n).padStart(2, "0");
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export const dataBR = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
export const diaMes = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
export const hora = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const diaSemana = (d: Date) => DIAS[d.getDay()];
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Validade = data de manipulação + dias do método de conservação (dias corridos). */
export function validadeDe(manipulacao: Date, dias: number): Date {
  const v = new Date(manipulacao);
  v.setDate(v.getDate() + dias);
  return v;
}

/** Código do lote: AAMMDD-XXXX (data da manipulação + sufixo aleatório). */
export function novoCodigoLote(agora: Date, aleatorio: () => number = Math.random): string {
  const sufixo = aleatorio().toString(36).slice(2, 6).toUpperCase().padEnd(4, "0");
  return `${String(agora.getFullYear()).slice(2)}${pad(agora.getMonth() + 1)}${pad(agora.getDate())}-${sufixo}`;
}

export type DadosEtiquetaValidade = {
  produto: string; metodo: string; dias: number; manipulacao: Date; validade: Date; responsavel: string;
  lote: string; empresa: string; cnpj?: string | null; qr: string; codigo?: string | null;
};

/** Campos da RDC 216 (produto, manipulação, validade, responsável) + lote e QR. */
export function blocosValidade(d: DadosEtiquetaValidade): BlocoEtiqueta[] {
  return [
    ...(d.codigo ? [{ tipo: "codigo", texto: d.codigo } as BlocoEtiqueta] : []),
    { tipo: "rotulo", texto: d.metodo, direita: `${d.dias} ${d.dias === 1 ? "dia" : "dias"}` },
    { tipo: "titulo", texto: d.produto },
    { tipo: "colunas", colunas: [
      { rotulo: "Validade", valor: diaMes(d.validade), sub: `${diaSemana(d.validade)} · ${d.validade.getFullYear()}`, destaque: true },
      { rotulo: "Manipulado", valor: diaMes(d.manipulacao), sub: `${hora(d.manipulacao)} · ${d.manipulacao.getFullYear()}` },
    ] },
    { tipo: "rodapeQr", qr: d.qr, linhas: [d.responsavel, `Lote ${d.lote}`, d.empresa, d.cnpj || ""] },
  ];
}
