// Fase 2 — import de planilha por IA (lado cliente): lê o .xlsx, manda pro
// endpoint /api/importar-fichas (Claude) e casa os ingredientes com os insumos
// já cadastrados (dedup) pra tela de revisão.
import * as XLSX from "xlsx";
import { authHeader } from "../../core/firebase/idToken";
import type { FtDimensao, FtInsumo } from "../../core/types";
import { dimensaoDeUnidade } from "./unidades";
import { sugerirInsumos } from "./dedup";

export type IngredienteIA = { nome: string; qtd: number; unidade: string; qb?: boolean; insumoPrincipal?: string; variacao?: string };
// Cada "Preparo" da planilha vira UMA receita (lista plana de ingredientes).
export type FichaIA = {
  nome: string;
  ehSubficha?: boolean;
  categoria?: string;
  rendimento: { qtd: number; unidade: string };
  ingredientes: IngredienteIA[];
};

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

export type Anexo = { data: string; mediaType: string; nome: string };

// Lê um arquivo (imagem/PDF) como base64 SEM prefixo, pra mandar ao Claude.
export async function fileParaAnexo(file: File): Promise<Anexo> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  const data = btoa(bin);
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const mediaType = isPdf ? "application/pdf" : (file.type || "image/jpeg");
  return { data, mediaType, nome: file.name || (isPdf ? "documento.pdf" : "imagem") };
}

// Divide o texto da planilha em blocos, um por "Preparo" (cada bloco = uma
// receita). Preserva o cabeçalho da aba. Se não achar marcadores, retorna [].
export function dividirEmBlocos(planilha: string): string[] {
  const linhas = planilha.split("\n");
  const blocos: string[] = [];
  let atual: string[] = [];
  const push = () => { if (atual.some(l => /Preparo\s*\|/i.test(l))) blocos.push(atual.join("\n").trim()); };
  for (const l of linhas) {
    if (/^===\s*Aba:/i.test(l)) continue;          // ignora marcador de aba
    if (/^\s*Preparo\s*\|/i.test(l)) { push(); atual = [l]; }
    else atual.push(l);
  }
  push();
  return blocos.filter(b => b.length > 0);
}

// Extrai o nome do preparo da linha "Preparo | <nome> | ..." de um bloco.
export function nomeDoBloco(bloco: string): string {
  const linha = bloco.split("\n").find(l => /^\s*Preparo\s*\|/i.test(l));
  if (!linha) return "(sem nome)";
  const partes = linha.split("|").map(s => s.trim()).filter(Boolean);
  return partes[1] || partes[0] || "(sem nome)";
}

export async function importarFichasIA(payload: { planilha?: string; anexos?: Anexo[] }): Promise<FichaIA[]> {
  const anexos = (payload.anexos || []).map(a => ({ data: a.data, mediaType: a.mediaType }));
  const resp = await fetch("/api/importar-fichas", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ planilha: payload.planilha || "", anexos }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((data as { error?: string })?.error || `Erro ${resp.status} ao processar a receita.`);
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
