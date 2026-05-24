// SiteRenderer: hoje só um template (personalizado) — atende todos os
// restaurantes via cor/fonte/logo/textos editáveis no admin. Valores
// legados ("default", "lobozo", undefined) caem aqui também.
//
// Se um dia tiver mais de um layout visual, o switch volta aqui.

import type { SiteConfig } from "../../../core/types";
import { PersonalizadoTemplate } from "./personalizado/PersonalizadoTemplate";

type Props = { siteConfig: SiteConfig };

export function SiteRenderer({ siteConfig }: Props) {
  return <PersonalizadoTemplate siteConfig={siteConfig} />;
}
