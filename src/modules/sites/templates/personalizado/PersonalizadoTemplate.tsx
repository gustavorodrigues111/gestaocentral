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

  // Estilo do título h2 das seções — reaproveitado no layout pareado
  // (2 colunas no desktop). Section single-col faz tamanho maior inline.
  const tituloSectionStyle: React.CSSProperties = {
    fontFamily: fonteHeading,
    fontSize: "clamp(28px, 4vw, 40px)",
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
              fontSize: 14,
              color: corSecundaria, marginBottom: 16, opacity: 0.95,
              whiteSpace: "pre-wrap",
            }}>
              {cfg.slogan}
            </p>
          )}
          <h1 style={{
            fontFamily: fonteHeading,
            fontSize: isMobile ? "clamp(36px, 9vw, 56px)" : "clamp(40px, 7vw, 84px)",
            lineHeight: 1.05, margin: "0 0 20px 0", letterSpacing: "-0.01em",
            whiteSpace: "pre-wrap",
          }}>
            {t("heroTitulo", "Cozinha caipira,\nfeita com tempo.")}
          </h1>
          <p style={{
            fontFamily: fonteSubtitulo,
            fontSize: 17, opacity: 0.9, maxWidth: 560, margin: "0 auto 28px",
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
          }}>
            {t("heroSubtitulo", "Um laboratório gastronômico no coração da Vila Madalena.")}
          </p>
          {/* CTA do hero: leva pra reservas. Instagram + WhatsApp vivem
              nos botões flutuantes no canto inferior — não duplica aqui. */}
          {cfg.features.hasReservas && (
            <Link to={`/reservas/${cfg.restaurantId}`} style={primaryButton(corSecundaria)}>
              {t("heroCtaLabel", "Faça sua reserva")}
            </Link>
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
            conteudo: <HistoriaExpansivel texto={cfg.historia} bgSecao={bg} corPrimaria={corPrimaria} />,
          } : null,
          cardapio: () => (cfg.cardapioPdfPtUrl || cfg.cardapioPdfEnUrl) ? {
            titulo: t("cardapioTitulo", "Cardápio"),
            conteudo: <CardapioPreview cfg={cfg} isMobile={isMobile} corPrimaria={corPrimaria} corSecundaria={corSecundaria} corFundo={corFundo} menuButton={menuButton} />,
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
                    display: "flex", justifyContent: "space-between",
                    padding: "10px 0",
                    borderBottom: i < grupos.length - 1 ? `1px dashed ${corSecundaria}30` : "none",
                    fontSize: 15,
                  }}>
                    <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{g.diasLabel}</span>
                    <span style={{ color: g.fechado ? "#999" : "#1a1a1a" }}>
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
              <div style={{ maxWidth: 700, margin: "0 auto", textAlign: "center" }}>
                <p style={{ fontSize: 17, lineHeight: 1.7, marginBottom: 28, whiteSpace: "pre-wrap" }}>
                  {t("lajeTexto", "Nosso rooftop recebe eventos privados para até 45 pessoas. Aniversários, encontros corporativos, jantares fechados — montamos cada celebração com você.")}
                </p>
                <Link to={`/eventos/${cfg.restaurantId}`} style={primaryButton(corPrimaria)}>
                  {t("lajeCtaLabel", "Solicitar proposta")}
                </Link>
              </div>
            ),
          } : null,
          eventos: () => (cfg.features.hasEventos && !cfg.features.hasLaje) ? {
            titulo: t("eventosTitulo", "Eventos privados"),
            conteudo: (
              <div style={{ maxWidth: 700, margin: "0 auto", textAlign: "center" }}>
                <p style={{ fontSize: 17, lineHeight: 1.7, marginBottom: 28, whiteSpace: "pre-wrap" }}>
                  {t("eventosTexto", "Reservamos o espaço para sua celebração. Conta pra gente o que tem em mente — voltamos com uma proposta sob medida.")}
                </p>
                <Link to={`/eventos/${cfg.restaurantId}`} style={primaryButton(corPrimaria)}>
                  {t("eventosCtaLabel", "Solicitar proposta")}
                </Link>
              </div>
            ),
          } : null,
          reservas: () => cfg.features.hasReservas ? {
            titulo: t("reservasTitulo", "Reservas"),
            conteudo: (
              <div style={{ maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
                <p style={{ fontSize: 17, lineHeight: 1.7, marginBottom: 24, whiteSpace: "pre-wrap" }}>
                  {t("reservasTexto", "Recebemos com e sem reserva. Pra grupos a partir de 6 pessoas, recomendamos reservar.")}
                </p>
                <Link to={`/reservas/${cfg.restaurantId}`} style={primaryButton(corPrimaria)}>
                  {t("reservasCtaLabel", "Reservar mesa")}
                </Link>
              </div>
            ),
          } : null,
          delivery: () => (cfg.features.hasDelivery && cfg.delivery && cfg.delivery.length > 0) ? {
            titulo: t("deliveryTitulo", "Peça pra casa"),
            conteudo: (
              <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", maxWidth: 700, margin: "0 auto" }}>
                {(cfg.delivery || []).map((d, i) => (
                  <a key={i} href={d.url} target="_blank" rel="noreferrer" style={menuButton(corPrimaria, corFundo)}>
                    {d.label || labelDelivery(d.plataforma)}
                  </a>
                ))}
              </div>
            ),
          } : null,
          trabalhe: () => cfg.features.hasTrabalheConosco ? {
            titulo: t("trabalheTitulo", "Venha trabalhar com a gente"),
            conteudo: (
              <div style={{ maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
                <p style={{ fontSize: 17, lineHeight: 1.7, marginBottom: 24, whiteSpace: "pre-wrap" }}>
                  {t("trabalheTexto", "Sempre buscando gente boa pra somar no time.")}
                </p>
                <Link to={`/trabalhe/${cfg.restaurantId}`} style={primaryButton(corPrimaria)}>
                  {t("trabalheCtaLabel", "Enviar candidatura")}
                </Link>
              </div>
            ),
          } : null,
          contato: () => {
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
            return {
              titulo: t("contatoTitulo", "Como chegar"),
              conteudo: (
                <div style={{ maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
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
                          <span>📞</span> {cfg.telefone}
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

        // 2) Pareia consecutivos NA LISTA FILTRADA. Mobile sempre single.
        const nodes: React.ReactNode[] = [];
        let idxRenderizado = 0;
        let i = 0;
        while (i < items.length) {
          const a = items[i]!;
          const b = items[i + 1];
          const bg = idxRenderizado % 2 === 0 ? corFundo : "#ffffff";

          if (!isMobile && b && ehPar(a.id, b.id)) {
            nodes.push(
              <section key={`${a.id}-${b.id}`} id={`pair-${a.id}-${b.id}`} style={{
                padding: "80px 20px", backgroundColor: bg,
              }}>
                {/* Grid sem gap + linha divisória sólida no meio (separator
                    visual). Cada coluna ganha seu próprio padding interno.
                    "grid-template-columns: 1fr 1px 1fr" reserva 1px exato
                    pra divisora — sem hack de margin negativa. */}
                <div style={{
                  maxWidth: 1300, margin: "0 auto",
                  display: "grid",
                  gridTemplateColumns: "1fr 1px 1fr",
                  alignItems: "stretch",
                }}>
                  <div id={a.id} style={{ paddingRight: 48 }}>
                    <h2 style={tituloSectionStyle}>{a.titulo}</h2>
                    {a.conteudo}
                  </div>
                  <div aria-hidden style={{
                    backgroundColor: corSecundaria,
                    opacity: 0.25,
                    width: 1,
                  }} />
                  <div id={b.id} style={{ paddingLeft: 48 }}>
                    <h2 style={tituloSectionStyle}>{b.titulo}</h2>
                    {b.conteudo}
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
                   style={{ color: corFundo, textDecoration: "none", fontSize: 14 }}>
                  {iconRede(r.tipo)} {labelRede(r.tipo, r.label)}
                </a>
              ))}
            </div>
          );
        })()}
        <div style={{ fontSize: 12, opacity: 0.7, whiteSpace: "pre-wrap" }}>
          © {new Date().getFullYear()} — {t("rodapeDireitos", "Todos os direitos reservados.")}
        </div>
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

  function NavLink({ href, children, cor }: { href: string; children: React.ReactNode; cor?: string }) {
    return (
      <a href={href} style={{
        color: cor ?? corTexto, textDecoration: "none",
        fontSize: 14, fontWeight: 500,
        padding: "4px 10px",
        borderRadius: 999,
        transition: "color 0.25s ease, background-color 0.15s ease",
      }}
      onPointerEnter={(e) => { if (e.pointerType === "touch") return; e.currentTarget.style.backgroundColor = `${corPrimaria}10`; }}
      onPointerLeave={(e) => { if (e.pointerType === "touch") return; e.currentTarget.style.backgroundColor = "transparent"; }}
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
            ...tituloSectionStyle,
            fontSize: "clamp(32px, 5vw, 48px)",  // tamanho original
            marginBottom: 48,
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
      fontSize: 15,
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
  // Hash do iframe muda quando a página muda — força o PDF re-render
  const viewMode = isMobile ? "FitH" : "Fit";
  const iframeSrc = pdfUrl
    ? `${pdfUrl}#page=${pagina}&toolbar=0&navpanes=0&scrollbar=0&view=${viewMode}`
    : "";

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
      {pdfUrl && (
        <div style={{ position: "relative", marginBottom: 24 }}>
          {/* Wrapper visual + iframe — não envolvido em <a> pq queremos
              click nas setas funcionar. Em vez disso, hint clicável
              abaixo serve pra abrir o PDF completo. */}
          <div style={previewWrapperStyle}>
            <iframe
              key={`${pdfUrl}#${pagina}`}
              src={iframeSrc}
              title="Preview do cardápio"
              scrolling="no"
              style={{
                width: "100%", height: "100%",
                border: "none", display: "block",
                // Bloqueia scroll/interação do PDF viewer interno —
                // navegação entre páginas só pelas setas. Mobile mantém
                // pointerEvents pra scroll natural funcionar dentro do FitH.
                pointerEvents: isMobile ? "auto" : "none",
              }}
              loading="lazy"
            />
            {/* Setas — só desktop. Mobile usa o botão "abrir completo" pra ver tudo. */}
            {!isMobile && seta("prev")}
            {!isMobile && seta("next")}
            {!isMobile && (
              <div style={{
                position: "absolute", bottom: 12, left: 12,
                backgroundColor: "rgba(0,0,0,0.78)", color: "#fff",
                padding: "4px 12px", borderRadius: 999,
                fontSize: 11, fontWeight: 500,
              }}>
                pág. {pagina}
              </div>
            )}
            {/* Hint abrir completo */}
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
              }}
            >
              🔍 abrir completo
            </a>
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
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
    </div>
  );
}
