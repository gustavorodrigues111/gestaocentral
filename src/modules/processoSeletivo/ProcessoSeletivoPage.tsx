// Processo Seletivo — kanban de candidaturas + gestão de vagas.
// F1: kanban com etapas fixas + arrastar. F2: vagas com perguntas próprias +
// responsável + página pública. F3: transferir, rejeitar c/ motivo, aprovar→admissão.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, query, where, updateDoc, doc, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import { IniciarAdmissaoModal } from "../admissao/IniciarAdmissaoModal";
import { iniciarAdmissao, getPrazoDias, getDocumentosAdmissao, getSchemaAdmissao } from "../../core/admissao/admissaoHelpers";
import type { CandidaturaTrabalhe, EtapaSeletivo, StatusCandidatura, Vaga, PerguntaVaga, Pessoa, Cargo, WorkSchedule } from "../../core/types";

type EmpMin = { id: string; nome: string; workSchedules?: WorkSchedule[] };

const COLUNAS: { id: EtapaSeletivo; label: string; cor: string }[] = [
  { id: "nova",       label: "Novas",      cor: "border-blue-300 dark:border-blue-800" },
  { id: "triagem",    label: "Triagem",    cor: "border-indigo-300 dark:border-indigo-800" },
  { id: "entrevista", label: "Entrevista", cor: "border-amber-300 dark:border-amber-800" },
  { id: "aprovado",   label: "Aprovados",  cor: "border-emerald-300 dark:border-emerald-800" },
  { id: "rejeitado",  label: "Rejeitados", cor: "border-rose-300 dark:border-rose-800" },
  { id: "banco",      label: "Banco de talentos", cor: "border-gray-300 dark:border-gray-700" },
];

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
function statusDaEtapa(e: EtapaSeletivo): StatusCandidatura {
  switch (e) {
    case "triagem": case "entrevista": return "em_analise";
    case "aprovado": return "aprovada_pra_admissao";
    case "rejeitado": return "rejeitada";
    case "banco": return "arquivada";
    default: return "nova";
  }
}
const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const inp = "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";

