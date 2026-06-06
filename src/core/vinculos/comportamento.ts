// ════════════════════════════════════════════════════════════════════════════
//  Vínculo Lógico — matriz de comportamento por tipo de vínculo
//
//  TODO o sistema (escala, gorjeta, ponto, VT, trilha, etc.) consulta esta
//  matriz pra decidir o que cada vínculo recebe / aparece / exige. Hard-coded
//  (não vive no Firestore) — qualquer ajuste passa por edit de código.
//
//  Aprovado pelo master via HTML editor — JSON colado direto aqui.
//
//  Vínculo "lógico" é o conceito unificado (5 valores). O sistema também
//  mantém o `Cargo.tipoVinculo` legacy (registrado/provisorio/terceirizado)
//  pra compat — o helper normalizarVinculoCargo() faz a tradução.
// ════════════════════════════════════════════════════════════════════════════

import type { Cargo, Empregado, Pessoa, TipoVinculo } from "../types";

// ─── Tipo lógico unificado ─────────────────────────────────────────────────

export type VinculoLogico =
  | "clt"
  | "estagiario"
  | "freela"
  | "prestadorAdm"
  | "diretoria";

export const VINCULOS_LOGICOS: VinculoLogico[] = [
  "clt", "estagiario", "freela", "prestadorAdm", "diretoria",
];

export const VINCULO_LOGICO_LABEL: Record<VinculoLogico, string> = {
  clt:          "CLT (Registrado)",
  estagiario:   "Estagiário",
  freela:       "Freela",
  prestadorAdm: "Prestador Administrativo",
  diretoria:    "Diretoria",
};

export const VINCULO_LOGICO_ICONE: Record<VinculoLogico, string> = {
  clt:          "🪪",
  estagiario:   "🎓",
  freela:       "🎒",
  prestadorAdm: "💼",
  diretoria:    "👔",
};

// Cores Tailwind pro badge na lista de Pessoas + filtros
export const VINCULO_LOGICO_CLASSES: Record<VinculoLogico, string> = {
  clt:          "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  estagiario:   "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  freela:       "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  prestadorAdm: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  diretoria:    "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
};

// ─── Tradução do cargo (legacy) → vínculo lógico ──────────────────────────

/**
 * O `Cargo.tipoVinculo` continua usando os 4 valores legados
 * ("registrado" | "provisorio" | "estagiario" | "terceirizado") porque
 * mexer em cargos antigos no Firestore exigiria migração ampla. Esta
 * função traduz pra vínculo lógico:
 *
 *   registrado    → clt
 *   provisorio    → freela
 *   estagiario    → estagiario
 *   terceirizado  → prestadorAdm
 *
 * "terceirizado" historicamente cobria limpeza/segurança outsourcing.
 * Vamos colocar em prestadorAdm provisoriamente — se aparecer uso real
 * que não bate, criamos um 6º vínculo "terceirizadoOps".
 */
export function normalizarVinculoCargo(tv: TipoVinculo): VinculoLogico {
  switch (tv) {
    case "registrado":   return "clt";
    case "provisorio":   return "freela";
    case "estagiario":   return "estagiario";
    case "terceirizado": return "prestadorAdm";
  }
}

// ─── Matriz de comportamento ──────────────────────────────────────────────

export type ComportamentoValor =
  | "obrig"   // sempre obrigatório
  | "opc"     // opcional (admin marca por pessoa)
  | "cargo"   // depende do cargo associado
  | "pess"    // depende da pessoa (toggle no editor)
  | "nunca";  // nunca aparece pra esse vínculo

export type AtributoVinculo =
  | "apareceEmEmpregados"
  | "apareceNaEscalaMensal"
  | "temCargoAssociado"
  | "temHorarioCadastrado"
  | "batePonto"
  | "recebeGorjeta"
  | "recebeVT"
  | "recebeVR"
  | "trilhaCompleta"
  | "pessoaVinculadaLogin"
  | "apareceEmDiretoriaAdm"
  | "apareceEmFreelas"
  | "responsavelTarefas"
  | "recebeBeneficios"
  | "apareceEmInconformidades";

