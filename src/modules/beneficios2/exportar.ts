// Exportações do Pagamento de benefícios (módulo novo).
//  • Caju (só quem tem forma="caju"): mesmo template de 20 colunas do Caju —
//    Mobilidade (col 8) = VT, Refeição (col 3) = VR.
//  • Pix (só quem tem forma="pix"): lista Nome;Chave Pix;Valor pra pagar no banco.
import type { BeneficioPagLinha, Empregado } from "../../core/types";
import { pad2 } from "../../core/utils/date";

const onlyDigits = (s?: string | null) => (s || "").replace(/\D/g, "");
const brl = (n: number) => n.toFixed(2).replace(".", ",");

const HEADER_CAJU = [
  "CPF", "Centro de Custo", "Valor fixo em Auxílio Alimentação",
  "Refeição", "Valor fixo em refeição", "Alimentação", "Valor fixo em alimentação",
  "Valor fixo em Vale Transporte", "Mobilidade", "Valor fixo em mobilidade",
  "Cultura", "Valor fixo em cultura", "Saúde", "Valor fixo em saúde",
  "Educação", "Valor fixo em educação", "Home Office", "Valor fixo em home office",
  "Saldo Livre", "Multi",
].join(";");
const COL_REFEICAO = 3, COL_ALIMENTACAO = 5, COL_MOBILIDADE = 8, COL_MULTI = 19, NUM_COLUNAS = 20;
// Categoria única do Caju (config do restaurante) → coluna do template. Quando
// definida, o benefício INTEIRO (VT + VR + aux) vai nessa coluna. Sem config
// (ou "padrao"), mantém o split VT→Mobilidade / VR→Refeição. (Ex.: Lobozó usa
// Mobilidade; Puba usa Multi.)
const COL_POR_CATEGORIA: Record<string, number> = { multi: COL_MULTI, mobilidade: COL_MOBILIDADE, refeicao: COL_REFEICAO, alimentacao: COL_ALIMENTACAO };

export type IgnoradaPag = { nome: string; motivo: string; total: number };
export type ExportCajuPag = { csv: string; filename: string; qtd: number; totalVt: number; totalVr: number; ignoradas: IgnoradaPag[] };

export function exportarCajuPag(linhas: BeneficioPagLinha[], empregados: Empregado[], slug: string, ano: number, mes: number, categoria?: string | null): ExportCajuPag {
  const empMap = Object.fromEntries(empregados.map((e) => [e.id, e]));
  // Categoria única configurada pro restaurante (ex.: Puba = "multi"). Se não,
  // undefined = comportamento padrão (VT→Mobilidade, VR→Refeição).
  const colUnica = categoria && categoria !== "padrao" ? COL_POR_CATEGORIA[categoria] : undefined;
  const out = [HEADER_CAJU];
  const ignoradas: IgnoradaPag[] = [];
  let totalVt = 0, totalVr = 0, qtd = 0;
  for (const l of linhas) {
    if (l.forma !== "caju") continue;                 // Pix vai na outra lista
    // Ajuste (desconto/crédito do mês anterior) abate na Mobilidade (VT).
    const mobil = Math.max(0, Math.round((l.vtTotal + (l.ajuste || 0)) * 100) / 100);
    const refei = l.vrTotal;
    // Caju não carrega R$ 0 nem valor negativo — pula, mas registra o motivo.
    if (mobil <= 0 && refei <= 0) {
      ignoradas.push({ nome: l.empregadoNome, motivo: l.total < 0 ? "valor líquido negativo (desconto maior que o benefício — recuperar em folha/rescisão)" : "valor líquido zero (nada a carregar)", total: l.total });
      continue;
    }
    const cpf = onlyDigits(empMap[l.empregadoId]?.cpf);
    if (cpf.length !== 11) { ignoradas.push({ nome: l.empregadoNome, motivo: "CPF inválido ou ausente", total: l.total }); continue; }
    const cols = new Array(NUM_COLUNAS).fill("0");
    cols[0] = cpf; cols[1] = "";
    if (colUnica != null) {
      // Tudo numa categoria só (ex.: Multi) — soma VT + VR + aux num valor.
      const totalCat = Math.round((mobil + refei) * 100) / 100;
      if (totalCat > 0) cols[colUnica] = brl(totalCat);
    } else {
      if (refei > 0) cols[COL_REFEICAO] = brl(refei);
      if (mobil > 0) cols[COL_MOBILIDADE] = brl(mobil);
    }
    out.push(cols.join(";"));
    totalVt += mobil; totalVr += refei; qtd++;
  }
  return {
    csv: "﻿" + out.join("\r\n") + "\r\n",
    filename: `beneficios-caju-${slug}-${ano}-${pad2(mes)}.csv`,
    qtd, totalVt: Math.round(totalVt * 100) / 100, totalVr: Math.round(totalVr * 100) / 100, ignoradas,
  };
}

export function exportarPixPag(linhas: BeneficioPagLinha[], slug: string, ano: number, mes: number): { csv: string; filename: string; qtd: number; total: number; semChave: string[] } {
  const out = ["Nome;Chave Pix;Valor"];
  let total = 0, qtd = 0;
  const semChave: string[] = [];
  for (const l of linhas) {
    if (l.forma !== "pix" || l.total <= 0) continue;
    if (!l.chavePix) semChave.push(l.empregadoNome);
    out.push([l.empregadoNome, l.chavePix || "", brl(l.total)].join(";"));
    total += l.total; qtd++;
  }
  return { csv: "﻿" + out.join("\r\n") + "\r\n", filename: `beneficios-pix-${slug}-${ano}-${pad2(mes)}.csv`, qtd, total: Math.round(total * 100) / 100, semChave };
}

export function baixarCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
