// Exporta o lote de VR no formato CSV do Caju — coluna "Refeição".
// Header completo aceito pelo Caju (todas as categorias). Preenchemos só
// a coluna Refeição com o total da linha. As outras ficam zeradas.
//
// Linha de exemplo:
//   12345678901;;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0
//
// (CPF;Centro de Custo;Valor fixo em Auxílio Alimentação;Refeição;Valor fixo
//  em refeição;Alimentação;Valor fixo em alimentação;Valor fixo em Vale
//  Transporte;Mobilidade;Valor fixo em mobilidade;Cultura;Valor fixo em
//  cultura;Saúde;Valor fixo em saúde;Educação;Valor fixo em educação;Home
//  Office;Valor fixo em home office;Saldo Livre;Multi)

import type { Empregado, VRLote } from "../../core/types";
import { pad2 } from "../../core/utils/date";

function onlyDigits(s: string | null | undefined): string {
  return (s || "").replace(/\D/g, "");
}

export type LinhaIgnorada = {
  nome: string;
  motivo: string;
  total: number;
};

export type ExportCajuResult = {
  csv: string;
  filename: string;
  qtdLinhasOk: number;
  totalValor: number;
  ignoradas: LinhaIgnorada[];
};

// Header oficial do Caju (mesma ordem do CSV de erro que ele devolve)
const HEADER_CAJU = [
  "CPF",
  "Centro de Custo",
  "Valor fixo em Auxílio Alimentação",
  "Refeição",
  "Valor fixo em refeição",
  "Alimentação",
  "Valor fixo em alimentação",
  "Valor fixo em Vale Transporte",
  "Mobilidade",
  "Valor fixo em mobilidade",
  "Cultura",
  "Valor fixo em cultura",
  "Saúde",
  "Valor fixo em saúde",
  "Educação",
  "Valor fixo em educação",
  "Home Office",
  "Valor fixo em home office",
  "Saldo Livre",
  "Multi",
].join(";");

// Posição (0-indexed) da coluna "Refeição" — onde gravamos o valor.
const COL_REFEICAO = 3;
const NUM_COLUNAS = 20;

export function exportarLoteCaju(params: {
  lote: VRLote;
  empregados: Empregado[];
  restaurantSlug: string;
}): ExportCajuResult {
  const { lote, empregados, restaurantSlug } = params;
  const empMap = Object.fromEntries(empregados.map((e) => [e.id, e]));

  const linhasOut: string[] = [HEADER_CAJU];
  const ignoradas: LinhaIgnorada[] = [];
  let totalValor = 0;
  let qtdLinhasOk = 0;

  for (const linha of lote.linhas) {
    const emp = empMap[linha.empregadoId];

    // "Recebe pelo Caju" desmarcado → não vai no CSV.
    if (emp?.vrRecebePeloCaju === false) {
      ignoradas.push({
        nome: linha.nome,
        motivo: `Não recebe pelo Caju — pagar manualmente (R$ ${linha.total.toFixed(2).replace(".", ",")})`,
        total: linha.total,
      });
      continue;
    }

    const cpfDigits = onlyDigits(emp?.cpf);

    if (!cpfDigits || cpfDigits.length !== 11) {
      ignoradas.push({
        nome: linha.nome,
        motivo: "CPF inválido ou ausente no cadastro do empregado",
        total: linha.total,
      });
      continue;
    }
    if (linha.total <= 0) {
      ignoradas.push({
        nome: linha.nome,
        motivo: `Valor R$ ${linha.total.toFixed(2).replace(".", ",")} — não envia`,
        total: linha.total,
      });
      continue;
    }

    // Monta linha CSV com 20 colunas, valor só na posição 3 (Refeição).
    const cols = new Array(NUM_COLUNAS).fill("0");
    cols[0] = cpfDigits;       // CPF
    cols[1] = "";              // Centro de Custo (vazio)
    cols[COL_REFEICAO] = linha.total.toFixed(2).replace(".", ",");

    linhasOut.push(cols.join(";"));
    totalValor += linha.total;
    qtdLinhasOk++;
  }

  // BOM + CRLF (Excel/LibreOffice abrem com encoding e separador BR direito)
  const csv = "﻿" + linhasOut.join("\r\n") + "\r\n";
  const filename = `vr-caju-${restaurantSlug}-${lote.ano}-${pad2(lote.mes)}.csv`;

  return { csv, filename, qtdLinhasOk, totalValor, ignoradas };
}

export function baixarCsvCaju(result: ExportCajuResult): void {
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
