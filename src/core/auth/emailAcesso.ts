// Envia o email de convite de acesso (senha inicial + link). Usa /api/send-email
// (Resend). Email não tem as travas de template da Meta — é o canal certo pra
// entregar credencial de primeiro acesso.
export async function enviarEmailAcesso(to: string, nome: string, email: string, senha: string, loginUrl: string): Promise<boolean> {
  const nomePrimeiro = (nome || "").split(/\s+/)[0] || "";
  const subject = "Seu acesso ao sistema de gestão";
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;color:#111827">
      <p style="font-size:16px">Oi ${escapeHtml(nomePrimeiro)}! 👋</p>
      <p>Seu acesso ao nosso sistema de gestão já está pronto. Use os dados abaixo pra entrar:</p>
      <div style="background:#f3f4f6;border-radius:10px;padding:14px 16px;margin:14px 0">
        <p style="margin:0 0 6px"><b>🔗 Link:</b> <a href="${escapeAttr(loginUrl)}">${escapeHtml(loginUrl)}</a></p>
        <p style="margin:0 0 6px"><b>📧 Email:</b> ${escapeHtml(email)}</p>
        <p style="margin:0"><b>🔑 Senha inicial:</b> <code style="background:#fff;padding:2px 6px;border-radius:4px">${escapeHtml(senha)}</code></p>
      </div>
      <p>No <b>primeiro acesso</b> o sistema vai pedir pra você confirmar o CPF e criar uma nova senha.</p>
      <p style="color:#6b7280;font-size:13px">Se você não esperava este email, pode ignorar.</p>
    </div>`;
  const text = `Oi ${nomePrimeiro}! Seu acesso ao sistema de gestão está pronto.\nLink: ${loginUrl}\nEmail: ${email}\nSenha inicial: ${senha}\nNo primeiro acesso, confirme seu CPF e crie uma nova senha.`;
  try {
    const r = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, html, text }),
    });
    return r.ok;
  } catch { return false; }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
function escapeAttr(s: string): string { return escapeHtml(s); }
