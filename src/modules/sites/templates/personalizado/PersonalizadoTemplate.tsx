// Template "Personalizado" — base completa, pensada pra adaptar-se à
// identidade de qualquer marca por meio de cor/fonte/logo no admin.
// Layout: header sticky → hero grande → história → cardápio → horário
// → laje/eventos → reservas → delivery → trabalhe → contato → footer.
//
// Defaults vêm com paleta verde+dourado + DM Serif Display + Inter
// (inspirado no Lobozó), mas o usuário sobrescreve no editor.
//
// Pesos performance:
//  - Google Fonts com display=swap (não bloqueia)
//  - 1 foto hero opcional (cor sólida quando ausente)
//  - Mapa = link Google Maps (sem iframe pesado)
//  - Cardápio = botão abre PDF (sem embed)
//  - Sem libs extras

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../../core/firebase/config";
import type { SiteConfig, CardapioEstruturado } from "../../../../core/types";
import { IconeCardapioView } from "../../../cardapio/iconesCardapio";
import { agruparHorarios, proximasExcecoes } from "../../shared/horarioUtils";
import { formatarTelefoneExibicao } from "../../shared/telefoneUtils";
import { enderecoLinhaUm, enderecoLinhaDois, googleMapsLink, googleMapsEmbedUrl } from "../../shared/enderecoUtils";
import { findFonte, googleFontsUrl } from "../fontesDisponiveis";
import { normalizarOrdem, type SecaoId } from "../ordemSecoes";

type Props = { siteConfig: SiteConfig };

// Defaults — usados quando cfg.tema não tem override
const PADRAO_PRIMARIA = "#1a5c2a";   // verde-mata
const PADRAO_SECUNDARIA = "#b8923a"; // dourado-velho
const PADRAO_FUNDO = "#f7f3e9";       // creme
const PADRAO_TEXTO = "#1a1a1a";

