// ════════════════════════════════════════════════════════════════════════════
//  Export único de Benefícios pro Caju (1 CSV, 1 upload)
//
//  Template completo do Caju (mesmo do VR). Por empregado, preenche:
//    • Mobilidade (col 8)  = VT + auxílio fixo  (se vtRecebePeloCaju)
//    • Refeição   (col 3)  = VR                 (se vrRecebePeloCaju)
//  Cada benefício respeita seu próprio "recebe pelo Caju": quem recebe por PIX
//  fica de fora daquela coluna e entra em "ignoradas" pra lembrar do manual.
// ════════════════════════════════════════════════════════════════════════════

import type { BeneficiosLote, Empregado } from "../../core/types";
import { pad2 } from "../../core/utils/date";

function onlyDigits(s: string | null | undefined): string {
  return (s || "").replace(/\D/g, "");
}

export type LinhaIgnorada = { nome: string; motivo: string; total: number };

export type ExportBeneficiosResult = {
  csv: string;
  filename: string;
  qtdLinhasOk: number;       // empregados que entraram no CSV
  totalMobilidade: number;
  totalRefeicao: number;
  totalValor: number;        // mobilidade + refeição
  ignoradas: LinhaIgnorada[];
};

const HEADER_CAJU = [
  "CPF", "Centro de Custo",
  "Valor fixo em Auxílio Alimentação",
  "Refeição", "Valor fixo em refeição",
  "Alimentação", "Valor fixo em alimentação",
  "Valor fixo em Vale Transporte",
  "Mobilidade", "Valor fixo em mobilidade",
  "Cultura", "Valor fixo em cultura",
  "Saúde", "Valor fixo em saúde",
  "Educação", "Valor fixo em educação",
  "Home Office", "Valor fixo em home office",
  "Saldo Livre", "Multi",
].join(";");

const COL_REFEICAO = 3;
const COL_MOBILIDADE = 8;
const NUM_COLUNAS = 20;

function brl(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

export function exportarBeneficiosCaju(params: {
  lote: BeneficiosLote;
  empregados: Empregado[];
  restaurantSlug: string;
}): ExportBeneficiosResult {
  const { lote, empregados, restaurantSlug } = params;
  const empMap = Object.fromEntries(empregados.map((e) => [e.id, e]));

  const linhasOut: string[] = [HEADER_CAJU];
  const ignoradas: LinhaIgnorada[] = [];
  let totalMobilidade = 0;
  let totalRefeicao = 0;
  let qtdLinhasOk = 0;

  for (const l of lote.linhas) {
    const emp = empMap[l.empregadoId];
    const cpfDigits = onlyDigits(emp?.cpf);

    const vtVal = l.vt?.total || 0;
    const vrVal = l.vr?.total || 0;

    // CPF inválido → ignora a pessoa inteira (Caju casa por CPF).
    if (!cpfDigits || cpfDigits.length !== 11) {
      if (vtVal > 0 || vrVal > 0) {
        ignoradas.push({
          nome: l.nome,
          motivo: "CPF inválido ou ausente no cadastro",
          total: vtVal + vrVal,
        });
      }
      continue;
    }

    // Mobilidade (VT + aux fixo) — só se recebe pelo Caju e tem valor.
    let mobil = 0;
    if (vtVal > 0) {
      if (l.vtRecebePeloCaju) mobil = vtVal;
      else ignoradas.push({ nome: l.nome, motivo: `VT R$ ${brl(vtVal)} por PIX — pagar manualmente`, total: vtVal });
    }
    // Refeição (VR) — idem.
    let refei = 0;
    if (vrVal > 0) {
      if (l.vrRecebePeloCaju) refei = vrVal;
      else ignoradas.push({ nome: l.nome, motivo: `VR R$ ${brl(vrVal)} por PIX — pagar manualmente`, total: vrVal });
    }

    if (mobil <= 0 && refei <= 0) continue; // nada pro Caju nessa linha

    const cols = new Array(NUM_COLUNAS).fill("0");
    cols[0] = cpfDigits;
    cols[1] = "";
    if (refei > 0) cols[COL_REFEICAO] = brl(refei);
    if (mobil > 0) cols[COL_MOBILIDADE] = brl(mobil);
    linhasOut.push(cols.join(";"));

    totalMobilidade += mobil;
    totalRefeicao += refei;
    qtdLinhasOk++;
  }

  const csv = "﻿" + linhasOut.join("\r\n") + "\r\n";
  const filename = `beneficios-caju-${restaurantSlug}-${lote.ano}-${pad2(lote.mes)}.csv`;

  return {
    csv,
    filename,
    qtdLinhasOk,
    totalMobilidade: Math.round(totalMobilidade * 100) / 100,
    totalRefeicao: Math.round(totalRefeicao * 100) / 100,
    totalValor: Math.round((totalMobilidade + totalRefeicao) * 100) / 100,
    ignoradas,
  };
}

export function baixarCsvBeneficios(result: ExportBeneficiosResult): void {
  const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
