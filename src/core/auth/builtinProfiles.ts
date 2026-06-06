// Perfis built-in do sistema. São constantes no código — não vivem no
// Firestore (apesar de poderem ser sobrescritos no Firestore se master
// quiser personalizar; nesse caso `builtin: true` e o doc passa a
// existir em /accessProfiles com o mesmo id).
//
// IDs dos built-ins seguem o padrão `_builtin_<slug>` pra não colidir
// com IDs custom (que vêm do Firestore com autoId).

import type { AccessProfile } from "../types";

// Gerente de Restaurante — papel "gerente da unidade" típico de restaurante:
// opera reservas, gerencia time, vê dados gerais, mas NÃO mexe em
// permissões/regra de gorjeta/segurança (essas ficam pro master).
//
// Cobre: operação completa de Reservas + CRM histórico, horários, site
// (sem upload de PDF de cardápio nem publicar — operacional do dia, não
// publicação institucional), escala completa, gorjetas operacional (sem
// regra de divisão), VT operacional, pessoas (sem excluir/perfil/demitir),
// comunicados, recursos, exceções operacional.
export const BUILTIN_GERENTE_RESTAURANTE: AccessProfile = {
  id: "_builtin_gerente_restaurante",
  nome: "Gerente de Restaurante",
  descricao: "Gerente operacional da unidade: opera tudo do dia-a-dia, " +
    "mexe em time/escala/gorjeta operacional, mas não altera perfis de " +
    "acesso, regra de gorjeta ou exclui pessoas (privilégio de master).",
  builtin: true,
  restaurantId: null,                 // disponível em qualquer restaurante
  criadoEm: "2026-05-25T00:00:00.000Z",
  permissions: {
    reservas: {
      verFuturas: true, verPassadas: true,
      criar: true, editar: true, cancelar: true,
      chegou: true, whatsapp: true, notaCliente: true, mesclar: true,
      verCRM: true, editarCliente: true,
      excluirCliente: false,            // só master
      configurar: true,
    },
    horarios: {
      ver: true,
      editarRegular: true, gerenciarExcecoes: true,
      marcarSyncGoogle: true,
      configurarUrlGoogle: false,       // mais "institucional", master decide URL
    },
    sites: {
      ver: true,
      editarTextos: true, editarContato: true,
      editarTema: false,                // identidade visual = master
      uploadCardapio: true,
      uploadAssets: false,              // logo/favicon = master
      publicar: false,                  // publicar/despublicar = master
    },
    ocorrencias: {
      criar: true, ver: true, editar: true, estatistics: true,
    },
    eventos: {
      verLeads: true, editar: true, responder: true,
      configurar: false,                // espaços = master
    },
    compras: {
      verPedidos: true, criarPedido: true, enviarWhatsapp: true, receber: true,
      configurarFornecs: true, configurarProdutos: true,
    },
    contagens: {
      lancar: true, verCiclos: true, abrirFecharCiclo: true, configurar: true,
    },
    checklists: {
      executar: true, verTime: true, configurar: true,
    },
    fichas: {
      ver: true, editar: true, configInsumos: true, configEquips: true,
    },
    escala: {
      verPropria: true, verTime: true,
      editar: true, aprovarTrocas: true, publicar: true, exportar: true,
      planejarPrevista: true,
    },
    fechamentoEscala: {
      ver: true, fechar: true,
      reabrir: false,                   // ato terminal — master only
    },
    gorjetas: {
      verExtratoProprio: true, verTime: true,
      lancar: true,
      configurarRegra: false,           // assembleia = master
      exportar: true,
    },
    vt: {
      verProprio: true, verTime: true,
      configurar: true, registrarPg: true,
    },
    vr: {
      ver: true, configurar: true,
    },
    freelas: {
      verVagas: true, candidatar: true,
      criarVaga: true, atribuir: true, avaliar: true,
      lancarTurnos: true, atribuirValor: true, fecharLote: true,
      acessarDados: true, verRelatoriosLote: true,
    },
    reunioes: {
      verPropria: true, verTodas: true,
      criar: true, editar: true, pauta: true, verPassadas: true,
    },
    trilha: {
      verTime: true, lancar: true,
      configurar: false,                // tipos de evento = master
    },
    ideias: {
      submeter: true, ver: true, moderar: true, executar: true,
    },
    comunicados: {
      ler: true, criar: true, editar: true, deletar: true, verLeituras: true,
    },
    admissao: {
      verCandidaturas: true, triar: true,
      iniciarAdmissao: true, concluirAdmissao: true,
      configurar: false,                // processo = master
    },
    recursos: {
      verCatalogo: true, aprovar: true, configurar: true,
    },
    excecoes: {
      verInconformidades: true, ajustes: true, compatibilidade: true,
      configurar: false,                // regras = master
    },
    pessoas: {
      verLista: true, verDetalhes: true,
      criar: false,                     // só master cria pessoa
      editarDados: true, atribuirCargo: true, atribuirRest: false,
      atribuirPerfil: false,            // só master mexe em perfil
      demitir: false, excluir: false,   // atos terminais = master
    },
    configuracoes: {
      ver: true,
      editarRest: false, configCargos: false, configSeguranca: false,
    },
    perfisAcesso: {
      ver: false, criar: false, editar: false, excluir: false, atribuir: false,
    },
  },
};

// Portal do Empregado — perfil mínimo pra empregado de fábrica. Só dá
// acesso à área pessoal (/portal/:rid) com as seções básicas. Master
// atribui esse perfil a empregado novo; pra dar mais acessos, sobrepõe
// com um perfil customizado.
export const BUILTIN_PORTAL_EMPREGADO: AccessProfile = {
  id: "_builtin_portal_empregado",
  nome: "Portal do Empregado",
  descricao: "Acesso pessoal básico — vê só a própria escala, horários e gorjeta. Não enxerga nada do restante do sistema.",
  builtin: true,
  restaurantId: null,                 // disponível em qualquer restaurante
  criadoEm: "2026-06-06T00:00:00.000Z",
  permissions: {
    portalEmpregado: {
      acessar: true,
      verMinhaEscala: true,
      verMeusHorarios: true,
      verMinhaGorjeta: true,
      // Futuras (verMinhaFolhaPonto, verMeusUniformes, verMeusExames,
      // verMeuVT, acessarFaleComDP) ficam DESLIGADAS por default — master
      // habilita por restaurante quando a UI dessas seções existir.
    },
  },
};

export const BUILTIN_PROFILES: AccessProfile[] = [
  BUILTIN_GERENTE_RESTAURANTE,
  BUILTIN_PORTAL_EMPREGADO,
];

/** Lookup rápido pra resolver perfis built-in por id. */
export const BUILTIN_BY_ID: Record<string, AccessProfile> = Object.fromEntries(
  BUILTIN_PROFILES.map(p => [p.id, p])
);

/** Predicate: id pertence a algum built-in? */
export function isBuiltinProfileId(id: string): boolean {
  return id.startsWith("_builtin_");
}
