// Bridge entre AccessProfile (sistema novo, granular) e o sistema legado
// (RestaurantPermissions com ver/configurar + PessoaSpecialPermissions).
//
// Por que existe: o sistema novo expõe ~155 ações granulares mas as ~24
// pages atuais ainda checam canVer/canConfigurar legados. Em vez de migrar
// cada page (refactor doloroso, error-prone), o AuthContext aplica esse
// mapeador no momento que expõe a pessoa. Resultado:
//
//   profile.permissions.reservas = { criar: true, editar: true, ... }
//                                 ↓
//   pessoa.permissions.<rid>.reservas = { ver: true, configurar: true }
//                                 ↓
//   canVer(...)/canConfigurar(...) já existentes funcionam.
//
// Trade-off: perde granularidade nos checks legados. Quem tem profile com
// `criar=true,editar=false` aparece como `configurar=true` (algumas pages
// vão permitir editar mesmo bloqueado no perfil). Quando migrarmos a page
// pra canAcao() granular, esse trade-off some.

import type {
  AccessProfile, PermissoesPerfil, Pessoa, PessoaSpecialPermissions,
  RestaurantPermissions,
} from "../types";
import { resolverPerfil } from "./permissions";

/**
 * Aplica os perfis (profileIds) da pessoa sobre suas permissions efetivas.
 * Pra cada rid, calcula permissions[rid] e specialPermissions[rid]
 * DERIVADAS do perfil — ignora completamente qualquer permissions legado
 * que possa existir no doc Firestore (Rodada 5 removeu o sistema antigo).
 *
 * Sem profileId pro rid → pessoa fica SEM permissões nesse restaurante.
 * Master é retornado intacto (bypass via isMaster nas checks).
 */
export function aplicarPerfisNaPessoa(
  pessoa: Pessoa,
  perfisCustom: AccessProfile[],
): Pessoa {
  if (pessoa.isMaster) return pessoa;
  const profileIds = pessoa.profileIds || {};

  // Zera permissions e specialPermissions — vão ser recalculadas só a
  // partir do perfil. Quem não tem profileId pra um rid → sem acesso.
  const novasPermissions: Record<string, ReturnType<typeof mapearProfilePraLegacy>> = {};
  const novasSpecials: Record<string, PessoaSpecialPermissions> = {};

  for (const [rid, profileId] of Object.entries(profileIds)) {
    if (!profileId) continue;
    const profile = resolverPerfil(profileId, perfisCustom);
    if (!profile) continue;
    novasPermissions[rid] = mapearProfilePraLegacy(profile.permissions);
    novasSpecials[rid] = mapearProfilePraSpecial(profile.permissions);
  }

  return {
    ...pessoa,
    permissions: novasPermissions,
    specialPermissions: novasSpecials,
  };
}

// ─── Mapeamento: profile.permissions[mod][acao] → { ver, configurar } ────

// Ações estritamente de leitura — quando o perfil só tem essas habilitadas
// num módulo, o legado canConfigurar fica false (mas canVer fica true).
//
// NÃO incluem ações que SÃO ESCRITA DO PRÓPRIO USUÁRIO (submeter ideia,
// candidatar-se a freela, executar checklist). Essas precisam ser
// classificadas como "configurar" no bridge senão telas legadas que
// gateiam botões "+ Nova ideia" / "Candidatar" / "Executar" por
// canConfigurar não mostram o botão pra quem tem só essa permissão.
const ACOES_LEITURA = new Set([
  "ver", "verPropria", "verExtratoProprio", "verLista", "verDetalhes",
  "verCRM", "verFuturas", "verPassadas", "verTime", "verPedidos",
  "verCiclos", "verLeads", "verCandidaturas", "verCatalogo", "verVagas",
  "verTodas", "verLeituras", "verRelatoriosLote", "verInconformidades",
  "verProprio", "ler",
  "compatibilidade", "estatistics", "exportar",
]);

// Ações específicas que são SELF-SERVICE: quando a pessoa só tem essas
// num módulo, ela NÃO deve abrir a tela admin do módulo — ela tem o
// "Meu Portal" pra ver seus próprios dados. Por isso essas ações NÃO
// contam pra "ver legado" — `canVer` fica false e a página de gestão
// bloqueia/redireciona. O Meu Portal tem suas próprias checagens
// (independente do legado).
//
// Indexado por moduleId pra distinguir "verPropria" de escala (self) de
// "verPropria" de trilha (que não está em self-service hoje).
const ACOES_SELF_SERVICE: Record<string, Set<string>> = {
  escala:   new Set(["verPropria"]),
  gorjetas: new Set(["verExtratoProprio"]),
  vt:       new Set(["verProprio"]),
  reunioes: new Set(["verPropria"]),
};

function mapearProfilePraLegacy(perms: PermissoesPerfil): RestaurantPermissions {
  const out: RestaurantPermissions = {};
  for (const [moduleId, acoes] of Object.entries(perms)) {
    const ativas = Object.entries(acoes).filter(([, v]) => v === true);
    if (ativas.length === 0) continue;

    // Filtra ações self-service: NÃO contam pra abrir tela admin desse módulo
    // (a pessoa vê seus dados no Meu Portal, não na tela de gestão).
    const selfServiceDoModulo = ACOES_SELF_SERVICE[moduleId];
    const ativasNaoSelf = selfServiceDoModulo
      ? ativas.filter(([aid]) => !selfServiceDoModulo.has(aid))
      : ativas;
    if (ativasNaoSelf.length === 0) continue;  // só self-service -> não entra na tela admin

    // ver = qualquer ação NÃO-self-service habilitada
    const hasVer = true;
    // configurar = qualquer ação "de escrita" habilitada
    const hasConfigurar = ativasNaoSelf.some(([aid]) => !ACOES_LEITURA.has(aid));
    out[moduleId] = { ver: hasVer, configurar: hasConfigurar };
  }
  return out;
}

// ─── Mapeamento de specialPermissions ─────────────────────────────────────
// Algumas ações sensíveis do sistema antigo viviam em specialPermissions.
// Mapeamos pra delas continuarem funcionando quando rege um profile.

function mapearProfilePraSpecial(perms: PermissoesPerfil): PessoaSpecialPermissions {
  return {
    // pessoas.excluir → pessoasExcluir
    pessoasExcluir: perms.pessoas?.excluir === true,
    // gorjetas.configurarRegra → gorjetasConfigurarRegra (assembleia)
    gorjetasConfigurarRegra: perms.gorjetas?.configurarRegra === true,
    // fechamentoEscala.reabrir → escalaReabrir
    escalaReabrir: perms.fechamentoEscala?.reabrir === true,
    // sites.uploadCardapio → sitesCardapio
    sitesCardapio: perms.sites?.uploadCardapio === true,
    // sites.editarTextos|editarContato|editarTema|uploadAssets → sitesGeral
    sitesGeral: perms.sites?.editarTextos === true
      || perms.sites?.editarContato === true
      || perms.sites?.editarTema === true
      || perms.sites?.uploadAssets === true,
  };
}
