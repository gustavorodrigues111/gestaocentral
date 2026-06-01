// Helpers de matching usados na aba "Compatibilidade de cadastros".
//
// O caso mais comum é fazer auto-match entre cadastros do Planejamento e da
// Sólides quando o nome é o mesmo (ignorando caixa, acento e espaços
// duplicados). Quando o normalizado bate exato e é único nos dois lados,
// o sistema grava o id da Sólides no doc do Planejamento.

// Normaliza nome pra comparação: minúsculo, sem acento, sem espaços extras.
export function normalizeNome(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}
