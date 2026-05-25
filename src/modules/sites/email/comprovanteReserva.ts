// Email de CONFIRMAÇÃO da reserva, enviado imediatamente após o cliente
// submeter o form público. A reserva já é considerada confirmada — esse
// email é o registro/comprovante.
//
// Nota sobre o "WhatsApp no dia": o restaurante pode (opcionalmente)
// reconfirmar presença pelo WhatsApp algumas horas antes da reserva, pra
// reduzir no-show. Isso é uma cortesia da casa, não um "vamos confirmar SE
// está confirmada". O email deixa isso claro pro cliente.
//
// IMPLEMENTAÇÃO: chama /api/send-email (Vercel route) que dispara via Resend.
// A escolha por Resend (não Firebase Extension) está documentada em
// api/send-email.ts — TL;DR: org policies do Workspace bloqueiam build da
// Cloud Function que a extension precisa.

import type { SiteConfig } from "../../../core/types";

type Args = {
  emailDestinatario: string;
  nomeDestinatario: string;
  // Dados da reserva pra renderizar no email
  data: string;                         // YYYY-MM-DD
  horario: string;                      // HH:MM
  pessoas: number;
  salaoNome?: string;
  ocasiao?: string;
  observacoes?: string;
  // Dados do restaurante pra branding
  restauranteNome: string;
  siteConfig: SiteConfig;
};

// Estrutura do email pronta pra enviar via QUALQUER transport. Não tem
// `from` — quem decide é a API route (`/api/send-email`) com base na
// env `RESEND_FROM_DEFAULT`, pra centralizar identidade do remetente.
export type EmailComprovanteReserva = {
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
};

