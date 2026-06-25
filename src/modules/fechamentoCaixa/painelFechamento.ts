// Painel de faturamento do Fechamento de Caixa — dados + HTML do e-mail.
// Usado pela aba "Painel" (in-app) e espelhado no e-mail aos sócios.
import type { FechamentoCaixa } from "../../core/types";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const fmtBRLp = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const fmtDiaCurto = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const nomeMesAno = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1] || ""}/${ym.slice(0, 4)}`;

export type PainelDados = {
  refData: string;          // YYYY-MM-DD (dia de referência: hoje ou o fechamento)
  diaTotal: number;         // faturamento do dia de referência (soma dos turnos)
  ultimos7: { ymd: string; total: number }[]; // até 7 dias com fechamento, ordem crescente
  mesTotal: number;         // soma do mês corrente do refData
  mesLabel: string;         // "junho/2026"
  total7: number;           // soma dos últimos 7 dias com faturamento
};

type FechMin = Pick<FechamentoCaixa, "data" | "turno" | "totalVendas" | "excluidoEm">;

export function montarPainel(fechamentos: FechMin[], refData: string): PainelDados {
  const porDia = new Map<string, number>();
  for (const f of fechamentos) {
    if (f.excluidoEm) continue;
    porDia.set(f.data, (porDia.get(f.data) || 0) + (f.totalVendas || 0));
  }
  const diaTotal = porDia.get(refData) || 0;
  const diasAteRef = [...porDia.keys()].filter((d) => d <= refData).sort();
  const ultimos7 = diasAteRef.slice(-7).map((ymd) => ({ ymd, total: porDia.get(ymd) || 0 }));
  const total7 = ultimos7.reduce((s, x) => s + x.total, 0);
  const ym = refData.slice(0, 7);
  const diasDoMes = [...porDia.entries()].filter(([d]) => d.startsWith(ym));
  const mesTotal = diasDoMes.reduce((s, [, v]) => s + v, 0);
  return { refData, diaTotal, ultimos7, mesTotal, mesLabel: nomeMesAno(ym), total7 };
}

// Destaque do e-mail: o fechamento (turno) que acabou de ser registrado.
export type DestaqueFechamento = {
  titulo: string;     // "Venda do almoço · quinta, 25/06"
  valor: number;      // faturamento desse turno
};

// HTML do e-mail (inline styles, à prova de cliente de e-mail). O turno recém
// fechado vem em destaque grande (hero); dia/semana/mês entram como cards menores.
export function painelEmailHtml(d: PainelDados, restaurantNome: string, destaque?: DestaqueFechamento): string {
  const FONT = "-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
  const max = Math.max(1, ...d.ultimos7.map((x) => x.total));

  // Hero — o turno recém fechado, em destaque máximo.
  const hero = destaque
    ? `<div style="background:#4f46e5;background:linear-gradient(135deg,#4f46e5,#6366f1);border-radius:20px;padding:24px 26px;margin:6px 0 4px;">
        <div style="font:700 13px ${FONT};text-transform:uppercase;letter-spacing:.7px;color:rgba(255,255,255,.9);">${destaque.titulo}</div>
        <div style="font:800 42px ${FONT};color:#fff;margin-top:6px;line-height:1.02;">${fmtBRLp(destaque.valor)}</div>
      </div>`
    : `<div style="background:#4f46e5;border-radius:20px;padding:22px 26px;margin:6px 0 4px;">
        <div style="font:700 13px ${FONT};text-transform:uppercase;letter-spacing:.7px;color:rgba(255,255,255,.9);">Faturamento do dia · ${fmtDiaCurto(d.refData)}</div>
        <div style="font:800 42px ${FONT};color:#fff;margin-top:6px;line-height:1.02;">${fmtBRLp(d.diaTotal)}</div>
      </div>`;

  // Cards secundários menores (lado a lado).
  const cardSm = (label: string, valor: string, cor: string) =>
    `<td width="33.33%" style="padding:5px;vertical-align:top;">
      <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:12px 14px;">
        <div style="font:600 10px ${FONT};text-transform:uppercase;letter-spacing:.4px;color:#64748b;line-height:1.3;">${label}</div>
        <div style="font:800 18px ${FONT};color:${cor};margin-top:4px;line-height:1.1;">${valor}</div>
      </div>
    </td>`;

  // Linha de barra dentro do card branco.
  const barras = d.ultimos7.map((x) => {
    const pct = Math.round((x.total / max) * 100);
    const hoje = x.ymd === d.refData;
    return `<tr>
      <td style="padding:6px 8px 6px 0;font:${hoje ? "700" : "400"} 14px ${FONT};color:${hoje ? "#4f46e5" : "#64748b"};white-space:nowrap;vertical-align:middle;">${fmtDiaCurto(x.ymd)}</td>
      <td style="padding:6px 8px;width:100%;vertical-align:middle;">
        <div style="background:#eef2ff;border-radius:8px;overflow:hidden;height:22px;">
          <div style="background:${hoje ? "#4f46e5" : "#a5b4fc"};height:22px;width:${pct}%;border-radius:8px;"></div>
        </div>
      </td>
      <td style="padding:6px 0 6px 8px;font:700 15px ${FONT};color:#0f172a;white-space:nowrap;text-align:right;vertical-align:middle;">${fmtBRLp(x.total)}</td>
    </tr>`;
  }).join("");

  return `<div style="max-width:600px;margin:0 auto;padding:8px;font-family:${FONT};background:#f8fafc;">
    <div style="padding:6px 4px 0;">
      <div style="font:800 20px ${FONT};color:#0f172a;margin:0 0 2px;">📊 Faturamento — ${restaurantNome}</div>
      <div style="font:400 14px ${FONT};color:#64748b;margin-bottom:6px;">${d.mesLabel}</div>
    </div>
    ${hero}
    <table role="presentation" width="100%" style="border-collapse:collapse;margin-top:2px;">
      <tr>
        ${cardSm("Total do dia", fmtBRLp(d.diaTotal), "#4f46e5")}
        ${cardSm(`Últimos ${d.ultimos7.length} dia(s)`, fmtBRLp(d.total7), "#0ea5e9")}
        ${cardSm("Total do mês", fmtBRLp(d.mesTotal), "#10b981")}
      </tr>
    </table>
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:18px;margin-top:12px;">
      <div style="font:700 15px ${FONT};color:#334155;margin-bottom:10px;">Últimos ${d.ultimos7.length} dia(s)</div>
      <table role="presentation" width="100%" style="border-collapse:collapse;">${barras}</table>
    </div>
    <div style="font:400 12px ${FONT};color:#94a3b8;margin:14px 4px 4px;">Resumo automático do fechamento de caixa · planejamento.app</div>
  </div>`;
}
