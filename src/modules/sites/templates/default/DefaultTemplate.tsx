// Template default — fallback genérico pra restaurantes sem template
// dedicado. Layout limpo, neutro, sem personalidade forte de marca.
// Suficiente pra ter um site no ar; troca pra template dedicado quando
// quiser visual de marca.

import { Link } from "react-router-dom";
import type { SiteConfig } from "../../../../core/types";
import { agruparHorarios, formatarDataCurta, proximasExcecoes } from "../../shared/horarioUtils";
import { enderecoLinhaUm, enderecoLinhaDois, googleMapsLink } from "../../shared/enderecoUtils";

type Props = { siteConfig: SiteConfig };

export function DefaultTemplate({ siteConfig: cfg }: Props) {
  const cor = cfg.tema.corPrimaria || "#1a5c2a";
  const grupos = agruparHorarios(cfg.horarios);
  const excecoes = proximasExcecoes(cfg.excecoes, 3);
  const waLink = cfg.telefone
    ? `https://api.whatsapp.com/send?phone=${cfg.telefone.replace(/\D/g, "")}`
    : cfg.redes.find(r => r.tipo === "whatsapp")?.url;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", color: "#1a1a1a", minHeight: "100vh" }}>
      <header style={{ padding: "60px 20px 40px", textAlign: "center", backgroundColor: cor, color: "#fff" }}>
        <h1 style={{ fontSize: "clamp(36px, 6vw, 56px)", margin: 0 }}>
          {cfg.logoUrl ? <img src={cfg.logoUrl} alt="" style={{ height: 60 }} /> : cfg.slug}
        </h1>
        {cfg.slogan && <p style={{ marginTop: 12, opacity: 0.9 }}>{cfg.slogan}</p>}
      </header>

      <main style={{ maxWidth: 800, margin: "0 auto", padding: "40px 20px" }}>
        {cfg.historia && (
          <section style={{ marginBottom: 48 }}>
            <h2 style={{ color: cor }}>Sobre</h2>
            <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{cfg.historia}</p>
          </section>
        )}

        {(cfg.cardapioPdfPtUrl || cfg.cardapioPdfEnUrl) && (
          <section style={{ marginBottom: 48 }}>
            <h2 style={{ color: cor }}>Cardápio</h2>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {cfg.cardapioPdfPtUrl && <a href={cfg.cardapioPdfPtUrl} target="_blank" rel="noreferrer" style={btn(cor)}>🇧🇷 Português</a>}
              {cfg.cardapioPdfEnUrl && <a href={cfg.cardapioPdfEnUrl} target="_blank" rel="noreferrer" style={btn(cor)}>🇺🇸 English</a>}
            </div>
          </section>
        )}

        <section style={{ marginBottom: 48 }}>
          <h2 style={{ color: cor }}>Horário</h2>
          {grupos.map((g, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px dashed #ddd" }}>
              <span style={{ textTransform: "capitalize" }}>{g.diasLabel}</span>
              <span style={{ color: g.fechado ? "#999" : "#1a1a1a" }}>{g.fechado ? "fechado" : g.turnosLabel}</span>
            </div>
          ))}
          {excecoes.length > 0 && (
            <div style={{ marginTop: 16, fontSize: 13, color: "#666" }}>
              <strong>Próximos avisos:</strong>
              {excecoes.map(e => (
                <div key={e.id}>{formatarDataCurta(e.data)} — {e.fechado ? "fechado" : "horário especial"}{e.motivo && ` (${e.motivo})`}</div>
              ))}
            </div>
          )}
        </section>

        <section style={{ marginBottom: 48 }}>
          <h2 style={{ color: cor }}>Como chegar</h2>
          <p>{enderecoLinhaUm(cfg.endereco)}</p>
          <p style={{ color: "#666" }}>{enderecoLinhaDois(cfg.endereco)}</p>
          <a href={googleMapsLink(cfg.endereco)} target="_blank" rel="noreferrer" style={{ color: cor }}>ver no Google Maps →</a>
        </section>

        {cfg.features.hasEventos && (
          <section style={{ marginBottom: 48 }}>
            <h2 style={{ color: cor }}>Eventos privados</h2>
            <Link to={`/eventos/${cfg.restaurantId}`} style={btn(cor)}>Solicitar proposta</Link>
          </section>
        )}

        {cfg.features.hasTrabalheConosco && (
          <section style={{ marginBottom: 48 }}>
            <h2 style={{ color: cor }}>Trabalhe conosco</h2>
            <Link to={`/trabalhe/${cfg.restaurantId}`} style={btn(cor)}>Enviar candidatura</Link>
          </section>
        )}
      </main>

      <footer style={{ padding: 30, textAlign: "center", backgroundColor: "#f5f5f5", fontSize: 13, color: "#666" }}>
        {cfg.redes.filter(r => r.url).map((r, i) => (
          <a key={i} href={r.url} target="_blank" rel="noreferrer" style={{ margin: "0 10px", color: cor }}>
            {r.tipo}
          </a>
        ))}
        {waLink && (
          <div style={{ marginTop: 10 }}>
            <a href={waLink} target="_blank" rel="noreferrer" style={{ color: cor }}>💬 WhatsApp</a>
          </div>
        )}
      </footer>
    </div>
  );
}

function btn(cor: string): React.CSSProperties {
  return {
    display: "inline-block",
    padding: "12px 24px",
    backgroundColor: cor, color: "#fff",
    textDecoration: "none", borderRadius: 4, fontWeight: 600,
  };
}
