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

type Props = { siteConfig: SiteConfig };

const COR_VERDE = "#1a5c2a";
const COR_DOURADO = "#b8923a";
const COR_CREME = "#f7f3e9";

export function LobozoTemplate({ siteConfig: cfg }: Props) {
  // Carrega Google Fonts dinamicamente (preconnect + link)
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
    addLink(
      "https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Inter:wght@400;500;600;700&display=swap",
      { rel: "stylesheet" },
    );
    return () => { links.forEach(l => l.remove()); };
  }, []);

  const fontHeading = "'DM Serif Display', Georgia, serif";
  const fontBody = "'Inter', system-ui, sans-serif";

  const heroBg = cfg.heroImagemUrl
    ? `linear-gradient(rgba(15,40,20,0.55), rgba(15,40,20,0.75)), url(${cfg.heroImagemUrl}) center/cover`
    : `linear-gradient(135deg, ${COR_VERDE}, #0d3315)`;

  const grupos = agruparHorarios(cfg.horarios);
  const excecoes = proximasExcecoes(cfg.excecoes, 3);

  const whatsappRede = cfg.redes.find(r => r.tipo === "whatsapp");
  const waLink = whatsappRede?.url || (cfg.telefone
    ? `https://api.whatsapp.com/send?phone=${cfg.telefone.replace(/\D/g, "")}`
    : null);

  return (
    <div style={{
      fontFamily: fontBody,
      color: "#1a1a1a",
      backgroundColor: COR_CREME,
      minHeight: "100vh",
    }}>
      {/* HEADER */}
      <header style={{
        position: "sticky", top: 0, zIndex: 50,
        backgroundColor: "rgba(247,243,233,0.95)",
        backdropFilter: "blur(8px)",
        borderBottom: `1px solid ${COR_DOURADO}30`,
      }}>
        <div style={{
          maxWidth: 1100, margin: "0 auto",
          padding: "12px 20px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
        }}>
          <div style={{
            fontFamily: fontHeading, fontSize: 22, color: COR_VERDE, letterSpacing: "0.02em",
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
        color: COR_CREME,
        minHeight: "70vh",
        display: "flex", alignItems: "center",
        padding: "80px 20px",
      }}>
        <div style={{ maxWidth: 900, margin: "0 auto", textAlign: "center" }}>
          {cfg.slogan && (
            <p style={{
              fontSize: 13, letterSpacing: "0.3em", textTransform: "uppercase",
              color: COR_DOURADO, marginBottom: 16, opacity: 0.95,
            }}>
              {cfg.slogan}
            </p>
          )}
          <h1 style={{
            fontFamily: fontHeading, fontSize: "clamp(40px, 7vw, 84px)",
            lineHeight: 1.05, margin: "0 0 24px 0", letterSpacing: "-0.01em",
          }}>
            Cozinha caipira,<br />feita com tempo.
          </h1>
          <p style={{
            fontSize: 17, opacity: 0.9, maxWidth: 560, margin: "0 auto 36px",
            lineHeight: 1.55,
          }}>
            Um laboratório gastronômico no coração da Vila Madalena.
          </p>
          {cfg.features.hasReservas && (
            <a href="#reservas" style={primaryButton(COR_DOURADO)}>Faça sua reserva</a>
          )}
        </div>
      </section>

      {/* HISTÓRIA */}
      {cfg.historia && (
        <Section id="historia" titulo="A nossa história" bg={COR_CREME}>
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
        <Section id="cardapio" titulo="Cardápio" bg="#ffffff">
          <div style={{
            display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap",
            maxWidth: 600, margin: "0 auto",
          }}>
            {cfg.cardapioPdfPtUrl && (
              <a
                href={cfg.cardapioPdfPtUrl} target="_blank" rel="noreferrer"
                style={menuButton(COR_VERDE, COR_CREME)}
              >
                🇧🇷 Cardápio (Português)
              </a>
            )}
            {cfg.cardapioPdfEnUrl && (
              <a
                href={cfg.cardapioPdfEnUrl} target="_blank" rel="noreferrer"
                style={menuButton(COR_VERDE, COR_CREME)}
              >
                🇺🇸 Menu (English)
              </a>
            )}
          </div>
        </Section>
      )}

      {/* HORÁRIO */}
      <Section id="horario" titulo="Horário de funcionamento" bg={COR_CREME}>
        <div style={{
          maxWidth: 500, margin: "0 auto",
          background: "#ffffff",
          borderRadius: 8, padding: 24,
          border: `1px solid ${COR_DOURADO}30`,
        }}>
          {grupos.map((g, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", padding: "10px 0",
              borderBottom: i < grupos.length - 1 ? `1px dashed ${COR_DOURADO}30` : "none",
              fontSize: 15,
            }}>
              <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{g.diasLabel}</span>
              <span style={{ color: g.fechado ? "#999" : "#1a1a1a" }}>
                {g.fechado ? "fechado" : g.turnosLabel}
              </span>
            </div>
          ))}
          {excecoes.length > 0 && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${COR_DOURADO}30` }}>
              <div style={{
                fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase",
                color: COR_DOURADO, marginBottom: 8, fontWeight: 600,
              }}>
                Próximos avisos
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
        <Section id="laje" titulo="Eventos na Laje" bg="#ffffff">
          <div style={{ maxWidth: 700, margin: "0 auto", textAlign: "center" }}>
            <p style={{ fontSize: 17, lineHeight: 1.7, marginBottom: 28 }}>
              Nosso rooftop recebe eventos privados para até 45 pessoas.
              Aniversários, encontros corporativos, jantares fechados — montamos
              cada celebração com você.
            </p>
            <Link to={`/eventos/${cfg.restaurantId}`} style={primaryButton(COR_VERDE)}>
              Solicitar proposta
            </Link>
          </div>
        </Section>
      )}

      {/* EVENTOS (genérico, se não tem Laje específica) */}
      {cfg.features.hasEventos && !cfg.features.hasLaje && (
        <Section id="eventos" titulo="Eventos privados" bg="#ffffff">
          <div style={{ maxWidth: 700, margin: "0 auto", textAlign: "center" }}>
            <p style={{ fontSize: 17, lineHeight: 1.7, marginBottom: 28 }}>
              Reservamos o espaço para sua celebração. Conta pra gente o que tem em
              mente — voltamos com uma proposta sob medida.
            </p>
            <Link to={`/eventos/${cfg.restaurantId}`} style={primaryButton(COR_VERDE)}>
              Solicitar proposta
            </Link>
          </div>
        </Section>
      )}

      {/* RESERVAS */}
      {cfg.features.hasReservas && (
        <Section id="reservas" titulo="Reservas" bg={COR_CREME}>
          <div style={{ maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
            <p style={{ fontSize: 17, lineHeight: 1.7, marginBottom: 24 }}>
              Recebemos com e sem reserva. Pra grupos a partir de 6 pessoas, recomendamos reservar.
            </p>
            {waLink && (
              <a href={waLink} target="_blank" rel="noreferrer" style={primaryButton(COR_DOURADO)}>
                💬 Reservar pelo WhatsApp
              </a>
            )}
          </div>
        </Section>
      )}

      {/* DELIVERY */}
      {cfg.features.hasDelivery && cfg.delivery && cfg.delivery.length > 0 && (
        <Section id="delivery" titulo="Peça pra casa" bg="#ffffff">
          <div style={{
            display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap",
            maxWidth: 700, margin: "0 auto",
          }}>
            {cfg.delivery.map((d, i) => (
              <a key={i} href={d.url} target="_blank" rel="noreferrer"
                 style={menuButton(COR_VERDE, COR_CREME)}>
                {d.label || labelDelivery(d.plataforma)}
              </a>
            ))}
          </div>
        </Section>
      )}

      {/* TRABALHE CONOSCO */}
      {cfg.features.hasTrabalheConosco && (
        <Section id="trabalhe" titulo="Venha trabalhar com a gente" bg={COR_CREME}>
          <div style={{ maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
            <p style={{ fontSize: 17, lineHeight: 1.7, marginBottom: 24 }}>
              Sempre buscando gente boa pra somar no time.
            </p>
            <Link to={`/trabalhe/${cfg.restaurantId}`} style={primaryButton(COR_VERDE)}>
              Enviar candidatura
            </Link>
          </div>
        </Section>
      )}

      {/* CONTATO */}
      <Section id="contato" titulo="Como chegar" bg="#ffffff">
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
             style={{ color: COR_VERDE, textDecoration: "underline", fontSize: 15 }}>
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
        backgroundColor: COR_VERDE, color: COR_CREME,
        padding: "40px 20px 24px",
        textAlign: "center",
      }}>
        <div style={{
          fontFamily: fontHeading, fontSize: 24, marginBottom: 16, color: COR_DOURADO,
        }}>
          lobozó
        </div>
        {cfg.redes.length > 0 && (
          <div style={{ display: "flex", gap: 18, justifyContent: "center", marginBottom: 20 }}>
            {cfg.redes.filter(r => r.url).map((r, i) => (
              <a key={i} href={r.url} target="_blank" rel="noreferrer"
                 style={{ color: COR_CREME, textDecoration: "none", fontSize: 14 }}>
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
}

// ─── Sub-componentes ────────────────────────────────────────────────────────

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} style={{
      color: "#1a1a1a", textDecoration: "none",
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
          fontFamily: "'DM Serif Display', serif",
          fontSize: "clamp(32px, 5vw, 48px)",
          textAlign: "center", margin: "0 0 48px 0", color: COR_VERDE,
          letterSpacing: "-0.01em",
        }}>
          {titulo}
        </h2>
        {children}
      </div>
    </section>
  );
}

// ─── Styles inline (reusáveis) ──────────────────────────────────────────────

function primaryButton(cor: string): React.CSSProperties {
  return {
    display: "inline-block",
    padding: "14px 32px",
    backgroundColor: cor,
    color: cor === COR_DOURADO ? "#1a1a1a" : COR_CREME,
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