export function PersonalizadoTemplate({ siteConfig: cfg }: Props) {
  // Cores dinâmicas — pega do tema se preenchido, senão usa defaults da marca
  const corPrimaria = cfg.tema.corPrimaria || PADRAO_PRIMARIA;
  const corSecundaria = cfg.tema.corSecundaria || PADRAO_SECUNDARIA;
  const corFundo = cfg.tema.corFundo || PADRAO_FUNDO;
  const corTexto = cfg.tema.corTexto || PADRAO_TEXTO;

  // Escalas tipográficas — 5 categorias × 2 devices = 10 controles
  // independentes. Multiplicam os tamanhos base. Clamp em [0.85, 1.40].
  //
  // O template detecta `isMobile` (via window.innerWidth com listener) e
  // escolhe a escala apropriada por categoria. Exceção: Menu já era
  // device-specific antes — desktop/mobile ficam separados sempre (NavLink
  // só desktop, MobileMenuLink só mobile). As outras 4 categorias usam
  // `isMobile ? mobile : desktop`.
  //
  // Backward compat: 4 níveis de configs antigas. Cada uma cai pro próximo
  // fallback se o campo novo não existir. Ordem do mais específico pro
  // mais genérico — tipo cascata de CSS.
  const clampEscala = (v: number | undefined, fallback?: number) =>
    Math.min(1.40, Math.max(0.85, v ?? fallback ?? 1));
  const tm = cfg.tema;                    // alias curto (não colide com t() de tradução)
  const legPeq = tm.escalaPequenos;       // config v2 (antes da separação menu/botões)
  const legHero = tm.escalaHero;
  const legTitulos = tm.escalaTitulos;
  const legCorpo = tm.escalaCorpo ?? tm.escalaTexto;
  const legBotoes = tm.escalaBotoes;

  // 10 escalas finais — uma por categoria × device. Cascata de fallbacks.
  const escalaHeroDesktop = clampEscala(tm.escalaHeroDesktop, legHero);
  const escalaHeroMobile = clampEscala(tm.escalaHeroMobile, legHero);
  const escalaTitulosDesktop = clampEscala(tm.escalaTitulosDesktop, legTitulos);
  const escalaTitulosMobile = clampEscala(tm.escalaTitulosMobile, legTitulos);
  const escalaCorpoDesktop = clampEscala(tm.escalaCorpoDesktop, legCorpo);
  const escalaCorpoMobile = clampEscala(tm.escalaCorpoMobile, legCorpo);
  const escalaMenuDesktop = clampEscala(tm.escalaMenuDesktop, legPeq);
  const escalaMenuMobile = clampEscala(tm.escalaMenuMobile, legPeq);
  const escalaBotoesDesktop = clampEscala(tm.escalaBotoesDesktop, legBotoes ?? legPeq);
  const escalaBotoesMobile = clampEscala(tm.escalaBotoesMobile, legBotoes ?? legPeq);

  // Pra clamp() do CSS — escala cada componente em px (ignora vw, que é
  // viewport-relative e não deve mudar). Ex: clampEscalado(36, 9, 56, escala)
  // → "clamp(43px, 9vw, 67px)" com escala 1.20.
  const clampEscalado = (minPx: number, vw: number, maxPx: number, escala: number) =>
    `clamp(${Math.round(minPx * escala)}px, ${vw}vw, ${Math.round(maxPx * escala)}px)`;

  // Fontes — resolve via catálogo (id) ou fallback pros defaults da marca.
  // Heading/Subtitulo/Corpo são 3 fontes independentes selecionáveis no admin.
  const fonteHeading = findFonte(cfg.tema.fonteHeading)?.cssFamily
    || "'DM Serif Display', Georgia, serif";
  const fonteSubtitulo = findFonte(cfg.tema.fonteSubtitulo)?.cssFamily
    || fonteHeading; // default: usa a mesma do heading
  const fonteCorpo = findFonte(cfg.tema.fonteCorpo)?.cssFamily
    || "'Inter', system-ui, sans-serif";

  // Detecta mobile pra ajustar header (troca nav inline por hamburger).
  // 768px = breakpoint padrão Tailwind md.
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  );
  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth < 768); }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // Menu hamburger (só mobile) — abre dropdown abaixo do header com links
  const [menuAberto, setMenuAberto] = useState(false);
  useEffect(() => {
    if (!isMobile) setMenuAberto(false);
  }, [isMobile]);

  // Escalas EFETIVAS (resolvem isMobile) — usadas pelos helpers tx() abaixo
  // pra elementos que renderizam o mesmo componente em ambos os devices
  // (hero h1, h2 de seção, parágrafos, botões). Menu é tratado à parte
  // porque NavLink (desktop-only) e MobileMenuLink (mobile-only) são
  // componentes distintos — cada um vincula direto ao seu device.
  const escalaHero = isMobile ? escalaHeroMobile : escalaHeroDesktop;
  const escalaTitulos = isMobile ? escalaTitulosMobile : escalaTitulosDesktop;
  const escalaCorpo = isMobile ? escalaCorpoMobile : escalaCorpoDesktop;
  const escalaBotao = isMobile ? escalaBotoesMobile : escalaBotoesDesktop;

  // Helpers — converte um tamanho base (em px) pro escalado, arredondado.
  // Pras categorias com clamp() (Hero, Títulos), usar clampEscalado() direto
  // com a escala apropriada (sem helper extra). `tx` é alias antigo.
  const txCorpo = (px: number) => Math.round(px * escalaCorpo);
  const txMenuDesktop = (px: number) => Math.round(px * escalaMenuDesktop);
  const txMenuMobile = (px: number) => Math.round(px * escalaMenuMobile);
  const txBotao = (px: number) => Math.round(px * escalaBotao);
  const tx = txCorpo;

  // Scrolled: vira true quando user rola um pouquinho.
  // Threshold baixo (~60px) porque o header começa EXPANDIDO (bege +
  // logo grande em cores próprias) e encolhe assim que começa a rolar.
  // O hero vermelho com texto/CTA fica abaixo do header expandido.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    function onScroll() { setScrolled(window.scrollY > 60); }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Carrega Google Fonts dinamicamente — só as fontes que estão sendo usadas
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
    // Pega os ids das fontes ativas (heading, subtítulo, corpo)
    // + sempre garante DM Serif Display + Inter (defaults do Lobozó)
    const ids = [
      cfg.tema.fonteHeading || "dm-serif-display",
      cfg.tema.fonteSubtitulo || cfg.tema.fonteHeading || "dm-serif-display",
      cfg.tema.fonteCorpo || "inter",
    ];
    const url = googleFontsUrl(ids);
    if (url) addLink(url, { rel: "stylesheet" });
    return () => { links.forEach(l => l.remove()); };
  }, [cfg.tema.fonteHeading, cfg.tema.fonteSubtitulo, cfg.tema.fonteCorpo]);

  // Hero: cor sólida primária ou imagem com overlay escuro neutro
  // (overlay preto preserva qualquer cor da imagem, ao contrário do verde
  // que tava antes que dava muddy).
  const heroBg = cfg.heroImagemUrl
    ? `linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.65)), url(${cfg.heroImagemUrl}) center/cover`
    : corPrimaria;

  // Destino dos CTAs de reserva: módulo interno (/reservas/:rid) ou sistema
  // externo (Get In) quando configurado. Externo abre em nova aba.
  const reservasUrlExt = cfg.reservasModo === "externo" ? (cfg.reservasUrlExterna || "").trim() : "";
  const reservasExterno = !!reservasUrlExt;
  const reservasHref = reservasUrlExt || `/reservas/${cfg.restaurantId}`;

  const grupos = agruparHorarios(cfg.horarios);
  const excecoes = proximasExcecoes(cfg.excecoes, 3);

  const whatsappRede = cfg.redes.find(r => r.tipo === "whatsapp");
  const waLink = whatsappRede?.url || (cfg.telefone
    ? `https://api.whatsapp.com/send?phone=${cfg.telefone.replace(/\D/g, "")}`
    : null);

  // Textos editáveis com defaults da marca Lobozó.
  // Pra editar, vai em Sites → Geral → "Textos das seções".
  const t = (k: keyof NonNullable<typeof cfg.textos>, def: string): string => {
    return cfg.textos?.[k] || def;
  };

  // Estilo do título h2 das seções — reaproveitado no layout pareado
  // (2 colunas no desktop). Section single-col faz tamanho maior inline.
  const tituloSectionStyle: React.CSSProperties = {
    fontFamily: fonteHeading,
    fontSize: clampEscalado(28, 4, 40, escalaTitulos),
    textAlign: "center",
    margin: "0 0 32px 0",
    color: corPrimaria,
    letterSpacing: "-0.01em",
    whiteSpace: "pre-wrap",
  };

  return (
    <div style={{
      fontFamily: fonteCorpo,
      color: "#1a1a1a",
      backgroundColor: corFundo,
      minHeight: "100vh",
    }}>
      {/* HEADER — bege sempre visível, EXPANDIDO (logo grande em cores
          próprias) no topo da página; ENCOLHE pra compacto quando o user
          rola. Logo sempre nas cores originais (sem filtro branco). Hero
          vermelho com texto + CTA vive abaixo do header. */}
      <header style={{
        position: "sticky", top: 0, zIndex: 50,
        backgroundColor: corFundo,                                // bege sólido sempre
        borderBottom: scrolled ? `1px solid ${corSecundaria}30` : "1px solid transparent",
        transition: "border-color 0.3s ease",
      }}>
        <div style={{
          maxWidth: 1100, margin: "0 auto",
          padding: scrolled
            ? (isMobile ? "10px 16px" : "12px 20px")
            : (isMobile ? "20px 16px 16px" : "28px 20px 20px"),
          display: "flex",
          flexDirection: scrolled ? "row" : "column",
          alignItems: "center",
          justifyContent: scrolled ? "space-between" : "center",
          gap: scrolled ? 16 : 14,
          transition: "padding 0.3s ease, gap 0.3s ease",
          // Position relative pra absolutamente posicionar o hamburger no
          // canto superior direito quando expandido em mobile.
          position: "relative",
        }}>
          {/* Logo — sempre em cores próprias (sem filtro). Animação suave
              de tamanho entre expandido (~80/100px) e compacto (~32/36px). */}
          <div style={{
            fontFamily: fonteHeading,
            color: corPrimaria,
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.3s ease",
          }}>
            {cfg.logoUrl
              ? <img
                  src={cfg.logoUrl}
                  alt="Logo"
                  style={{
                    height: scrolled
                      ? (isMobile ? 32 : 36)
                      : (isMobile ? 72 : 100),
                    width: "auto", display: "block",
                    transition: "height 0.3s ease",
                  }}
                />
              : (
                <span style={{
                  fontSize: scrolled ? 22 : (isMobile ? 36 : 48),
                  letterSpacing: "0.02em",
                  transition: "font-size 0.3s ease",
                }}>
                  {cfg.slogan || cfg.slug}
                </span>
              )}
          </div>
          {/* Menu/hamburger — o header bege é sólido sempre, então o nav
              não precisa mais de "chip" com blur. Visual simples e direto. */}
          {(() => {
            // Sem chip — o header já é bege sólido, então fundo transparente
            // funciona sem precisar de pílula destacada.
            const chipBg = "transparent";
            const chipBorder = "1px solid transparent";
            const chipBlur = "none";
            const chipTransition = "background-color 0.25s ease, border-color 0.25s ease";

            if (isMobile) {
              // Hamburger em 2 posições:
              //   Scrolled:    no flow, à direita do logo pequeno (row)
              //   Expandido:   absoluto no canto superior direito, menor —
              //                deixa o logo grande respirar centralizado
              //                sem o botão competindo pela atenção.
              const expandido = !scrolled;
              return (
                <button
                  type="button"
                  onClick={() => setMenuAberto(v => !v)}
                  aria-label={menuAberto ? "Fechar menu" : "Abrir menu"}
                  style={{
                    background: chipBg,
                    backdropFilter: chipBlur,
                    border: chipBorder,
                    borderRadius: 999,
                    padding: expandido ? 6 : 8,
                    cursor: "pointer",
                    display: "flex", flexDirection: "column",
                    gap: expandido ? 3 : 4,
                    width: expandido ? 32 : 40,
                    height: expandido ? 32 : 40,
                    alignItems: "center", justifyContent: "center",
                    color: corPrimaria,
                    transition: chipTransition + ", width 0.3s ease, height 0.3s ease, padding 0.3s ease",
                    position: expandido ? "absolute" : "static",
                    top: expandido ? 16 : undefined,
                    right: expandido ? 16 : undefined,
                  }}
                >
                  {/* Hambúrguer estilizado: 3 barras → vira X quando aberto.
                      No estado expandido, barras menores também. */}
                  {[0, 1, 2].map(i => {
                    const w = expandido ? 18 : 22;
                    const transform = menuAberto
                      ? (i === 0 ? `translateY(${expandido ? 5 : 6}px) rotate(45deg)`
                          : i === 2 ? `translateY(-${expandido ? 5 : 6}px) rotate(-45deg)` : "none")
                      : "none";
                    const opacity = menuAberto && i === 1 ? 0 : 1;
                    return (
                      <span key={i} style={{
                        display: "block",
                        width: w,
                        height: 2,
                        backgroundColor: corPrimaria,
                        transition: "transform 0.2s, opacity 0.2s, width 0.3s ease",
                        transform,
                        opacity,
                      }} />
                    );
                  })}
                </button>
              );
            }
            return (
              <nav style={{
                display: "flex", gap: 4,
                fontSize: txMenuDesktop(14), fontWeight: 500,
                backgroundColor: chipBg,
                backdropFilter: chipBlur,
                border: chipBorder,
                borderRadius: 999,
                padding: "6px 12px",
                transition: chipTransition,
              }}>
                <NavLink href="#historia" cor={corTexto}>Sobre</NavLink>
                <NavLink href="#cardapio" cor={corTexto}>Cardápio</NavLink>
                <NavLink href="#horario" cor={corTexto}>Horário</NavLink>
                {cfg.features.hasLaje && <NavLink href="#laje" cor={corTexto}>Laje</NavLink>}
                {cfg.features.hasReservas && <NavLink href={reservasHref} externo={reservasExterno} cor={corTexto}>Reservas</NavLink>}
                {cfg.features.hasDelivery && cfg.delivery && cfg.delivery.length > 0 && <NavLink href="#delivery" cor={corTexto}>Delivery</NavLink>}
                <NavLink href="#contato" cor={corTexto}>Contato</NavLink>
              </nav>
            );
          })()}
        </div>
        {/* Dropdown do menu mobile — aparece abaixo do header sticky */}
        {isMobile && menuAberto && (
          <div style={{
            borderTop: `1px solid ${corSecundaria}30`,
            backgroundColor: "rgba(247,243,233,0.98)",
            backdropFilter: "blur(8px)",
          }}>
            <nav style={{
              display: "flex", flexDirection: "column",
              padding: "8px 0",
              maxWidth: 1100, margin: "0 auto",
            }}>
              <MobileMenuLink href="#historia" onClick={() => setMenuAberto(false)} cor={corTexto} corBorda={corSecundaria}>
                Sobre
              </MobileMenuLink>
              <MobileMenuLink href="#cardapio" onClick={() => setMenuAberto(false)} cor={corTexto} corBorda={corSecundaria}>
                Cardápio
              </MobileMenuLink>
              <MobileMenuLink href="#horario" onClick={() => setMenuAberto(false)} cor={corTexto} corBorda={corSecundaria}>
                Horário
              </MobileMenuLink>
              {cfg.features.hasLaje && (
                <MobileMenuLink href="#laje" onClick={() => setMenuAberto(false)} cor={corTexto} corBorda={corSecundaria}>
                  Laje
                </MobileMenuLink>
              )}
              {cfg.features.hasReservas && (
                <MobileMenuLink href={reservasHref} externo={reservasExterno} onClick={() => setMenuAberto(false)} cor={corTexto} corBorda={corSecundaria}>
                  Reservas
                </MobileMenuLink>
              )}
              {cfg.features.hasDelivery && cfg.delivery && cfg.delivery.length > 0 && (
                <MobileMenuLink href="#delivery" onClick={() => setMenuAberto(false)} cor={corTexto} corBorda={corSecundaria}>
                  Delivery
                </MobileMenuLink>
              )}
              <MobileMenuLink href="#contato" onClick={() => setMenuAberto(false)} cor={corTexto} corBorda={corSecundaria}>
                Contato
              </MobileMenuLink>
            </nav>
          </div>
        )}
      </header>

      {/* HERO */}
      <section style={{
        background: heroBg,
        color: corFundo,
        display: "flex", alignItems: "center",
        padding: isMobile ? "56px 20px" : "72px 20px",
      }}>
        <div style={{ maxWidth: 900, margin: "0 auto", textAlign: "center" }}>
          {/* Logo NÃO aparece mais aqui — vive no header bege acima
              (expandido com cores próprias, encolhe ao rolar). Hero focado
              em slogan/título/subtítulo/CTA. */}
          {cfg.slogan && (
            <p style={{
              fontFamily: fonteSubtitulo,
              fontSize: txCorpo(14),
              color: corSecundaria, marginBottom: 16, opacity: 0.95,
              whiteSpace: "pre-wrap",
            }}>
              {cfg.slogan}
            </p>
          )}
          <h1 style={{
            fontFamily: fonteHeading,
            fontSize: isMobile
              ? clampEscalado(36, 9, 56, escalaHero)
              : clampEscalado(40, 7, 84, escalaHero),
            lineHeight: 1.05, margin: "0 0 20px 0", letterSpacing: "-0.01em",
            whiteSpace: "pre-wrap",
          }}>
            {t("heroTitulo", "Cozinha caipira,\nfeita com tempo.")}
          </h1>
          <p style={{
            fontFamily: fonteSubtitulo,
            fontSize: txCorpo(17), opacity: 0.9, maxWidth: 560, margin: "0 auto 28px",
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
          }}>
            {t("heroSubtitulo", "Um laboratório gastronômico no coração da Vila Madalena.")}
          </p>
          {/* CTA do hero: leva pra reservas. Instagram + WhatsApp vivem
              nos botões flutuantes no canto inferior — não duplica aqui. */}
          {cfg.features.hasReservas && (
            reservasExterno
              ? <a href={reservasHref} target="_blank" rel="noreferrer" style={primaryButton(corSecundaria)}>{t("heroCtaLabel", "Faça sua reserva")}</a>
              : <Link to={reservasHref} style={primaryButton(corSecundaria)}>{t("heroCtaLabel", "Faça sua reserva")}</Link>
          )}
        </div>
      </section>

      {/* Seções reordenáveis — entre hero e footer.
          Ordem vem de cfg.ordemSecoes (com fallback pra ORDEM_PADRAO).
          Bg alterna creme/branco pra ritmo visual. Seções com feature
          desligada ou sem conteúdo retornam null e ficam fora do zebra. */}
      {(() => {
        const ordem = normalizarOrdem(cfg.ordemSecoes);
        // Conteúdos das seções: retornam título + conteúdo SEM <Section>
        // wrapper. O wrapper (com bg + padding) é aplicado depois — assim
        // dá pra parear 2 seções dentro de um único bg/padding no desktop.
        type SecaoConteudo = { titulo: string; conteudo: React.ReactNode };
        const conteudos: Record<SecaoId, (bg: string) => SecaoConteudo | null> = {
          historia: (bg) => cfg.historia ? {
            titulo: t("historiaTitulo", "A nossa história"),
            conteudo: <HistoriaExpansivel texto={cfg.historia} bgSecao={bg} corPrimaria={corPrimaria} fontSizeCorpo={txCorpo(17)} />,
          } : null,
          cardapio: () => (cfg.cardapioModo === "editor" || cfg.cardapioPdfPtUrl || cfg.cardapioPdfEnUrl) ? {
            titulo: t("cardapioTitulo", "Cardápio"),
            conteudo: cfg.cardapioModo === "editor"
              ? <CardapioEstruturadoView rid={cfg.restaurantId} corPrimaria={corPrimaria} corSecundaria={corSecundaria} txCorpo={txCorpo} />
              : <CardapioPreview cfg={cfg} isMobile={isMobile} corPrimaria={corPrimaria} corSecundaria={corSecundaria} corFundo={corFundo} menuButton={menuButton} />,
          } : null,
          horario: () => {
            // Cards de exceção — mesmo render usado em mobile (lista cheia)
            // ou desktop coluna direita.
            const cardsExcecoes = excecoes.map(e => {
              const d = new Date(e.data + "T12:00:00");
              const diaSemana = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d.getDay()];
              const dataCurta = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
              return (
                <div key={e.id} style={{
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: `1px solid ${corSecundaria}30`,
                  backgroundColor: e.fechado ? `${corSecundaria}10` : "#ffffff",
                  textAlign: "center",
                  width: 160,
                }}>
                  <div style={{ fontSize: 11, color: corPrimaria, fontWeight: 600 }}>{diaSemana}</div>
                  <div style={{
                    fontSize: 18, fontWeight: 700, color: "#1a1a1a", marginTop: 2,
                    fontFamily: fonteHeading,
                  }}>{dataCurta}</div>
                  <div style={{
                    fontSize: 12, marginTop: 6,
                    color: e.fechado ? corSecundaria : "#555",
                    fontWeight: e.fechado ? 600 : 400,
                  }}>
                    {e.fechado ? "Fechado" : (e.turnos?.map(tu => `${tu.abre}–${tu.fecha}`).join(" / ") || "Horário especial")}
                  </div>
                  {e.motivo && (
                    <div style={{ fontSize: 11, marginTop: 4, color: "#888", fontStyle: "italic", lineHeight: 1.3 }}>
                      {e.motivo}
                    </div>
                  )}
                </div>
              );
            });
            const listaSemana = (
              <div style={{
                background: "#ffffff", borderRadius: 8, padding: 24,
                border: `1px solid ${corSecundaria}30`,
              }}>
                {grupos.map((g, i) => (
                  <div key={i} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "baseline",
                    gap: 12,
                    padding: "12px 0",
                    borderBottom: i < grupos.length - 1 ? `1px dashed ${corSecundaria}30` : "none",
                    fontSize: tx(16),
                  }}>
                    <span style={{
                      fontWeight: 600, textTransform: "capitalize",
                      whiteSpace: "nowrap",
                    }}>
                      {g.diasLabel}
                    </span>
                    <span style={{
                      color: g.fechado ? "#999" : "#1a1a1a",
                      fontWeight: 500,                            // medium pra não sumir vs o dia em 600
                      fontVariantNumeric: "tabular-nums",         // dígitos com larguras iguais (mais limpo)
                      textAlign: "right",
                    }}>
                      {g.fechado ? "fechado" : g.turnosLabel}
                    </span>
                  </div>
                ))}
              </div>
            );
            const blocoAvisos = excecoes.length > 0 ? (
              <div>
                <div style={{
                  fontSize: 13, letterSpacing: "0.04em",
                  color: corPrimaria, marginBottom: 14, fontWeight: 600,
                  textAlign: "center", whiteSpace: "pre-wrap", lineHeight: 1.35,
                }}>
                  {t("horarioProximosAvisosLabel", "Próximos avisos")}
                </div>
                <div style={{
                  display: "flex", flexWrap: "wrap",
                  justifyContent: "center", gap: 10,
                }}>
                  {cardsExcecoes}
                </div>
              </div>
            ) : null;

            return {
              titulo: t("horarioTitulo", "Horário de funcionamento"),
              conteudo: (
                <div style={{ maxWidth: 600, margin: "0 auto" }}>
                  {listaSemana}
                  {blocoAvisos && <div style={{ marginTop: 28 }}>{blocoAvisos}</div>}
                </div>
              ),
            };
          },
          laje: () => (cfg.features.hasLaje && cfg.features.hasEventos) ? {
            titulo: t("lajeTitulo", "Eventos na Laje"),
            conteudo: (
              <CtaConteudo
                texto={t("lajeTexto", "Nosso rooftop recebe eventos privados para até 45 pessoas. Aniversários, encontros corporativos, jantares fechados — montamos cada celebração com você.")}
                ctaTo={`/eventos/${cfg.restaurantId}`}
                ctaLabel={t("lajeCtaLabel", "Solicitar proposta")}
                primaryButton={primaryButton}
                fontSizeCorpo={txCorpo(17)}
                corPrimaria={corPrimaria}
              />
            ),
          } : null,
          eventos: () => (cfg.features.hasEventos && !cfg.features.hasLaje) ? {
            titulo: t("eventosTitulo", "Eventos privados"),
            conteudo: (
              <CtaConteudo
                texto={t("eventosTexto", "Reservamos o espaço para sua celebração. Conta pra gente o que tem em mente — voltamos com uma proposta sob medida.")}
                ctaTo={`/eventos/${cfg.restaurantId}`}
                ctaLabel={t("eventosCtaLabel", "Solicitar proposta")}
                primaryButton={primaryButton}
                fontSizeCorpo={txCorpo(17)}
                corPrimaria={corPrimaria}
              />
            ),
          } : null,
          reservas: () => cfg.features.hasReservas ? {
            titulo: t("reservasTitulo", "Reservas"),
            conteudo: (
              <CtaConteudo
                texto={t("reservasTexto", "Recebemos com e sem reserva. Pra grupos a partir de 6 pessoas, recomendamos reservar.")}
                ctaTo={reservasHref}
                externo={reservasExterno}
                ctaLabel={t("reservasCtaLabel", "Reservar mesa")}
                primaryButton={primaryButton}
                fontSizeCorpo={txCorpo(17)}
                corPrimaria={corPrimaria}
              />
            ),
          } : null,
          delivery: () => (cfg.features.hasDelivery && cfg.delivery && cfg.delivery.length > 0) ? {
            titulo: t("deliveryTitulo", "Peça pra casa"),
            conteudo: (
              <div style={{
                maxWidth: 600, margin: "0 auto", textAlign: "center",
                display: "flex", flexDirection: "column",
                flex: 1, width: "100%",
                gap: 32, // mesma equidistância dos outros CtaConteudo
              }}>
                {t("deliveryTexto", "") && (
                  <p style={{
                    fontSize: tx(17), lineHeight: 1.7,
                    margin: 0, whiteSpace: "pre-wrap",
                  }}>
                    {t("deliveryTexto", "")}
                  </p>
                )}
                <div style={{
                  marginTop: "auto",  // empurra pro rodapé em par
                  display: "flex", gap: 12,
                  justifyContent: "center", flexWrap: "wrap",
                }}>
                  {(cfg.delivery || []).map((d, i) => (
                    <a key={i} href={d.url} target="_blank" rel="noreferrer" style={primaryButton(corPrimaria)}>
                      {d.label || labelDelivery(d.plataforma)}
                    </a>
                  ))}
                </div>
              </div>
            ),
          } : null,
          trabalhe: () => cfg.features.hasTrabalheConosco ? {
            titulo: t("trabalheTitulo", "Venha trabalhar com a gente"),
            conteudo: (
              <CtaConteudo
                texto={t("trabalheTexto", "Sempre buscando gente boa pra somar no time.")}
                ctaTo={`/vagas/${cfg.restaurantId}`}
                ctaLabel={t("trabalheCtaLabel", "Enviar candidatura")}
                primaryButton={primaryButton}
                fontSizeCorpo={txCorpo(17)}
                corPrimaria={corPrimaria}
              />
            ),
          } : null,
          contato: () => {
            const mapsHref = googleMapsLink(cfg.endereco);
            const mapsEmbed = googleMapsEmbedUrl(cfg.endereco);
            const telDigitos = (cfg.telefone || "").replace(/[^\d+]/g, "");
            const waHref = telDigitos
              ? `https://api.whatsapp.com/send?phone=${encodeURIComponent(telDigitos)}`
              : null;
            const mailHref = cfg.emailContato ? `mailto:${cfg.emailContato}` : null;
            // Estilo do card clicável de endereço
            const cardLink: React.CSSProperties = {
              display: "block",
              padding: "20px 24px",
              borderRadius: 8,
              border: `1px solid ${corSecundaria}40`,
              backgroundColor: "#ffffff",
              color: corTexto,
              textDecoration: "none",
              transition: "border-color 0.15s, transform 0.15s",
            };
            // Estilo dos pill links (telefone, email) — sem sublinhado, com ícone
            const pillLink: React.CSSProperties = {
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 18px",
              borderRadius: 999,
              border: `1px solid ${corSecundaria}50`,
              backgroundColor: "transparent",
              color: corTexto,
              textDecoration: "none",
              fontSize: 14,
              fontWeight: 500,
              transition: "background-color 0.15s, border-color 0.15s",
            };
            return {
              titulo: t("contatoTitulo", "Como chegar"),
              conteudo: (
                <div style={{
                  maxWidth: 560, margin: "0 auto", textAlign: "center",
                  // Flex column com flex:1 — quando renderizado em par no
                  // desktop (parent é flex column com altura), o mapa
                  // (com flex:1 também) cresce pra preencher o espaço
                  // disponível, alinhando o rodapé (telefone/email) com
                  // o fim da coluna Horário ao lado.
                  display: "flex", flexDirection: "column",
                  flex: 1, width: "100%",
                }}>
                  {/* Preview do mapa via Google Maps embed (sem API key).
                      Em par: flex:1 estica a altura. Single: aspectRatio
                      4/3 dá altura natural. minHeight evita encolher. */}
                  {mapsEmbed && (
                    <div style={{
                      width: "100%",
                      flex: 1,
                      aspectRatio: "4 / 3",
                      minHeight: 280,
                      borderRadius: 8,
                      overflow: "hidden",
                      border: `1px solid ${corSecundaria}40`,
                      marginBottom: 20,
                      boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
                    }}>
                      <iframe
                        src={mapsEmbed}
                        title="Mapa"
                        style={{ width: "100%", height: "100%", border: "none", display: "block" }}
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                      />
                    </div>
                  )}
                  {/* Endereço — card único clicável */}
                  {(enderecoLinhaUm(cfg.endereco) || enderecoLinhaDois(cfg.endereco)) && (
                    <a
                      href={mapsHref}
                      target="_blank"
                      rel="noreferrer"
                      style={cardLink}
                      title="Abrir no app de mapas"
                      onPointerEnter={(e) => { if (e.pointerType === "touch") return; e.currentTarget.style.borderColor = corPrimaria; }}
                      onPointerLeave={(e) => { if (e.pointerType === "touch") return; e.currentTarget.style.borderColor = `${corSecundaria}40`; }}
                    >
                      <div style={{ textAlign: "center" }}>
                        <div style={{ textAlign: "center" }}>
                          {enderecoLinhaUm(cfg.endereco) && (
                            <div style={{ fontSize: 16, fontWeight: 600 }}>
                              {enderecoLinhaUm(cfg.endereco)}
                            </div>
                          )}
                          {enderecoLinhaDois(cfg.endereco) && (
                            <div style={{ fontSize: 13, color: "#666", marginTop: 2 }}>
                              {enderecoLinhaDois(cfg.endereco)}
                            </div>
                          )}
                        </div>
                      </div>
                    </a>
                  )}

                  {/* Telefone + email — pills sem sublinhado */}
                  {(waHref || mailHref) && (
                    <div style={{
                      marginTop: 20,
                      display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap",
                    }}>
                      {waHref && cfg.telefone && (
                        <a
                          href={waHref}
                          target="_blank"
                          rel="noreferrer"
                          style={pillLink}
                          title="Abrir no WhatsApp"
                          onPointerEnter={(e) => { if (e.pointerType === "touch") return;
                            e.currentTarget.style.backgroundColor = `${corPrimaria}10`;
                            e.currentTarget.style.borderColor = corPrimaria;
                          }}
                          onPointerLeave={(e) => { if (e.pointerType === "touch") return;
                            e.currentTarget.style.backgroundColor = "transparent";
                            e.currentTarget.style.borderColor = `${corSecundaria}50`;
                          }}
                        >
                          <span>📞</span> {formatarTelefoneExibicao(cfg.telefone)}
                        </a>
                      )}
                      {mailHref && cfg.emailContato && (
                        <a
                          href={mailHref}
                          style={pillLink}
                          title="Enviar email"
                          onPointerEnter={(e) => { if (e.pointerType === "touch") return;
                            e.currentTarget.style.backgroundColor = `${corPrimaria}10`;
                            e.currentTarget.style.borderColor = corPrimaria;
                          }}
                          onPointerLeave={(e) => { if (e.pointerType === "touch") return;
                            e.currentTarget.style.backgroundColor = "transparent";
                            e.currentTarget.style.borderColor = `${corSecundaria}50`;
                          }}
                        >
                          <span>✉</span> {cfg.emailContato}
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ),
            };
          },
        };

        // Pares no desktop: seções renderizadas lado a lado dentro do mesmo
        // background. Ordem dentro do par não importa — qualquer combinação
        // entre os ids listados aqui é pareada se vierem em sequência.
        const PARES_DESKTOP: Array<Set<SecaoId>> = [
          new Set<SecaoId>(["reservas", "laje"]),
          new Set<SecaoId>(["reservas", "eventos"]),
          new Set<SecaoId>(["horario", "contato"]),
          new Set<SecaoId>(["delivery", "trabalhe"]),
          // Fallback: quando o site não tem laje/eventos/delivery (caso de
          // restaurante simples como Sororoca), reservas e trabalhe ficariam
          // órfãos no layout. Esse par só ativa via reordenação abaixo —
          // não dispara junto com os pares acima quando estão ativos.
          new Set<SecaoId>(["reservas", "trabalhe"]),
        ];
        function ehPar(a: SecaoId, b: SecaoId): boolean {
          return PARES_DESKTOP.some(s => s.has(a) && s.has(b) && a !== b);
        }

        // 1) Filtra primeiro as seções que realmente têm conteúdo —
        //    seções com null (feature desligada) são removidas da lista.
        //    Sem esse filtro, "Reservas" e "Laje" nunca seriam consecutivas
        //    no array original (têm outras seções entre eles) e o par nunca
        //    seria detectado.
        type Item = { id: SecaoId; titulo: string; conteudo: React.ReactNode };
        const items: Item[] = [];
        for (const id of ordem) {
          const c = conteudos[id]?.("");  // bg ainda não importa aqui
          if (c) items.push({ id, titulo: c.titulo, conteudo: c.conteudo });
        }

        // 2b) Pair fallback dinâmico: em sites simples (sem laje, eventos
        // e delivery), reordena pra:
        //   - trabalhe ficar logo depois de reservas (forma o par
        //     "reservas+trabalhe")
        //   - o bloco "reservas+trabalhe" vir DEPOIS de "horario+contato"
        //     — fluxo mais natural: o cliente lê info da casa (sobre,
        //     cardápio, horário, endereço) e só então é convidado a reservar
        //     ou trabalhar conosco no rodapé.
        // Sites com laje/eventos/delivery (Lobozó) mantêm a ordem natural —
        // não interfere nos pares nativos.
        const hasLajeAtiva = !!cfg.features.hasLaje;
        const hasEventosAtivo = !!cfg.features.hasEventos;
        const hasDeliveryAtivo = !!cfg.features.hasDelivery
          && !!cfg.delivery && cfg.delivery.length > 0;
        const ehSiteSimples = !hasLajeAtiva && !hasEventosAtivo && !hasDeliveryAtivo;
        if (ehSiteSimples) {
          // Passo 1: cola trabalhe logo depois de reservas
          const reservasIdx = items.findIndex(it => it.id === "reservas");
          const trabalheIdx = items.findIndex(it => it.id === "trabalhe");
          if (reservasIdx !== -1 && trabalheIdx !== -1 && trabalheIdx !== reservasIdx + 1) {
            const [trabalheItem] = items.splice(trabalheIdx, 1);
            const novoReservasIdx = items.findIndex(it => it.id === "reservas");
            items.splice(novoReservasIdx + 1, 0, trabalheItem!);
          }
          // Passo 2: move o bloco [reservas, trabalhe] pra DEPOIS de
          // [horario, contato]. Remove os 2 do meio e re-insere depois
          // do contato (se ambos existirem na lista).
          const rIdx = items.findIndex(it => it.id === "reservas");
          const cIdx = items.findIndex(it => it.id === "contato");
          if (rIdx !== -1 && cIdx !== -1 && rIdx < cIdx) {
            const tIdx = items.findIndex(it => it.id === "trabalhe");
            // Remove reservas + trabalhe (consecutivos) e re-insere após contato.
            // splice em sequência: pega o item por id pra evitar problema com
            // índices que mudam após cada splice.
            const reservasItem = items.splice(rIdx, 1)[0]!;
            const trabalheItemNovo = tIdx > rIdx
              ? items.splice(tIdx - 1, 1)[0]!  // -1 porque já removemos reservas
              : null;
            // Recalcula índice do contato pós-remoções
            const contatoIdxFinal = items.findIndex(it => it.id === "contato");
            if (contatoIdxFinal !== -1) {
              const inserts: Item[] = [reservasItem];
              if (trabalheItemNovo) inserts.push(trabalheItemNovo);
              items.splice(contatoIdxFinal + 1, 0, ...inserts);
            } else {
              // Sem contato? volta os itens pro fim mesmo
              items.push(reservasItem);
              if (trabalheItemNovo) items.push(trabalheItemNovo);
            }
          }
        }

        // 2) Pareia consecutivos NA LISTA FILTRADA. Mobile sempre single.
        const nodes: React.ReactNode[] = [];
        let idxRenderizado = 0;
        let i = 0;
        while (i < items.length) {
          const a = items[i]!;
          const b = items[i + 1];
          const bg = idxRenderizado % 2 === 0 ? corFundo : "#ffffff";

          if (!isMobile && b && ehPar(a.id, b.id)) {
            // Cada coluna pareada vira flex-column. h2 fica no topo, o
            // conteúdo cresce (flex:1) e o botão CTA dentro do conteúdo
            // ganha marginTop:auto — assim os botões ficam alinhados no
            // rodapé entre as 2 colunas mesmo com textos de tamanhos
            // diferentes.
            const colunaStyle: React.CSSProperties = {
              display: "flex",
              flexDirection: "column",
            };
            nodes.push(
              <section key={`${a.id}-${b.id}`} id={`pair-${a.id}-${b.id}`} style={{
                padding: "80px 20px", backgroundColor: bg,
              }}>
                <div style={{
                  maxWidth: 1300, margin: "0 auto",
                  display: "grid",
                  gridTemplateColumns: "1fr 1px 1fr",
                  alignItems: "stretch",
                }}>
                  <div id={a.id} style={{ ...colunaStyle, paddingRight: 48 }}>
                    <h2 style={tituloSectionStyle}>{a.titulo}</h2>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                      {a.conteudo}
                    </div>
                  </div>
                  <div aria-hidden style={{
                    backgroundColor: corPrimaria,
                    opacity: 0.35,
                    alignSelf: "stretch",
                  }} />
                  <div id={b.id} style={{ ...colunaStyle, paddingLeft: 48 }}>
                    <h2 style={tituloSectionStyle}>{b.titulo}</h2>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                      {b.conteudo}
                    </div>
                  </div>
                </div>
              </section>
            );
            i += 2;
            idxRenderizado++;
            continue;
          }

          nodes.push(
            <Section key={a.id} id={a.id} titulo={a.titulo} bg={bg}>
              {a.conteudo}
            </Section>
          );
          i++;
          idxRenderizado++;
        }
        return nodes;
      })()}

      {/* FOOTER */}
      <footer style={{
        backgroundColor: corPrimaria, color: corFundo,
        padding: "40px 20px 24px",
        textAlign: "center",
      }}>
        {(cfg.logoUrl || cfg.slogan) && (
          <div style={{
            fontFamily: fonteHeading, fontSize: 24, marginBottom: 16, color: corSecundaria,
            display: "flex", justifyContent: "center", alignItems: "center",
          }}>
            {cfg.logoUrl
              ? <img src={cfg.logoUrl} alt="" style={{ height: 40, width: "auto", filter: "brightness(0) invert(1)", opacity: 0.85, display: "block", margin: "0 auto" }} />
              : <span>{cfg.slogan}</span>}
          </div>
        )}
        {/* Redes sociais no footer — Instagram E WhatsApp ficam fora
            (já estão no hero como botões). Mostra Facebook/TikTok/etc. */}
        {(() => {
          const redesFooter = cfg.redes.filter(r =>
            r.url && r.tipo !== "instagram" && r.tipo !== "whatsapp"
          );
          if (redesFooter.length === 0) return null;
          return (
            <div style={{ display: "flex", gap: 18, justifyContent: "center", marginBottom: 20 }}>
              {redesFooter.map((r, i) => (
                <a key={i} href={r.url} target="_blank" rel="noreferrer"
                   style={{ color: corFundo, textDecoration: "none", fontSize: txMenuDesktop(14) }}>
                  {iconRede(r.tipo)} {labelRede(r.tipo, r.label)}
                </a>
              ))}
            </div>
          );
        })()}
        <div style={{ fontSize: 12, opacity: 0.7, whiteSpace: "pre-wrap" }}>
          © {new Date().getFullYear()} — {t("rodapeDireitos", "Todos os direitos reservados.")}
        </div>
        {/* Link LGPD — política + solicitação de exclusão */}
        {cfg.slug && (
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Link to={`/politica/${cfg.slug}`} style={{ color: "inherit", textDecoration: "underline" }}>
              Política de privacidade
            </Link>
            <Link to={`/r/excluir-dados/${cfg.restaurantId}`} style={{ color: "inherit", textDecoration: "underline" }}>
              Solicitar exclusão de dados
            </Link>
          </div>
        )}
      </footer>

      {/* FLOATS SOCIAIS — Instagram (acima) + WhatsApp (canto inferior).
          Ícones SVG das marcas pra parecer "de verdade", não emoji. */}
      <div style={{
        position: "fixed", bottom: 20, right: 20, zIndex: 100,
        display: "flex", flexDirection: "column", gap: 12,
      }}>
        {(() => {
          const insta = cfg.redes.find(r => r.tipo === "instagram" && r.url);
          if (!insta) return null;
          return (
            <a
              href={insta.url} target="_blank" rel="noreferrer"
              aria-label="Instagram"
              style={socialFloat({
                background: "linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)",
              })}
              onPointerEnter={(e) => { if (e.pointerType === "touch") return; e.currentTarget.style.transform = "scale(1.05)"; }}
              onPointerLeave={(e) => { if (e.pointerType === "touch") return; e.currentTarget.style.transform = "scale(1)"; }}
            >
              <InstagramIcon />
            </a>
          );
        })()}
        {waLink && (
          <a
            href={waLink} target="_blank" rel="noreferrer"
            aria-label="WhatsApp"
            style={socialFloat({ background: "#25d366" })}
            onPointerEnter={(e) => { if (e.pointerType === "touch") return; e.currentTarget.style.transform = "scale(1.05)"; }}
            onPointerLeave={(e) => { if (e.pointerType === "touch") return; e.currentTarget.style.transform = "scale(1)"; }}
          >
            <WhatsAppIcon />
          </a>
        )}
      </div>
    </div>
  );

  // ─── Helpers internos (closure sobre cores dinâmicas) ─────────────────────

  function NavLink({ href, children, cor, externo }: { href: string; children: React.ReactNode; cor?: string; externo?: boolean }) {
    return (
      <a href={href} {...(externo ? { target: "_blank", rel: "noreferrer" } : {})} style={{
        color: cor ?? corTexto, textDecoration: "none",
        // Escala "Menu desktop" — controla tamanho do nav superior.
        fontSize: txMenuDesktop(14), fontWeight: 500,
        padding: "4px 10px",
        borderRadius: 999,
        transition: "color 0.25s ease, background-color 0.15s ease",
      }}
      onPointerEnter={(e) => { if (e.pointerType === "touch") return; e.currentTarget.style.backgroundColor = `${corPrimaria}10`; }}
      onPointerLeave={(e) => { if (e.pointerType === "touch") return; e.currentTarget.style.backgroundColor = "transparent"; }}
      >{children}</a>
    );
  }

  function MobileMenuLink({ href, onClick, children, cor, corBorda, externo }: {
    href: string;
    onClick: () => void;
    children: React.ReactNode;
    cor: string;
    corBorda: string;
    externo?: boolean;
  }) {
    return (
      <a
        href={href}
        {...(externo ? { target: "_blank", rel: "noreferrer" } : {})}
        onClick={onClick}
        style={{
          color: cor,
          textDecoration: "none",
          // Escala "Menu mobile" — separada do NavLink desktop pra permitir
          // ajuste independente (hambúrguer ocupa mais espaço, fonte maior
          // costuma fazer sentido em mobile).
          fontSize: txMenuMobile(16),
          fontWeight: 500,
          padding: "14px 20px",
          borderBottom: `1px solid ${corBorda}20`,
          display: "block",
        }}
      >
        {children}
      </a>
    );
  }

  function Section({ id, titulo, bg, children }: {
    id: string; titulo: string; bg: string; children: React.ReactNode;
  }) {
    return (
      <section id={id} style={{ padding: "80px 20px", backgroundColor: bg }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <h2 style={{
            ...tituloSectionStyle,
            // Single-column section usa título maior. Mesma escala da
            // categoria Títulos (escalaTitulos) que tituloSectionStyle.
            fontSize: clampEscalado(32, 5, 48, escalaTitulos),
            // marginBottom 32 dá mesmo espaçamento que o gap interno do
            // CtaConteudo (h2 → texto = texto → botão = equidistante).
            marginBottom: 32,
          }}>
            {titulo}
          </h2>
          {children}
        </div>
      </section>
    );
  }

  function primaryButton(cor: string): React.CSSProperties {
    return {
      display: "inline-block",
      padding: "14px 32px",
      backgroundColor: cor,
      // Dourado tem brilho — texto preto contrasta melhor. Outras cores, fundo claro.
      color: cor === corSecundaria ? "#1a1a1a" : corFundo,
      textDecoration: "none",
      fontSize: txBotao(15),
      fontWeight: 600,
      borderRadius: 4,
      border: "none",
      cursor: "pointer",
      transition: "transform 0.15s ease",
      // Respeita case e \n do label que o usuário escreveu no admin.
      whiteSpace: "pre-wrap",
    };
  }

  function menuButton(cor: string, fundo: string): React.CSSProperties {
    return {
      display: "inline-block",
      padding: "16px 28px",
      backgroundColor: fundo,
      color: cor,
      textDecoration: "none",
      fontSize: txBotao(15),
      fontWeight: 600,
      border: `2px solid ${cor}`,
      borderRadius: 4,
    };
  }

}

// Estilo compartilhado dos botões sociais flutuantes. Aceita background
// customizado (verde sólido pro WhatsApp, gradient pro Instagram).
function socialFloat({ background }: { background: string }): React.CSSProperties {
  return {
    width: 56, height: 56,
    background,
    borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center",
    textDecoration: "none",
    boxShadow: "0 4px 14px rgba(0,0,0,0.22)",
    transition: "transform 0.15s ease",
    cursor: "pointer",
  };
}

// SVG do WhatsApp (silhueta oficial branca sobre verde)
function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" fill="#fff" aria-hidden="true">
      <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
    </svg>
  );
}

