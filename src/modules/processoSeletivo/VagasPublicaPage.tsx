// Páginas PÚBLICAS do Processo Seletivo (sem auth), no TEMA de cores do site:
//  • VagasPublicaPage  — lista as vagas abertas (/vagas/:rid ou domínio próprio /vagas)
//  • VagaCandidaturaPage — formulário de candidatura de uma vaga (/vaga/:rid/:vagaId)
// Candidatura espontânea (banco de talentos) continua em /trabalhe/:rid.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs, query, where, setDoc } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { Vaga, PerguntaVaga, CandidaturaTrabalhe, SiteConfig } from "../../core/types";

type Tema = { fundo: string; texto: string; primaria: string; secundaria: string; card: string };
function temaDe(cfg: SiteConfig | null): Tema {
  const t = cfg?.tema;
  const primaria = t?.corPrimaria || "#1a5c2a";
  return {
    primaria,
    secundaria: t?.corSecundaria || "#d4af37",
    fundo: t?.corFundo || "#f7f3e9",
    texto: t?.corTexto || "#1a1a1a",
    card: "#ffffff",
  };
}

async function ridDoSlug(slug: string): Promise<string | null> {
  try {
    const snap = await getDocs(query(collection(db, "sitesConfig"), where("slug", "==", slug)));
    if (!snap.empty) return (snap.docs[0]!.data() as { restaurantId?: string }).restaurantId || snap.docs[0]!.id;
  } catch { /* nada */ }
  return null;
}
async function carregarSite(rid: string): Promise<SiteConfig | null> {
  try { const s = await getDoc(doc(db, "sitesConfig", rid)); if (s.exists()) return { id: s.id, ...s.data() } as SiteConfig; } catch { /* nada */ }
  return null;
}