export const ATRIBUTO_LABEL: Record<AtributoVinculo, string> = {
  apareceEmEmpregados:      "Aparece em Empregados (lista operacional)",
  apareceNaEscalaMensal:    "Aparece na Escala mensal",
  temCargoAssociado:        "Tem Cargo associado",
  temHorarioCadastrado:     "Tem Horário de trabalho cadastrado",
  batePonto:                "Bate ponto (Sólides)",
  recebeGorjeta:            "Pode receber Gorjeta",
  recebeVT:                 "Recebe Vale Transporte (VT)",
  recebeVR:                 "Recebe Vale Refeição (VR)",
  trilhaCompleta:           "Tem Trilha do Empregado completa",
  pessoaVinculadaLogin:     "Tem Pessoa vinculada (login no sistema)",
  apareceEmDiretoriaAdm:    "Aparece em Diretoria & Adm (nova tab)",
  apareceEmFreelas:         "Aparece em Freelas (módulo)",
  responsavelTarefas:       "Pode ser responsável por Tarefas",
  recebeBeneficios:         "Pode receber benefícios (Caju)",
  apareceEmInconformidades: "Aparece em Inconformidades / Ajustes de ponto",
};

/**
 * Matriz aprovada via HTML editor. Cada vínculo lógico tem um valor pra
 * cada atributo. Consultada em todo o sistema via getComportamento().
 */
export const COMPORTAMENTO_POR_VINCULO: Record<
  VinculoLogico,
  Record<AtributoVinculo, ComportamentoValor>
> = {
  clt: {
    apareceEmEmpregados:      "obrig",
    apareceNaEscalaMensal:    "obrig",
    temCargoAssociado:        "obrig",
    temHorarioCadastrado:     "obrig",
    batePonto:                "obrig",
    recebeGorjeta:            "cargo",
    recebeVT:                 "obrig",
    recebeVR:                 "opc",
    trilhaCompleta:           "obrig",
    pessoaVinculadaLogin:     "obrig",
    apareceEmDiretoriaAdm:    "nunca",
    apareceEmFreelas:         "nunca",
    responsavelTarefas:       "opc",
    recebeBeneficios:         "obrig",
    apareceEmInconformidades: "obrig",
  },
  estagiario: {
    apareceEmEmpregados:      "obrig",
    apareceNaEscalaMensal:    "obrig",
    temCargoAssociado:        "obrig",
    temHorarioCadastrado:     "obrig",
    batePonto:                "obrig",
    recebeGorjeta:            "cargo",
    recebeVT:                 "obrig",
    recebeVR:                 "opc",
    trilhaCompleta:           "obrig",
    pessoaVinculadaLogin:     "opc",
    apareceEmDiretoriaAdm:    "nunca",
    apareceEmFreelas:         "nunca",
    responsavelTarefas:       "opc",
    recebeBeneficios:         "opc",
    apareceEmInconformidades: "obrig",
  },
  freela: {
    apareceEmEmpregados:      "obrig",
    apareceNaEscalaMensal:    "cargo",
    temCargoAssociado:        "obrig",
    temHorarioCadastrado:     "pess",
    batePonto:                "nunca",
    recebeGorjeta:            "pess",
    recebeVT:                 "pess",
    recebeVR:                 "nunca",
    trilhaCompleta:           "obrig",
    pessoaVinculadaLogin:     "nunca",
    apareceEmDiretoriaAdm:    "nunca",
    apareceEmFreelas:         "obrig",
    responsavelTarefas:       "opc",
    recebeBeneficios:         "nunca",
    apareceEmInconformidades: "nunca",
  },
  prestadorAdm: {
    apareceEmEmpregados:      "nunca",
    apareceNaEscalaMensal:    "pess",
    temCargoAssociado:        "pess",
    temHorarioCadastrado:     "nunca",
    batePonto:                "nunca",
    recebeGorjeta:            "pess",
    recebeVT:                 "nunca",
    recebeVR:                 "nunca",
    trilhaCompleta:           "nunca",
    pessoaVinculadaLogin:     "obrig",
    apareceEmDiretoriaAdm:    "obrig",
    apareceEmFreelas:         "nunca",
    responsavelTarefas:       "opc",
    recebeBeneficios:         "nunca",
    apareceEmInconformidades: "nunca",
  },
  diretoria: {
    apareceEmEmpregados:      "nunca",
    apareceNaEscalaMensal:    "pess",
    temCargoAssociado:        "pess",
    temHorarioCadastrado:     "nunca",
    batePonto:                "nunca",
    recebeGorjeta:            "nunca",
    recebeVT:                 "nunca",
    recebeVR:                 "nunca",
    trilhaCompleta:           "nunca",
    pessoaVinculadaLogin:     "obrig",
    apareceEmDiretoriaAdm:    "obrig",
    apareceEmFreelas:         "nunca",
    responsavelTarefas:       "opc",
    recebeBeneficios:         "nunca",
    apareceEmInconformidades: "nunca",
  },
};

