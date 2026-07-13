// Páginas PÚBLICAS do Processo Seletivo (sem auth):
//  • VagasPublicaPage  — lista as vagas abertas (rota /vagas/:rid ou domínio próprio /vagas)
//  • VagaCandidaturaPage — formulário de candidatura de uma vaga (/vaga/:rid/:vagaId)
// A candidatura espontânea (banco de talentos) continua em /trabalhe/:rid.
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs, query, where, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { Vaga, PerguntaVaga, CandidaturaTrabalhe } from "../../core/types";

async function ridDoSlug(slug: string): Promise<string | null> {
  try {
    const snap = await getDocs(query(collection(db, "sitesConfig"), where("slug", "==", slug)));
    if (!snap.empty) return (snap.docs[0]!.data() as { restaurantId?: string }).restaurantId || snap.docs[0]!.id;
  } catch { /* nada */ }
  return null;
}
async function nomeDoRest(rid: string): Promise<string> {
  try { const s = await getDoc(doc(db, "sitesConfig", rid)); const d = s.data() as { metaTitulo?: string } | undefined; return d?.metaTitulo || ""; } catch { return ""; }
}

const wrap = "min-h-screen bg-[#f7f3e9] dark:bg-gray-950 py-8 px-4";
const card = "max-w-2xl mx-auto";