// Constrói o payload de email a partir dos dados da reserva.
export function montarEmailComprovanteReserva(args: Args): EmailComprovanteReserva {
  const dataLegivel = formatarDataExtensa(args.data);
  const restNome = args.restauranteNome;
  const subject = `Reserva confirmada no ${restNome} — ${dataLegivel}, ${args.horario}`;

  const corPrimaria = args.siteConfig.tema?.corPrimaria || "#1a5c2a";
  const corFundo = args.siteConfig.tema?.corFundo || "#f7f3e9";
  const enderecoLinhas = montarEnderecoLinhas(args.siteConfig);
  const telefoneFmt = args.siteConfig.telefone ? formatarTelefonePtBR(args.siteConfig.telefone) : "";

  // Links de ação: WhatsApp pré-preenchido com os dados da reserva. Sem
  // telefone configurado, não renderiza os botões (não tem pra onde mandar).
  const waLinkAlterar = montarWaLink(args.siteConfig.telefone, restNome, "alterar", {
    dataLegivel, horario: args.horario, pessoas: args.pessoas, nome: args.nomeDestinatario,
  });
  const waLinkCancelar = montarWaLink(args.siteConfig.telefone, restNome, "cancelar", {
    dataLegivel, horario: args.horario, pessoas: args.pessoas, nome: args.nomeDestinatario,
  });
  const temBotoes = !!waLinkAlterar && !!waLinkCancelar;

  // HTML estilizado inline — clientes de email não aceitam <style> tags.
  // Estrutura: header colorido + bloco dados + observações + footer.
  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${corFundo};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,sans-serif;color:#1a1a1a;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <!-- Header -->
    <div style="background-color:${corPrimaria};padding:32px 24px;border-radius:12px 12px 0 0;text-align:center;color:#fff;">
      <div style="font-size:14px;letter-spacing:1px;text-transform:uppercase;opacity:0.85;">${escapeHtml(restNome)}</div>
      <div style="font-size:24px;font-weight:700;margin-top:8px;">✓ Reserva confirmada</div>
    </div>

    <!-- Corpo -->
    <div style="background-color:#fff;padding:24px;border-radius:0 0 12px 12px;border:1px solid rgba(0,0,0,0.08);border-top:none;">
      <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">
        Olá <strong>${escapeHtml(args.nomeDestinatario)}</strong>,
      </p>
      <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;">
        Sua reserva no <strong>${escapeHtml(restNome)}</strong> está <strong style="color:${corPrimaria};">confirmada</strong>. Te esperamos!
      </p>

      <!-- Detalhes -->
      <div style="background-color:${corFundo};padding:16px 20px;border-radius:8px;margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr>
            <td style="padding:6px 0;color:#666;width:90px;">📅 Data</td>
            <td style="padding:6px 0;font-weight:600;">${escapeHtml(dataLegivel)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#666;">⏰ Horário</td>
            <td style="padding:6px 0;font-weight:600;">${escapeHtml(args.horario)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#666;">👥 Pessoas</td>
            <td style="padding:6px 0;font-weight:600;">${args.pessoas}</td>
          </tr>
          ${args.salaoNome ? `
          <tr>
            <td style="padding:6px 0;color:#666;">🏛️ Salão</td>
            <td style="padding:6px 0;font-weight:600;">${escapeHtml(args.salaoNome)}</td>
          </tr>` : ""}
          ${args.ocasiao ? `
          <tr>
            <td style="padding:6px 0;color:#666;">🎉 Ocasião</td>
            <td style="padding:6px 0;font-weight:600;">${escapeHtml(args.ocasiao)}</td>
          </tr>` : ""}
        </table>
      </div>

      ${args.observacoes ? `
      <div style="margin-bottom:24px;">
        <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Suas observações</div>
        <div style="font-size:14px;line-height:1.5;color:#444;">${escapeHtml(args.observacoes)}</div>
      </div>` : ""}

      ${temBotoes ? `
      <!-- Botões de ação: Alterar / Cancelar via WhatsApp -->
      <div style="margin-bottom:20px;">
        <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Precisa mudar alguma coisa?</div>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;">
          <tr>
            <td style="padding-right:6px;width:50%;">
              <a href="${waLinkAlterar}" style="display:block;text-align:center;padding:12px 16px;background-color:${corPrimaria};color:${corFundo};text-decoration:none;font-size:14px;font-weight:600;border-radius:6px;">✎ Alterar</a>
            </td>
            <td style="padding-left:6px;width:50%;">
              <a href="${waLinkCancelar}" style="display:block;text-align:center;padding:12px 16px;background-color:#fff;color:#c44;text-decoration:none;font-size:14px;font-weight:600;border-radius:6px;border:1.5px solid #c44;">✕ Cancelar</a>
            </td>
          </tr>
        </table>
        <div style="font-size:11px;color:#999;margin-top:8px;text-align:center;">Os botões abrem o WhatsApp do restaurante.</div>
      </div>` : ""}

      <!-- Nota sobre WhatsApp opcional do restaurante -->
      <div style="border-left:3px solid ${corPrimaria};padding:10px 14px;background-color:${corPrimaria}10;border-radius:4px;font-size:13px;color:#444;margin-bottom:24px;line-height:1.5;">
        Algumas vezes entramos em contato pelo WhatsApp no dia da reserva
        pra reconfirmar sua presença — fica de olho!
      </div>

      <!-- Contato/endereço -->
      <div style="font-size:13px;color:#666;line-height:1.6;border-top:1px solid #eee;padding-top:16px;">
        ${enderecoLinhas ? `<div style="margin-bottom:8px;"><strong style="color:#1a1a1a;">${escapeHtml(restNome)}</strong><br>${enderecoLinhas}</div>` : ""}
        ${telefoneFmt ? `<div style="margin-bottom:4px;">📞 ${escapeHtml(telefoneFmt)}</div>` : ""}
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:16px;font-size:11px;color:#999;">
      Esse email é um comprovante automático da sua reserva.
    </div>
  </div>
</body>
</html>`.trim();

  // Versão texto puro pra clientes que bloqueiam HTML
  const text = [
    `${restNome} — Reserva confirmada ✓`,
    "",
    `Olá ${args.nomeDestinatario},`,
    "",
    `Sua reserva no ${restNome} está confirmada. Te esperamos!`,
    "",
    `Data: ${dataLegivel}`,
    `Horário: ${args.horario}`,
    `Pessoas: ${args.pessoas}`,
    args.salaoNome ? `Salão: ${args.salaoNome}` : "",
    args.ocasiao ? `Ocasião: ${args.ocasiao}` : "",
    args.observacoes ? `Observações: ${args.observacoes}` : "",
    "",
    temBotoes ? `Pra alterar: ${waLinkAlterar}` : "",
    temBotoes ? `Pra cancelar: ${waLinkCancelar}` : "",
    temBotoes ? "" : "",
    "Algumas vezes entramos em contato pelo WhatsApp no dia da reserva pra reconfirmar sua presença.",
    "",
    enderecoLinhas ? enderecoLinhas.replace(/<br>/g, "\n") : "",
    telefoneFmt ? `Telefone: ${telefoneFmt}` : "",
  ].filter(Boolean).join("\n");

  return {
    to: args.emailDestinatario,
    replyTo: args.siteConfig.emailContato || undefined,
    subject,
    html,
    text,
  };
}

// Dispara o email via Vercel route → Resend. Não joga exception em erro de
// rede — devolve { ok, error? } pra caller decidir se mostra no UI. Falha
// aqui NÃO deve bloquear a reserva (admin tem WhatsApp como canal primário
// e a reserva já foi gravada).
export async function enviarEmailComprovanteReserva(
  payload: EmailComprovanteReserva,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const resp = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: payload.to,
        replyTo: payload.replyTo,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      }),
    });
    const data = await resp.json().catch(() => ({} as Record<string, unknown>));
    if (!resp.ok) {
      const errMsg = typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : `HTTP ${resp.status}`;
      return { ok: false, error: errMsg };
    }
    const id = typeof (data as { id?: unknown }).id === "string"
      ? (data as { id: string }).id
      : "";
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "erro de rede" };
  }
}

// Monta link wa.me pré-preenchido pra alterar ou cancelar reserva. Retorna
// "" se não houver telefone configurado — caller checa antes de renderizar.
// DDI 55 é adicionado se número for BR (10/11 dígitos). Texto inclui dados
// da reserva pra atendente já saber qual é sem perguntar.
function montarWaLink(
  telefone: string | undefined,
  restNome: string,
  acao: "alterar" | "cancelar",
  ctx: { dataLegivel: string; horario: string; pessoas: number; nome: string },
): string {
  if (!telefone) return "";
  let d = telefone.replace(/\D/g, "");
  if (!d) return "";
  // Normaliza pra E.164 BR (55 + 10 ou 11 dígitos)
  if (d.length === 10 || d.length === 11) d = "55" + d;
  if (d.length < 12) return "";

  const verbo = acao === "alterar" ? "alterar" : "cancelar";
  const linhas = [
    `Olá! Quero ${verbo} minha reserva no ${restNome}.`,
    "",
    `Reserva no nome de ${ctx.nome}:`,
    `📅 ${ctx.dataLegivel}`,
    `⏰ ${ctx.horario}`,
    `👥 ${ctx.pessoas} ${ctx.pessoas === 1 ? "pessoa" : "pessoas"}`,
  ];
  const texto = linhas.join("\n");
  return `https://wa.me/${d}?text=${encodeURIComponent(texto)}`;
}

// Dom 25 de maio de 2026
function formatarDataExtensa(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function montarEnderecoLinhas(cfg: SiteConfig): string {
  const e = cfg.endereco;
  if (!e) return "";
  const linhas: string[] = [];
  if (e.rua) {
    const ruaNum = e.numero ? `${e.rua}, ${e.numero}` : e.rua;
    linhas.push(escapeHtml(ruaNum));
  }
  if (e.bairro || e.cidade || e.uf) {
    const local = [e.bairro, e.cidade, e.uf].filter(Boolean).join(" · ");
    linhas.push(escapeHtml(local));
  }
  return linhas.join("<br>");
}

// Formata phone BR pra exibição. Tira "+" e formata "+55 11 98765-4321"
// → "(11) 98765-4321". Sem código de país (10/11 dígitos) já direto.
function formatarTelefonePtBR(input: string): string {
  if (!input) return "";
  let d = input.replace(/\D/g, "");
  // Retira o 55 do início se for BR
  if (d.length === 13 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return input;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
