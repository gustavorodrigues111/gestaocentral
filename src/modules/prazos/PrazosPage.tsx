// Módulo PRAZOS — agenda unificada (contas, técnicos, trabalhistas, avulsos).
// Fonte única: você acompanha (Agendar / Realizado / laudo) e edita a definição
// pelo ✎. Recorrente = 1 registro que anda + histórico. Ver
// [[project_gestor_redesign_2modulos]].
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, doc, onSnapshot, query, where, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { pickDriveFolder } from "../../core/google/drivePicker";
import { uploadFileToFolder } from "../../core/google/driveShared";
import type { Prazo, PrazoTipo, Empregado, Pessoa } from "../../core/types";
import { PRAZO_TIPO_LABEL, PRAZO_SUBTIPO_TRAB_LABEL } from "../../core/types";
import { resumoRecorrencia } from "./recorrencia";
import { resolverPrazo, podeResolver, grupoAgenda, diasAte, hojeYmd } from "./logic";
import { PrazoModal } from "./PrazoModal";

const brl = (n?: number | null) => (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const ymdToBr = (ymd?: string) => { if (!ymd) return ""; const [a, m, d] = ymd.split("-"); return `${d}/${m}/${a}`; };

const TIPO_META: Record<PrazoTipo, { icon: string; cls: string }> = {
  conta: { icon: "💰", cls: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  tecnico: { icon: "🛠️", cls: "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" },
  trabalhista: { icon: "🧑‍⚖️", cls: "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" },
  avulso: { icon: "🚩", cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" },
};

export function PrazosPage() {
  const { pessoa: me } = useAuth();
  const { rid } = useParams<{ rid: string }>();
  const { restaurants, activeRestaurant } = useRestaurant();
  const isMaster = !!me?.isMaster;
  const { can } = useCanAcao(rid || "");
  const podeVer = isMaster || can("prazos", "ver");
  const podeGerir = isMaster || can("prazos", "gerir");

  const [prazos, setPrazos] = useState<Prazo[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [tipoFiltro, setTipoFiltro] = useState<PrazoTipo | "todos">("todos");
  const [aba, setAba] = useState<"agenda" | "resolvidos">("agenda");
  const [todosRest, setTodosRest] = useState(false);
  const [modal, setModal] = useState<{ prazo: Prazo | null } | null>(null);
  const [agendando, setAgendando] = useState<string | null>(null);
  const [dataAg, setDataAg] = useState("");
  const [erro, setErro] = useState("");
  const laudoRef = useRef<HTMLInputElement | null>(null);
  const laudoAlvo = useRef<Prazo | null>(null);

  useEffect(() => {
    if (!rid) return;
    // Master pode ver todos os restaurantes; senão só o ativo.
    const qy = (todosRest && isMaster)
      ? collection(db, "prazos")
      : query(collection(db, "prazos"), where("restaurantIds", "array-contains", rid));
    const u1 = onSnapshot(qy, (s) => setPrazos(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Prazo).filter((p) => !p.deletadoEm)), () => setPrazos([]));
    const u2 = onSnapshot(query(collection(db, "empregados"), where("restaurantId", "==", rid)), (s) => setEmpregados(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Empregado)), () => setEmpregados([]));
    const u3 = onSnapshot(collection(db, "pessoas"), (s) => setPessoas(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Pessoa)), () => setPessoas([]));
    return () => { u1(); u2(); u3(); };
  }, [rid, todosRest, isMaster]);

  const hoje = hojeYmd();
  const restNome = (ids: string[]) => restaurants.find((r) => ids.includes(r.id))?.nome || "";

  const visiveis = useMemo(() => {
    let ps = prazos.filter((p) => (tipoFiltro === "todos" || p.tipo === tipoFiltro));
    if (aba === "resolvidos") return ps.filter((p) => p.status === "resolvido").sort((a, b) => (b.vencimento).localeCompare(a.vencimento));
    return ps.filter((p) => p.status !== "resolvido").sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  }, [prazos, tipoFiltro, aba]);

  const grupos = useMemo(() => {
    const g: Record<string, Prazo[]> = { vencido: [], semana: [], proximo: [], futuro: [] };
    for (const p of visiveis) g[grupoAgenda(p, hoje)].push(p);
    return g;
  }, [visiveis, hoje]);

  const contagem = useMemo(() => {
    const c: Record<string, number> = { todos: 0, conta: 0, tecnico: 0, trabalhista: 0, avulso: 0 };
    for (const p of prazos) { if (p.status === "resolvido") continue; c.todos++; c[p.tipo]++; }
    return c;
  }, [prazos]);

  async function salvarPrazo(p: Prazo) {
    await setDoc(doc(db, "prazos", p.id), sanitizeForFirestore({ ...p, atualizadoEm: new Date().toISOString() }), { merge: true });
    setModal(null);
  }
  async function realizar(p: Prazo) {
    if (!podeResolver(p)) { setErro(`${p.titulo}: anexe o laudo antes de resolver.`); return; }
    const atualizado = resolverPrazo(p, { em: new Date().toISOString(), por: me?.id, porNome: me?.nome });
    await setDoc(doc(db, "prazos", p.id), sanitizeForFirestore({ ...atualizado, atualizadoEm: new Date().toISOString() }), { merge: true });
  }
  async function agendar(p: Prazo) {
    const [d, m, a] = dataAg.split("/");
    if (!d || !m || !a) { setErro("Data inválida (dd/mm/aaaa)."); return; }
    const data = `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    await updateDoc(doc(db, "prazos", p.id), sanitizeForFirestore({ status: "agendado", agendamento: { data, agendadoEm: new Date().toISOString(), agendadoPor: me?.id || null }, atualizadoEm: new Date().toISOString() }));
    setAgendando(null); setDataAg("");
  }
  async function removerAgendamento(p: Prazo) {
    await updateDoc(doc(db, "prazos", p.id), sanitizeForFirestore({ status: "aberto", agendamento: null, atualizadoEm: new Date().toISOString() }));
  }
  async function excluir(p: Prazo) {
    if (!confirm(`Excluir o prazo "${p.titulo}"?`)) return;
    await updateDoc(doc(db, "prazos", p.id), { deletadoEm: new Date().toISOString(), deletadoPor: me?.id || null });
  }

  // ── Laudo (Google Drive) ──
  async function configurarPasta() {
    if (!rid) return;
    try {
      const pasta = await pickDriveFolder("Pasta dos laudos e comprovantes de Prazos");
      if (!pasta) return;
      await updateDoc(doc(db, "restaurants", rid), { prazosDriveFolderId: pasta.id, prazosDriveFolderNome: pasta.name });
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao selecionar a pasta."); }
  }
  function pedirLaudo(p: Prazo) {
    const folderId = activeRestaurant?.prazosDriveFolderId;
    if (!folderId) { setErro("Configure a pasta do Drive dos prazos primeiro (botão no topo)."); return; }
    laudoAlvo.current = p; laudoRef.current?.click();
  }
  async function onLaudoFile(file: File) {
    const p = laudoAlvo.current; const folderId = activeRestaurant?.prazosDriveFolderId;
    if (!p || !folderId) return;
    try {
      const ext = file.name.split(".").pop() || "pdf";
      const nome = `laudo-${p.titulo.toLowerCase().replace(/[^\w]+/g, "-").slice(0, 40)}-${p.vencimento.replace(/-/g, "")}.${ext}`;
      const renomeado = new File([file], nome, { type: file.type });
      const up = await uploadFileToFolder(folderId, renomeado);
      await updateDoc(doc(db, "prazos", p.id), sanitizeForFirestore({ laudo: { driveFileId: up.id, driveUrl: (up as { webViewLink?: string }).webViewLink || null, nome, anexadoEm: new Date().toISOString(), anexadoPor: me?.id || null, anexadoPorNome: me?.nome || null }, atualizadoEm: new Date().toISOString() }));
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao subir o laudo."); }
  }

  if (!podeVer) return <div className="p-6 text-sm text-gray-500">Você não tem acesso aos Prazos.</div>;

  const GRUPO_LABEL: Record<string, { label: string; danger?: boolean }> = { vencido: { label: "Vencidos", danger: true }, semana: { label: "Esta semana" }, proximo: { label: "Próximos" }, futuro: { label: "Mais pra frente" } };

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <input ref={laudoRef} type="file" accept="application/pdf,image/*,.pdf,.doc,.docx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onLaudoFile(f); e.target.value = ""; }} />
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">📅 Prazos</h1>
          <p className="text-sm text-gray-500">{todosRest ? "Todos os restaurantes" : activeRestaurant?.nome || "—"} · o que vence e quando</p>
        </div>
        <div className="flex items-center gap-2">
          {!activeRestaurant?.prazosDriveFolderId && podeGerir && <button type="button" onClick={() => void configurarPasta()} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">📁 Pasta do Drive</button>}
          {podeGerir && <button type="button" onClick={() => setModal({ prazo: null })} className="text-sm font-semibold px-3 py-2 rounded-lg bg-indigo-600 text-white">+ Novo prazo</button>}
        </div>
      </header>

      {/* Filtros por tipo + abas */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["todos", "conta", "tecnico", "trabalhista", "avulso"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTipoFiltro(t)} className={`text-xs px-3 py-1.5 rounded-full border ${tipoFiltro === t ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium" : "border-gray-200 dark:border-gray-700 text-gray-500"}`}>
            {t === "todos" ? "Todos" : `${TIPO_META[t].icon} ${PRAZO_TIPO_LABEL[t]}`} <span className="opacity-60">{contagem[t]}</span>
          </button>
        ))}
        <div className="flex-1" />
        {isMaster && <label className="text-xs text-gray-500 flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={todosRest} onChange={(e) => setTodosRest(e.target.checked)} /> todas as empresas</label>}
      </div>
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-800">
        {([["agenda", "Agenda"], ["resolvidos", "Resolvidos"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setAba(k)} className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${aba === k ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500"}`}>{l}</button>
        ))}
      </div>

      {erro && <div className="text-sm rounded-lg px-3 py-2 bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400 flex justify-between"><span>{erro}</span><button onClick={() => setErro("")}>✕</button></div>}

      {aba === "agenda" ? (
        <div className="space-y-4">
          {visiveis.length === 0 && <p className="text-sm text-gray-400 py-8 text-center">Nenhum prazo em aberto.</p>}
          {(["vencido", "semana", "proximo", "futuro"] as const).map((g) => grupos[g].length > 0 && (
            <div key={g}>
              <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${GRUPO_LABEL[g].danger ? "text-rose-600" : "text-gray-500"}`}>{GRUPO_LABEL[g].label}</div>
              <div className="space-y-2">
                {grupos[g].map((p) => (
                  <PrazoCard key={p.id} p={p} hoje={hoje} podeGerir={podeGerir} mostrarEmpresa={todosRest} restNome={restNome}
                    onEditar={() => setModal({ prazo: p })} onRealizar={() => void realizar(p)} onExcluir={() => void excluir(p)}
                    onLaudo={() => pedirLaudo(p)} onRemoverAg={() => void removerAgendamento(p)}
                    agendando={agendando === p.id} dataAg={dataAg} setDataAg={setDataAg}
                    onAbrirAg={() => { setAgendando(p.id); setDataAg(ymdToBr(p.vencimento)); }} onCancelarAg={() => setAgendando(null)} onConfirmarAg={() => void agendar(p)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {visiveis.length === 0 && <p className="text-sm text-gray-400 py-8 text-center">Nada resolvido ainda.</p>}
          {visiveis.map((p) => (
            <div key={p.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${TIPO_META[p.tipo].cls}`}>{TIPO_META[p.tipo].icon} {PRAZO_TIPO_LABEL[p.tipo]}</span>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{p.titulo}</span>
                <span className="text-xs text-gray-400 ml-auto">resolvido</span>
              </div>
              {(p.historico || []).length > 0 && (
                <div className="mt-2 text-xs text-gray-500 space-y-1">
                  {(p.historico || []).slice().reverse().map((h, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span>{ymdToBr(h.vencimento)}</span>
                      {h.laudo?.driveUrl ? <a href={h.laudo.driveUrl} target="_blank" rel="noreferrer" className="text-indigo-600 dark:text-indigo-400">📄 {h.laudo.nome}</a> : h.laudo ? <span>📄 {h.laudo.nome}</span> : <span className="text-gray-400">sem laudo</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modal && (
        <PrazoModal rid={rid || ""} prazo={modal.prazo} empregados={empregados} pessoas={pessoas.filter((pp) => (pp.restaurantIds || []).includes(rid || ""))} restaurantes={restaurants} onClose={() => setModal(null)} onSalvar={salvarPrazo} />
      )}
    </div>
  );
}

// ── Card do prazo na agenda ──
function PrazoCard({ p, hoje, podeGerir, mostrarEmpresa, restNome, onEditar, onRealizar, onExcluir, onLaudo, onRemoverAg, agendando, dataAg, setDataAg, onAbrirAg, onCancelarAg, onConfirmarAg }: {
  p: Prazo; hoje: string; podeGerir: boolean; mostrarEmpresa: boolean; restNome: (ids: string[]) => string;
  onEditar: () => void; onRealizar: () => void; onExcluir: () => void; onLaudo: () => void; onRemoverAg: () => void;
  agendando: boolean; dataAg: string; setDataAg: (v: string) => void; onAbrirAg: () => void; onCancelarAg: () => void; onConfirmarAg: () => void;
}) {
  const dias = diasAte(hoje, p.vencimento);
  const vencido = dias < 0;
  const borda = vencido ? "border-l-rose-500" : p.status === "agendado" ? "border-l-sky-500" : "border-l-amber-500";
  const rotuloRealizar = p.tipo === "conta" ? "Pago" : "Realizado";
  return (
    <div className={`rounded-xl border border-gray-200 dark:border-gray-800 border-l-[3px] ${borda} bg-white dark:bg-gray-900 p-3 space-y-2`}>
      <div className="flex items-start gap-2">
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{p.titulo}</span>
        <span className={`text-xs ml-auto whitespace-nowrap ${vencido ? "text-rose-600" : "text-gray-500"}`}>🕐 {vencido ? "venceu" : "vence"} {ymdToBr(p.vencimento)}</span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap text-xs">
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${TIPO_META[p.tipo].cls}`}>{TIPO_META[p.tipo].icon} {PRAZO_TIPO_LABEL[p.tipo]}</span>
        {mostrarEmpresa && <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">{restNome(p.restaurantIds)}</span>}
        {p.exigeLaudo && !p.laudo && <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">📄 exige laudo</span>}
        {p.laudo && <span className="text-[10px] text-emerald-600 dark:text-emerald-400">📄 laudo ok</span>}
        {p.recorrencia && <span className="text-gray-400">🔁 {resumoRecorrencia(p.recorrencia)}</span>}
        {p.responsavelNome && <span className="text-gray-500">· {p.responsavelNome}</span>}
        {p.dados?.valor != null && <span className="text-gray-500">· {brl(p.dados.valor)}</span>}
        {p.dados?.subtipoTrab && <span className="text-gray-500">· {PRAZO_SUBTIPO_TRAB_LABEL[p.dados.subtipoTrab]}</span>}
        {p.precisaRevisao && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">⚠ revisar</span>}
      </div>
      {p.status === "agendado" && p.agendamento && (
        <div className="text-xs text-sky-600 dark:text-sky-400">📅 agendado para {ymdToBr(p.agendamento.data)}</div>
      )}
      {podeGerir && (agendando ? (
        <div className="flex items-center gap-2 flex-wrap bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2">
          <span className="text-xs text-gray-500">Executar em</span>
          <input value={dataAg} onChange={(e) => setDataAg(e.target.value)} placeholder="dd/mm/aaaa" className="w-28 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
          <button type="button" onClick={onConfirmarAg} className="text-xs px-2.5 py-1 rounded bg-indigo-600 text-white">Agendar</button>
          <button type="button" onClick={onCancelarAg} className="text-xs text-gray-400">cancelar</button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          {p.status === "agendado"
            ? <><button type="button" onClick={onRealizar} className="text-xs px-2.5 py-1 rounded-lg bg-indigo-600 text-white">✓ {rotuloRealizar}</button><button type="button" onClick={onAbrirAg} className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">Reagendar</button><button type="button" onClick={onRemoverAg} className="text-xs text-gray-400">desagendar</button></>
            : <><button type="button" onClick={onAbrirAg} className="text-xs px-2.5 py-1 rounded-lg bg-indigo-600 text-white">📅 Agendar</button><button type="button" onClick={onRealizar} className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">✓ {rotuloRealizar}</button></>}
          {p.exigeLaudo && <button type="button" onClick={onLaudo} className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">📎 Laudo</button>}
          <button type="button" onClick={onEditar} className="text-xs px-2 py-1 rounded-lg text-gray-400 hover:text-gray-700" title="Editar definição">✎</button>
          <button type="button" onClick={onExcluir} className="text-xs px-2 py-1 rounded-lg text-gray-300 hover:text-rose-600">🗑</button>
        </div>
      ))}
    </div>
  );
}

export { TIPO_META, ymdToBr };
