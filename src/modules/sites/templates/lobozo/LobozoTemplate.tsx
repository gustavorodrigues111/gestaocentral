// Template visual do Lobozó — caipira refinado.
// Paleta: verde-mata + dourado-velho + creme.
// Tipografia: DM Serif Display (heading) + Inter (corpo) — ambos Google Fonts.
//
// Pesos performance:
//  - Fontes carregadas com display=swap (não bloqueia)
//  - 1 foto hero opcional (se não tiver, gradiente bem feito)
//  - Mapa = link pra Google Maps (sem iframe pesado)
//  - Cardápio = botão abre PDF (sem embed)
//  - Sem libs extras

import { useEffect } from "react";
import { Link } from "react-router-dom";
import type { SiteConfig } from "../../../../core/types";
import { agruparHorarios, formatarDataCurta, proximasExcecoes } from "../../shared/horarioUtils";
import { enderecoLinhaUm, enderecoLinhaDois, googleMapsLink } from "../../shared/enderecoUtils";
import { findFonte, googleFontsUrl } from "../fontesDisponiveis";

type Props = { siteConfig: SiteConfig };

// Defaults do Lobozó — usados quando cfg.tema não tem override.
// Se você mudar a cor primária / secundária / fundo / texto na aba Geral,
// vai sobrescrever esses valores.
const PADRAO_PRIMARIA = "#1a5c2a";   // verde-mata
const PADRAO_SECUNDARIA = "#b8923a"; // dourado-velho
const PADRAO_FUNDO = "#f7f3e9";       // creme
const PADRAO_TEXTO = "#1a1a1a";

