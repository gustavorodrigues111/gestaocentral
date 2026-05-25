// Exporta o lote de VT no formato CSV que o Caju aceita pra importação
// em "Criar pedido por planilha". Template do Caju:
//
//   CPF;Matricula (opcional);Mobilidade;Valor Fixo em Mobilidade
//   12345678901;;220,50;0
//
// Convenções:
// - Separador: ponto-e-vírgula (padrão BR)
// - CPF: 11 dígitos puros, sem máscara
// - Valor: vírgula decimal (formato BR)
// - "Valor Fixo em Mobilidade" sempre 0 — usamos só Mobilidade variável
//   pra não duplicar com recorrências configuradas direto no painel do Caju
// - Encoding: UTF-8 com BOM (Excel abre direito)
// - Quebra de linha: CRLF

import type { Empregado, VTLote } from "../../core/types";
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
  csv: string;             // conteúdo do arquivo
  filename: string;        // nome sugerido
  qtdLinhasOk: number;     // linhas que entraram
  totalValor: number;      // soma dos valores que entraram
  ignoradas: LinhaIgnorada[]; // linhas que NÃO entraram (com motivo)
};

export function exportarLoteCaju(params: {
  lote: VTLote;
  empregados: Empregado[];
  restaurantSlug: string; // slug pro nome do arquivo (ex: "lobozo")
}): ExportCajuResult {
  const { lote, empregados, restaurantSlug } = params;
  const empMap = Object.fromEntries(empregados.map((e) => [e.id, e]));

  // Header obrigatório (idêntico ao template do Caju)
  const linhas: string[] = ["CPF;Matricula (opcional);Mobilidade;Valor Fixo em Mobilidade"];
  const ignoradas: LinhaIgnorada[] = [];
  let totalValor = 0;
  let qtdLinhasOk = 0;

  for (const linha of lote.linhas) {
    const emp = empMap[linha.empregadoId];

    // Filtro: empregado marcado como "recebe VT por fora do Caju" (PIX direto,
    // dinheiro, etc.) — NÃO entra no CSV. Mas aparece no "ignoradas" pra você
    // lembrar de pagar manualmente.
    if (emp?.vtForaCaju) {
      ignoradas.push({
        nome: linha.nome,
        motivo: `Recebe por fora do Caju — pagar manualmente (R$ ${linha.total.toFixed(2).replace(".", ",")})`,
        total: linha.total,
      });
      continue;
    }

    const cpfDigits = onlyDigits(emp?.cpf);

    // Validação: CPF precisa ter 11 dígitos
    if (!cpfDigits || cpfDigits.length !== 11) {
      ignoradas.push({
        nome: linha.nome,
        motivo: "CPF inválido ou ausente no cadastro do empregado",
        total: linha.total,
      });
      continue;
    }

    // Validação: valor zero/negativo não vai (Caju não aceita pedido vazio)
    if (linha.total <= 0) {
      ignoradas.push({
        nome: linha.nome,
        motivo: `Valor R$ ${linha.total.toFixed(2).replace(".", ",")} — não envia (desconto cobriu tudo ou ajuste negativo)`,
        total: linha.total,
      });
      continue;
    }

    // Formata o valor em BR: vírgula decimal, sem separador de milhar.
    // O Caju aceita assim (testado com o template oficial).
    const valorBR = linha.total.toFixed(2).replace(".", ",");

    // Matrícula vazia — Caju usa o CPF pra fazer o match com colaboradores
    // já cadastrados na plataforma.
    linhas.push(`${cpfDigits};;${valorBR};0`);
    totalValor += linha.total;
    qtdLinhasOk++;
  }

  // BOM + CRLF garante que Excel/LibreOffice abrem com acentuação correta
  // e respeitando ponto-e-vírgula como separador no Brasil.
  const csv = "﻿" + linhas.join("\r\n") + "\r\n";

  const filename = `vt-caju-${restaurantSlug}-${lote.ano}-${pad2(lote.mes)}.csv`;

  return { csv, filename, qtdLinhasOk, totalValor, ignoradas };
}

// Helper: dispara o download do CSV gerado pelo navegador.
// Cria um <a download> temporário, clica e descarta.
export function baixarCsvCaju(result: ExportCajuResult): void {
  const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Libera memória; setTimeout pq o click é async em alguns browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
