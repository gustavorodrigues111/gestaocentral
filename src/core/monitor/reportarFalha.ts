// Monitor de falhas (cliente). Reporta um erro pro backend, que persiste em
// falhasLog e dispara email pro master. Use nos pontos onde uma falha silenciosa
// prejudica alguém que você não consegue contatar (formulários públicos) ou em
// ações internas críticas (salvar fatura, fechar caixa).
//
// É best-effort e à prova de falha: NUNCA lança, nunca bloqueia o fluxo do
// usuário. Se o report falhar, engole o erro (o erro original já foi tratado
// pela tela que chamou).

type ExtraFalha = {
  restaurantId?: string;
  restauranteNome?: string;
  pessoaNome?: string;
  contexto?: string;      // ex.: dados do formulário, id do registro
};

export function reportarFalha(modulo: string, erro: unknown, extra: ExtraFalha = {}): void {
  try {
    const e = erro as { message?: unknown; code?: unknown } | null;
    const mensagem = (e && typeof e.message === "string" && e.message) || String(erro || "erro");
    const codigo = e && typeof e.code === "string" ? e.code : undefined;
    const payload = {
      modulo,
      mensagem,
      codigo,
      url: typeof location !== "undefined" ? location.href : undefined,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      ...extra,
    };
    // Não await: dispara e esquece. keepalive garante o envio mesmo se a página
    // navegar/fechar logo após.
    void fetch("/api/reportar-falha", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* monitor de falha nunca pode, ele mesmo, quebrar */
  }
}
