// SiteRenderer: escolhe qual template visual renderizar baseado em
// siteConfig.templateId.
//
// Templates:
//   - "personalizado": base completa, adapta a qualquer marca via cor/fonte/logo
//   - "default": layout minimalista
//   - "lobozo" (legado): alias de "personalizado" pra retrocompat de docs antigos

import type { SiteConfig } from "../../../core/types";
import { PersonalizadoTemplate } from "./personalizado/PersonalizadoTemplate";
import { DefaultTemplate } from "./default/DefaultTemplate";

type Props = { siteConfig: SiteConfig };

export function SiteRenderer({ siteConfig }: Props) {
  switch (siteConfig.templateId) {
    case "personalizado":
    case "lobozo":         // alias legado
      return <PersonalizadoTemplate siteConfig={siteConfig} />;
    case "default":
    default:
      return <DefaultTemplate siteConfig={siteConfig} />;
  }
}