export function ProcessoSeletivoPage() {
  const { pessoa } = useAuth();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const isMaster = !!pessoa?.isMaster;
  const { can, loading } = useCanAcao(rid);
  const podeVer = isMaster || can("processoSeletivo", "ver");
  const podeTriar = isMaster || can("processoSeletivo", "triar");
  const podeVagas = isMaster || can("processoSeletivo", "gerenciarVagas");
  const podeTransferir = isMaster || can("processoSeletivo", "transferir");
  const podeAprovar = isMaster || can("processoSeletivo", "aprovar");
  const { restaurants } = useRestaurant();
  const activeRest = restaurants.find((r) => r.id === rid) || null;

  const [aba, setAba] = useState<"kanban" | "vagas">("kanban");
  const [cands, setCands] = useState<CandidaturaTrabalhe[]>([]);
  const [vagas, setVagas] = useState<Vaga[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [empregados, setEmpregados] = useState<EmpMin[]>([]);
  const [sel, setSel] = useState<CandidaturaTrabalhe | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [editVaga, setEditVaga] = useState<Vaga | "nova" | null>(null);
  const [admitir, setAdmitir] = useState<CandidaturaTrabalhe | null>(null);

  useEffect(() => {
    if (!rid) return;
    const u1 = onSnapshot(query(collection(db, "candidaturasTrabalhe"), where("restaurantId", "==", rid)),
      (s) => setCands(s.docs.map((d) => ({ id: d.id, ...d.data() }) as CandidaturaTrabalhe)), () => setCands([]));
    const u2 = onSnapshot(query(collection(db, "vagas"), where("restaurantId", "==", rid)),
      (s) => setVagas(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Vaga)), () => setVagas([]));
    const u3 = onSnapshot(query(collection(db, "pessoas"), where("restaurantIds", "array-contains", rid)),
      (s) => setPessoas(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Pessoa).sort((a, b) => a.nome.localeCompare(b.nome))), () => setPessoas([]));
    const u4 = onSnapshot(query(collection(db, "cargos"), where("restaurantId", "==", rid)),
      (s) => setCargos(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Cargo)), () => setCargos([]));
    const u5 = onSnapshot(query(collection(db, "empregados"), where("restaurantId", "==", rid)),
      (s) => setEmpregados(s.docs.map((d) => ({ id: d.id, ...d.data() }) as EmpMin).filter((e) => e.nome).sort((a, b) => a.nome.localeCompare(b.nome))), () => setEmpregados([]));
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, [rid]);

  // Mantém o sel atualizado quando a candidatura muda no snapshot.
  useEffect(() => { if (sel) { const f = cands.find((c) => c.id === sel.id); if (f) setSel(f); } }, [cands]); // eslint-disable-line react-hooks/exhaustive-deps

  const porEtapa = useMemo(() => {
    const m: Record<EtapaSeletivo, CandidaturaTrabalhe[]> = { nova: [], triagem: [], entrevista: [], aprovado: [], rejeitado: [], banco: [] };
    for (const c of cands) m[etapaDe(c)].push(c);
    for (const k of Object.keys(m) as EtapaSeletivo[]) m[k].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return m;
  }, [cands]);

  async function mover(id: string, etapa: EtapaSeletivo, extra?: Record<string, unknown>) {
    if (!podeTriar) return;
    await updateDoc(doc(db, "candidaturasTrabalhe", id), { etapa, status: statusDaEtapa(etapa), updatedAt: new Date().toISOString(), ...(extra || {}) }).catch(() => {});
  }
  async function transferir(c: CandidaturaTrabalhe, p: Pessoa) {
    const hist = [...(((c as unknown as { historico?: unknown[] }).historico) || []), { tipo: "transferencia", para: p.id, paraNome: p.nome, por: pessoa?.nome || "—", em: new Date().toISOString() }];
    await updateDoc(doc(db, "candidaturasTrabalhe", c.id), { responsavelId: p.id, responsavelNome: p.nome, historico: hist, updatedAt: new Date().toISOString() }).catch(() => {});
  }
  async function rejeitar(c: CandidaturaTrabalhe, motivo: string) {
    await mover(c.id, "rejeitado", { motivoRejeicao: motivo || null, rejeitadaEm: new Date().toISOString() });
  }
  async function salvarVaga(v: Vaga) {
    await setDoc(doc(db, "vagas", v.id), sanitizeForFirestore(v), { merge: true });
  }
  async function excluirVaga(v: Vaga) {
    if (confirm(`Excluir a vaga "${v.titulo}"?`)) await deleteDoc(doc(db, "vagas", v.id));
  }

  if (loading) return <div className="max-w-6xl mx-auto p-6 text-sm text-gray-400">Carregando…</div>;
  if (!podeVer) return <div className="max-w-3xl mx-auto p-8 text-center text-gray-500">Você não tem acesso ao Processo Seletivo.</div>;

  return (
    <div className="max-w-full mx-auto p-4">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">🎯 Processo Seletivo</h1>
          <p className="text-xs text-gray-500">Vagas e candidaturas em kanban. {cands.length} candidatura(s) · {vagas.length} vaga(s).</p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-4">
        {([["kanban", "🗂️ Candidaturas"], ["vagas", "📌 Vagas"]] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => setAba(v)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${aba === v ? "border-emerald-500 text-emerald-600 dark:text-emerald-300" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>{l}</button>
        ))}
      </div>

      {aba === "kanban" ? (
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
                  <button key={c.id} type="button" draggable={podeTriar}
                    onDragStart={(e) => { e.dataTransfer.setData("id", c.id); setArrastando(c.id); }}
                    onDragEnd={() => setArrastando(null)}
                    onClick={() => setSel(c)}
                    className={`w-full text-left rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2.5 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors ${arrastando === c.id ? "opacity-50" : ""}`}>
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{c.nome}</div>
                    <div className="text-[11px] text-gray-500 truncate">{c.vagaTitulo ? `📌 ${c.vagaTitulo}` : "Banco de talentos"}{c.areaInteresse ? ` · ${c.areaInteresse}` : ""}</div>
                    {c.responsavelNome && <div className="text-[10px] text-indigo-500 dark:text-indigo-300 truncate mt-0.5">🙋 {c.responsavelNome}</div>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <VagasAdmin vagas={vagas} rid={rid} podeVagas={podeVagas} onNova={() => setEditVaga("nova")} onEditar={(v) => setEditVaga(v)} onExcluir={excluirVaga} />
      )}

      {sel && (
        <CandidatoDrawer cand={sel} pessoas={pessoas}
          podeTriar={podeTriar} podeTransferir={podeTransferir} podeAprovar={podeAprovar}
          onMover={(e) => { if (e === "rejeitado") { const m = prompt("Motivo da rejeição (opcional):") || ""; void rejeitar(sel, m); } else void mover(sel.id, e); setSel(null); }}
          onTransferir={(p) => { void transferir(sel, p); }}
          onIniciarAdmissao={() => { setAdmitir(sel); }}
          onClose={() => setSel(null)} />
      )}

      {admitir && activeRest && (
        <IniciarAdmissaoModal
          rid={rid} cargos={cargos} schemaUsado={getSchemaAdmissao(activeRest)}
          defaults={{ nome: admitir.nome, email: admitir.email, whatsapp: admitir.whatsapp, cargoId: vagas.find((v) => v.id === admitir.vagaId)?.cargoId || undefined }}
          onClose={() => setAdmitir(null)}
          onConfirm={async (input) => {
            if (!pessoa) return undefined;
            try {
              const adm = await iniciarAdmissao({ ...input, restaurantSnapshot: {
                nome: activeRest.nome, whatsappDP: activeRest.whatsappDP,
                prazoDias: getPrazoDias(activeRest), documentosAdmissao: getDocumentosAdmissao(activeRest),
              } }, pessoa);
              await mover(admitir.id, "aprovado", { admissaoId: adm.id });
              setAdmitir(null); setSel(null);
              return adm;
            } catch (e) { alert("Erro ao iniciar admissão: " + (e instanceof Error ? e.message : "?")); return undefined; }
          }} />
      )}

      {editVaga && (
        <VagaEditor vaga={editVaga === "nova" ? null : editVaga} rid={rid} pessoas={pessoas} cargos={cargos} empregados={empregados} pessoaId={pessoa?.id || ""}
          onSalvar={(v) => { void salvarVaga(v); setEditVaga(null); }} onClose={() => setEditVaga(null)} />
      )}
    </div>
  );
}