// SVG do Instagram (câmera oficial branca sobre o gradient da marca)
function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="#fff" aria-hidden="true">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
    </svg>
  );
}

function iconRede(tipo: string): string {
  return {
    instagram: "📷", whatsapp: "💬", facebook: "f",
    tiktok: "🎵", youtube: "▶", outro: "🔗",
  }[tipo] || "🔗";
}

function labelRede(tipo: string, label?: string): string {
  if (label) return label;
  return {
    instagram: "Instagram", whatsapp: "WhatsApp", facebook: "Facebook",
    tiktok: "TikTok", youtube: "YouTube", outro: "Link",
  }[tipo] || tipo;
}

function labelDelivery(plataforma: string): string {
  return {
    ifood: "iFood", rappi: "Rappi", uber: "Uber Eats",
    proprio: "Pedido próprio", outro: "Delivery",
  }[plataforma] || plataforma;
}

// ─── HistoriaExpansivel ──────────────────────────────────────────────
// Histórias longas comem a navegação — mostro só os primeiros ~220px e
// um "Ver mais" pra expandir. Textos curtos passam direto sem botão.
// Gradient fade no rodapé da versão recolhida pra deixar o corte suave.
function HistoriaExpansivel({
  texto, bgSecao, corPrimaria, fontSizeCorpo,
}: {
  texto: string;
  bgSecao: string;
  corPrimaria: string;
  fontSizeCorpo?: number;          // se omitido, default 17
}) {
  const [expandido, setExpandido] = useState(false);
  const [precisaExpandir, setPrecisaExpandir] = useState(false);
  // Altura "limite" pra mostrar sem expandir (~7 linhas a 1.7 line-height
  // com fontSize 17 = ~200px; arredondamos pra 220).
  const ALTURA_RECOLHIDO = 220;
  const ref = useRef<HTMLDivElement>(null);

  // Mede se o texto excede o limite — só então mostra "Ver mais".
  useEffect(() => {
    if (!ref.current) return;
    setPrecisaExpandir(ref.current.scrollHeight > ALTURA_RECOLHIDO + 8);
  }, [texto]);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div
        ref={ref}
        style={{
          position: "relative",
          fontSize: fontSizeCorpo ?? 17, lineHeight: 1.7,
          whiteSpace: "pre-wrap",
          maxHeight: expandido || !precisaExpandir ? "none" : ALTURA_RECOLHIDO,
          overflow: "hidden",
          transition: "max-height 0.4s ease",
        }}
      >
        {texto}
        {/* Gradient fade no rodapé do recolhido */}
        {precisaExpandir && !expandido && (
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0,
            height: 80,
            background: `linear-gradient(to bottom, transparent, ${bgSecao})`,
            pointerEvents: "none",
          }} />
        )}
      </div>
      {precisaExpandir && (
        <div style={{ textAlign: "center", marginTop: 18 }}>
          <button
            type="button"
            onClick={() => setExpandido(v => !v)}
            style={{
              background: "transparent",
              border: `1px solid ${corPrimaria}40`,
              color: corPrimaria,
              fontSize: 13, fontWeight: 600,
              padding: "8px 18px",
              borderRadius: 999,
              cursor: "pointer",
              transition: "background-color 0.15s, border-color 0.15s",
            }}
            // onPointerEnter dispara só com mouse (não em touch), evitando
            // o "hover-then-click" do iOS que exigia 2 taps.
            onPointerEnter={(e) => {
              if (e.pointerType === "touch") return;
              e.currentTarget.style.backgroundColor = `${corPrimaria}10`;
              e.currentTarget.style.borderColor = `${corPrimaria}80`;
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === "touch") return;
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.borderColor = `${corPrimaria}40`;
            }}
          >
            {expandido ? "↑ Ver menos" : "↓ Ver mais"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── CtaConteudo ──────────────────────────────────────────────────────
// Conteúdo padrão das seções "texto + botão" (Reservas, Eventos, Laje,
// Trabalhe). Estruturado como flex column com `flex: 1` + botão dentro de
// container com `marginTop: auto` — assim os botões ficam alinhados no
// rodapé quando essas seções entram em pares no desktop (mesmo com textos
// de tamanhos diferentes).
function CtaConteudo({
  texto, ctaTo, ctaLabel, primaryButton, corPrimaria, fontSizeCorpo, externo,
}: {
  texto: string;
  ctaTo: string;
  ctaLabel: string;
  primaryButton: (cor: string) => React.CSSProperties;
  corPrimaria: string;
  fontSizeCorpo?: number;          // se omitido, usa default 17
  externo?: boolean;               // ctaTo é URL externa → abre em nova aba
}) {
  return (
    <div style={{
      maxWidth: 600, margin: "0 auto", textAlign: "center",
      display: "flex", flexDirection: "column",
      flex: 1, width: "100%",
      // Gap mínimo entre p e botão = mesmo que h2→p (32px), garantindo
      // equidistância visual no render single. No par (com altura
      // forçada via flex stretch), o marginTop:auto do botão empurra
      // pro rodapé pra alinhar com a outra coluna.
      gap: 32,
    }}>
      <p style={{
        fontSize: fontSizeCorpo ?? 17, lineHeight: 1.7,
        margin: 0, whiteSpace: "pre-wrap",
      }}>
        {texto}
      </p>
      <div style={{ marginTop: "auto" }}>
        {externo
          ? <a href={ctaTo} target="_blank" rel="noreferrer" style={primaryButton(corPrimaria)}>{ctaLabel}</a>
          : <Link to={ctaTo} style={primaryButton(corPrimaria)}>{ctaLabel}</Link>}
      </div>
    </div>
  );
}

// ─── CardapioEstruturadoView ──────────────────────────────────────────
// Cardápio montado no editor (modo "editor"): lê /cardapioEstruturado/{rid}
// e renderiza ao vivo. Idioma PT/EN (EN só aparece quando há tradução).
function CardapioEstruturadoView({ rid, corPrimaria, corSecundaria, txCorpo }: {
  rid: string;
  corPrimaria: string;
  corSecundaria: string;
  txCorpo: (px: number) => number;
}) {
  const [docData, setDocData] = useState<CardapioEstruturado | null>(null);
  const [idioma, setIdioma] = useState<"pt" | "en">("pt");
  const [menuSel, setMenuSel] = useState<string>("");
  const [secaoSel, setSecaoSel] = useState<string>("");   // chip selecionado (single); "__tudo__" = todas

  useEffect(() => {
    let cancel = false;
    void getDoc(doc(db, "cardapioEstruturado", rid)).then((snap) => {
      if (cancel) return;
      setDocData(snap.exists() ? (snap.data() as CardapioEstruturado) : { id: rid, restaurantId: rid, secoes: [], atualizadoEm: "" });
    });
    return () => { cancel = true; };
  }, [rid]);

  if (!docData) return <div style={{ textAlign: "center", opacity: 0.5, fontSize: txCorpo(14), padding: "24px 0" }}>Carregando cardápio…</div>;
  // Múltiplos cardápios (novo) ou 1 legado (campo secoes).
  const cardapios = (docData.cardapios && docData.cardapios.length)
    ? docData.cardapios
    : (docData.secoes && docData.secoes.length ? [{ id: "_legacy", nome: "Cardápio", secoes: docData.secoes }] : []);
  if (!cardapios.length) return <div style={{ textAlign: "center", opacity: 0.5, fontSize: txCorpo(14), padding: "24px 0" }}>Cardápio em breve.</div>;
  const menuAtual = cardapios.find((c) => c.id === menuSel) || cardapios[0]!;
  const secoes = (menuAtual.secoes || []).filter((s) => s.nome || s.pratos.length);

  const en = idioma === "en";
  const temEn = secoes.some((s) => s.nomeEn || s.pratos.some((p) => p.tituloEn));
  const nomeSec = (s: typeof secoes[number]) => (en && s.nomeEn) || s.nome;
  const obsSec = (s: typeof secoes[number]) => (en && s.obsEn) || s.obs;
  const tituloPr = (p: { titulo: string; tituloEn?: string }) => (en && p.tituloEn) || p.titulo;
  const subPr = (p: { subtitulo?: string; subtituloEn?: string }) => (en && p.subtituloEn) || p.subtitulo;

  // Abas de exibição no site: se o cardápio tem `gruposSite`, cada grupo vira 1
  // chip (com título próprio) reunindo as seções apontadas. Seções fora de
  // qualquer grupo entram como chips soltos no fim. Sem config = 1 chip por seção.
  type Aba = { id: string; titulo: string; secoes: typeof secoes };
  const grupos = menuAtual.gruposSite || [];
  // Percorre as seções NA ORDEM: seção agrupada emite o grupo (uma vez, na
  // posição da 1ª seção dele); seção solta vira chip próprio. Assim a ordem dos
  // chips segue a ordem das seções (reordenável no editor), mesmo com grupos.
  const abas: Aba[] = [];
  const grupoFeito = new Set<string>();
  for (const s of secoes) {
    const g = grupos.find((x) => (x.secaoIds || []).includes(s.id));
    if (g) {
      if (grupoFeito.has(g.id)) continue;
      grupoFeito.add(g.id);
      const ss = secoes.filter((x) => (g.secaoIds || []).includes(x.id));
      abas.push({ id: g.id, titulo: g.titulo || nomeSec(ss[0]!), secoes: ss });
    } else {
      abas.push({ id: s.id, titulo: nomeSec(s), secoes: [s] });
    }
  }
  // Seleção única: um chip por vez (não soma). "__tudo__" mostra todas as seções.
  // Chip normal mostra só a sua. Se o id não bate (troca de cardápio), cai na 1ª.
  const isTudo = secaoSel === "__tudo__";
  const abaAtualId = abas.some((a) => a.id === secaoSel) ? secaoSel : (abas[0]?.id || "");
  const abasVisiveis = isTudo ? abas : abas.filter((a) => a.id === abaAtualId);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      {temEn && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginBottom: 14 }}>
          {(["pt", "en"] as const).map((l) => (
            <button key={l} type="button" onClick={() => setIdioma(l)}
              style={{ fontSize: txCorpo(11.5), fontWeight: 600, padding: "4px 11px", borderRadius: 999, cursor: "pointer",
                border: `1px solid ${corPrimaria}`, background: idioma === l ? corPrimaria : "transparent", color: idioma === l ? "#fff" : corPrimaria }}>
              {l === "pt" ? "PT" : "EN"}
            </button>
          ))}
        </div>
      )}
      {cardapios.length > 1 && (
        <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {cardapios.map((c) => {
            const ativo = c.id === menuAtual.id;
            return (
              <button key={c.id} type="button" onClick={() => setMenuSel(c.id)}
                style={{ fontSize: txCorpo(13), fontWeight: 600, padding: "6px 16px", borderRadius: 999, cursor: "pointer",
                  border: `1px solid ${corPrimaria}`, background: ativo ? corPrimaria : "transparent", color: ativo ? "#fff" : corPrimaria }}>
                {c.nome}
              </button>
            );
          })}
        </div>
      )}
      {!secoes.length && <div style={{ textAlign: "center", opacity: 0.5, fontSize: txCorpo(14), padding: "16px 0" }}>Cardápio em breve.</div>}
      {abas.length > 1 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22, justifyContent: "center" }}>
          <button type="button" onClick={() => setSecaoSel("__tudo__")}
            style={{ flexShrink: 0, fontSize: txCorpo(13), fontWeight: 600, padding: "6px 15px", borderRadius: 999, cursor: "pointer",
              border: `1px solid ${corPrimaria}`, background: isTudo ? corPrimaria : "transparent", color: isTudo ? "#fff" : corPrimaria, whiteSpace: "nowrap" }}>
            Tudo
          </button>
          {abas.map((a) => {
            const ativo = !isTudo && a.id === abaAtualId;
            return (
              <button key={a.id} type="button" onClick={() => setSecaoSel(a.id)}
                style={{ flexShrink: 0, fontSize: txCorpo(13), fontWeight: 600, padding: "6px 15px", borderRadius: 999, cursor: "pointer",
                  border: `1px solid ${corPrimaria}`, background: ativo ? corPrimaria : "transparent", color: ativo ? "#fff" : corPrimaria, whiteSpace: "nowrap" }}>
                {a.titulo}
              </button>
            );
          })}
        </div>
      )}
      {abasVisiveis.map((aba) => (
        <div key={aba.id} style={{ marginBottom: 30 }}>
          <h3 style={{ fontSize: txCorpo(22), color: corPrimaria, fontWeight: 700, margin: "0 0 10px", letterSpacing: 0.3 }}>{aba.titulo}</h3>
          {aba.secoes.map((s) => (
          <div key={s.id} style={{ marginTop: aba.secoes.length > 1 ? 16 : 0 }}>
            {obsSec(s) && <p style={{ fontSize: txCorpo(13), opacity: 0.7, fontStyle: "italic", margin: "0 0 12px" }}>{obsSec(s)}</p>}
          <div style={{ marginTop: 4 }}>
            {s.pratos.filter((p) => tituloPr(p)).map((p) => (
              <div key={p.id} style={{ padding: "9px 0", borderBottom: `1px solid ${corSecundaria}22`, display: "flex", alignItems: "center", gap: 10 }}>
                {(p.iconeUrl || p.iconeId) && (
                  <div style={{ flexShrink: 0, width: txCorpo(28), display: "flex", justifyContent: "center" }}>
                    {p.iconeUrl
                      ? <img src={p.iconeUrl} alt="" style={{ width: txCorpo(26), height: txCorpo(26), objectFit: "contain" }} />
                      : <IconeCardapioView id={p.iconeId!} size={txCorpo(24)} color={corPrimaria} />}
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span style={{ fontSize: txCorpo(17), fontWeight: 600, flex: 1, whiteSpace: "pre-line" }}>{tituloPr(p)}</span>
                    {(p.preco || (p.taca && (p.precoTaca || "").trim())) && (
                      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0, gap: 1 }}>
                        {p.preco && (
                          <span style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                            {menuAtual.mostrarGarrafa && <svg width={txCorpo(13)} height={txCorpo(13)} viewBox="0 0 24 24" fill="none" stroke={corPrimaria} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ alignSelf: "center" }}><path d="M10 2.5h4" /><path d="M10.5 2.5V6c0 1-.4 1.6-1.1 2.3C8.3 9.6 8 10.5 8 11.8V20a1.5 1.5 0 0 0 1.5 1.5h5A1.5 1.5 0 0 0 16 20v-8.2c0-1.3-.3-2.2-1.4-3.5C13.9 7.6 13.5 7 13.5 6V2.5" /></svg>}
                            {(p.garrafaMl || "").trim() && <span style={{ fontSize: txCorpo(12), color: corPrimaria, opacity: 0.75, whiteSpace: "nowrap" }}>({String(p.garrafaMl).replace(/ml$/i, "").trim()}ml)</span>}
                            <span style={{ fontSize: txCorpo(16), fontWeight: 600, color: corPrimaria, whiteSpace: "nowrap" }}>{p.preco}</span>
                          </span>
                        )}
                        {p.taca && (p.precoTaca || "").trim() && (
                          <span style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                            <svg width={txCorpo(13)} height={txCorpo(13)} viewBox="0 0 24 24" fill="none" stroke={corPrimaria} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ alignSelf: "center" }}><path d="M6.5 3h11l-1.2 6.6a4.6 4.6 0 0 1-9.2 0L6.5 3z" /><path d="M12 15.5V20" /><path d="M8.5 20h7" /></svg>
                            {(p.tacaMl || "").trim() && <span style={{ fontSize: txCorpo(12), color: corPrimaria, opacity: 0.75, whiteSpace: "nowrap" }}>({String(p.tacaMl).replace(/ml$/i, "").trim()}ml)</span>}
                            <span style={{ fontSize: txCorpo(15), fontWeight: 600, color: corPrimaria, whiteSpace: "nowrap" }}>{p.precoTaca!.trim()}</span>
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  {subPr(p) && <div style={{ fontSize: txCorpo(13.5), opacity: 0.7, marginTop: 2, lineHeight: 1.35, whiteSpace: "pre-line" }}>{subPr(p)}</div>}
                </div>
              </div>
            ))}
          </div>
          </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── CardapioPreview ──────────────────────────────────────────────────
// Preview do cardápio:
//   - Desktop: aspect A4 com setas pra navegar entre páginas. Click no
//     preview abre o PDF completo em nova aba.
//   - Mobile: altura adaptável (sem aspect ratio fixo — muitos cardápios
//     são landscape e cortavam com aspect portrait). FitH faz o PDF
//     ocupar 100% da largura sem cortar.
function CardapioPreview({
  cfg, isMobile, corPrimaria, corSecundaria, corFundo, menuButton,
}: {
  cfg: SiteConfig;
  isMobile: boolean;
  corPrimaria: string;
  corSecundaria: string;
  corFundo: string;
  menuButton: (cor: string, fundo: string) => React.CSSProperties;
}) {
  const [pagina, setPagina] = useState(1);
  const pdfUrl = cfg.cardapioPdfPtUrl;
  // No iOS Safari, o viewer nativo de PDF ignora os hash params
  // (#page, #view=FitH, #toolbar=0), o que faz o PDF não preencher a
  // largura do iframe no mobile. Solução: usar Google Docs Viewer no
  // mobile, que renderiza o PDF como sequência de imagens e SEMPRE
  // ocupa 100% da largura. Desktop continua iframe nativo + setas
  // (mais responsivo, sem dependência externa).
  const iframeSrc = !pdfUrl
    ? ""
    : isMobile
      ? `https://docs.google.com/gview?url=${encodeURIComponent(pdfUrl)}&embedded=true`
      // FitH (fit horizontally) ancora a página no topo do iframe e ajusta
      // o zoom pra largura da página = largura do iframe. Combinado com
      // iframe de altura exata = altura da página (aspectRatio 1/1.414),
      // a página 1 preenche o quadro sem deixar pixel de pág 2 vazar.
      // view=Fit não funciona aqui — o Chrome às vezes entra em modo
      // "continuous scroll" e mostra topo da próxima página no espaço
      // que sobra.
      : `${pdfUrl}#page=${pagina}&toolbar=0&navpanes=0&scrollbar=0&view=FitH&pagemode=none`;

  // Estilo do container do preview — adapta entre mobile e desktop
  const previewWrapperStyle: React.CSSProperties = isMobile
    ? {
        width: "100%",
        height: "75vh",                    // adapta à altura do viewport
        position: "relative",
        borderRadius: 8,
        overflow: "hidden",
        border: `1px solid ${corSecundaria}40`,
        backgroundColor: "#fff",
        boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
      }
    : {
        position: "relative",
        aspectRatio: "1 / 1.414",
        maxWidth: 760,
        margin: "0 auto",
        borderRadius: 8,
        overflow: "hidden",
        border: `1px solid ${corSecundaria}40`,
        backgroundColor: "#fff",
        boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
      };

  function seta(direcao: "prev" | "next") {
    return (
      <button
        type="button"
        aria-label={direcao === "prev" ? "Página anterior" : "Próxima página"}
        onClick={() => setPagina(p => direcao === "prev" ? Math.max(1, p - 1) : p + 1)}
        disabled={direcao === "prev" && pagina === 1}
        style={{
          position: "absolute",
          top: "50%", transform: "translateY(-50%)",
          [direcao === "prev" ? "left" : "right"]: 12,
          width: 44, height: 44,
          borderRadius: "50%",
          border: `1px solid ${corSecundaria}40`,
          backgroundColor: "rgba(255,255,255,0.95)",
          backdropFilter: "blur(4px)",
          color: corPrimaria,
          fontSize: 20, fontWeight: 700,
          cursor: direcao === "prev" && pagina === 1 ? "not-allowed" : "pointer",
          opacity: direcao === "prev" && pagina === 1 ? 0.3 : 1,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
          zIndex: 2,
          transition: "background-color 0.15s, transform 0.15s",
        }}
        onPointerEnter={(e) => {
          if (e.pointerType === "touch") return;
          e.currentTarget.style.backgroundColor = "#fff";
          e.currentTarget.style.transform = "translateY(-50%) scale(1.05)";
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "touch") return;
          e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.95)";
          e.currentTarget.style.transform = "translateY(-50%)";
        }}
      >
        {direcao === "prev" ? "‹" : "›"}
      </button>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* MOBILE: preview pesado do PDF (Google Docs Viewer) saiu — o iframe
          gview adicionava ~3-5s no first paint e às vezes nem carregava
          em redes 3G/4G fracas. Em vez de preview, mostra ilustração leve
          + botão grande "Toque pra abrir cardápio". Abre o PDF em nova aba
          via viewer nativo do iOS/Android — escala perfeita, sem custo. */}
      {pdfUrl && isMobile && (
        <div style={{ marginBottom: 24, textAlign: "center" }}>
          <a
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "block",
              padding: "32px 24px",
              borderRadius: 12,
              border: `2px dashed ${corSecundaria}60`,
              backgroundColor: "#fff",
              textDecoration: "none",
              color: corPrimaria,
              boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 12 }}>📄</div>
            <div style={{
              fontFamily: "inherit",
              fontSize: 18, fontWeight: 600,
              marginBottom: 4,
            }}>
              Toque para abrir o cardápio
            </div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Abre em nova aba (PDF)
            </div>
          </a>
        </div>
      )}

      {/* DESKTOP: mantém preview com iframe nativo (rápido + setas de navegação) */}
      {pdfUrl && !isMobile && (
        <div style={{ position: "relative", marginBottom: 24 }}>
          <div style={previewWrapperStyle}>
            <iframe
              key={`${pdfUrl}#${pagina}`}
              src={iframeSrc}
              title="Preview do cardápio"
              scrolling="no"
              style={{
                // OVERSIZE só na largura — empurra a scrollbar vertical do
                // PDF viewer pra fora do viewport (sem isso aparece uma
                // listra cinza na borda direita). Altura fica EXATAMENTE
                // igual à do wrapper (aspect 1/1.414) pra não sobrar pixel
                // de página 2 no rodapé.
                width: "calc(100% + 20px)",
                height: "100%",
                marginRight: -20,
                border: "none", display: "block",
              }}
              loading="lazy"
            />
            {/* Overlay invisível bloqueia scroll/clicks DENTRO do PDF
                viewer no desktop. Sem isso o scroll roda as páginas do
                PDF debaixo das setas. */}
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 1,
                backgroundColor: "transparent",
              }}
            />
            {seta("prev")}
            {seta("next")}
            <div style={{
              position: "absolute", bottom: 12, left: 12,
              backgroundColor: "rgba(0,0,0,0.78)", color: "#fff",
              padding: "4px 12px", borderRadius: 999,
              fontSize: 11, fontWeight: 500,
              zIndex: 2,
            }}>
              pág. {pagina}
            </div>
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                position: "absolute", bottom: 12, right: 12,
                backgroundColor: "rgba(0,0,0,0.78)", color: "#fff",
                padding: "6px 14px", borderRadius: 999,
                fontSize: 12, fontWeight: 500,
                textDecoration: "none",
                backdropFilter: "blur(4px)",
                zIndex: 2,
              }}
            >
              🔍 abrir completo
            </a>
          </div>
        </div>
      )}
      {/* Botões inferiores — só fazem sentido quando há 2 idiomas (escolha
          PT/EN) OU no desktop (preview não abre direto clicando — botão
          é a única forma de ver o cardápio completo). No mobile com só
          1 idioma, o próprio card "Toque para abrir o cardápio" já é o
          link — segunda exibição vira ruído. */}
      {(cfg.cardapioPdfEnUrl || !isMobile) && (
        <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
          {cfg.cardapioPdfPtUrl && (
            <a href={cfg.cardapioPdfPtUrl} target="_blank" rel="noreferrer" style={menuButton(corPrimaria, corFundo)}>
              {cfg.cardapioPdfEnUrl ? "Português" : "Ver cardápio completo"}
            </a>
          )}
          {cfg.cardapioPdfEnUrl && (
            <a href={cfg.cardapioPdfEnUrl} target="_blank" rel="noreferrer" style={menuButton(corPrimaria, corFundo)}>
              English
            </a>
          )}
        </div>
      )}
    </div>
  );
}
