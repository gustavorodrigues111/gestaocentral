// Email de comprovante da reserva, enviado imediatamente após o cliente
// submeter o form público. NÃO é a confirmação (essa é outra etapa, feita
// pelo admin por WhatsApp ~2h antes). Esse aqui é só o "recibo" que o
// cliente tem como garantia/registro.
//
// Implementação: escreve doc em /mail. A Firebase Extension "Trigger
// Email from Firestore" lê esse doc e dispara o email via SMTP
// (configurado com Gmail Workspace).

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

export type EmailMailDoc = {
  to: string;
  replyTo?: string;
  message: {
    subject: string;
    html: string;
    text?: string;          // versão sem HTML (clientes que bloqueiam)
  };
};

// Constrói o doc /mail que a Firebase Extension vai enviar.
export function montarEmailComprovanteReserva(args: Args): EmailMailDoc {
  const dataLegivel = formatarDataExtensa(args.data);
  const restNome = args.restauranteNome;
  const subject = `Recebemos sua reserva no ${restNome} — ${dataLegivel}, ${args.horario}`;

  const corPrimaria = args.siteConfig.tema?.corPrimaria || "#1a5c2a";
  const corFundo = args.siteConfig.tema?.corFundo || "#f7f3e9";
  const enderecoLinhas = montarEnderecoLinhas(args.siteConfig);
  const telefoneFmt = args.siteConfig.telefone ? formatarTelefonePtBR(args.siteConfig.telefone) : "";

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
      <div style="font-size:24px;font-weight:700;margin-top:8px;">Recebemos sua reserva</div>
    </div>

    <!-- Corpo -->
    <div style="background-color:#fff;padding:24px;border-radius:0 0 12px 12px;border:1px solid rgba(0,0,0,0.08);border-top:none;">
      <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">
        Olá <strong>${escapeHtml(args.nomeDestinatario)}</strong>,
      </p>
      <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;">
        Este é o comprovante da sua reserva no <strong>${escapeHtml(restNome)}</strong>.
        Em breve confirmaremos pelo WhatsApp se a reserva está confirmada — esse
        email é só o registro inicial.
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

      <!-- Status -->
      <div style="border-left:3px solid ${corPrimaria};padding:10px 14px;background-color:${corPrimaria}10;border-radius:4px;font-size:13px;color:#444;margin-bottom:24px;">
        <strong>Status:</strong> aguardando confirmação. Te avisamos pelo WhatsApp algumas horas antes pra confirmar.
      </div>

      <!-- Contato/endereço -->
      <div style="font-size:13px;color:#666;line-height:1.6;border-top:1px solid #eee;padding-top:16px;">
        ${enderecoLinhas ? `<div style="margin-bottom:8px;"><strong style="color:#1a1a1a;">${escapeHtml(restNome)}</strong><br>${enderecoLinhas}</div>` : ""}
        ${telefoneFmt ? `<div style="margin-bottom:4px;">📞 ${escapeHtml(telefoneFmt)}</div>` : ""}
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:16px;font-size:11px;color:#999;">
      Esse email é só um comprovante automático. Pra alterar ou cancelar a reserva,
      ${telefoneFmt ? `fale com a gente pelo WhatsApp` : `entre em contato pelo site`}.
    </div>
  </div>
</body>
</html>`.trim();

  // Versão texto puro pra clientes que bloqueiam HTML
  const text = [
    `${restNome} — Recebemos sua reserva`,
    "",
    `Olá ${args.nomeDestinatario},`,
    "",
    `Este é o comprovante da sua reserva no ${restNome}.`,
    `Em breve confirmaremos pelo WhatsApp.`,
    "",
    `Data: ${dataLegivel}`,
    `Horário: ${args.horario}`,
    `Pessoas: ${args.pessoas}`,
    args.salaoNome ? `Salão: ${args.salaoNome}` : "",
    args.ocasiao ? `Ocasião: ${args.ocasiao}` : "",
    args.observacoes ? `Observações: ${args.observacoes}` : "",
    "",
    "Status: aguardando confirmação",
    "",
    enderecoLinhas ? enderecoLinhas.replace(/<br>/g, "\n") : "",
    telefoneFmt ? `Telefone: ${telefoneFmt}` : "",
  ].filter(Boolean).join("\n");

  return {
    to: args.emailDestinatario,
    replyTo: args.siteConfig.emailContato || undefined,
    message: { subject, html, text },
  };
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
