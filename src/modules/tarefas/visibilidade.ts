// Helpers de visibilidade/confidencialidade pro Gestor de Tarefas.
//
// REGRA DE ACESSO (OR — basta uma das condições):
//   1. pessoa.isMaster
//   2. pessoa.id == tarefa.criadoPor
//   3. pessoa.id == tarefa.responsavelId
//   4. pessoa.id ∈ tarefa.coResponsaveis
//   5. pessoa.id ∈ tarefa.usuariosAutorizados
//   6. pessoa.id ∈ projeto.usuariosAutorizados
//   7. visibilidade efetiva ∈ {"publico","escritorio"}
//   8. visibilidade ∈ {"grupo_dp","grupo_fin","grupo_dir","grupo_ops"}
//      → pessoa tem permissão tarefas.verGrupoX em ALGUM dos rests dela.
//      (checagem simplificada — usa permissions[rid][tarefas].ver, sem
//      passar pelo accessProfile ainda; promove em fase futura.)
//
// "privado" só passa pelas regras 1-6.

import type { Tarefa, TarefaProjeto, Pessoa } from "../../core/types";

export function visibilidadeEfetiva(tarefa: Tarefa, projeto?: TarefaProjeto): string {
  return tarefa.visibilidadeOverride
    || tarefa.visibilidadeEfetiva
    || projeto?.visibilidade
    || "escritorio";
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
  if (v === "privado") return false;

  // grupos — checagem simplificada via permissions legado (qualquer rid)
  if (v.startsWith("grupo_")) {
    return pessoaTemAcessoAoGrupo(pessoa, v as `grupo_${string}`);
  }
  return false;
}

// Confidencial = tem lista explícita OU visibilidade restritiva.
export function isConfidencial(tarefa: Tarefa, projeto?: TarefaProjeto): boolean {
  if ((tarefa.usuariosAutorizados || []).length > 0) return true;
  if (projeto && (projeto.usuariosAutorizados || []).length > 0) return true;
  const v = visibilidadeEfetiva(tarefa, projeto);
  return v === "privado" || v.startsWith("grupo_");
}

// Checagem simplificada se pessoa tem acesso ao "grupo_xxx".
// Hoje: olha pelo menos um rid onde pessoa.permissions[rid].tarefas existe
// e ver/configurar é true. Em fase futura: derivar do AccessProfile via
// canAcao("tarefas", "verGrupoXX").
function pessoaTemAcessoAoGrupo(pessoa: Pessoa, grupo: string): boolean {
  // Sem permissões setadas pra Tarefas → não pertence a nenhum grupo.
  const todasPerms = pessoa.permissions || {};
  for (const rid of Object.keys(todasPerms)) {
    const p = todasPerms[rid]?.tarefas;
    if (!p) continue;
    if (p.ver || p.configurar) {
      // Heurística MVP: se tem acesso ao módulo, pertence aos grupos.
      // Quando a Fase 6 trouxer perfil granular, troca por canAcao().
      return true;
    }
  }
  // Fallback: campos legados de specialPermissions ou outras heurísticas
  // podem entrar aqui se necessário.
  void grupo;
  return false;
}

// Filtra lista de tarefas pelas que a pessoa pode ver.
export function filtrarVisiveis(
  tarefas: Tarefa[],
  projetos: TarefaProjeto[],
  pessoa: Pessoa | null,
): Tarefa[] {
  return tarefas.filter(t => podeVerTarefa(t, projetos.find(p => p.id === t.projetoId), pessoa));
}