export function VagasPublicaPage({ slugFromHost }: { slugFromHost?: string }) {
  const { rid: ridParam } = useParams<{ rid: string }>();
  const navigate = useNavigate();
  const [rid, setRid] = useState<string | null>(ridParam || null);
  const [nome, setNome] = useState("");
  const [vagas, setVagas] = useState<Vaga[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const r = ridParam || (slugFromHost ? await ridDoSlug(slugFromHost) : null);
      if (!r) { setLoading(false); return; }
      setRid(r);
      setNome(await nomeDoRest(r));
      try {
        const snap = await getDocs(query(collection(db, "vagas"), where("restaurantId", "==", r), where("status", "==", "aberta")));
        setVagas(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Vaga).filter((v) => v.publica !== false));
      } catch { setVagas([]); }
      setLoading(false);
    })();
  }, [ridParam, slugFromHost]);

  if (loading) return <div className={wrap}><div className={`${card} text-center text-gray-400`}>Carregando…</div></div>;
  if (!rid) return <div className={wrap}><div className={`${card} text-center text-gray-500`}>Página não encontrada.</div></div>;

  return (
    <div className={wrap}>
      <div className={card}>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Trabalhe com a gente{nome ? ` · ${nome}` : ""}</h1>
        <p className="text-sm text-gray-500 mt-1 mb-5">Confira as vagas abertas e candidate-se. Não achou a sua? Deixe seu currículo no banco de talentos.</p>

        <div className="space-y-3">
          {vagas.length === 0 && (
            <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500 bg-white/60 dark:bg-gray-900/40">Nenhuma vaga aberta no momento.</div>
          )}
          {vagas.map((v) => (
            <div key={v.id} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{v.titulo}</h2>
                {v.area && <span className="text-xs text-gray-400">· {v.area}</span>}
              </div>
              {v.descricao && <p className="text-sm text-gray-600 dark:text-gray-300 mt-1 whitespace-pre-wrap">{v.descricao}</p>}
              {v.requisitos && <p className="text-xs text-gray-500 mt-1 whitespace-pre-wrap"><b>Requisitos:</b> {v.requisitos}</p>}
              <button type="button" onClick={() => navigate(`/vaga/${rid}/${v.id}`)} className="mt-3 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold">Candidatar-se →</button>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white/60 dark:bg-gray-900/40 p-4 text-center">
          <p className="text-sm text-gray-600 dark:text-gray-300">Não encontrou uma vaga pra você?</p>
          <button type="button" onClick={() => navigate(`/trabalhe/${rid}`)} className="mt-2 px-4 py-2 rounded-xl border border-emerald-500 text-emerald-600 dark:text-emerald-300 text-sm font-semibold">Deixar meu currículo (banco de talentos)</button>
        </div>
      </div>
    </div>
  );
}

export function VagaCandidaturaPage() {
  const { rid, vagaId } = useParams<{ rid: string; vagaId: string }>();
  const navigate = useNavigate();
  const [vaga, setVaga] = useState<Vaga | null>(null);
  const [loading, setLoading] = useState(true);
  const [nome, setNome] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [respostas, setRespostas] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);

  useEffect(() => {
    (async () => {
      if (!vagaId) { setLoading(false); return; }
      try { const s = await getDoc(doc(db, "vagas", vagaId)); if (s.exists()) setVaga({ id: s.id, ...s.data() } as Vaga); } catch { /* nada */ }
      setLoading(false);
    })();
  }, [vagaId]);

  const inp = "w-full px-3 py-2.5 text-base rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";

  async function enviar() {
    setErro("");
    if (!nome.trim()) return setErro("Preencha seu nome.");
    if (whatsapp.replace(/\D/g, "").length < 10) return setErro("Digite um WhatsApp válido (DDD + número).");
    for (const p of vaga?.perguntas || []) {
      if (p.obrigatoria && !(respostas[p.id] || "").trim()) return setErro(`Responda: ${p.label}`);
    }
    setEnviando(true);
    try {
      let d = whatsapp.replace(/\D/g, ""); if (d.length <= 11) d = "55" + d;
      const respLabels: Record<string, string> = {};
      for (const p of vaga?.perguntas || []) { const v = (respostas[p.id] || "").trim(); if (v) respLabels[p.label] = v; }
      const id = `cand_${rid}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const cand: CandidaturaTrabalhe = {
        id, restaurantId: rid || "", status: "nova", etapa: "nova",
        vagaId: vagaId || null, vagaTitulo: vaga?.titulo || null,
        respostas: Object.keys(respLabels).length ? respLabels : undefined,
        responsavelId: vaga?.responsavelId || undefined, responsavelNome: vaga?.responsavelNome || undefined,
        nome: nome.trim(), whatsapp: d, email: email.trim(), areaInteresse: vaga?.area || vaga?.titulo || "",
        origem: "publico", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      await setDoc(doc(db, "candidaturasTrabalhe", id), sanitizeForFirestore(cand));
      setOk(true);
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao enviar."); }
    setEnviando(false);
  }

  if (loading) return <div className={wrap}><div className={`${card} text-center text-gray-400`}>Carregando…</div></div>;
  if (!vaga) return <div className={wrap}><div className={`${card} text-center text-gray-500`}>Vaga não encontrada ou encerrada.</div></div>;
  if (ok) return (
    <div className={wrap}><div className={`${card} rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-white dark:bg-gray-900 p-8 text-center`}>
      <div className="text-4xl mb-2">✅</div>
      <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Candidatura enviada!</h1>
      <p className="text-sm text-gray-500 mt-1">Obrigado, {nome.split(" ")[0]}. Vamos analisar e entrar em contato pelo WhatsApp.</p>
    </div></div>
  );

  return (
    <div className={wrap}>
      <div className={`${card} rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5`}>
        <button type="button" onClick={() => navigate(`/vagas/${rid}`)} className="text-xs text-gray-500 hover:underline mb-2">← Todas as vagas</button>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{vaga.titulo}</h1>
        {vaga.area && <p className="text-xs text-gray-400">{vaga.area}</p>}
        {vaga.descricao && <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 whitespace-pre-wrap">{vaga.descricao}</p>}

        <div className="space-y-3 mt-4">
          <div><label className="text-xs font-medium text-gray-600 dark:text-gray-300">Seu nome *</label><input value={nome} onChange={(e) => setNome(e.target.value)} className={inp} /></div>
          <div><label className="text-xs font-medium text-gray-600 dark:text-gray-300">WhatsApp *</label><input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className={inp} placeholder="(11) 99999-9999" /></div>
          <div><label className="text-xs font-medium text-gray-600 dark:text-gray-300">E-mail</label><input value={email} onChange={(e) => setEmail(e.target.value)} className={inp} /></div>

          {(vaga.perguntas || []).map((p: PerguntaVaga) => (
            <div key={p.id}>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-300">{p.label}{p.obrigatoria ? " *" : ""}</label>
              {p.tipo === "textolongo" ? (
                <textarea value={respostas[p.id] || ""} onChange={(e) => setRespostas((r) => ({ ...r, [p.id]: e.target.value }))} rows={3} className={inp} />
              ) : p.tipo === "opcoes" ? (
                <select value={respostas[p.id] || ""} onChange={(e) => setRespostas((r) => ({ ...r, [p.id]: e.target.value }))} className={inp}>
                  <option value="">— escolha —</option>{(p.opcoes || []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : p.tipo === "simnao" ? (
                <select value={respostas[p.id] || ""} onChange={(e) => setRespostas((r) => ({ ...r, [p.id]: e.target.value }))} className={inp}>
                  <option value="">— escolha —</option><option value="Sim">Sim</option><option value="Não">Não</option>
                </select>
              ) : (
                <input type={p.tipo === "numero" ? "number" : "text"} value={respostas[p.id] || ""} onChange={(e) => setRespostas((r) => ({ ...r, [p.id]: e.target.value }))} className={inp} />
              )}
            </div>
          ))}

          {erro && <div className="text-sm text-rose-600 dark:text-rose-400">{erro}</div>}
          <button type="button" onClick={() => void enviar()} disabled={enviando} className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-60">{enviando ? "Enviando…" : "Enviar candidatura"}</button>
        </div>
      </div>
    </div>
  );
}
