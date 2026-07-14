// Guarda global de "alterações não salvas". Uma tela registra um check (ex: a
// classificação de fatura quando está com edições pendentes); qualquer ponto de
// saída (troca de aba, chips, menu lateral, troca de restaurante) chama
// confirmarSaida() antes de navegar. Simples de propósito — um check por vez.
let check: (() => boolean) | null = null;

export function setUnsavedCheck(fn: (() => boolean) | null): void {
  check = fn;
}
export function temNaoSalvo(): boolean {
  try { return !!check && check(); } catch { return false; }
}
export function confirmarSaida(
  msg = "Você tem alterações não salvas que serão perdidas se sair agora. Deseja continuar mesmo assim?"
): boolean {
  return !temNaoSalvo() || window.confirm(msg);
}