function VagasAdmin({ vagas, rid, podeVagas, onNova, onEditar, onExcluir }: {
  vagas: Vaga[]; rid: string; podeVagas: boolean; onNova: () => void; onEditar: (v: Vaga) => void; onExcluir: (v: Vaga) => void;
}) {
  const linkPublico = `${window.location.origin}/vagas/${rid}`;
  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <a href={linkPublico} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">🔗 Página pública de vagas ↗</a>
        {podeVagas && <Button size="sm" onClick={onNova}>➕ Nova vaga</Button>}
      </div>
      <div className="space-y-2">
        {vagas.length === 0 && <div className="text-sm text-gray-400 py-6 text-center rounded-xl border border-dashed border-gray-300 dark:border-gray-700">Nenhuma vaga ainda.</div>}
        {vagas.map((v) => (
          <div key={v.id} className="rounded-xl border border-gray-200 dark:border-gray-800 p-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-gray-900 dark:text-gray-100">{v.titulo}</span>
                <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${v.status === "aberta" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : v.status === "pausada" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-gray-100 text-gray-500 dark:bg-gray-800"}`}>{v.status}</span>
                {v.publica && <span className="text-[10px] text-gray-400">pública</span>}
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">{v.area || "—"}{v.responsavelNome ? ` · 🙋 ${v.responsavelNome}` : ""}{v.perguntas?.length ? ` · ${v.perguntas.length} pergunta(s)` : ""}</div>
            </div>
            {podeVagas && <div className="flex gap-1.5 shrink-0">
              <button type="button" onClick={() => onEditar(v)} className="text-xs px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">Editar</button>
              <button type="button" onClick={() => onExcluir(v)} className="text-xs text-gray-400 hover:text-rose-600">🗑️</button>
            </div>}
          </div>
        ))}
      </div>
    </div>
  );
}

const lbl = "text-[11px] font-medium text-gray-500 dark:text-gray-400 block mb-1";
const ta = inp + " resize-none";

