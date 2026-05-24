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
import type { SiteConfig } from "../../../../core/types";
import { agruparHorarios, proximasExcecoes } from "../../shared/horarioUtils";
import { enderecoLinhaUm, enderecoLinhaDois, googleMapsLink } from "../../shared/enderecoUtils";
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

  // Scrolled: vira true quando o usuário rolou pra fora do hero.
  // Usado pra mostrar a logo no header só depois disso, mantendo o topo
  // limpo enquanto a logo grande do hero ainda está visível.
  // Threshold conservador: ~280px cobre logo grande + slogan no hero.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    function onScroll() { setScrolled(window.scrollY > 280); }
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

  return (
    <div style={{
      fontFamily: fonteCorpo,
      color: "#1a1a1a",
      backgroundColor: corFundo,
      minHeight: "100vh",
    }}>
      {/* HEADER — desktop tem nav inline; mobile tem hamburger que abre
          dropdown abaixo do header com os mesmos links em coluna.
          Background + borda só aparecem depois que rola (junto com a logo)
          pra deixar o hero "respirar" inteiro no topo da página. */}
      <header style={{
        position: "sticky", top: 0, zIndex: 50,
        backgroundColor: scrolled ? "rgba(247,243,233,0.95)" : "transparent",
        backdropFilter: scrolled ? "blur(8px)" : "none",
        borderBottom: scrolled ? `1px solid ${corSecundaria}30` : "1px solid transparent",
        transition: "background-color 0.25s ease, border-color 0.25s ease",
      }}>
        <div style={{
          maxWidth: 1100, margin: "0 auto",
          padding: isMobile ? "10px 16px" : "12px 20px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 16,
        }}>
          {/* Logo/título do header — só aparece depois que rola pra fora do hero.
              Mantém o slot reservado (mesma altura) pra não causar layout shift
              quando aparece. Fade + slide suave pra ficar elegante. */}
          <div style={{
            fontFamily: fonteHeading, fontSize: 22, color: corPrimaria, letterSpacing: "0.02em",
            display: "flex", alignItems: "center",
            height: isMobile ? 32 : 36,
            opacity: scrolled ? 1 : 0,
            transform: scrolled ? "translateY(0)" : "translateY(-6px)",
            transition: "opacity 0.25s ease, transform 0.25s ease",
            pointerEvents: scrolled ? "auto" : "none",
          }}>
            {cfg.logoUrl
              ? <img src={cfg.logoUrl} alt="Logo" style={{ height: isMobile ? 32 : 36, width: "auto", display: "block" }} />
              : (cfg.slogan || cfg.slug)}
          </div>
          {/* Menu/hamburger ganham um "chip" próprio com background creme +
              blur. Assim o menu fica visível desde o topo (mesmo com o
              header transparente sobre a hero escura), enquanto a logo do
              header continua escondida até rolar. Quando o header já está
              sólido, o chip se funde naturalmente. */}
          {(() => {
            // Estilo de pílula compartilhado entre nav e hamburger.
            // Mais marcado quando o header está transparente, mais sutil quando sólido.
            const chipBg = scrolled
              ? "transparent"
              : `${corFundo}d9`;             // ~85% opaco
            const chipBorder = scrolled
              ? "1px solid transparent"
              : `1px solid ${corSecundaria}40`;
            const chipBlur = scrolled ? "none" : "blur(6px)";
            const chipTransition =
              "background-color 0.25s ease, border-color 0.25s ease";

            if (isMobile) {
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
                    padding: 8,
                    cursor: "pointer",
                    display: "flex", flexDirection: "column",
                    gap: 4,
                    width: 40, height: 40,
                    alignItems: "center", justifyContent: "center",
                    color: corPrimaria,
                    transition: chipTransition,
                  }}
                >
                  {/* Hambúrguer estilizado: 3 barras → vira X quando aberto */}
                  <span style={{
                    display: "block", width: 22, height: 2,
                    backgroundColor: corPrimaria,
                    transition: "transform 0.2s, opacity 0.2s",
                    transform: menuAberto ? "translateY(6px) rotate(45deg)" : "none",
                  }} />
                  <span style={{
                    display: "block", width: 22, height: 2,
                    backgroundColor: corPrimaria,
                    transition: "opacity 0.2s",
                    opacity: menuAberto ? 0 : 1,
                  }} />
                  <span style={{
                    display: "block", width: 22, height: 2,
                    backgroundColor: corPrimaria,
                    transition: "transform 0.2s",
                    transform: menuAberto ? "translateY(-6px) rotate(-45deg)" : "none",
                  }} />
                </button>
              );
            }
            return (
              <nav style={{
                display: "flex", gap: 4,
                fontSize: 14, fontWeight: 500,
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
                {cfg.features.hasReservas && <NavLink href={`/reservas/${cfg.restaurantId}`} cor={corTexto}>Reservas</NavLink>}
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
                <MobileMenuLink href={`/reservas/${cfg.restaurantId}`} onClick={() => setMenuAberto(false)} cor={corTexto} corBorda={corSecundaria}>
                  Reservas
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
          {/* Logo grande no topo do hero — branca/invertida pra
              destacar sobre o fundo escuro. Só aparece se tem logo. */}
          {cfg.logoUrl && (
            <img
              src={cfg.logoUrl}
              alt="Logo"
              style={{
                maxWidth: isMobile ? 200 : 280,
                width: "auto",
                height: "auto",
                marginBottom: 28,
                filter: "brightness(0) invert(1)",
                display: "block",
                marginLeft: "auto",
                marginRight: "auto",
              }}
            />
          )}
          {cfg.slogan && (
            <p style={{
              fontFamily: fonteSubtitulo,
              fontSize: 13, letterSpacing: "0.3em", textTransform: "uppercase",
              color: corSecundaria, marginBottom: 16, opacity: 0.95,
            }}>
              {cfg.slogan}
            </p>
          )}
          <h1 style={{
            fontFamily: fonteHeading,
            fontSize: isMobile ? "clamp(36px, 9vw, 56px)" : "clamp(40px, 7vw, 84px)",
            lineHeight: 1.05, margin: "0 0 20px 0", letterSpacing: "-0.01em",
            whiteSpace: "pre-line",
          }}>
            {t("heroTitulo", "Cozinha caipira,\nfeita com tempo.")}
          </h1>
          <p style={{
            fontFamily: fonteSubtitulo,
            fontSize: 17, opacity: 0.9, maxWidth: 560, margin: "0 auto 28px",
            lineHeight: 1.55,
          }}>
            {t("heroSubtitulo", "Um laboratório gastronômico no coração da Vila Madalena.")}
          </p>
          {/* CTA do hero: Instagram (se cadastrado).
              WhatsApp já tem o botão flutuante 💬 no canto da tela, então
              fica fora daqui pra não duplicar. Fallback: botão de reserva. */}
          {(() => {
            const insta = cfg.redes.find(r => r.tipo === "instagram" && r.url);
            if (insta) {
              return (
                <a
                  href={insta.url}
                  target="_blank"
                  rel="noreferrer"
                  style={socialButtonHero(corSecundaria)}
                  title="Instagram"
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
                >
                  <span style={{ fontSize: 14 }}>📷</span> Instagram
                </a>
              );
            }
            // Fallback: botão de reserva — leva pra página pública /reservas/:rid
            if (cfg.features.hasReservas) {
              return (
                <Link to={`/reservas/${cfg.restaurantId}`} style={primaryButton(corSecundaria)}>
                  {t("heroCtaLabel", "Faça sua reserva")}
                </Link>
              );
            }
            return null;
          })()}
        </div>
      </section>

      {/* Seções reordenáveis — entre hero e footer.
          Ordem vem de cfg.ordemSecoes (com fallback pra ORDEM_PADRAO).
          Bg alterna creme/branco pra ritmo visual. Seções com feature
          desligada ou sem conteúdo retornam null e ficam fora do zebra. */}
      {(() => {
        const ordem = normalizarOrdem(cfg.ordemSecoes);
        const renderers: Record<SecaoId, (bg: string) => React.ReactNode> = {
          historia: (bg) => cfg.historia ? (
            <Section id="historia" titulo={t("historiaTitulo", "A nossa história")} bg={bg}>
              <HistoriaExpansivel
                texto={cfg.historia}
                bgSecao={bg}
                corPrimaria={corPrimaria}
              />
            </Section>
          ) : null,
          cardapio: (bg) => (cfg.cardapioPdfPtUrl || cfg.cardapioPdfEnUrl) ? (
            <Section id="cardapio" titulo={t("cardapioTitulo", "Cardápio")} bg={bg}>
              <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap", maxWidth: 600, margin: "0 auto" }}>
                {cfg.cardapioPdfPtUrl && (
                  <a href={cfg.cardapioPdfPtUrl} target="_blank" rel="noreferrer" style={menuButton(corPrimaria, corFundo)}>
                    🇧🇷 Cardápio (Português)
                  </a>
                )}
                {cfg.cardapioPdfEnUrl && (
                  <a href={cfg.cardapioPdfEnUrl} target="_blank" rel="noreferrer" style={menuButton(corPrimaria, corFundo)}>
                    🇺🇸 Menu (English)
                  </a>
                )}
              </div>
            </Section>
          ) : null,
          horario: (bg) => (
            <Section id="horario" titulo={t("horarioTitulo", "Horário de funcionamento")} bg={bg}>
              <div style={{ maxWidth: 600, margin: "0 auto", background: "#ffffff", borderRadius: 8, padding: 24, border: `1px solid ${corSecundaria}30` }}>
                {grupos.map((g, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: i < grupos.length - 1 ? `1px dashed ${corSecundaria}30` : "none", fontSize: 15 }}>
                    <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{g.diasLabel}</span>
                    <span style={{ color: g.fechado ? "#999" : "#1a1a1a" }}>
                      {g.fechado ? "fechado" : g.turnosLabel}
                    </span>
                  </div>
                ))}
                {excecoes.length > 0 && (
                  <div style={{ marginTop: 20, paddingTop: 20, borderTop: `1px solid ${corSecundaria}30` }}>
                    <div style={{
                      // Preserva case do usuário (pode misturar Maiúscula/minúscula)
                      // e suporta \n pra quebrar em duas linhas.
                      fontSize: 13, letterSpacing: "0.04em",
                      color: corPrimaria, marginBottom: 14, fontWeight: 600,
                      textAlign: "center", whiteSpace: "pre-line", lineHeight: 1.35,
                    }}>
                      {t("horarioProximosAvisosLabel", "Próximos avisos")}
                    </div>
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                      gap: 10,
                    }}>
                      {excecoes.map(e => {
                        const d = new Date(e.data + "T12:00:00");
                        const diaSemana = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d.getDay()];
                        const dataCurta = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
                        return (
                          <div key={e.id} style={{
                            padding: "10px 12px",
                            borderRadius: 6,
                            border: `1px solid ${corSecundaria}30`,
                            backgroundColor: e.fechado
                              ? `${corSecundaria}10`
                              : "#ffffff",
                            textAlign: "center",
                          }}>
                            <div style={{
                              fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em",
                              color: corPrimaria, fontWeight: 600,
                            }}>
                              {diaSemana}
                            </div>
                            <div style={{
                              fontSize: 18, fontWeight: 700, color: "#1a1a1a", marginTop: 2,
                              fontFamily: fonteHeading,
                            }}>
                              {dataCurta}
                            </div>
                            <div style={{
                              fontSize: 12, marginTop: 6, color: e.fechado ? corSecundaria : "#555",
                              fontWeight: e.fechado ? 600 : 400,
                            }}>
                              {e.fechado
                                ? "Fechado"
                                : (e.turnos?.map(tu => `${tu.abre}–${tu.fecha}`).join(" / ") || "Horário especial")}
                            </div>
                            {e.motivo && (
                              <div style={{
                                fontSize: 11, marginTop: 4, color: "#888", fontStyle: "italic",
                                lineHeight: 1.3,
                              }}>
                                {e.motivo}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </Section>
          ),
          laje: (bg) => (cfg.features.hasLaje && cfg.features.hasEventos) ? (
            <Section id="laje" titulo={t("lajeTitulo", "Eventos na Laje")} bg={bg}>
              <div style={{ maxWidth: 700, margin: "0 auto", textAlign: "center" }}>
                <p style={{ fontSize: 17, lineHeight: 1.7, marginBottom: 28, whiteSpace: "pre-line" }}>
                  {t("lajeTexto", "Nosso rooftop recebe eventos privados para até 45 pessoas. Aniversários, encontros corporativos, jantares fechados — montamos cada celebração com você.")}
                </p>
                <Link to={`/eventos/${cfg.restaurantId}`} style={primaryButton(corPrimaria)}>
                  {t("lajeCtaLabel", "Solicitar proposta")}
                </Link>
              </div>
            </Section>
          ) : null,
          eventos: (bg) => (cfg.features.hasEventos && !cfg.features.hasLaje) ? (
            <Section id="eventos" titulo={t("eventosTitulo", "Eventos privados")} bg={bg}>
              <div style={{ maxWidth: 700, margin: "0 auto", textAlign: "center" }}>
                <p style={{ fontSize: 17, lineHeight: 1.7, marginBottom: 28, whiteSpace: "pre-line" }}>
                  {t("eventosTexto", "Reservamos o espaço para sua celebração. Conta pra gente o que tem em mente — voltamos com uma proposta sob medida.")}
                </p>
                <Link to={`/eventos/${cfg.restaurantId}`} style={primaryButton(corPrimaria)}>
                  {t("eventosCtaLabel", "Solicitar proposta")}
                </Link>
              </div>
            </Section>
          ) : null,
          reservas: (bg) => cfg.features.hasReservas ? (
            <Section id="reservas" titulo={t("reservasTitulo", "Reservas")} bg={bg}>
              <div style={{ maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
                <p style={{ fontSize: 17, lineHeight: 1.7, marginBottom: 24, whiteSpace: "pre-line" }}>
                  {t("reservasTexto", "Recebemos com e sem reserva. Pra grupos a partir de 6 pessoas, recomendamos reservar.")}
                </p>
                <Link to={`/reservas/${cfg.restaurantId}`} style={primaryButton(corPrimaria)}>
                  {t("reservasCtaLabel", "Reservar mesa")}
                </Link>
              </div>
            </Section>
          ) : null,
          delivery: (bg) => (cfg.features.hasDelivery && cfg.delivery && cfg.delivery.length > 0) ? (
            <Section id="delivery" titulo={t("deliveryTitulo", "Peça pra casa")} bg={bg}>
              <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", maxWidth: 700, margin: "0 auto" }}>
                {(cfg.delivery || []).map((d, i) => (
                  <a key={i} href={d.url} target="_blank" rel="noreferrer" style={menuButton(corPrimaria, corFundo)}>
                    {d.label || labelDelivery(d.plataforma)}
                  </a>
                ))}
              </div>
            </Section>
          ) : null,
          trabalhe: (bg) => cfg.features.hasTrabalheConosco ? (
            <Section id="trabalhe" titulo={t("trabalheTitulo", "Venha trabalhar com a gente")} bg={bg}>
              <div style={{ maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
                <p style={{ fontSize: 17, lineHeight: 1.7, marginBottom: 24, whiteSpace: "pre-line" }}>
                  {t("trabalheTexto", "Sempre buscando gente boa pra somar no time.")}
                </p>
                <Link to={`/trabalhe/${cfg.restaurantId}`} style={primaryButton(corPrimaria)}>
                  {t("trabalheCtaLabel", "Enviar candidatura")}
                </Link>
              </div>
            </Section>
          ) : null,
          contato: (bg) => {
            const mapsHref = googleMapsLink(cfg.endereco);
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
            return (
              <Section id="contato" titulo={t("contatoTitulo", "Como chegar")} bg={bg}>
                <div style={{ maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
                  {/* Endereço — card único clicável */}
                  {(enderecoLinhaUm(cfg.endereco) || enderecoLinhaDois(cfg.endereco)) && (
                    <a
                      href={mapsHref}
                      target="_blank"
                      rel="noreferrer"
                      style={cardLink}
                      title="Abrir no app de mapas"
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = corPrimaria; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = `${corSecundaria}40`; }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 22, color: corPrimaria }}>📍</span>
                        <div style={{ textAlign: "left" }}>
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
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = `${corPrimaria}10`;
                            e.currentTarget.style.borderColor = corPrimaria;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = "transparent";
                            e.currentTarget.style.borderColor = `${corSecundaria}50`;
                          }}
                        >
                          <span>📞</span> {cfg.telefone}
                        </a>
                      )}
                      {mailHref && cfg.emailContato && (
                        <a
                          href={mailHref}
                          style={pillLink}
                          title="Enviar email"
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = `${corPrimaria}10`;
                            e.currentTarget.style.borderColor = corPrimaria;
                          }}
                          onMouseLeave={(e) => {
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
              </Section>
            );
          },
        };

        // Render seções na ordem + alterna bg só nas seções que existirem
        let idxRenderizado = 0;
        const nodes: React.ReactNode[] = [];
        for (const id of ordem) {
          const bg = idxRenderizado % 2 === 0 ? corFundo : "#ffffff";
          const node = renderers[id](bg);
          if (node) {
            nodes.push(<div key={id}>{node}</div>);
            idxRenderizado++;
          }
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
                   style={{ color: corFundo, textDecoration: "none", fontSize: 14 }}>
                  {iconRede(r.tipo)} {labelRede(r.tipo, r.label)}
                </a>
              ))}
            </div>
          );
        })()}
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          © {new Date().getFullYear()} — {t("rodapeDireitos", "Todos os direitos reservados.")}
        </div>
      </footer>

      {/* WHATSAPP FLOAT */}
      {waLink && (
        <a href={waLink} target="_blank" rel="noreferrer"
           style={whatsappFloat}>
          💬
        </a>
      )}
    </div>
  );

  // ─── Helpers internos (closure sobre cores dinâmicas) ─────────────────────

  function NavLink({ href, children, cor }: { href: string; children: React.ReactNode; cor?: string }) {
    return (
      <a href={href} style={{
        color: cor ?? corTexto, textDecoration: "none",
        fontSize: 14, fontWeight: 500,
        padding: "4px 10px",
        borderRadius: 999,
        transition: "color 0.25s ease, background-color 0.15s ease",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${corPrimaria}10`; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
      >{children}</a>
    );
  }

  function MobileMenuLink({ href, onClick, children, cor, corBorda }: {
    href: string;
    onClick: () => void;
    children: React.ReactNode;
    cor: string;
    corBorda: string;
  }) {
    return (
      <a
        href={href}
        onClick={onClick}
        style={{
          color: cor,
          textDecoration: "none",
          fontSize: 16,
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
            fontFamily: fonteHeading,
            fontSize: "clamp(32px, 5vw, 48px)",
            textAlign: "center", margin: "0 0 48px 0", color: corPrimaria,
            letterSpacing: "-0.01em",
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
      fontSize: 15,
      fontWeight: 600,
      letterSpacing: "0.05em",
      textTransform: "uppercase",
      borderRadius: 4,
      border: "none",
      cursor: "pointer",
      transition: "transform 0.15s ease",
    };
  }

  function menuButton(cor: string, fundo: string): React.CSSProperties {
    return {
      display: "inline-block",
      padding: "16px 28px",
      backgroundColor: fundo,
      color: cor,
      textDecoration: "none",
      fontSize: 15,
      fontWeight: 600,
      border: `2px solid ${cor}`,
      borderRadius: 4,
    };
  }

  // Botão social pro hero (Instagram, WhatsApp). Fundo cor secundária,
  // texto preto (contraste alto sobre amarelo/dourado/cores claras).
  // Sem uppercase, sem letterspacing — pílula discreta mas presente.
  function socialButtonHero(cor: string): React.CSSProperties {
    return {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "8px 18px",
      backgroundColor: cor,
      color: "#1a1a1a",
      textDecoration: "none",
      fontSize: 14,
      fontWeight: 500,
      borderRadius: 999,
      border: "none",
      transition: "opacity 0.2s, transform 0.15s",
    };
  }
}

const whatsappFloat: React.CSSProperties = {
  position: "fixed",
  bottom: 20, right: 20,
  width: 56, height: 56,
  backgroundColor: "#25d366",
  borderRadius: "50%",
  display: "flex", alignItems: "center", justifyContent: "center",
  textDecoration: "none",
  fontSize: 28,
  boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
  zIndex: 100,
};

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
  texto, bgSecao, corPrimaria,
}: {
  texto: string;
  bgSecao: string;
  corPrimaria: string;
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
          fontSize: 17, lineHeight: 1.7,
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
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = `${corPrimaria}10`;
              e.currentTarget.style.borderColor = `${corPrimaria}80`;
            }}
            onMouseLeave={(e) => {
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