export function VagasPublicaPage({ slugFromHost }: { slugFromHost?: string }) {
  const { rid: ridParam } = useParams<{ rid: string }>();
  const navigate = useNavigate();
  const [rid, setRid] = useState<string | null>(ridParam || null);
  const [cfg, setCfg] = useState<SiteConfig | null>(null);
  const [vagas, setVagas] = useState<Vaga[]>([]);
  const [loading, setLoading] = useState(true);
  const tema = useMemo(() => temaDe(cfg), [cfg]);

  useEffect(() => {
    (async () => {
      const r = ridParam || (slugFromHost ? await ridDoSlug(slugFromHost) : null);
      if (!r) { setLoading(false); return; }
      setRid(r);
      setCfg(await carregarSite(r));
      try {
        const snap = await getDocs(query(collection(db, "vagas"), where("restaurantId", "==", r), where("status", "==", "aberta")));
        setVagas(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Vaga).filter((v) => v.publica !== false));
      } catch { setVagas([]); }
      setLoading(false);
    })();
  }, [ridParam, slugFromHost]);

  const wrap: React.CSSProperties = { minHeight: "100vh", background: tema.fundo, color: tema.texto, padding: "40px 16px", fontFamily: "system-ui, sans-serif" };

  if (loading) return <div style={wrap}><div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center", opacity: 0.6 }}>Carregando…</div></div>;
  if (!rid) return <div style={wrap}><div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center", opacity: 0.6 }}>Página não encontrada.</div></div>;

  return (
    <div style={wrap}>
      <div style={{ maxWidth: 660, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          {cfg?.logoUrl && <img src={cfg.logoUrl} alt="" style={{ height: 80, maxWidth: 220, objectFit: "contain", margin: "0 auto 14px", display: "block" }} />}
          <h1 style={{ fontSize: 30, fontWeight: 800, margin: 0, letterSpacing: -0.5 }}>Trabalhe com a gente</h1>
          <p style={{ fontSize: 14, opacity: 0.7, marginTop: 8 }}>Confira as vagas abertas e candidate-se.<br />Não achou a sua? Deixe seu currículo no banco de talentos.</p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {vagas.length === 0 && (
            <div style={{ borderRadius: 18, border: "1px dashed rgba(0,0,0,.18)", padding: 40, textAlign: "center", fontSize: 14, opacity: 0.7, background: "rgba(255,255,255,.55)" }}>Nenhuma vaga aberta no momento.</div>
          )}
          {vagas.map((v) => (
            <div key={v.id} style={{ borderRadius: 18, background: tema.card, boxShadow: "0 2px 10px rgba(0,0,0,.07)", padding: 22, borderLeft: `4px solid ${tema.primaria}` }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <h2 style={{ fontSize: 21, fontWeight: 700, margin: 0, color: tema.texto }}>{v.titulo}</h2>
                {v.area && <span style={{ fontSize: 12, fontWeight: 600, color: tema.secundaria }}>{v.area}</span>}
              </div>
              {v.descricao && <p style={{ fontSize: 14, opacity: 0.8, marginTop: 8, whiteSpace: "pre-wrap", color: tema.texto, lineHeight: 1.5 }}>{v.descricao}</p>}
              {v.requisitos && <p style={{ fontSize: 12.5, opacity: 0.65, marginTop: 8, whiteSpace: "pre-wrap", color: tema.texto }}><b>Requisitos:</b> {v.requisitos}</p>}
              <button type="button" onClick={() => navigate(`/vaga/${rid}/${v.id}`)} style={{ marginTop: 16, padding: "11px 22px", borderRadius: 12, background: tema.primaria, color: "#fff", fontSize: 14, fontWeight: 700, border: "none", cursor: "pointer" }}>Candidatar-se →</button>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 22, borderRadius: 18, background: "rgba(255,255,255,.55)", padding: 20, textAlign: "center" }}>
          <p style={{ fontSize: 14, opacity: 0.75, margin: 0, color: tema.texto }}>Não encontrou uma vaga pra você?</p>
          <button type="button" onClick={() => navigate(`/trabalhe/${rid}`)} style={{ marginTop: 10, padding: "11px 22px", borderRadius: 12, background: "transparent", color: tema.primaria, border: `1.5px solid ${tema.primaria}`, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Deixar meu currículo (banco de talentos)</button>
        </div>

        <p style={{ textAlign: "center", fontSize: 11, opacity: 0.4, marginTop: 28 }}>powered by planejamento.app</p>
      </div>
    </div>
  );
}

export function VagaCandidaturaPage() {
  const { rid, vagaId } = useParams<{ rid: string; vagaId: string }>();
  const navigate = useNavigate();
  const [vaga, setVaga] = useState<Vaga | null>(null);
  const [cfg, setCfg] = useState<SiteConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [nome, setNome] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [curriculo, setCurriculo] = useState<File | null>(null);
  const [respostas, setRespostas] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);
  const tema = useMemo(() => temaDe(cfg), [cfg]);

  useEffect(() => {
    (async () => {
      if (!vagaId || !rid) { setLoading(false); return; }
      try { const s = await getDoc(doc(db, "vagas", vagaId)); if (s.exists()) setVaga({ id: s.id, ...s.data() } as Vaga); } catch { /* nada */ }
      setCfg(await carregarSite(rid));
      setLoading(false);
    })();
  }, [vagaId, rid]);

  const wrap: React.CSSProperties = { minHeight: "100vh", background: tema.fundo, color: tema.texto, padding: "40px 16px", fontFamily: "system-ui, sans-serif" };
  const inp: React.CSSProperties = { width: "100%", padding: "11px 12px", fontSize: 16, borderRadius: 10, border: "1px solid rgba(0,0,0,.2)", background: "#fff", color: "#1a1a1a", boxSizing: "border-box" };
  const lbl: React.CSSProperties = { fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4, color: tema.texto };

  async function enviar() {
    setErro("");
    if (!nome.trim()) return setErro("Preencha seu nome.");
    if (whatsapp.replace(/\D/g, "").length < 10) return setErro("Digite um WhatsApp válido (DDD + número).");
    if (!email.trim() || !email.includes("@")) return setErro("Digite um e-mail válido.");
    for (const p of vaga?.perguntas || []) {
      if (p.obrigatoria && !(respostas[p.id] || "").trim()) return setErro(`Responda: ${p.label}`);
    }
    if (curriculo && curriculo.size > 10 * 1024 * 1024) return setErro("Currículo muito grande (máx 10 MB).");
    setEnviando(true);
    try {
      let d = whatsapp.replace(/\D/g, ""); if (d.length <= 11) d = "55" + d;
      const id = `cand_${rid}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      let curriculoUrl: string | undefined;
      if (curriculo) {
        const ext = curriculo.name.split(".").pop()?.toLowerCase() || "pdf";
        const r = storageRef(storage, `candidaturas/${rid}/${id}.${ext}`);
        const snap = await uploadBytes(r, curriculo, { contentType: curriculo.type });
        curriculoUrl = await getDownloadURL(snap.ref);
      }
      const respLabels: Record<string, string> = {};
      for (const p of vaga?.perguntas || []) { const v = (respostas[p.id] || "").trim(); if (v) respLabels[p.label] = v; }
      const cand: CandidaturaTrabalhe = {
        id, restaurantId: rid || "", status: "nova", etapa: "nova",
        vagaId: vagaId || null, vagaTitulo: vaga?.titulo || null,
        respostas: Object.keys(respLabels).length ? respLabels : undefined,
        observacoes: observacoes.trim() || undefined, curriculoUrl,
        responsavelId: vaga?.responsavelId || undefined, responsavelNome: vaga?.responsavelNome || undefined,
        nome: nome.trim(), whatsapp: d, email: email.trim(), areaInteresse: vaga?.area || vaga?.titulo || "",
        origem: "publico", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      await setDoc(doc(db, "candidaturasTrabalhe", id), sanitizeForFirestore(cand));
      setOk(true);
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao enviar."); }
    setEnviando(false);
  }

  if (loading) return <div style={wrap}><div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center", opacity: 0.6 }}>Carregando…</div></div>;
  if (!vaga) return <div style={wrap}><div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center", opacity: 0.6 }}>Vaga não encontrada ou encerrada.</div></div>;
  if (ok) return (
    <div style={wrap}><div style={{ maxWidth: 560, margin: "0 auto", borderRadius: 16, background: tema.card, padding: 32, textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,.08)" }}>
      <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: tema.texto }}>Candidatura enviada!</h1>
      <p style={{ fontSize: 14, opacity: 0.7, marginTop: 6, color: tema.texto }}>Obrigado, {nome.split(" ")[0]}. Vamos analisar e entrar em contato pelo WhatsApp.</p>
    </div></div>
  );

  return (
    <div style={wrap}>
      <div style={{ maxWidth: 640, margin: "0 auto", borderRadius: 16, background: tema.card, padding: 22, boxShadow: "0 1px 4px rgba(0,0,0,.08)" }}>
        <button type="button" onClick={() => navigate(`/vagas/${rid}`)} style={{ fontSize: 12, opacity: 0.6, background: "none", border: "none", cursor: "pointer", marginBottom: 8, color: tema.texto }}>← Todas as vagas</button>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: tema.texto }}>{vaga.titulo}</h1>
        {vaga.area && <p style={{ fontSize: 12, opacity: 0.5, margin: "2px 0 0" }}>{vaga.area}</p>}
        {vaga.descricao && <p style={{ fontSize: 14, opacity: 0.8, marginTop: 10, whiteSpace: "pre-wrap", color: tema.texto }}>{vaga.descricao}</p>}

        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16 }}>
          <div><label style={lbl}>Seu nome *</label><input value={nome} onChange={(e) => setNome(e.target.value)} style={inp} /></div>
          <div><label style={lbl}>WhatsApp *</label><input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} style={inp} placeholder="(11) 99999-9999" /></div>
          <div><label style={lbl}>E-mail *</label><input value={email} onChange={(e) => setEmail(e.target.value)} style={inp} type="email" /></div>

          {(vaga.perguntas || []).map((p: PerguntaVaga) => (
            <div key={p.id}>
              <label style={lbl}>{p.label}{p.obrigatoria ? " *" : ""}</label>
              {p.tipo === "textolongo" ? (
                <textarea value={respostas[p.id] || ""} onChange={(e) => setRespostas((r) => ({ ...r, [p.id]: e.target.value }))} rows={3} style={inp} />
              ) : p.tipo === "opcoes" ? (
                <select value={respostas[p.id] || ""} onChange={(e) => setRespostas((r) => ({ ...r, [p.id]: e.target.value }))} style={inp}>
                  <option value="">— escolha —</option>{(p.opcoes || []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : p.tipo === "simnao" ? (
                <select value={respostas[p.id] || ""} onChange={(e) => setRespostas((r) => ({ ...r, [p.id]: e.target.value }))} style={inp}>
                  <option value="">— escolha —</option><option value="Sim">Sim</option><option value="Não">Não</option>
                </select>
              ) : (
                <input type={p.tipo === "numero" ? "number" : "text"} value={respostas[p.id] || ""} onChange={(e) => setRespostas((r) => ({ ...r, [p.id]: e.target.value }))} style={inp} />
              )}
            </div>
          ))}

          <div>
            <label style={lbl}>Currículo (PDF, opcional)</label>
            <input type="file" accept="application/pdf,.pdf,.doc,.docx" onChange={(e) => setCurriculo(e.target.files?.[0] || null)} style={{ fontSize: 13 }} />
            {curriculo && <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>📎 {curriculo.name}</div>}
          </div>

          <div><label style={lbl}>Observações (opcional)</label>
            <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={3} style={inp} placeholder="Algo que você queira incluir…" /></div>

          {erro && <div style={{ fontSize: 14, color: "#dc2626" }}>{erro}</div>}
          <button type="button" onClick={() => void enviar()} disabled={enviando} style={{ width: "100%", padding: "13px", borderRadius: 12, background: tema.primaria, color: "#fff", fontWeight: 700, fontSize: 15, border: "none", cursor: "pointer", opacity: enviando ? 0.6 : 1 }}>{enviando ? "Enviando…" : "Enviar candidatura"}</button>
        </div>
      </div>
    </div>
  );
}
