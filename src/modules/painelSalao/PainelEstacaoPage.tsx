// PainelEstacaoPage — a tela de parede (ESTAÇÃO), rota pública /painel-estacao.
// NÃO tem login de pessoa: a estação carrega só um "código de estação" (token),
// que vem da URL (?t=...) ou do localStorage (o app Electron grava uma vez), e
// busca tudo do /api/painel-feed (read-only, escopado a 1 restaurante). Poll a
// cada 30s. Mesma tela do painel autenticado (<PainelColunas>), dados via feed.
import { useEffect, useState } from "react";
import { PainelColunas, type PainelData } from "./PainelColunas";

const LS_KEY = "painel_estacao_token";

export function PainelEstacaoPage() {
  const [token, setToken] = useState<string>(() => {
    try {
      const u = new URLSearchParams(window.location.search);
      const fromUrl = (u.get("t") || u.get("token") || "").trim();
      if (fromUrl) { try { localStorage.setItem(LS_KEY, fromUrl); } catch { /* */ } return fromUrl; }
      return localStorage.getItem(LS_KEY) || "";
    } catch { return ""; }
  });
  const [input, setInput] = useState("");
  const [feed, setFeed] = useState<any>(null);
  const [erro, setErro] = useState("");
  const [ts, setTs] = useState<Date | undefined>(undefined);

  useEffect(() => {
    if (!token) return;
    let stop = false;
    async function tick() {
      try {
        const r = await fetch(`/api/painel-feed?t=${encodeURIComponent(token)}`);
        const j = await r.json();
        if (stop) return;
        if (j?.ok) { setFeed(j); setErro(""); setTs(new Date()); }
        else setErro(j?.erro === "token_invalido" ? "Código de estação inválido ou revogado." : j?.erro === "nao_configurado" ? "Servidor sem credenciais (WEBHOOK_FB_*)." : "Falha ao carregar o painel.");
      } catch { if (!stop) setErro("Sem conexão com o servidor."); }
    }
    void tick();
    const iv = setInterval(() => void tick(), 30000);
    return () => { stop = true; clearInterval(iv); };
  }, [token]);

  // Sem token → pede o código de estação (setup único na parede).
  if (!token) {
    return (
      <div className="fixed inset-0 z-50 bg-[#121317] text-[#eef1f5] grid place-items-center p-6" style={{ fontFamily: "system-ui, sans-serif" }}>
        <div className="w-full max-w-sm text-center">
          <div className="w-14 h-14 rounded-2xl grid place-items-center mx-auto mb-3 font-extrabold text-2xl text-[#1a1205]" style={{ background: "linear-gradient(135deg,#e3a63c,#b9792a)" }}>P</div>
          <div className="font-extrabold text-xl mb-1">Painel do Salão</div>
          <p className="text-sm text-[#9aa3b2] mb-4">Cole o <b>código de estação</b> gerado no admin (Download de Apps → Estações).</p>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="código de estação" className="w-full rounded-xl bg-[#1b1e25] border border-[#2a2f39] px-4 py-3 text-center tracking-wider outline-none" />
          <button onClick={() => { const t = input.trim(); if (t.length >= 12) { try { localStorage.setItem(LS_KEY, t); } catch { /* */ } setToken(t); } }} className="mt-3 w-full rounded-xl py-3 font-extrabold text-[#1a1205]" style={{ background: "#e3a63c" }}>Ativar painel</button>
        </div>
      </div>
    );
  }

  // Com token mas ainda sem dados → carregando / erro.
  if (!feed) {
    return (
      <div className="fixed inset-0 z-50 bg-[#121317] text-[#eef1f5] grid place-items-center p-6 text-center" style={{ fontFamily: "system-ui, sans-serif" }}>
        <div>
          <div className="text-sm text-[#9aa3b2]">{erro || "Carregando painel…"}</div>
          {erro && <button onClick={() => { try { localStorage.removeItem(LS_KEY); } catch { /* */ } setToken(""); setFeed(null); }} className="mt-4 text-[12px] underline text-[#6f7889]">trocar código de estação</button>}
        </div>
      </div>
    );
  }

  const data: PainelData = { nome: feed.nome, reservas: feed.reservas || [], freelasAbertos: feed.freelasAbertos || [], freelasProgramados: feed.freelasProgramados || [], checklists: feed.checklists || [], wa: feed.wa || { list: [], total: 0 } };
  return <PainelColunas rid={feed.rid} data={data} atualizadoEm={ts} />;
}