// ─── Helpers de consulta ───────────────────────────────────────────────────

/** Consulta direta na matriz. */
export function getComportamento(
  vinculo: VinculoLogico,
  atributo: AtributoVinculo,
): ComportamentoValor {
  return COMPORTAMENTO_POR_VINCULO[vinculo][atributo];
}

/**
 * Lista atributos que são "depende da pessoa" pro vínculo — usados pelo
 * editor de Pessoa pra mostrar os toggles condicionais.
 */
export function atributosDependeDaPessoa(vinculo: VinculoLogico): AtributoVinculo[] {
  const config = COMPORTAMENTO_POR_VINCULO[vinculo];
  return (Object.keys(config) as AtributoVinculo[]).filter(a => config[a] === "pess");
}

/**
 * Lista atributos que são "obrigatórios" — usado pra validar cadastro
 * ("Pessoa com vínculo X precisa ter Y preenchido").
 */
export function atributosObrigatorios(vinculo: VinculoLogico): AtributoVinculo[] {
  const config = COMPORTAMENTO_POR_VINCULO[vinculo];
  return (Object.keys(config) as AtributoVinculo[]).filter(a => config[a] === "obrig");
}

// ─── Resolução do vínculo de uma Pessoa num Restaurante ───────────────────

/**
 * Resolve o vínculo lógico de uma pessoa num restaurante específico.
 * Ordem de busca:
 *   1. pessoa.vinculos[rid] (campo explícito — sistema novo)
 *   2. Se tem empregado no rid → traduz cargo.tipoVinculo (legacy)
 *   3. Se pessoa.isMaster → "diretoria" (default conservador)
 *   4. null (vínculo desconhecido — admin precisa preencher)
 *
 * O sistema de badges chama isso pra mostrar "Precisa de vínculo" quando
 * retorna null. UI gates (escala, gorjeta, etc) usam pra decidir
 * comportamento via getComportamento().
 */
export function resolverVinculo(
  pessoa: Pessoa | null | undefined,
  restaurantId: string,
  empregado?: Empregado | null,
  cargo?: Cargo | null,
): VinculoLogico | null {
  if (!pessoa) return null;
  // 1. Campo explícito da pessoa
  const direto = pessoa.vinculos?.[restaurantId];
  if (direto) return direto;
  // 2. Empregado existente com cargo → mapeia legacy
  if (empregado && cargo) {
    return normalizarVinculoCargo(cargo.tipoVinculo);
  }
  // 3. Master sem cadastro de cargo → default "Diretoria"
  if (pessoa.isMaster) return "diretoria";
  // 4. Sem informação
  return null;
}

/**
 * Resolve o valor efetivo de um atributo "depende da pessoa" pro vínculo
 * dela. Consulta o toggle em pessoa.pessoaToggles[rid].atributo.
 * Retorna false como default conservador (não habilita).
 */
export function getToggleDaPessoa(
  pessoa: Pessoa | null | undefined,
  restaurantId: string,
  atributo: keyof NonNullable<Pessoa["pessoaToggles"]>[string],
): boolean {
  if (!pessoa) return false;
  return pessoa.pessoaToggles?.[restaurantId]?.[atributo] === true;
}
