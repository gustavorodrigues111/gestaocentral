// Processo Seletivo — kanban de candidaturas (avulsas + por vaga) até a decisão.
// Fase 1: kanban com etapas fixas + arrastar entre colunas + detalhe do candidato.
// (Vagas com perguntas próprias + página pública + aprovar→admissão vêm nas
// fases 2 e 3.)
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, query, where, updateDoc, doc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import type { CandidaturaTrabalhe, EtapaSeletivo, StatusCandidatura } from "../../core/types";

const COLUNAS: { id: EtapaSeletivo; label: string; cor: string }[] = [
  { id: "nova",       label: "Novas",      cor: "border-blue-300 dark:border-blue-800" },
  { id: "triagem",    label: "Triagem",    cor: "border-indigo-300 dark:border-indigo-800" },
  { id: "entrevista", label: "Entrevista", cor: "border-amber-300 dark:border-amber-800" },
  { id: "aprovado",   label: "Aprovados",  cor: "border-emerald-300 dark:border-emerald-800" },
  { id: "rejeitado",  label: "Rejeitados", cor: "border-rose-300 dark:border-rose-800" },
  { id: "banco",      label: "Banco de talentos", cor: "border-gray-300 dark:border-gray-700" },
];

// Deriva a etapa do kanban a partir do status legado quando `etapa` não existe.
function etapaDe(c: CandidaturaTrabalhe): EtapaSeletivo {
  if (c.etapa) return c.etapa;
  switch (c.status) {
    case "em_analise": return "triagem";
    case "aprovada_pra_admissao": return "aprovado";
    case "rejeitada": return "rejeitado";
    case "arquivada": return "banco";
    default: return "nova";
  }
}
// Mantém o `status` legado coerente com a etapa (pro CandidaturasTab antigo + aviso).
function statusDaEtapa(e: EtapaSeletivo): StatusCandidatura {
  switch (e) {
    case "triagem": case "entrevista": return "em_analise";
    case "aprovado": return "aprovada_pra_admissao";
    case "rejeitado": return "rejeitada";
    case "banco": return "arquivada";
    default: return "nova";
  }
}

