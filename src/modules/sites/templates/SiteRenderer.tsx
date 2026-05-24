// SiteRenderer: escolhe qual template visual renderizar baseado em
// siteConfig.templateId. Cada template é um componente totalmente
// independente que recebe o siteConfig e renderiza o site público inteiro.
//
// Templates implementados:
//   - lobozo  → caipira refinado (verde + dourado, DM Serif Display)
//   - sororoca → (próxima fase)
//   - puba     → (próxima fase)
//   - default  → fallback genérico (limpo, sem marca específica)

import type { SiteConfig } from "../../../core/types";
import { LobozoTemplate } from "./lobozo/LobozoTemplate";
import { DefaultTemplate } from "./default/DefaultTemplate";

type Props = { siteConfig: SiteConfig };

export function SiteRenderer({ siteConfig }: Props) {
  switch (siteConfig.templateId) {
    case "lobozo":
      return <LobozoTemplate siteConfig={siteConfig} />;
    // case "sororoca": return <SororocaTemplate siteConfig={siteConfig} />;
    // case "puba":     return <PubaTemplate siteConfig={siteConfig} />;
    case "default":
    default:
      return <DefaultTemplate siteConfig={siteConfig} />;
  }
}
