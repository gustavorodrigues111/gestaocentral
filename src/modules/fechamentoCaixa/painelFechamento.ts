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

// HTML do e-mail (inline styles, à prova de cliente de e-mail). Barras via tabela.
export function painelEmailHtml(d: PainelDados, restaurantNome: string): string {
  const max = Math.max(1, ...d.ultimos7.map((x) => x.total));
  const barras = d.ultimos7.map((x) => {
    const pct = Math.round((x.total / max) * 100);
    const hoje = x.ymd === d.refData;
    return `<tr>
      <td style="padding:4px 8px;font:13px -apple-system,Segoe UI,Roboto,sans-serif;color:#475569;white-space:nowrap;${hoje ? "font-weight:700;color:#4f46e5;" : ""}">${fmtDiaCurto(x.ymd)}</td>
      <td style="padding:4px 8px;width:100%;">
        <div style="background:#eef2ff;border-radius:6px;overflow:hidden;">
          <div style="background:${hoje ? "#4f46e5" : "#a5b4fc"};height:18px;width:${pct}%;border-radius:6px;"></div>
        </div>
      </td>
      <td style="padding:4px 8px;font:13px -apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;font-weight:600;white-space:nowrap;text-align:right;">${fmtBRLp(x.total)}</td>
    </tr>`;
  }).join("");
  const card = (label: string, valor: string, cor: string) =>
    `<td style="padding:6px;"><div style="background:${cor};border-radius:12px;padding:14px 16px;">
      <div style="font:11px -apple-system,Segoe UI,Roboto,sans-serif;text-transform:uppercase;letter-spacing:.5px;color:rgba(255,255,255,.85);">${label}</div>
      <div style="font:22px -apple-system,Segoe UI,Roboto,sans-serif;font-weight:800;color:#fff;margin-top:2px;">${valor}</div>
    </div></td>`;
  return `<div style="max-width:560px;margin:0 auto;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
    <h2 style="font-size:18px;color:#0f172a;margin:0 0 2px;">📊 Faturamento — ${restaurantNome}</h2>
    <div style="font-size:13px;color:#64748b;margin-bottom:14px;">Referência: ${fmtDiaCurto(d.refData)} · ${d.mesLabel}</div>
    <table role="presentation" width="100%" style="border-collapse:collapse;"><tr>
      ${card("Faturamento do dia", fmtBRLp(d.diaTotal), "#4f46e5")}
      ${card(`Últimos ${d.ultimos7.length} dia(s)`, fmtBRLp(d.total7), "#0ea5e9")}
      ${card("Total do mês", fmtBRLp(d.mesTotal), "#10b981")}
    </tr></table>
    <div style="font:12px -apple-system,Segoe UI,Roboto,sans-serif;font-weight:700;color:#334155;margin:18px 0 6px;">Últimos ${d.ultimos7.length} dia(s)</div>
    <table role="presentation" width="100%" style="border-collapse:collapse;">${barras}</table>
    <div style="font-size:11px;color:#94a3b8;margin-top:16px;">Resumo automático do fechamento de caixa · planejamento.app</div>
  </div>`;
}
