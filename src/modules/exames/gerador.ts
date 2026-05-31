// Gerador de tarefas-pai de Exames.
//
// Roda diariamente. Pra cada ExameEmpregado ativo com proximoVencimento dentro
// da janela de antecedência, cria UMA tarefa-pai no projeto Pessoas — Rotinas
// / subprojeto Prazos do Empregado, com subtarefas template do tipo.
//
// Idempotência: ExameEmpregado.ultimoCicloGerado guarda a chave do ciclo já
// criado ("exm-{exameId}-{proximoVencimento}"). Não gera 2× pro mesmo ciclo.

import { collection, getDocs, query, where, doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { criarTarefa } from "../tarefas/repository";
import { resolverPrazoOffset } from "../tarefas/prazoOffset";
import type { ExameEmpregado, ExameTipoConfig, Tarefa, Subtarefa } from "../../core/types";

const COL_EXAMES = "examesEmpregado";
const COL_TIPOS = "exameTiposConfig";

const PROJETO_DESTINO = "proj-pessoas-rot";
const SUBPROJETO_DESTINO = "sub-pessoas-prazos";

/**
 * Roda a varredura. Retorna contagem de tarefas geradas e exames já gerados
 * (pra dar feedback no toast).
 */
export async function gerarTarefasDeExames(autor: { id: string; nome: string }): Promise<{
  geradas: number;
  jaExistiam: number;
  erros: string[];
}> {
  const hoje = new Date().toISOString().slice(0, 10);
  let geradas = 0;
  let jaExistiam = 0;
  const erros: string[] = [];

  // Carrega todos os exames ativos (poderia escopar por rest se ficar lento)
  const snap = await getDocs(query(collection(db, COL_EXAMES), where("ativo", "==", true)));
  for (const d of snap.docs) {
    const exame = { id: d.id, ...d.data() } as ExameEmpregado;
    try {
      const dias = diasEntre(hoje, exame.proximoVencimento);
      const antec = exame.diasAntecedencia || 14;
      // Pula se ainda não chegou na janela de antecedência
      if (dias > antec) continue;
      const chave = `exm-${exame.id}-${exame.proximoVencimento}`;
      // Idempotência local
      if (exame.ultimoCicloGerado === chave) { jaExistiam++; continue; }
      // Idempotência global (caso outro client tenha gerado simultaneamente)
      const existSnap = await getDocs(query(
        collection(db, "tarefas"),
        where("recorrenciaKey", "==", chave),
      ));
      if (!existSnap.empty) { jaExistiam++; continue; }

      // Carrega o tipo pra pegar o template de subtarefas (que pode ter sido
      // editado depois da criação do exame). Snapshot do template pega O QUE
      // ESTÁ AGORA no tipo.
      const tipo = await carregarTipo(exame.tipoId);
      const subtarefasTemplate = tipo?.subtarefasTemplate
        || (await import("../../core/types").then(m =>
            m.EXAME_SUBTAREFAS_TEMPLATE_DEFAULT.map((t, i) => ({
              ...t, id: `st-${i}`,
            }))
        ));

      const subtarefas: Subtarefa[] = (subtarefasTemplate || [])
        .sort((a, b) => a.ordem - b.ordem)
        .map((st, i) => ({
          id: Math.random().toString(36).slice(2, 11),
          texto: st.texto,
          feito: false,
          prazo: resolverPrazoOffset(st.prazoOffset, exame.proximoVencimento),
          ordem: i + 1,
        }));

      const titulo = `${exame.tipoNomeSnapshot} — ${exame.empregadoNomeSnapshot}`;
      const responsavelId = tipo?.responsavelPadraoId || autor.id;
      const responsavelNome = tipo?.responsavelPadraoNome || autor.nome;

      const t: Omit<Tarefa, "id" | "criadoEm" | "atualizadoEm"> = {
        projetoId: PROJETO_DESTINO,
        subprojetoId: SUBPROJETO_DESTINO,
        titulo,
        descricao: [
          `Empregado: ${exame.empregadoNomeSnapshot}`,
          exame.cargoSnapshot && `Cargo: ${exame.cargoSnapshot}`,
          `Tipo: ${exame.tipoNomeSnapshot}`,
          `Vencimento: ${exame.proximoVencimento}`,
          exame.fornecedor && `Fornecedor padrão: ${exame.fornecedor}`,
          exame.ultimaRealizacao && `Última realização: ${exame.ultimaRealizacao}`,
        ].filter(Boolean).join("\n"),
        responsavelId,
        responsavelNome,
        restaurantIds: [exame.restaurantId],
        prazo: exame.proximoVencimento,
        status: "a_fazer",
        prioridade: dias < 0 ? "urgente" : dias <= 3 ? "alta" : "normal",
        subtarefas,
        origem: "admissao",                  // origem semântica: gestão do empregado
        origemRefId: exame.id,
        origemRefLabel: `Exame: ${exame.tipoNomeSnapshot} de ${exame.empregadoNomeSnapshot}`,
        recorrenciaKey: chave,
        criadoPor: autor.id,
        criadoPorNome: autor.nome,
      };
      await criarTarefa(t);

      // Marca o ciclo como gerado no cadastro mestre
      await updateDoc(doc(db, COL_EXAMES, exame.id), sanitizeForFirestore({
        ultimoCicloGerado: chave,
        atualizadoEm: new Date().toISOString(),
      }));
      geradas++;
    } catch (e) {
      erros.push(`Exame ${exame.id}: ${String(e)}`);
    }
  }
  return { geradas, jaExistiam, erros };
}

async function carregarTipo(tipoId: string): Promise<ExameTipoConfig | null> {
  try {
    const s = await getDoc(doc(db, COL_TIPOS, tipoId));
    return s.exists() ? ({ id: s.id, ...s.data() } as ExameTipoConfig) : null;
  } catch {
    return null;
  }
}

function diasEntre(a: string, b: string): number {
  const da = new Date(a + "T00:00:00");
  const db_ = new Date(b + "T00:00:00");
  return Math.round((db_.getTime() - da.getTime()) / (1000 * 60 * 60 * 24));
}

// ─── Cascata Admissão → cria ExameEmpregado pra cada tipo aplicável ────

import type { Cargo, Empregado } from "../../core/types";
import { criarExame } from "./repository";

export async function gerarExamesParaAdmissao(input: {
  empregadoId: string;
  empregadoNome: string;
  cargoId?: string;
  cargoNome?: string;
  cargoArea?: string;
  restaurantId: string;
  dataAdmissao: string;
  autor: { id: string; nome: string };
}): Promise<number> {
  // Carrega tipos ativos do restaurante
  const tiposSnap = await getDocs(query(
    collection(db, COL_TIPOS),
    where("restaurantId", "==", input.restaurantId),
    where("ativo", "==", true),
  ));
  const tipos = tiposSnap.docs.map(d => ({ id: d.id, ...d.data() }) as ExameTipoConfig);

  let criados = 0;
  for (const tipo of tipos) {
    // Filtra aplicabilidade
    if (tipo.aplicabilidade === "manipulador") {
      if (input.cargoArea !== "Cozinha" && input.cargoArea !== "Bar") continue;
    }
    if (tipo.aplicabilidade === "custom") {
      if (!input.cargoId || !(tipo.cargoIdsCustom || []).includes(input.cargoId)) continue;
    }
    // Verifica se já existe (idempotência por empregado × tipo)
    const existSnap = await getDocs(query(
      collection(db, COL_EXAMES),
      where("empregadoId", "==", input.empregadoId),
      where("tipoId", "==", tipo.id),
    ));
    if (!existSnap.empty) continue;

    const proximoVencimento = addDias(input.dataAdmissao, tipo.periodicidadeDias);
    await criarExame({
      restaurantId: input.restaurantId,
      empregadoId: input.empregadoId,
      empregadoNomeSnapshot: input.empregadoNome,
      cargoSnapshot: input.cargoNome,
      tipoId: tipo.id,
      tipoNomeSnapshot: tipo.nome,
      periodicidadeDias: tipo.periodicidadeDias,
      diasAntecedencia: tipo.diasAntecedencia,
      fornecedor: tipo.fornecedorPadrao,
      ultimaRealizacao: input.dataAdmissao,
      proximoVencimento,
      ativo: true,
      criadoPor: input.autor.id,
    });
    criados++;
  }
  return criados;
}

// ─── Cascata Demissão → desativa todos os exames do empregado ──────────

import { desativarExame, listarExamesDeEmpregado } from "./repository";

export async function desativarExamesPorDemissao(
  empregadoId: string,
  autor: { id: string; nome: string },
  motivo = "Demissão do empregado",
): Promise<number> {
  const exames = await listarExamesDeEmpregado(empregadoId);
  let count = 0;
  for (const e of exames) {
    if (!e.ativo) continue;
    await desativarExame(e.id, autor, motivo);
    count++;
  }
  return count;
}

// Helper de cargo: dado um cargoId, retorna a área. Cache trivial.
const cargosCache = new Map<string, Cargo>();
export async function carregarCargo(cargoId: string): Promise<Cargo | null> {
  if (cargosCache.has(cargoId)) return cargosCache.get(cargoId) || null;
  try {
    const s = await getDoc(doc(db, "cargos", cargoId));
    if (s.exists()) {
      const c = { id: s.id, ...s.data() } as Cargo;
      cargosCache.set(cargoId, c);
      return c;
    }
  } catch {}
  return null;
}

// Helper de empregado: pra cascata buscar dados completos
export async function carregarEmpregado(id: string): Promise<Empregado | null> {
  try {
    const s = await getDoc(doc(db, "empregados", id));
    return s.exists() ? ({ id: s.id, ...s.data() } as Empregado) : null;
  } catch {
    return null;
  }
}

function addDias(yyyymmdd: string, dias: number): string {
  const d = new Date(yyyymmdd + "T00:00:00");
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}
