// Importador CSV → Tarefas. Suporta o formato de export do Asana (que tem
// quebras de linha dentro de Notes, vírgulas dentro de strings, aspas
// escapadas como "").
//
// Mapeamento Asana → Tarefa (campos típicos do export):
//   Name        → titulo
//   Notes       → descricao
//   Due Date    → prazo (YYYY-MM-DD)
//   Completed At→ status (concluida se preenchido, senão a_fazer)
//   Created At  → criadoEm (preservado)
//   Assignee    → responsavelNome (resolve id via lista pessoas)
//   Empresas(s) → restaurantIds (resolve via nome do restaurante)
//   Parent task → relaciona pra virar subtarefa da pai
//
// Tarefas top-level com Parent task vazio viram Tarefa. Linhas com
// Parent task viram Subtarefa da tarefa pai correspondente.

import { criarTarefa } from "./repository";
import type { Pessoa, Restaurant, Subtarefa, Tarefa } from "../../core/types";

// ─── Parser CSV ────────────────────────────────────────────────────────
// Trata aspas + escapes ("") + quebras de linha dentro de aspas.

export function parseCSV(texto: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    if (inQuotes) {
      if (c === '"') {
        if (texto[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    } else {
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(field); field = ""; rows.push(row); row = []; i++; continue; }
      field += c; i++;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  // Remove BOM da 1ª célula (Asana exporta com BOM UTF-8)
  if (rows[0] && rows[0][0]) rows[0][0] = rows[0][0].replace(/^﻿/, "");
  return rows.filter(r => r.some(c => c.trim()));
}

// ─── Mapeamento ────────────────────────────────────────────────────────

export type LinhaImportada = {
  taskId: string;
  parentTaskId: string;
  titulo: string;
  descricao?: string;
  prazo?: string | null;
  status: "a_fazer" | "em_andamento" | "concluida" | "cancelada";
  assigneeNome?: string;
  empresasNomes?: string[];
  criadoEm?: string;
  // Detectados:
  responsavelId?: string;
  responsavelNome?: string;
  restaurantIds?: string[];
};

export function mapearLinhas(
  rows: string[][],
  pessoas: Pessoa[],
  restaurantes: Restaurant[],
): { linhas: LinhaImportada[]; warnings: string[] } {
  const warnings: string[] = [];
  if (rows.length === 0) return { linhas: [], warnings: ["CSV vazio"] };
  const header = rows[0].map(h => h.trim());
  const col = (nome: string): number => {
    const idx = header.findIndex(h => h === nome || h.toLowerCase() === nome.toLowerCase());
    return idx;
  };
  const idxName = col("Name");
  const idxNotes = col("Notes");
  const idxDue = col("Due Date");
  const idxCompleted = col("Completed At");
  const idxCreated = col("Created At");
  const idxAssignee = col("Assignee");
  const idxEmpresas = col("Empresas(s)");
  const idxParent = col("Parent task");
  const idxTaskId = col("Task ID");

  if (idxName < 0) {
    warnings.push("Coluna 'Name' não encontrada — CSV inválido");
    return { linhas: [], warnings };
  }

  // Mapas de busca por nome (case-insensitive, trim)
  const pessoaPorNome = new Map<string, Pessoa>();
  pessoas.forEach(p => {
    if (p.nome) pessoaPorNome.set(p.nome.toLowerCase().trim(), p);
    // primeiro nome também
    const primeiro = p.nome?.split(" ")[0]?.toLowerCase().trim();
    if (primeiro && !pessoaPorNome.has(primeiro)) pessoaPorNome.set(primeiro, p);
  });
  const restPorNome = new Map<string, Restaurant>();
  restaurantes.forEach(r => {
    if (r.nome) restPorNome.set(r.nome.toLowerCase().trim(), r);
  });

  const linhas: LinhaImportada[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const titulo = (r[idxName] || "").trim();
    if (!titulo) continue;
    const parent = idxParent >= 0 ? (r[idxParent] || "").trim() : "";
    const due = idxDue >= 0 ? normalizarData(r[idxDue]) : null;
    const completed = idxCompleted >= 0 ? (r[idxCompleted] || "").trim() : "";
    const created = idxCreated >= 0 ? (r[idxCreated] || "").trim() : "";
    const assignee = idxAssignee >= 0 ? (r[idxAssignee] || "").trim() : "";
    const empresasRaw = idxEmpresas >= 0 ? (r[idxEmpresas] || "").trim() : "";
    const taskId = idxTaskId >= 0 ? (r[idxTaskId] || "").trim() : `imp-${i}`;
    const notes = idxNotes >= 0 ? (r[idxNotes] || "").trim() : "";

    const status: LinhaImportada["status"] = completed ? "concluida" : "a_fazer";

    // Empresas: split por "," se tem ", ", senão é única
    const empresasNomes = empresasRaw
      ? empresasRaw.split(/,\s*/).map(s => s.trim()).filter(Boolean)
      : [];

    const linha: LinhaImportada = {
      taskId,
      parentTaskId: parent,
      titulo,
      descricao: notes || undefined,
      prazo: due,
      status,
      assigneeNome: assignee || undefined,
      empresasNomes,
      criadoEm: normalizarData(created) || undefined,
    };

    // Resolver responsável por nome
    if (assignee) {
      const pNome = assignee.toLowerCase().trim();
      const p = pessoaPorNome.get(pNome) || pessoaPorNome.get(pNome.split(" ")[0]);
      if (p) {
        linha.responsavelId = p.id;
        linha.responsavelNome = p.nome;
      } else {
        warnings.push(`Linha ${i + 1}: responsável "${assignee}" não encontrado em /pessoas`);
      }
    }
    // Resolver empresas por nome
    const restIds: string[] = [];
    empresasNomes.forEach(en => {
      const r = restPorNome.get(en.toLowerCase().trim());
      if (r) restIds.push(r.id);
      else warnings.push(`Linha ${i + 1}: empresa "${en}" não encontrada em /restaurants`);
    });
    if (restIds.length > 0) linha.restaurantIds = restIds;

    linhas.push(linha);
  }
  return { linhas, warnings };
}

function normalizarData(s: string | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  // YYYY-MM-DD direto
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  // DD/MM/YYYY
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

// ─── Executor ──────────────────────────────────────────────────────────

export async function executarImport(
  linhas: LinhaImportada[],
  destino: { projetoId: string; subprojetoId: string; corProjeto?: string },
  autor: { id: string; nome: string },
  onProgress?: (idx: number, total: number) => void,
): Promise<{ criadas: number; vinculadas: number; erros: string[] }> {
  const erros: string[] = [];
  // Index pais por taskId
  const pais = linhas.filter(l => !l.parentTaskId);
  const filhas = linhas.filter(l => l.parentTaskId);
  const filhasPorPai = new Map<string, LinhaImportada[]>();
  filhas.forEach(f => {
    const arr = filhasPorPai.get(f.parentTaskId) || [];
    arr.push(f);
    filhasPorPai.set(f.parentTaskId, arr);
  });

  let criadas = 0;
  let vinculadas = 0;
  for (let i = 0; i < pais.length; i++) {
    const pai = pais[i];
    onProgress?.(i, pais.length);
    try {
      // Subtarefas a partir das filhas
      const subFilhas = filhasPorPai.get(pai.taskId) || [];
      const subtarefas: Subtarefa[] | undefined = subFilhas.length > 0
        ? subFilhas.map((sf, idx) => ({
            id: Math.random().toString(36).slice(2, 11),
            texto: sf.titulo,
            feito: sf.status === "concluida",
            feitoEm: sf.status === "concluida" ? new Date().toISOString() : null,
            ordem: idx + 1,
            prazo: sf.prazo || undefined,
          }))
        : undefined;

      const t: Omit<Tarefa, "id" | "criadoEm" | "atualizadoEm"> = {
        projetoId: destino.projetoId,
        subprojetoId: destino.subprojetoId,
        titulo: pai.titulo,
        descricao: pai.descricao,
        responsavelId: pai.responsavelId || autor.id,
        responsavelNome: pai.responsavelNome || autor.nome,
        coResponsaveis: [],
        restaurantIds: pai.restaurantIds && pai.restaurantIds.length > 0 ? pai.restaurantIds : undefined,
        prazo: pai.prazo || null,
        status: pai.status,
        prioridade: "normal",
        subtarefas,
        origem: "manual",
        origemRefId: pai.taskId,
        origemRefLabel: `Importado do Asana (${pai.taskId})`,
        corHerdada: destino.corProjeto,
        criadoPor: autor.id,
        criadoPorNome: autor.nome,
      };
      await criarTarefa(t);
      criadas++;
      vinculadas += subFilhas.length;
    } catch (e) {
      erros.push(`${pai.titulo}: ${String(e)}`);
    }
  }
  return { criadas, vinculadas, erros };
}

// Tarefas órfãs: filhas cujo pai não tá no CSV (parentTaskId não bate).
// Importadas como tarefas top-level pra não perder dados.
export function detectarOrfas(linhas: LinhaImportada[]): LinhaImportada[] {
  const paiIds = new Set(linhas.filter(l => !l.parentTaskId).map(l => l.taskId));
  return linhas.filter(l => l.parentTaskId && !paiIds.has(l.parentTaskId));
}