export function LobozoTemplate({ siteConfig: cfg }: Props) {
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
      {/* HEADER */}
      <header style={{
        position: "sticky", top: 0, zIndex: 50,
        backgroundColor: "rgba(247,243,233,0.95)",
        backdropFilter: "blur(8px)",
        borderBottom: `1px solid ${corSecundaria}30`,
      }}>
        <div style={{
          maxWidth: 1100, margin: "0 auto",
          padding: "12px 20px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
        }}>
          <div style={{
            fontFamily: fonteHeading, fontSize: 22, color: corPrimaria, letterSpacing: "0.02em",
          }}>
            {cfg.logoUrl
              ? <img src={cfg.logoUrl} alt="Logo" style={{ height: 36, width: "auto" }} />
              : "lobozó"}
          </div>
          <nav style={{ display: "flex", gap: 18, fontSize: 14, fontWeight: 500 }}>
            <NavLink href="#historia">Sobre</NavLink>
            <NavLink href="#cardapio">Cardápio</NavLink>
            <NavLink href="#horario">Horário</NavLink>
            {cfg.features.hasLaje && <NavLink href="#laje">Laje</NavLink>}
            {cfg.features.hasReservas && <NavLink href="#reservas">Reservas</NavLink>}
            <NavLink href="#contato">Contato</NavLink>
          </nav>
        </div>
      </header>

      {/* HERO */}
      <section style={{
        background: heroBg,
        color: corFundo,
        minHeight: "70vh",
        display: "flex", alignItems: "center",
        padding: "80px 20px",
      }}>
        <div style={{ maxWidth: 900, margin: "0 auto", textAlign: "center" }}>
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
            fontFamily: fonteHeading, fontSize: "clamp(40px, 7vw, 84px)",
            lineHeight: 1.05, margin: "0 0 24px 0", letterSpacing: "-0.01em",
            whiteSpace: "pre-line",
          }}>
            {t("heroTitulo", "Cozinha caipira,\nfeita com tempo.")}
          </h1>
          <p style={{
            fontFamily: fonteSubtitulo,
            fontSize: 17, opacity: 0.9, maxWidth: 560, margin: "0 auto 36px",
            lineHeight: 1.55,
          }}>
            {t("heroSubtitulo", "Um laboratório gastronômico no coração da Vila Madalena.")}
          </p>
          {cfg.features.hasReservas && (
            <a href="#reservas" style={primaryButton(corSecundaria)}>
              {t("heroCtaLabel", "Faça sua reserva")}
            </a>
          )}
        </div>
      </section>

      {/* HISTÓRIA */}
      {cfg.historia && (
        <Section id="historia" titulo={t("historiaTitulo", "A nossa história")} bg={corFundo}>
          <div style={{
            maxWidth: 720, margin: "0 auto", fontSize: 17, lineHeight: 1.7,
            whiteSpace: "pre-wrap",
          }}>
            {cfg.historia}
          </div>
        </Section>
      )}

      {/* CARDÁPIO */}
      {(cfg.cardapioPdfPtUrl || cfg.cardapioPdfEnUrl) && (
        <Section id="cardapio" titulo={t("cardapioTitulo", "Cardápio")} bg="#ffffff">
          <div style={{
            display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap",
            maxWidth: 600, margin: "0 auto",
          }}>
            {cfg.cardapioPdfPtUrl && (
              <a
                href={cfg.cardapioPdfPtUrl} target="_blank" rel="noreferrer"
                style={menuButton(corPrimaria, corFundo)}
              >
                🇧🇷 Cardápio (Português)
              </a>
            )}
            {cfg.cardapioPdfEnUrl && (
              <a
                href={cfg.cardapioPdfEnUrl} target="_blank" rel="noreferrer"
                style={menuButton(corPrimaria, corFundo)}
              >
                🇺🇸 Menu (English)
              </a>
            )}
          </div>
        </Section>
      )}

      {/* HORÁRIO */}
      <Section id="horario" titulo={t("horarioTitulo", "Horário de funcionamento")} bg={corFundo}>
        <div style={{
          maxWidth: 500, margin: "0 auto",
          background: "#ffffff",
          borderRadius: 8, padding: 24,
          border: `1px solid ${corSecundaria}30`,
        }}>
          {grupos.map((g, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", padding: "10px 0",
              borderBottom: i < grupos.length - 1 ? `1px dashed ${corSecundaria}30` : "none",
              fontSize: 15,
            }}>
              <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{g.diasLabel}</span>
              <span style={{ color: g.fechado ? "#999" : "#1a1a1a" }}>
                {g.fechado ? "fechado" : g.turnosLabel}
              </span>
            </div>
          ))}
          {excecoes.length > 0 && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${corSecundaria}30` }}>
              <div style={{
                fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase",
                color: corSecundaria, marginBottom: 8, fontWeight: 600,
              }}>
                {t("horarioProximosAvisosLabel", "Próximos avisos")}
              </div>
              {excecoes.map(e => (
                <div key={e.id} style={{ fontSize: 13, marginBottom: 4, color: "#555" }}>
                  <strong>{formatarDataCurta(e.data)}</strong>
                  {" — "}
                  {e.fechado ? "fechado" : (e.turnos?.map(t => `${t.abre}–${t.fecha}`).join(", ") || "horário especial")}
                  {e.motivo && ` (${e.motivo})`}
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      {/* LAJE — só se ligado */}
      {cfg.features.hasLaje && cfg.features.hasEventos && (
        <Section id="laje" titulo={t("lajeTitulo", "Eventos na Laje")} bg="#ffffff">
          <div style={{ maxWidth: 700, margin: "0 auto", textAlign: "center" }}>
            <p style={{ fontSize: 17, lineHeight: 1.7, marginBottom: 28, whiteSpace: "pre-line" }}>
              {t("lajeTexto", "Nosso rooftop recebe eventos privados para até 45 pessoas. Aniversários, encontros corporativos, jantares fechados — montamos cada celebração com você.")}
            </p>
            <Link to={`/eventos/${cfg.restaurantId}`} style={primaryButton(corPrimaria)}>
              {t("lajeCtaLabel", "Solicitar proposta")}
            </Link>
          </div>
        </Section>
      )}

      {/* EVENTOS (genérico, se não tem Laje específica) */}
      {cfg.features.hasEventos && !cfg.features.hasLaje && (
        <Section id="eventos" titulo={t("eventosTitulo", "Eventos privados")} bg="#ffffff">
          <div style={{ maxWidth: 700, margin: "0 auto", textAlign: "center" }}>
            <p style={{ fontSize: 17, lineHeight: 1.7, marginBottom: 28, whiteSpace: "pre-line" }}>
              {t("eventosTexto", "Reservamos o espaço para sua celebração. Conta pra gente o que tem em mente — voltamos com uma proposta sob medida.")}
            </p>
            <Link to={`/eventos/${cfg.restaurantId}`} style={primaryButton(corPrimaria)}>
              {t("eventosCtaLabel", "Solicitar proposta")}
            </Link>
          </div>
        </Section>
      )}

      {/* RESERVAS */}
      {cfg.features.hasReservas && (
        <Section id="reservas" titulo={t("reservasTitulo", "Reservas")} bg={corFundo}>
          <div style={{ maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
            <p style={{ fontSize: 17, lineHeight: 1.7, marginBottom: 24, whiteSpace: "pre-line" }}>
              {t("reservasTexto", "Recebemos com e sem reserva. Pra grupos a partir de 6 pessoas, recomendamos reservar.")}
            </p>
            {waLink && (
              <a href={waLink} target="_blank" rel="noreferrer" style={primaryButton(corSecundaria)}>
                {t("reservasCtaLabel", "💬 Reservar pelo WhatsApp")}
              </a>
            )}
          </div>
        </Section>
      )}

      {/* DELIVERY */}
      {cfg.features.hasDelivery && cfg.delivery && cfg.delivery.length > 0 && (
        <Section id="delivery" titulo={t("deliveryTitulo", "Peça pra casa")} bg="#ffffff">
          <div style={{
            display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap",
            maxWidth: 700, margin: "0 auto",
          }}>
            {cfg.delivery.map((d, i) => (
              <a key={i} href={d.url} target="_blank" rel="noreferrer"
                 style={menuButton(corPrimaria, corFundo)}>
                {d.label || labelDelivery(d.plataforma)}
              </a>
            ))}
          </div>
        </Section>
      )}

      {/* TRABALHE CONOSCO */}
      {cfg.features.hasTrabalheConosco && (
        <Section id="trabalhe" titulo={t("trabalheTitulo", "Venha trabalhar com a gente")} bg={corFundo}>
          <div style={{ maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
            <p style={{ fontSize: 17, lineHeight: 1.7, marginBottom: 24, whiteSpace: "pre-line" }}>
              {t("trabalheTexto", "Sempre buscando gente boa pra somar no time.")}
            </p>
            <Link to={`/trabalhe/${cfg.restaurantId}`} style={primaryButton(corPrimaria)}>
              {t("trabalheCtaLabel", "Enviar candidatura")}
            </Link>
          </div>
        </Section>
      )}

      {/* CONTATO */}
      <Section id="contato" titulo={t("contatoTitulo", "Como chegar")} bg="#ffffff">
        <div style={{
          maxWidth: 600, margin: "0 auto", textAlign: "center", fontSize: 16, lineHeight: 1.7,
        }}>
          {enderecoLinhaUm(cfg.endereco) && (
            <p style={{ marginBottom: 4 }}>{enderecoLinhaUm(cfg.endereco)}</p>
          )}
          {enderecoLinhaDois(cfg.endereco) && (
            <p style={{ marginBottom: 16, color: "#555" }}>{enderecoLinhaDois(cfg.endereco)}</p>
          )}
          <a href={googleMapsLink(cfg.endereco)} target="_blank" rel="noreferrer"
             style={{ color: corPrimaria, textDecoration: "underline", fontSize: 15 }}>
            ver no Google Maps →
          </a>
          {(cfg.telefone || cfg.emailContato) && (
            <div style={{ marginTop: 24, fontSize: 14, color: "#555" }}>
              {cfg.telefone && <div>📞 {cfg.telefone}</div>}
              {cfg.emailContato && <div>✉ {cfg.emailContato}</div>}
            </div>
          )}
        </div>
      </Section>

      {/* FOOTER */}
      <footer style={{
        backgroundColor: corPrimaria, color: corFundo,
        padding: "40px 20px 24px",
        textAlign: "center",
      }}>
        <div style={{
          fontFamily: fonteHeading, fontSize: 24, marginBottom: 16, color: corSecundaria,
        }}>
          lobozó
        </div>
        {cfg.redes.length > 0 && (
          <div style={{ display: "flex", gap: 18, justifyContent: "center", marginBottom: 20 }}>
            {cfg.redes.filter(r => r.url).map((r, i) => (
              <a key={i} href={r.url} target="_blank" rel="noreferrer"
                 style={{ color: corFundo, textDecoration: "none", fontSize: 14 }}>
                {iconRede(r.tipo)} {labelRede(r.tipo, r.label)}
              </a>
            ))}
          </div>
        )}
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          © {new Date().getFullYear()} {cfg.restaurantId}
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

  function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
    return (
      <a href={href} style={{
        color: corTexto, textDecoration: "none",
        fontSize: 14, fontWeight: 500,
      }}>{children}</a>
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
