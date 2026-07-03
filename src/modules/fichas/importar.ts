// Fase 2 — import de planilha por IA (lado cliente): lê o .xlsx, manda pro
// endpoint /api/importar-fichas (Claude) e casa os ingredientes com os insumos
// já cadastrados (dedup) pra tela de revisão.
import * as XLSX from "xlsx";
import { authHeader } from "../../core/firebase/idToken";
import type { FtDimensao, FtInsumo } from "../../core/types";
import { dimensaoDeUnidade } from "./unidades";
import { sugerirInsumos } from "./dedup";

export type IngredienteIA = { nome: string; qtd: number; unidade: string; qb?: boolean };
export type SubfichaIA = { nome: string; rendimento: { qtd: number; unidade: string }; ingredientes: IngredienteIA[] };
export type FichaIA = { nome: string; tipo: string; rendimento: { qtd: number; unidade: string }; subfichas: SubfichaIA[] };

// Lê o arquivo e transforma cada aba em texto tabular ("A | B | C" por linha).
export async function planilhaParaTexto(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const partes: string[] = [];
  for (const nome of wb.SheetNames) {
    const ws = wb.Sheets[nome];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: "" });
    const linhas = rows
      .map(r => (r as unknown[]).map(c => String(c ?? "").trim()).join(" | "))
      .filter(l => l.replace(/\|/g, "").trim());
    if (linhas.length) partes.push(`=== Aba: ${nome} ===\n${linhas.join("\n")}`);
  }
  return partes.join("\n\n");
}

export async function importarFichasIA(planilha: string): Promise<FichaIA[]> {
  const resp = await fetch("/api/importar-fichas", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ planilha }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((data as { error?: string })?.error || `Erro ${resp.status} ao processar a planilha.`);
  return Array.isArray((data as { fichas?: FichaIA[] }).fichas) ? (data as { fichas: FichaIA[] }).fichas : [];
}

// Base canônica por dimensão (insumo novo é cadastrado por kg/L/un).
export function baseCanonica(dim: FtDimensao): string {
  return dim === "massa" ? "kg" : dim === "volume" ? "L" : "un";
}

export type StatusResol = "casado" | "conferir" | "novo";
export type IngredienteResol = {
  id: string;
  nome: string;
  qtd: number;
  unidade: string;
  qb: boolean;
  status: StatusResol;
  matchInsumoId: string | null;   // insumo existente escolhido (casado/conferir); null = criar novo
  sugestoes: FtInsumo[];
  novoDimensao: FtDimensao;
  novoUnidadeBase: string;
};

// Resolve um ingrediente da IA contra os insumos existentes.
export function resolverIngrediente(ing: IngredienteIA, insumos: FtInsumo[], idx: number): IngredienteResol {
  const dim = (dimensaoDeUnidade(ing.unidade) || "massa") as FtDimensao;
  const sug = sugerirInsumos(ing.nome, insumos).map(s => s.insumo);
  const top = sugerirInsumos(ing.nome, insumos)[0];
  let status: StatusResol;
  let matchInsumoId: string | null;
  if (top?.motivo === "igual") { status = "casado"; matchInsumoId = top.insumo.id; }
  else if (top) { status = "conferir"; matchInsumoId = top.insumo.id; }
  else { status = "novo"; matchInsumoId = null; }
  return {
    id: `ir_${idx}_${Math.random().toString(36).slice(2, 6)}`,
    nome: ing.nome, qtd: ing.qtd || 0, unidade: ing.unidade, qb: !!ing.qb,
    status, matchInsumoId, sugestoes: sug, novoDimensao: dim, novoUnidadeBase: baseCanonica(dim),
  };
}
