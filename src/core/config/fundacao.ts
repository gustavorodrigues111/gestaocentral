// Data de "fundação do sistema": o Portal do Empregado não mostra nenhuma
// informação (escala, gorjetas, comunicados) anterior a esta data, nem deixa
// navegar pra meses antes dela. Serve pra não expor histórico pré-adoção.
//
// Global por ora. Se um dia precisar variar por empresa, vira config em
// `restaurants/{id}`.
export const DATA_FUNDACAO = "2026-05-01"; // YYYY-MM-DD
export const AM_FUNDACAO = DATA_FUNDACAO.slice(0, 7); // "2026-05"

// true se (ano,mes) é anterior ao mês de fundação.
export function mesAntesDaFundacao(ano: number, mes: number): boolean {
  return `${ano}-${String(mes).padStart(2, "0")}` < AM_FUNDACAO;
}
