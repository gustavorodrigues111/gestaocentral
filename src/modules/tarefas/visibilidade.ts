// Helpers de visibilidade/confidencialidade pro Gestor de Tarefas.
//
// MODELO SIMPLES (pós-remoção dos grupos):
//   - "privado":     master + criador + responsável + co-resp + usuariosAutorizados (projeto e tarefa)
//   - "escritorio":  qualquer pessoa autenticada
//   - "publico":     idem escritório
//
// Docs legados com "grupo_dp"/"grupo_fin"/"grupo_dir"/"grupo_ops" são tratados
// como "privado" (esconde por padrão). Master pode reconfigurar via Admin.

import type { Tarefa, TarefaProjeto, Pessoa } from "../../core/types";

export function visibilidadeEfetiva(tarefa: Tarefa, projeto?: TarefaProjeto): string {
  return tarefa.visibilidadeOverride
    || tarefa.visibilidadeEfetiva
    || projeto?.visibilidade
    || "privado";
}

export function podeVerTarefa(
  tarefa: Tarefa,
  projeto: TarefaProjeto | undefined,
  pessoa: Pessoa | null,
): boolean {
  if (!pessoa) return false;
  if (pessoa.isMaster) return true;
  if (tarefa.criadoPor === pessoa.id) return true;
  if (tarefa.responsavelId === pessoa.id) return true;
  if ((tarefa.coResponsaveis || []).includes(pessoa.id)) return true;
  if ((tarefa.usuariosAutorizados || []).includes(pessoa.id)) return true;
  if (projeto && (projeto.usuariosAutorizados || []).includes(pessoa.id)) return true;

  const v = visibilidadeEfetiva(tarefa, projeto);
  if (v === "publico" || v === "escritorio") return true;
  // "privado" e qualquer valor legado (grupo_*) — só passa pelas regras acima
  return false;
}

// Confidencial = visibilidade restritiva OU lista explícita de autorizados.
export function isConfidencial(tarefa: Tarefa, projeto?: TarefaProjeto): boolean {
  if ((tarefa.usuariosAutorizados || []).length > 0) return true;
  if (projeto && (projeto.usuariosAutorizados || []).length > 0) return true;
  const v = visibilidadeEfetiva(tarefa, projeto);
  return v !== "publico" && v !== "escritorio";
}

// Filtra lista de tarefas pelas que a pessoa pode ver.
export function filtrarVisiveis(
  tarefas: Tarefa[],
  projetos: TarefaProjeto[],
  pessoa: Pessoa | null,
): Tarefa[] {
  return tarefas.filter(t => podeVerTarefa(t, projetos.find(p => p.id === t.projetoId), pessoa));
}
