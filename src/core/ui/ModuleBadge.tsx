import type { ModuleEtapa } from "../types";

// Badge de maturidade do módulo (Beta / Em dev). DESLIGADO por decisão de
// produto — não exibimos mais os selos em lugar nenhum. A prop `etapa` segue
// no registro de módulos (pode voltar a ser usada), mas nada é renderizado.
export function ModuleBadge(_props: { etapa?: ModuleEtapa; size?: "xs" | "sm" }) {
  return null;
}