export function ProcessoSeletivoPage() {
  const { pessoa } = useAuth();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const isMaster = !!pessoa?.isMaster;
  const { can, loading } = useCanAcao(rid);
  const podeVer = isMaster || can("processoSeletivo", "ver");
  const podeTriar = isMaster || can("processoSeletivo", "triar");

  const [cands, setCands] = useState<CandidaturaTrabalhe[]>([]);
  const [sel, setSel] = useState<CandidaturaTrabalhe | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);

  useEffect(() => {
    if (!rid) return;
    const u = onSnapshot(
      query(collection(db, "candidaturasTrabalhe"), where("restaurantId", "==", rid)),
      (s) => setCands(s.docs.map((d) => ({ id: d.id, ...d.data() }) as CandidaturaTrabalhe)),
      () => setCands([]),
    );
    return () => u();
  }, [rid]);

  const porEtapa = useMemo(() => {
    const m: Record<EtapaSeletivo, CandidaturaTrabalhe[]> = { nova: [], triagem: [], entrevista: [], aprovado: [], rejeitado: [], banco: [] };
    for (const c of cands) m[etapaDe(c)].push(c);
    for (const k of Object.keys(m) as EtapaSeletivo[]) m[k].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return m;
  }, [cands]);

  async function mover(id: string, etapa: EtapaSeletivo) {
    if (!podeTriar) return;
    await updateDoc(doc(db, "candidaturasTrabalhe", id), { etapa, status: statusDaEtapa(etapa), updatedAt: new Date().toISOString() }).catch(() => {});
  }

  if (loading) return <div className="max-w-6xl mx-auto p-6 text-sm text-gray-400">Carregando…</div>;
  if (!podeVer) return <div className="max-w-3xl mx-auto p-8 text-center text-gray-500">Você não tem acesso ao Processo Seletivo.</div>;

  return (
    <div className="max-w-full mx-auto p-4">
      <div className="mb-3">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">🎯 Processo Seletivo</h1>
        <p className="text-xs text-gray-500">Candidaturas em kanban. Arraste entre as colunas conforme avança a triagem. {cands.length} candidatura(s).</p>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-3 [scrollbar-width:thin]">
        {COLUNAS.map((col) => (
          <div key={col.id}
            onDragOver={(e) => { if (podeTriar) e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("id"); if (id) void mover(id, col.id); setArrastando(null); }}
            className={`shrink-0 w-64 rounded-xl border-t-4 ${col.cor} bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-800 flex flex-col`}>
            <div className="px-3 py-2 flex items-center justify-between">
              <span className="text-sm font-bold text-gray-700 dark:text-gray-200">{col.label}</span>
              <span className="text-[11px] font-semibold text-gray-400">{porEtapa[col.id].length}</span>
            </div>
            <div className="px-2 pb-2 space-y-2 min-h-[120px] overflow-y-auto max-h-[70vh]">
              {porEtapa[col.id].length === 0 && <div className="text-[11px] text-gray-400 text-center py-4">—</div>}
              {porEtapa[col.id].map((c) => (
                <button key={c.id} type="button"
                  draggable={podeTriar}
                  onDragStart={(e) => { e.dataTransfer.setData("id", c.id); setArrastando(c.id); }}
                  onDragEnd={() => setArrastando(null)}
                  onClick={() => setSel(c)}
                  className={`w-full text-left rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2.5 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors ${arrastando === c.id ? "opacity-50" : ""}`}>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{c.nome}</div>
                  <div className="text-[11px] text-gray-500 truncate">{c.vagaTitulo ? `📌 ${c.vagaTitulo}` : "Banco de talentos"}{c.areaInteresse ? ` · ${c.areaInteresse}` : ""}</div>
                  <div className="flex items-center gap-2 mt-1">
                    {c.responsavelNome && <span className="text-[10px] text-indigo-500 dark:text-indigo-300 truncate">🙋 {c.responsavelNome}</span>}
                    {c.curriculoUrl && <span className="text-[10px] text-gray-400">📎 CV</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {sel && <CandidatoDrawer cand={sel} podeTriar={podeTriar} onMover={(e) => { void mover(sel.id, e); setSel(null); }} onClose={() => setSel(null)} />}
    </div>
  );
}

function CandidatoDrawer({ cand, podeTriar, onMover, onClose }: {
  cand: CandidaturaTrabalhe; podeTriar: boolean; onMover: (e: EtapaSeletivo) => void; onClose: () => void;
}) {
  const fone = (cand.whatsapp || "").replace(/\D/g, "");
  const waLink = fone ? `https://api.whatsapp.com/send?phone=${fone}&text=${encodeURIComponent(`Oi ${cand.nome.split(" ")[0]}, sobre sua candidatura…`)}` : "";
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md h-full bg-white dark:bg-gray-900 overflow-y-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{cand.nome}</h2>
            <p className="text-xs text-gray-500">{cand.vagaTitulo ? `📌 ${cand.vagaTitulo}` : "Candidatura avulsa (banco de talentos)"}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="space-y-1.5 text-sm">
          {cand.whatsapp && <div>📱 {cand.whatsapp} {waLink && <a href={waLink} target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline ml-1">abrir no WhatsApp ↗</a>}</div>}
          {cand.email && <div>✉️ {cand.email}</div>}
          {cand.areaInteresse && <div>🎯 Área: {cand.areaInteresse}</div>}
          {cand.disponibilidade && <div>🗓️ Disponibilidade: {cand.disponibilidade}</div>}
          {cand.curriculoUrl && <div>📎 <a href={cand.curriculoUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Currículo (PDF) ↗</a></div>}
        </div>

        {cand.experiencia && (
          <div><div className="text-[11px] font-semibold text-gray-500 uppercase">Experiência</div>
            <p className="text-sm whitespace-pre-wrap text-gray-700 dark:text-gray-200">{cand.experiencia}</p></div>
        )}
        {cand.respostas && Object.keys(cand.respostas).length > 0 && (
          <div><div className="text-[11px] font-semibold text-gray-500 uppercase">Respostas da vaga</div>
            <div className="text-sm text-gray-700 dark:text-gray-200 space-y-1">
              {Object.entries(cand.respostas).map(([k, v]) => <div key={k}>• {v}</div>)}
            </div></div>
        )}

        {podeTriar && (
          <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
            <div className="text-[11px] font-semibold text-gray-500 uppercase mb-1.5">Mover para</div>
            <div className="flex flex-wrap gap-1.5">
              {COLUNAS.filter((c) => c.id !== etapaDe(cand)).map((c) => (
                <button key={c.id} type="button" onClick={() => onMover(c.id)} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50">{c.label}</button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">Vagas com perguntas próprias, transferência entre atendentes e “aprovar → admissão” chegam nas próximas fases.</p>
          </div>
        )}
      </div>
    </div>
  );
}
