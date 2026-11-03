// PainelEstacaoPage — a tela de parede (ESTAÇÃO), rota pública /painel-estacao.
// NÃO tem login de pessoa: carrega só um "código de estação" (token) da URL
// (?t=...) ou do localStorage, e busca tudo do /api/painel-feed (read-only,
// escopado a 1 restaurante). Poll a cada 30s. Suporta navegação de dia e seletor
// de número do WhatsApp (passados ao feed). Mesma tela do painel autenticado.
import { useEffect, useState } from "react";
import { PainelColunas, type PainelData } from "./PainelColunas";

const LS_KEY = "painel_estacao_token";
function todayYmd(): string { const d = new Date(); const p = (n: number) => (n < 10 ? `0${n}` : `${n}`); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

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
  const [dataSel, setDataSel] = useState<string>(() => todayYmd());
  const [waSel, setWaSel] = useState<string | null>(null); // null = default (servidor escolhe); "" = todos; <id>

  useEffect(() => {
    if (!token) return;
    let stop = false;
    async function tick() {
      try {
        let u = `/api/painel-feed?t=${encodeURIComponent(token)}`;
        if (dataSel && dataSel !== todayYmd()) u += `&data=${dataSel}`;
        if (waSel != null) u += `&numero=${encodeURIComponent(waSel === "" ? "__todos__" : waSel)}`;
        const r = await fetch(u);
        const j = await r.json();
        if (stop) return;
        if (j?.ok) { setFeed(j); setErro(""); setTs(new Date()); }
        else setErro(j?.erro === "token_invalido" ? "Código de estação inválido ou revogado." : j?.erro === "nao_configurado" ? "Servidor sem credenciais (WEBHOOK_FB_*)." : "Falha ao carregar o painel.");
      } catch { if (!stop) setErro("Sem conexão com o servidor."); }
    }
    void tick();
    const iv = setInterval(() => void tick(), 20000);
    return () => { stop = true; clearInterval(iv); };
  }, [token, dataSel, waSel]);

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

  const data: PainelData = { nome: feed.nome, reservas: feed.reservas || [], proximaReserva: feed.proximaReserva, freelasAbertos: feed.freelasAbertos || [], freelasProgramados: feed.freelasProgramados || [], checklists: feed.checklists || [], wa: feed.wa || { list: [], total: 0 } };
  async function painelAcao(payload: Record<string, unknown>) {
    try { const r = await fetch("/api/painel-acao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...payload }) }); return await r.json(); }
    catch { return { ok: false, erro: "rede" }; }
  }
  return (
    <PainelColunas
      rid={feed.rid}
      data={data}
      atualizadoEm={ts}
      tema={feed.tema === "claro" ? "claro" : "escuro"}
      dataSel={dataSel}
      onDataSel={setDataSel}
      waNumeros={feed.waNumeros || []}
      waNumeroSel={feed.waNumeroSel || ""}
      onWaNumero={(id) => setWaSel(id)}
      estacaoAcoes={feed.acoes}
      estacaoUsuarios={feed.usuarios || []}
      onWaThread={(numeroId, waId) => painelAcao({ acao: "wa-thread", numeroId, waId })}
      onWaResponder={(pessoaId, numeroId, waId, texto) => painelAcao({ acao: "wa-responder", pessoaId, numeroId, waId, texto })}
      onFreelaAbrir={(pessoaId, shiftId) => painelAcao({ acao: "freela-abrir", pessoaId, shiftId })}
      onFreelaNovo={(pessoaId, f) => painelAcao({ acao: "freela-novo", pessoaId, ...f })}
      onChecklistAbrir={(templateId) => painelAcao({ acao: "checklist-abrir", templateId })}
      onChecklistItem={(pessoaId, templateId, itemId, feito, observacao) => painelAcao({ acao: "checklist-item", pessoaId, templateId, itemId, feito, observacao })}
      onReservaCriar={(pessoaId, r) => painelAcao({ acao: "reserva-criar", pessoaId, ...r })}
    />
  );
}
