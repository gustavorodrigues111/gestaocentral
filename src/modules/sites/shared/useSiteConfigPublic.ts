import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../core/firebase/config";
import type { SiteConfig } from "../../../core/types";

// Motivo de não-encontrado — ajuda a debugar quando algum gate falhar.
export type NotFoundMotivo =
  | "sem_rid"           // URL sem :rid
  | "sem_config"        // sitesConfig doc não existe pro rid
  | "feature_off";      // feature exigida está desligada

type Options = {
  // Feature exigida em siteConfig.features (ex: "hasReservas"). Se omitido,
  // só checa se o sitesConfig existe — útil pra Eventos onde o gate é
  // diferente (existência de espaços).
  requireFeature?: keyof SiteConfig["features"];
};

// Hook que carrega o SiteConfig público pelo restaurantId (rid). Centraliza
// loading/erro/notfound + checagem de feature, usado por todos os forms
// públicos (Reservas, Trabalhe Conosco, Eventos).
//
// NÃO checa "publicado" — os forms são links que podem ser compartilhados
// antes do site ir ao ar (testes, soft launch).
export function useSiteConfigPublic(
  rid: string | undefined,
  opts: Options = {},
) {
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [notFoundMotivo, setNotFoundMotivo] = useState<NotFoundMotivo | null>(null);

  useEffect(() => {
    if (!rid) {
      setNotFoundMotivo("sem_rid");
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const snap = await getDoc(doc(db, "sitesConfig", rid));
        if (!snap.exists()) {
          console.warn("[form-publico] sitesConfig não existe pro rid:", rid);
          setNotFoundMotivo("sem_config");
          return;
        }
        const data = { id: snap.id, ...snap.data() } as SiteConfig;
        if (opts.requireFeature && !data.features?.[opts.requireFeature]) {
          console.warn(
            "[form-publico] feature desligada pro rid:",
            rid,
            opts.requireFeature,
          );
          setNotFoundMotivo("feature_off");
          return;
        }
        setSiteConfig(data);
      } catch (e) {
        console.error(e);
        setErro("Erro ao carregar página. Tenta de novo em alguns minutos.");
      } finally {
        setLoading(false);
      }
    })();
    // opts.requireFeature é primitivo (string|undefined) — safe na dep array
  }, [rid, opts.requireFeature]);

  return { siteConfig, loading, erro, notFoundMotivo };
}

// Helper pra montar a mensagem de erro detalhada do motivo
export function explicarNotFound(
  motivo: NotFoundMotivo | null,
  featureLabel?: string,
): string {
  if (motivo === "sem_rid") return "Link inválido. Confere a URL ou contata o restaurante.";
  if (motivo === "sem_config") return "Esse restaurante ainda não tem site configurado. Cria em Sites no admin.";
  if (motivo === "feature_off") {
    return featureLabel
      ? `O restaurante ainda não habilitou ${featureLabel}. Liga em Sites → Geral → Features.`
      : "A feature exigida está desligada. Liga em Sites → Geral → Features.";
  }
  return "Confere o link ou contata o restaurante.";
}
