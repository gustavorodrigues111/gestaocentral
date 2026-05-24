import { useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { SiteConfig } from "../../../core/types";
import { findFonte, googleFontsUrl } from "../templates/fontesDisponiveis";

// Shell visual compartilhado pelos forms públicos (Reservas, Trabalhe,
// Eventos). Aplica tema/fontes/logo do SiteConfig do restaurante, com
// header (logo + voltar pro site) e footer "Powered by Planejamento.app".
//
// Cada form passa seu conteúdo via children. O shell cuida:
//   - Background + cor de texto + fonte de corpo (do tema)
//   - Header sticky: logo (ou nome) à esquerda, "← Voltar pro site" à direita
//   - Card branco centralizado com título (fonte heading + cor primária)
//   - Footer "Powered by"
//
// O siteConfig é opcional — se vier null, usa defaults neutros (fallback
// pra quando o restaurante não configurou site ainda).

type Props = {
  siteConfig: SiteConfig | null;
  titulo: string;
  subtitulo?: ReactNode;
  // Largura máxima do card. Padrão 560px (forms simples). Forms maiores
  // (Eventos) podem passar 720 ou 800.
  maxWidth?: number;
  children: ReactNode;
};

// Defaults neutros pra fallback
const DEFAULT_BG = "#f7f3e9";
const DEFAULT_PRIMARIA = "#1a5c2a";
const DEFAULT_SECUNDARIA = "#d4af37";
const DEFAULT_TEXTO = "#1a1a1a";

export function SiteFormShell({ siteConfig, titulo, subtitulo, maxWidth = 560, children }: Props) {
  const tema = siteConfig?.tema;
  const corPrimaria   = tema?.corPrimaria   || DEFAULT_PRIMARIA;
  const corSecundaria = tema?.corSecundaria || DEFAULT_SECUNDARIA;
  const corFundo      = tema?.corFundo      || DEFAULT_BG;
  const corTexto      = tema?.corTexto      || DEFAULT_TEXTO;
  const fonteHeading  = findFonte(tema?.fonteHeading)?.cssFamily || "'DM Serif Display', Georgia, serif";
  const fonteCorpo    = findFonte(tema?.fonteCorpo)?.cssFamily   || "'Inter', system-ui, sans-serif";

  // Carrega Google Fonts dinamicamente (mesma estratégia do template público).
  useEffect(() => {
    const links: HTMLLinkElement[] = [];
    function addLink(href: string, opts: Partial<HTMLLinkElement> = {}) {
      const l = document.createElement("link");
      Object.assign(l, opts);
      l.href = href;
      document.head.appendChild(l);
      links.push(l);
    }
    addLink("https://fonts.googleapis.com", { rel: "preconnect" });
    addLink("https://fonts.gstatic.com", { rel: "preconnect", crossOrigin: "anonymous" });
    const ids = [
      tema?.fonteHeading || "dm-serif-display",
      tema?.fonteCorpo   || "inter",
    ];
    const url = googleFontsUrl(ids);
    if (url) addLink(url, { rel: "stylesheet" });
    return () => { links.forEach(l => l.remove()); };
  }, [tema?.fonteHeading, tema?.fonteCorpo]);

  // Link de volta pro site só aparece se tem slug + site publicado.
  // (sem isso o link levaria pra /site/<slug> que diria "em manutenção")
  const voltarHref = (siteConfig?.slug && siteConfig?.publicado)
    ? `/site/${siteConfig.slug}`
    : null;

  return (
    <div style={{
      minHeight: "100vh",
      backgroundColor: corFundo,
      color: corTexto,
      fontFamily: fonteCorpo,
    }}>
      {/* Header sticky com logo + voltar pro site */}
      <header style={{
        position: "sticky", top: 0, zIndex: 50,
        backgroundColor: `${corFundo}f2`,           // 95% opaco
        backdropFilter: "blur(8px)",
        borderBottom: `1px solid ${corSecundaria}30`,
      }}>
        <div style={{
          maxWidth: 900, margin: "0 auto",
          padding: "12px 20px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12,
        }}>
          {/* Logo / nome do restaurante */}
          <div style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
            {siteConfig?.logoUrl ? (
              <img
                src={siteConfig.logoUrl}
                alt="Logo"
                style={{ height: 32, width: "auto", display: "block" }}
              />
            ) : (
              <span style={{
                fontFamily: fonteHeading,
                fontSize: 20, color: corPrimaria, letterSpacing: "0.02em",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>
                {siteConfig?.slug || ""}
              </span>
            )}
          </div>

          {/* Voltar pro site */}
          {voltarHref && (
            <a
              href={voltarHref}
              style={{
                fontSize: 14, color: corPrimaria,
                textDecoration: "none", fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              ← Voltar pro site
            </a>
          )}
        </div>
      </header>

      {/* Conteúdo */}
      <main style={{ padding: "32px 16px 24px" }}>
        <div style={{ maxWidth, margin: "0 auto" }}>
          <div style={{
            backgroundColor: "#ffffff",
            borderRadius: 16,
            border: `1px solid ${corSecundaria}30`,
            padding: "32px 28px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
          }}>
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <h1 style={{
                fontFamily: fonteHeading,
                fontSize: 28, color: corPrimaria,
                margin: 0, letterSpacing: "0.01em",
              }}>
                {titulo}
              </h1>
              {subtitulo && (
                <p style={{
                  fontSize: 14, color: "#666",
                  margin: "8px 0 0", lineHeight: 1.5,
                }}>
                  {subtitulo}
                </p>
              )}
            </div>
            {children}
          </div>
          <p style={{
            textAlign: "center", fontSize: 11,
            color: "#999", marginTop: 16,
          }}>
            Powered by Planejamento.app
          </p>
        </div>
      </main>
    </div>
  );
}

// Variantes de mensagem (sucesso / não-encontrado) — reaproveita tema do
// siteConfig pra ficar coerente com o resto do form.

type ScreenProps = {
  siteConfig: SiteConfig | null;
  icone: string;
  titulo: string;
  mensagem: ReactNode;
};

export function SiteFormScreen({ siteConfig, icone, titulo, mensagem }: ScreenProps) {
  const tema = siteConfig?.tema;
  const corPrimaria   = tema?.corPrimaria   || DEFAULT_PRIMARIA;
  const corSecundaria = tema?.corSecundaria || DEFAULT_SECUNDARIA;
  const corFundo      = tema?.corFundo      || DEFAULT_BG;
  const corTexto      = tema?.corTexto      || DEFAULT_TEXTO;
  const fonteHeading  = findFonte(tema?.fonteHeading)?.cssFamily || "'DM Serif Display', Georgia, serif";
  const fonteCorpo    = findFonte(tema?.fonteCorpo)?.cssFamily   || "'Inter', system-ui, sans-serif";

  // Mesmo loading de fontes do shell — replica pra screens standalone
  useEffect(() => {
    const links: HTMLLinkElement[] = [];
    function addLink(href: string, opts: Partial<HTMLLinkElement> = {}) {
      const l = document.createElement("link");
      Object.assign(l, opts);
      l.href = href;
      document.head.appendChild(l);
      links.push(l);
    }
    addLink("https://fonts.googleapis.com", { rel: "preconnect" });
    addLink("https://fonts.gstatic.com", { rel: "preconnect", crossOrigin: "anonymous" });
    const url = googleFontsUrl([
      tema?.fonteHeading || "dm-serif-display",
      tema?.fonteCorpo   || "inter",
    ]);
    if (url) addLink(url, { rel: "stylesheet" });
    return () => { links.forEach(l => l.remove()); };
  }, [tema?.fonteHeading, tema?.fonteCorpo]);

  const voltarHref = (siteConfig?.slug && siteConfig?.publicado)
    ? `/site/${siteConfig.slug}`
    : null;

  return (
    <div style={{
      minHeight: "100vh",
      backgroundColor: corFundo,
      color: corTexto,
      fontFamily: fonteCorpo,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
    }}>
      <div style={{
        backgroundColor: "#ffffff",
        borderRadius: 16,
        border: `1px solid ${corSecundaria}30`,
        padding: "40px 28px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
        maxWidth: 480, textAlign: "center",
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>{icone}</div>
        <h1 style={{
          fontFamily: fonteHeading,
          fontSize: 24, color: corPrimaria,
          margin: "0 0 12px",
        }}>
          {titulo}
        </h1>
        <div style={{ fontSize: 14, color: "#666", lineHeight: 1.6 }}>
          {mensagem}
        </div>
        {voltarHref && (
          <a
            href={voltarHref}
            style={{
              display: "inline-block",
              marginTop: 24,
              fontSize: 14, color: corPrimaria,
              textDecoration: "none", fontWeight: 500,
            }}
          >
            ← Voltar pro site
          </a>
        )}
      </div>
    </div>
  );
}

// Estilo pronto de botão primário (cor primária do tema). Use no submit
// dos forms pra ficar coerente entre as 3 telas.
export function botaoPrimarioStyle(siteConfig: SiteConfig | null): CSSProperties {
  const corPrimaria = siteConfig?.tema?.corPrimaria || DEFAULT_PRIMARIA;
  return {
    backgroundColor: corPrimaria,
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "12px 20px",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    width: "100%",
    transition: "opacity 0.15s",
  };
}
