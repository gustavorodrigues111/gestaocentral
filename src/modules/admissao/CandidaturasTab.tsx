import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { CurriculoLink } from "../_shared/CurriculoLink";
import type { CandidaturaTrabalhe, StatusCandidatura } from "../../core/types";

type Props = {
  rid: string;
  podeEditar: boolean;
};

const STATUS_LABEL: Record<StatusCandidatura, string> = {
  nova: "Nova",
  em_analise: "Em análise",
  aprovada_pra_admissao: "Aprovada pra admissão",
  rejeitada: "Rejeitada",
  arquivada: "Arquivada",
};

const STATUS_COR: Record<StatusCandidatura, string> = {
  nova: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  em_analise: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  aprovada_pra_admissao: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  rejeitada: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  arquivada: "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
};

const STATUS_FLUXO: StatusCandidatura[] = ["nova", "em_analise", "aprovada_pra_admissao", "rejeitada", "arquivada"];

export function CandidaturasTab({ rid, podeEditar }: Props) {
  const { pessoa: me } = useAuth();
  const [candidaturas, setCandidaturas] = useState<CandidaturaTrabalhe[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<StatusCandidatura | "todas">("todas");
  const [abertaId, setAbertaId] = useState<string | null>(null);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "candidaturasTrabalhe"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as CandidaturaTrabalhe);
        list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setCandidaturas(list);
        setLoading(false);
        setErro("");
      },
      (err) => {
        setLoading(false);
        setErro(err.code === "permission-denied" ? "permission_denied" : (err.message || "Erro"));
      },
    );
    return () => unsub();
  }, [rid]);

  const filtradas = useMemo(() => {
    if (filtroStatus === "todas") return candidaturas;
    return candidaturas.filter(c => c.status === filtroStatus);
  }, [candidaturas, filtroStatus]);

  const aberta = useMemo(() => candidaturas.find(c => c.id === abertaId) || null, [candidaturas, abertaId]);
  const contagens = useMemo(() => {
    const acc: Record<StatusCandidatura | "todas", number> = {
      todas: candidaturas.length,
      nova: 0, em_analise: 0, aprovada_pra_admissao: 0, rejeitada: 0, arquivada: 0,
    };
    for (const c of candidaturas) acc[c.status]++;
    return acc;
  }, [candidaturas]);

  async function mudarStatus(c: CandidaturaTrabalhe, novo: StatusCandidatura) {
    if (!podeEditar) return;
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { status: novo, updatedAt: now };
    if (novo === "rejeitada") {
      updates.rejeitadaEm = now;
      const motivo = prompt("Motivo da rejeição (opcional):");
      if (motivo !== null) updates.motivoRejeicao = motivo;
    }
    await updateDoc(doc(db, "candidaturasTrabalhe", c.id), sanitizeForFirestore(updates));
  }

  async function salvarObservacoes(c: CandidaturaTrabalhe, obs: string) {
    if (!podeEditar) return;
    await updateDoc(doc(db, "candidaturasTrabalhe", c.id), sanitizeForFirestore({
      observacoesInternas: obs,
      updatedAt: new Date().toISOString(),
    }));
  }

  async function atribuir(c: CandidaturaTrabalhe, eu: boolean) {
    if (!me) return;
    await updateDoc(doc(db, "candidaturasTrabalhe", c.id), sanitizeForFirestore({
      responsavelId: eu ? me.id : null,
      responsavelNome: eu ? me.nome : null,
      updatedAt: new Date().toISOString(),
    }));
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;
  if (erro === "permission_denied") {
    return (
      <div className="rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-4 text-sm">
        <p className="font-semibold text-rose-900 dark:text-rose-200 mb-1">⚠ Regras Firestore não publicadas</p>
        <code className="block mt-2 text-[12px] bg-white dark:bg-gray-900 px-3 py-2 rounded border">
          firebase deploy --only firestore:rules --project gestaocentral
        </code>
      </div>
    );
  }
  if (erro) return <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800">⚠ {erro}</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 p-3 text-sm text-indigo-900 dark:text-indigo-200">
        <p className="font-semibold mb-1">💼 Candidaturas espontâneas</p>
        <p className="text-[13px] opacity-90">
          Pessoas que se candidataram pelo form público do site. Quando aprovar
          alguém pra admissão formal, move o status — depois cria o processo
          de admissão no módulo dedicado.
        </p>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-1.5">
        {(["todas", ...STATUS_FLUXO] as const).map(s => (
          <button
            key={s}
            onClick={() => setFiltroStatus(s)}
            className={`px-3 py-1 text-xs font-medium rounded-full border ${
              filtroStatus === s
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700 hover:bg-gray-50"
            }`}
          >
            {s === "todas" ? "Todas" : STATUS_LABEL[s]} ({contagens[s]})
          </button>
        ))}
      </div>

      {/* Lista */}
      {filtradas.length === 0 ? (
        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/30 border border-gray-200 dark:border-gray-700 p-6 text-center">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {filtroStatus === "todas" ? "Nenhuma candidatura ainda." : `Nenhuma candidatura com status "${STATUS_LABEL[filtroStatus]}".`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtradas.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => setAbertaId(c.id)}
              className="w-full text-left rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 hover:shadow transition-shadow"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-gray-900 dark:text-gray-100 truncate">{c.nome}</span>
                    <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${STATUS_COR[c.status]}`}>
                      {STATUS_LABEL[c.status]}
                    </span>
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    Área: <strong>{c.areaInteresse}</strong>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    📱 {c.whatsapp} · ✉ {c.email}
                  </div>
                  {c.responsavelNome && (
                    <div className="text-[11px] text-indigo-700 dark:text-indigo-400 mt-0.5">
                      → {c.responsavelNome}
                    </div>
                  )}
                </div>
                <div className="text-[10px] text-gray-400 shrink-0 tabular-nums">
                  {new Date(c.createdAt).toLocaleDateString("pt-BR")}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Drawer / Modal de candidatura aberta */}
      {aberta && (
        <CandidaturaModal
          candidatura={aberta}
          podeEditar={podeEditar}
          mePessoaId={me?.id}
          onClose={() => setAbertaId(null)}
          onMudarStatus={(novo) => mudarStatus(aberta, novo)}
          onSalvarObs={(obs) => salvarObservacoes(aberta, obs)}
          onAtribuir={(eu) => atribuir(aberta, eu)}
        />
      )}
    </div>
  );
}

function CandidaturaModal({
  candidatura, podeEditar, mePessoaId, onClose, onMudarStatus, onSalvarObs, onAtribuir,
}: {
  candidatura: CandidaturaTrabalhe;
  podeEditar: boolean;
  mePessoaId?: string;
  onClose: () => void;
  onMudarStatus: (novo: StatusCandidatura) => Promise<void>;
  onSalvarObs: (obs: string) => Promise<void>;
  onAtribuir: (eu: boolean) => Promise<void>;
}) {
  const [obs, setObs] = useState(candidatura.observacoesInternas || "");
  const [savingObs, setSavingObs] = useState(false);

  const numeroLimpo = candidatura.whatsapp.replace(/\D/g, "");
  const whatsappLink = `https://api.whatsapp.com/send?phone=${numeroLimpo}&text=${encodeURIComponent(`Oi ${candidatura.nome.split(" ")[0]}, vi sua candidatura.`)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50">
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-xl max-w-2xl w-full max-h-[95vh] overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 p-4 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-lg text-gray-900 dark:text-gray-100">{candidatura.nome}</h2>
            <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${STATUS_COR[candidatura.status]}`}>
              {STATUS_LABEL[candidatura.status]}
            </span>
          </div>
          <button onClick={onClose} className="text-2xl text-gray-400 hover:text-gray-700 px-2">×</button>
        </div>

        <div className="p-4 space-y-4">
          {/* Contato */}
          <section>
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Contato</h3>
            <div className="text-sm space-y-1">
              <div>📱 {candidatura.whatsapp} <a href={whatsappLink} target="_blank" rel="noreferrer" className="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 ml-2">💬 abrir</a></div>
              <div>✉ {candidatura.email}</div>
            </div>
          </section>

          {/* Detalhes */}
          <section>
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Detalhes</h3>
            <div className="text-sm space-y-1 rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-800/30">
              <div><strong>Área:</strong> {candidatura.areaInteresse}</div>
              {candidatura.disponibilidade && <div><strong>Disponibilidade:</strong> {candidatura.disponibilidade}</div>}
              {candidatura.experiencia && (
                <div><strong>Experiência:</strong>
                  <p className="whitespace-pre-wrap text-gray-700 dark:text-gray-300 mt-0.5">{candidatura.experiencia}</p>
                </div>
              )}
              {(candidatura.curriculoUrl || candidatura.curriculoPath) && (
                <div>
                  📄 <CurriculoLink url={candidatura.curriculoUrl} path={candidatura.curriculoPath} label="abrir currículo" className="text-indigo-600 hover:underline" />
                </div>
              )}
            </div>
          </section>

          {/* Atribuição */}
          {podeEditar && (
            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Responsável</h3>
              <div className="flex items-center gap-2">
                {candidatura.responsavelNome ? (
                  <>
                    <span className="text-sm">{candidatura.responsavelNome}</span>
                    {candidatura.responsavelId === mePessoaId && (
                      <Button size="sm" variant="secondary" onClick={() => onAtribuir(false)}>tirar</Button>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-sm text-gray-500 italic">ninguém atribuído</span>
                    <Button size="sm" variant="secondary" onClick={() => onAtribuir(true)}>assumir</Button>
                  </>
                )}
              </div>
            </section>
          )}

          {/* Observações */}
          {podeEditar && (
            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Observações internas</h3>
              <textarea
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                rows={3}
                placeholder="anotações pra equipe..."
              />
              <Button
                size="sm"
                onClick={async () => {
                  setSavingObs(true);
                  try { await onSalvarObs(obs); } finally { setSavingObs(false); }
                }}
                disabled={savingObs}
                className="mt-1"
              >
                {savingObs ? "Salvando..." : "Salvar observações"}
              </Button>
            </section>
          )}

          {/* Motivo rejeição (se houver) */}
          {candidatura.status === "rejeitada" && candidatura.motivoRejeicao && (
            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-rose-600 mb-1">Motivo da rejeição</h3>
              <div className="text-sm bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg p-2 whitespace-pre-wrap">
                {candidatura.motivoRejeicao}
              </div>
            </section>
          )}

          {/* Mudar status */}
          {podeEditar && (
            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Mover pra...</h3>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_FLUXO.filter(s => s !== candidatura.status).map(s => (
                  <Button
                    key={s}
                    size="sm"
                    variant="secondary"
                    onClick={() => onMudarStatus(s)}
                  >
                    {STATUS_LABEL[s]}
                  </Button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
