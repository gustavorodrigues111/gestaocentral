// Páginas PÚBLICAS do Processo Seletivo (sem auth), no TEMA de cores do site:
//  • VagasPublicaPage  — lista as vagas abertas (/vagas/:rid ou domínio próprio /vagas)
//  • VagaCandidaturaPage — formulário de candidatura de uma vaga (/vaga/:rid/:vagaId)
// Candidatura espontânea (banco de talentos) continua em /trabalhe/:rid.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs, query, where, setDoc } from "firebase/firestore";
import { ref as storageRef, uploadBytes } from "firebase/storage";
import { db, storage } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { Vaga, PerguntaVaga, CandidaturaTrabalhe, SiteConfig, HorarioDia, SundayCycle } from "../../core/types";

const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const brl = (n: number) => `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Horário-modelo da vaga (1ª vigência): TODOS os dias (sem carga = folga) + ciclo de domingo.
function horarioInfo(vaga: Vaga): { dias: { dia: string; texto: string; folga: boolean }[]; ciclo: SundayCycle | null } {
  const ws = vaga.horarioModelo?.[0];
  const days = ws && ws.type === "single" ? (ws.days as { [k: number]: HorarioDia } | undefined) : undefined;
  if (!days) return { dias: [], ciclo: null };
  const dias = [];
  for (const i of [1, 2, 3, 4, 5, 6, 0]) {   // começa na segunda, domingo por último
    const d = days[i];
    if (d?.active && d.in && d.out) dias.push({ dia: DIAS_SEMANA[i], texto: `${d.in}–${d.out}${d.break ? ` (int. ${d.break}min)` : ""}`, folga: false });
    else dias.push({ dia: DIAS_SEMANA[i], texto: "Folga", folga: true });
  }
  return { dias, ciclo: (ws?.sundayCycle as SundayCycle | undefined) || null };
}

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
        const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Vaga).filter((v) => v.publica !== false);
        setVagas(lista);
        const nome = lista.find((v) => v.restauranteNome)?.restauranteNome;
        document.title = nome ? `Vagas · ${nome}` : "Trabalhe conosco";
      } catch { setVagas([]); }
      setLoading(false);
    })();
  }, [ridParam, slugFromHost]);

  const wrap: React.CSSProperties = { minHeight: "100vh", background: tema.fundo, color: tema.texto, padding: "40px 16px", fontFamily: "system-ui, sans-serif" };

  if (loading) return <div style={wrap}><div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center", opacity: 0.6 }}>Carregando…</div></div>;
  if (!rid) return <div style={wrap}><div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center", opacity: 0.6 }}>Página não encontrada.</div></div>;

  const secTitulo: React.CSSProperties = { fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", opacity: 0.55, textAlign: "center", margin: "0 0 14px" };
  return (
    <div style={wrap}>
      <div style={{ maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
        {/* Hero centralizado */}
        {cfg?.logoUrl && <img src={cfg.logoUrl} alt="" style={{ height: 88, maxWidth: 240, objectFit: "contain", margin: "0 auto 18px", display: "block" }} />}
        <h1 style={{ fontSize: 32, fontWeight: 800, margin: 0, letterSpacing: -0.5 }}>Trabalhe com a gente</h1>
        <p style={{ fontSize: 15, opacity: 0.7, marginTop: 10, maxWidth: 440, marginLeft: "auto", marginRight: "auto", lineHeight: 1.5 }}>Confira as vagas abertas e candidate-se. Não achou a sua? Deixe seu currículo no banco de talentos.</p>

        {/* Vagas em aberto */}
        <div style={{ marginTop: 40 }}>
          <h2 style={secTitulo}>Vagas em aberto</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {vagas.length === 0 && (
              <div style={{ borderRadius: 18, border: "1px dashed rgba(0,0,0,.18)", padding: 40, fontSize: 14, opacity: 0.7, background: "rgba(255,255,255,.55)" }}>Nenhuma vaga aberta no momento.</div>
            )}
            {vagas.map((v) => (
              <div key={v.id} style={{ borderRadius: 18, background: tema.card, boxShadow: "0 2px 12px rgba(0,0,0,.07)", padding: "26px 22px" }}>
                <h3 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: tema.texto }}>{v.titulo}</h3>
                {v.area && <div style={{ fontSize: 12.5, fontWeight: 600, color: tema.secundaria, marginTop: 4 }}>{v.area}</div>}
                {v.resumo?.trim() && <p style={{ fontSize: 14, opacity: 0.8, marginTop: 12, whiteSpace: "pre-wrap", color: tema.texto, lineHeight: 1.55, maxWidth: 460, marginLeft: "auto", marginRight: "auto" }}>{v.resumo.trim()}</p>}
                <button type="button" onClick={() => navigate(`/vaga/${rid}/${v.id}`)} style={{ marginTop: 20, padding: "12px 28px", borderRadius: 12, background: tema.primaria, color: "#fff", fontSize: 15, fontWeight: 700, border: "none", cursor: "pointer" }}>Ver vaga e candidatar-se →</button>
              </div>
            ))}
          </div>
        </div>

        {/* Banco de talentos */}
        <div style={{ marginTop: 44 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 6px", color: tema.texto }}>Não encontrou uma vaga pra você?</h2>
          <p style={{ fontSize: 14, opacity: 0.65, margin: "0 0 16px" }}>Deixe seu currículo no nosso banco de talentos — a gente chama quando surgir algo.</p>
          <button type="button" onClick={() => navigate(`/trabalhe/${rid}`)} style={{ padding: "12px 28px", borderRadius: 12, background: "transparent", color: tema.primaria, border: `1.5px solid ${tema.primaria}`, fontSize: 15, fontWeight: 700, cursor: "pointer" }}>Deixar meu currículo</button>
        </div>

        <p style={{ fontSize: 11, opacity: 0.4, marginTop: 40 }}>powered by planejamento.app</p>
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
      try { const s = await getDoc(doc(db, "vagas", vagaId)); if (s.exists()) { const vg = { id: s.id, ...s.data() } as Vaga; setVaga(vg); document.title = `${vg.titulo}${vg.restauranteNome ? ` · ${vg.restauranteNome}` : ""}`; } } catch { /* nada */ }
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
    if (vaga?.curriculoObrigatorio && !curriculo) return setErro("Anexe seu currículo (obrigatório pra esta vaga).");
    for (const p of vaga?.perguntas || []) {
      if (p.obrigatoria && !(respostas[p.id] || "").trim()) return setErro(`Responda: ${p.label}`);
    }
    if (curriculo && curriculo.size > 10 * 1024 * 1024) return setErro("Currículo muito grande (máx 10 MB).");
    // Content-type DETERMINÍSTICO pela extensão: o iOS/Safari às vezes manda
    // octet-stream ou vazio pra .docx, o que fazia a regra do Storage barrar o
    // upload (storage/unauthorized). Aqui garantimos um tipo que a regra aceita.
    const CT_POR_EXT: Record<string, string> = {
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      odt: "application/vnd.oasis.opendocument.text",
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic",
    };
    const extCv = curriculo ? (curriculo.name.split(".").pop()?.toLowerCase() || "") : "";
    if (curriculo && !CT_POR_EXT[extCv]) return setErro("Formato não aceito. Envie o currículo em PDF, Word (.doc/.docx) ou imagem (JPG/PNG).");
    setEnviando(true);
    try {
      let d = whatsapp.replace(/\D/g, ""); if (d.length <= 11) d = "55" + d;
      const id = `cand_${rid}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      // Candidato é anônimo (sem login). NÃO chamamos getDownloadURL aqui — o
      // READ do Storage exige auth. Guardamos só o path; o DP resolve a URL.
      let curriculoPath: string | undefined;
      if (curriculo) {
        curriculoPath = `candidaturas/${rid}/${id}.${extCv}`;
        await uploadBytes(storageRef(storage, curriculoPath), curriculo, { contentType: CT_POR_EXT[extCv] });
      }
      const respLabels: Record<string, string> = {};
      for (const p of vaga?.perguntas || []) { const v = (respostas[p.id] || "").trim(); if (v) respLabels[p.label] = v; }
      const cand: CandidaturaTrabalhe = {
        id, restaurantId: rid || "", status: "nova", etapa: "nova",
        vagaId: vagaId || null, vagaTitulo: vaga?.titulo || null,
        respostas: Object.keys(respLabels).length ? respLabels : undefined,
        observacoes: observacoes.trim() || undefined, curriculoPath,
        responsavelIds: vaga?.responsavelIds?.length ? vaga.responsavelIds : (vaga?.responsavelId ? [vaga.responsavelId] : undefined),
        responsavelId: (vaga?.responsavelIds?.[0]) || vaga?.responsavelId || undefined, responsavelNome: (vaga?.responsavelNomes?.[0]) || vaga?.responsavelNome || undefined,
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

        {/* Quadro de detalhes da vaga */}
        {(() => { const hor = horarioInfo(vaga); return (vaga.resumo || vaga.descricao || vaga.requisitos || hor.dias.length > 0 || vaga.salarioBase != null || vaga.gorjetaMedia != null) && (
          <div style={{ marginTop: 14, borderRadius: 12, background: tema.fundo, border: `1px solid rgba(0,0,0,.08)`, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", opacity: 0.5, marginBottom: 8 }}>Sobre a vaga</div>
            {vaga.resumo && <p style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px", whiteSpace: "pre-wrap", color: tema.texto, lineHeight: 1.5 }}>{vaga.resumo}</p>}
            {vaga.descricao && <p style={{ fontSize: 14, opacity: 0.85, margin: "0 0 8px", whiteSpace: "pre-wrap", color: tema.texto, lineHeight: 1.5 }}>{vaga.descricao}</p>}
            {vaga.requisitos && <p style={{ fontSize: 13, opacity: 0.7, margin: "0 0 8px", whiteSpace: "pre-wrap", color: tema.texto }}><b>Requisitos:</b> {vaga.requisitos}</p>}
            {(vaga.salarioBase != null || vaga.gorjetaMedia != null) && (
              <div style={{ marginTop: 6, marginBottom: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: tema.texto, marginBottom: 4 }}>💰 Remuneração</div>
                <div style={{ fontSize: 14, color: tema.texto }}>
                  {vaga.salarioBase != null && <div>Salário base: <b>{brl(vaga.salarioBase)}</b></div>}
                  {vaga.gorjetaMedia != null && <div>Gorjeta média: <b>{brl(vaga.gorjetaMedia)}</b></div>}
                  {vaga.salarioBase != null && vaga.gorjetaMedia != null && <div style={{ opacity: 0.7, marginTop: 2 }}>Total médio estimado: <b>{brl((vaga.salarioBase || 0) + (vaga.gorjetaMedia || 0))}</b></div>}
                </div>
                <div style={{ fontSize: 11.5, opacity: 0.6, color: tema.texto, marginTop: 6, lineHeight: 1.4 }}>
                  Valores <b>brutos</b>, sujeitos às deduções legais (INSS, IRRF e demais descontos aplicáveis){vaga.gorjetaMedia != null ? "; a gorjeta média é uma estimativa e pode variar mês a mês" : ""}.
                </div>
              </div>
            )}
            {hor.dias.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: tema.texto, marginBottom: 8 }}>🕒 Horário</div>
                <div style={{ width: "100%", borderRadius: 10, overflow: "hidden", border: "1px solid rgba(0,0,0,.1)" }}>
                  {hor.dias.map((h, idx) => (
                    <div key={h.dia} style={{ display: "flex", alignItems: "center", padding: "9px 16px", fontSize: 14, background: h.folga ? "transparent" : tema.card, borderTop: idx > 0 ? "1px solid rgba(0,0,0,.07)" : "none", color: tema.texto, opacity: h.folga ? 0.55 : 1 }}>
                      <span style={{ fontWeight: 700, width: "40%", flexShrink: 0, textAlign: "left" }}>{h.dia}</span>
                      <span style={{ textAlign: "left" }}>{h.texto}</span>
                    </div>
                  ))}
                </div>
                {hor.ciclo && (
                  <p style={{ fontSize: 13, opacity: 0.75, marginTop: 8, color: tema.texto }}>🔁 <b>Domingo cíclico:</b> trabalha {hor.ciclo.workCount} domingo{hor.ciclo.workCount > 1 ? "s" : ""} seguido{hor.ciclo.workCount > 1 ? "s" : ""} e folga 1.</p>
                )}
              </div>
            )}
          </div>
        ); })()}

        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: tema.texto }}>Candidate-se</div>
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
            <label style={lbl}>Currículo (PDF, Word ou imagem{vaga.curriculoObrigatorio ? ", obrigatório *" : ", opcional"})</label>
            <input type="file" accept="application/pdf,.pdf,.doc,.docx,.odt,image/*" onChange={(e) => setCurriculo(e.target.files?.[0] || null)} style={{ fontSize: 13 }} />
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