function Secao({ titulo, hint, children }: { titulo: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 p-3 space-y-2.5">
      <div className="text-[11px] font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300">{titulo}{hint && <span className="ml-1 font-normal normal-case text-gray-400">· {hint}</span>}</div>
      {children}
    </section>
  );
}

function VagaEditor({ vaga, rid, pessoas, cargos, empregados, pessoaId, onSalvar, onClose }: {
  vaga: Vaga | null; rid: string; pessoas: Pessoa[]; cargos: Cargo[]; empregados: EmpMin[]; pessoaId: string; onSalvar: (v: Vaga) => void; onClose: () => void;
}) {
  const [titulo, setTitulo] = useState(vaga?.titulo || "");
  const [area, setArea] = useState(vaga?.area || "");
  const [descricao, setDescricao] = useState(vaga?.descricao || "");
  const [requisitos, setRequisitos] = useState(vaga?.requisitos || "");
  const [status, setStatus] = useState<Vaga["status"]>(vaga?.status || "aberta");
  const [responsavelId, setResponsavelId] = useState(vaga?.responsavelId || "");
  const [cargoId, setCargoId] = useState(vaga?.cargoId || "");
  const [horarioEmpId, setHorarioEmpId] = useState(vaga?.horarioModeloEmpregadoId || "");
  const [publica, setPublica] = useState(vaga?.publica !== false);
  const [perguntas, setPerguntas] = useState<PerguntaVaga[]>(vaga?.perguntas || []);

  const cargosAtivos = cargos.filter((c) => (c as { ativo?: boolean }).ativo !== false).sort((a, b) => a.nome.localeCompare(b.nome));
  const empModelo = empregados.find((e) => e.id === horarioEmpId);
  const nWs = empModelo?.workSchedules?.length || 0;

  const addPerg = () => setPerguntas((p) => [...p, { id: "p" + Math.random().toString(36).slice(2, 7), label: "", tipo: "texto", obrigatoria: false }]);
  const setPerg = (i: number, patch: Partial<PerguntaVaga>) => setPerguntas((p) => p.map((x, j) => j === i ? { ...x, ...patch } : x));
  const delPerg = (i: number) => setPerguntas((p) => p.filter((_, j) => j !== i));

  function salvar() {
    if (!titulo.trim()) { alert("Informe o título da vaga."); return; }
    const resp = pessoas.find((p) => p.id === responsavelId);
    const cargo = cargos.find((c) => c.id === cargoId);
    const emp = empregados.find((e) => e.id === horarioEmpId);
    const v: Vaga = {
      id: vaga?.id || `vaga_${rid}_${slugify(titulo)}_${Math.random().toString(36).slice(2, 5)}`,
      restaurantId: rid, titulo: titulo.trim(), area: area.trim() || undefined, descricao: descricao.trim() || undefined,
      requisitos: requisitos.trim() || undefined, status, responsavelId: responsavelId || null, responsavelNome: resp?.nome || null,
      cargoId: cargoId || null, cargoNome: cargo?.nome || null,
      horarioModeloEmpregadoId: horarioEmpId || null, horarioModeloNome: emp?.nome || null,
      horarioModelo: emp?.workSchedules && emp.workSchedules.length ? emp.workSchedules : undefined,
      perguntas: perguntas.filter((p) => p.label.trim()).map((p) => ({ ...p, label: p.label.trim() })),
      publica, slug: vaga?.slug || slugify(titulo), criadoEm: vaga?.criadoEm || new Date().toISOString(), criadoPor: vaga?.criadoPor || pessoaId, atualizadoEm: new Date().toISOString(),
    };
    onSalvar(v);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-b border-gray-200 dark:border-gray-800">
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{vaga ? "Editar vaga" : "Nova vaga"}</h3>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">✕</button>
        </div>

        <div className="p-4 space-y-3">
          <Secao titulo="A vaga">
            <div><label className={lbl}>Título *</label><input value={titulo} onChange={(e) => setTitulo(e.target.value)} className={inp} placeholder="Ex.: Bartender" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={lbl}>Área</label><input value={area} onChange={(e) => setArea(e.target.value)} className={inp} placeholder="Salão, Cozinha, Bar…" /></div>
              <div><label className={lbl}>Status</label>
                <select value={status} onChange={(e) => setStatus(e.target.value as Vaga["status"])} className={inp}>
                  <option value="aberta">Aberta</option><option value="pausada">Pausada</option><option value="encerrada">Encerrada</option>
                </select></div>
            </div>
            <div><label className={lbl}>Descrição</label><textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} className={ta} placeholder="O que a pessoa vai fazer, cultura, benefícios…" /></div>
            <div><label className={lbl}>Requisitos</label><textarea value={requisitos} onChange={(e) => setRequisitos(e.target.value)} rows={3} className={ta} placeholder="Experiência, disponibilidade, etc." /></div>
          </Secao>

          <Secao titulo="Responsável & visibilidade">
            <div><label className={lbl}>Responsável (recebe as candidaturas)</label>
              <select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)} className={inp}>
                <option value="">— ninguém (fica com quem tem permissão) —</option>
                {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select></div>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" checked={publica} onChange={(e) => setPublica(e.target.checked)} /> Aparecer na página pública de vagas</label>
          </Secao>

          <Secao titulo="Ligação com a admissão" hint="pré-preenche quando o candidato for aprovado">
            <div><label className={lbl}>Cargo interno vinculado</label>
              <select value={cargoId} onChange={(e) => setCargoId(e.target.value)} className={inp}>
                <option value="">— nenhum —</option>
                {cargosAtivos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select></div>
            <div><label className={lbl}>Horário: copiar de um empregado</label>
              <select value={horarioEmpId} onChange={(e) => setHorarioEmpId(e.target.value)} className={inp}>
                <option value="">— nenhum —</option>
                {empregados.map((e) => <option key={e.id} value={e.id}>{e.nome}{e.workSchedules?.length ? "" : " (sem horário)"}</option>)}
              </select>
              {horarioEmpId && <p className="text-[11px] text-gray-400 mt-1">{nWs > 0 ? `Copia o horário atual de ${empModelo?.nome} (${nWs} vigência${nWs > 1 ? "s" : ""}) como modelo pra admissão.` : `${empModelo?.nome} não tem horário cadastrado.`}</p>}
            </div>
          </Secao>

          <Secao titulo="Perguntas da vaga" hint="aparecem no formulário público">
            <div className="space-y-2">
              {perguntas.length === 0 && <div className="text-xs text-gray-400">Nenhuma pergunta.</div>}
              {perguntas.map((p, i) => (
                <div key={p.id} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <input value={p.label} onChange={(e) => setPerg(i, { label: e.target.value })} className={`${inp} flex-1`} placeholder="Pergunta (ex.: Tem experiência?)" />
                    <button type="button" onClick={() => delPerg(i)} className="text-gray-400 hover:text-rose-600 text-sm shrink-0">🗑️</button>
                  </div>
                  <div className="flex items-center gap-2">
                    <select value={p.tipo} onChange={(e) => setPerg(i, { tipo: e.target.value as PerguntaVaga["tipo"] })} className={`${inp} flex-1`}>
                      <option value="texto">Texto curto</option><option value="textolongo">Texto longo</option>
                      <option value="opcoes">Múltipla escolha</option><option value="simnao">Sim/Não</option><option value="numero">Número</option>
                    </select>
                    <label className="flex items-center gap-1 text-[11px] text-gray-500 shrink-0"><input type="checkbox" checked={!!p.obrigatoria} onChange={(e) => setPerg(i, { obrigatoria: e.target.checked })} /> obrigatória</label>
                  </div>
                  {p.tipo === "opcoes" && <input value={(p.opcoes || []).join(", ")} onChange={(e) => setPerg(i, { opcoes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} className={inp} placeholder="Opções separadas por vírgula" />}
                </div>
              ))}
            </div>
            <button type="button" onClick={addPerg} className="w-full text-xs font-semibold px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-900">➕ Adicionar pergunta</button>
          </Secao>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 px-5 py-3 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-t border-gray-200 dark:border-gray-800">
          <button type="button" onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">Cancelar</button>
          <Button onClick={salvar}>💾 Salvar vaga</Button>
        </div>
      </div>
    </div>
  );
}

function CandidatoDrawer({ cand, pessoas, podeTriar, podeTransferir, podeAprovar, onMover, onTransferir, onIniciarAdmissao, onClose }: {
  cand: CandidaturaTrabalhe; pessoas: Pessoa[]; podeTriar: boolean; podeTransferir: boolean; podeAprovar: boolean;
  onMover: (e: EtapaSeletivo) => void; onTransferir: (p: Pessoa) => void; onIniciarAdmissao: () => void; onClose: () => void;
}) {
  const [transf, setTransf] = useState(false);
  const [buscaT, setBuscaT] = useState("");
  const fone = (cand.whatsapp || "").replace(/\D/g, "");
  const waLink = fone ? `https://api.whatsapp.com/send?phone=${fone}&text=${encodeURIComponent(`Oi ${cand.nome.split(" ")[0]}, sobre sua candidatura…`)}` : "";
  const etapa = etapaDe(cand);
  const disponiveis = pessoas.filter((p) => !buscaT.trim() || p.nome.toLowerCase().includes(buscaT.trim().toLowerCase())).slice(0, 30);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md h-full bg-white dark:bg-gray-900 overflow-y-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{cand.nome}</h2>
            <p className="text-xs text-gray-500">{cand.vagaTitulo ? `📌 ${cand.vagaTitulo}` : "Candidatura avulsa (banco de talentos)"}</p>
            {cand.responsavelNome && <p className="text-[11px] text-indigo-500 dark:text-indigo-300">🙋 Responsável: {cand.responsavelNome}</p>}
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="space-y-1.5 text-sm">
          {cand.whatsapp && <div>📱 {cand.whatsapp} {waLink && <a href={waLink} target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline ml-1">WhatsApp ↗</a>}</div>}
          {cand.email && <div>✉️ {cand.email}</div>}
          {cand.areaInteresse && <div>🎯 {cand.areaInteresse}</div>}
          {cand.disponibilidade && <div>🗓️ {cand.disponibilidade}</div>}
          {cand.curriculoUrl && <div>📎 <a href={cand.curriculoUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Currículo (PDF) ↗</a></div>}
        </div>
        {cand.experiencia && <div><div className="text-[11px] font-semibold text-gray-500 uppercase">Experiência</div><p className="text-sm whitespace-pre-wrap text-gray-700 dark:text-gray-200">{cand.experiencia}</p></div>}
        {cand.observacoes && <div><div className="text-[11px] font-semibold text-gray-500 uppercase">Observações do candidato</div><p className="text-sm whitespace-pre-wrap text-gray-700 dark:text-gray-200">{cand.observacoes}</p></div>}
        {cand.respostas && Object.keys(cand.respostas).length > 0 && (
          <div><div className="text-[11px] font-semibold text-gray-500 uppercase">Respostas da vaga</div>
            <div className="text-sm text-gray-700 dark:text-gray-200 space-y-1">{Object.entries(cand.respostas).map(([k, v]) => <div key={k}>• {v}</div>)}</div></div>
        )}

        {podeTransferir && (
          <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
            {!transf ? (
              <button type="button" onClick={() => setTransf(true)} className="text-xs px-2.5 py-1.5 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-300">↪ Transferir responsável</button>
            ) : (
              <div className="space-y-1.5">
                <input value={buscaT} onChange={(e) => setBuscaT(e.target.value)} className={inp} placeholder="Buscar pessoa…" autoFocus />
                <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                  {disponiveis.map((p) => <button key={p.id} type="button" onClick={() => { onTransferir(p); setTransf(false); setBuscaT(""); }} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/40">{p.nome}</button>)}
                </div>
              </div>
            )}
          </div>
        )}

        {podeTriar && (
          <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
            <div className="text-[11px] font-semibold text-gray-500 uppercase mb-1.5">Mover para</div>
            <div className="flex flex-wrap gap-1.5">
              {COLUNAS.filter((c) => c.id !== etapa).map((c) => (
                <button key={c.id} type="button" onClick={() => onMover(c.id)} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50">{c.label}</button>
              ))}
            </div>
          </div>
        )}

        {podeAprovar && etapa === "aprovado" && (
          <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
            <Button className="w-full" onClick={onIniciarAdmissao}>🪪 Iniciar admissão deste candidato</Button>
            <p className="text-[11px] text-gray-400 mt-1">Abre a admissão já com nome, e-mail e WhatsApp preenchidos. Você completa CPF e cargo.</p>
          </div>
        )}
      </div>
    </div>
  );
}
