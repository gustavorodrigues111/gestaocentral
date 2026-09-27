import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Plus, Minus, Maximize2, ArrowLeft, X, GitFork, CalendarDays, ListTree, Trash2, Pencil } from "lucide-react";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { fmtBR } from "../../core/utils/date";
import type { MapaProjeto, MapaMarco, Tarefa, TarefaProjeto, TarefaSubprojeto, TarefaStatus } from "../../core/types";
import { ouvirProjetos, ouvirSubprojetos, ouvirTodasTarefas, criarTarefa, mudarStatus, atualizarTarefa } from "../tarefas/repository";
import { ouvirMapaProjetos, salvarMapaProjeto, excluirMapaProjeto } from "./mapaRepository";

// ════════════════════════════════════════════════════════════════════════════
//  MAPA DE PROJETOS — mapa mental radial (360°) por cima do Gestor de Tarefas.
//  Conceito: PROJETO é um campo OPCIONAL da tarefa (tarefa.projetoMapaId). No
//  mapa, um projeto mostra SÓ as tarefas com esse campo == projeto. O projeto
//  PERTENCE a uma área + sub-área (só rótulo). Tarefa criada de dentro do
//  projeto já nasce com o campo preenchido. Visões: Mapa, Roadmap, Lista.
// ════════════════════════════════════════════════════════════════════════════

const PALETA = ["#6366f1", "#7c3aed", "#2563eb", "#db2777", "#0891b2", "#d97706", "#ea580c", "#16a34a", "#0d9488", "#e11d48"];
const RING1 = 250, GAP = 205;
const SC: Record<"fazer" | "and" | "ok", string> = { fazer: "#94a3b8", and: "#2563eb", ok: "#16a34a" };
type NType = "root" | "proj" | "task";
type Desc = { type: NType; nid: string; ref?: unknown; proj?: MapaProjeto; c?: string };
type MNode = Desc & { depth: number; angle: number; x: number; y: number; px: number; py: number; hasKids: boolean; open: boolean; parentNid?: string };

function stBucket(s: TarefaStatus): "fazer" | "and" | "ok" { return s === "concluida" ? "ok" : s === "em_andamento" ? "and" : "fazer"; }
function isLate(t: Tarefa): boolean { return t.status !== "concluida" && t.status !== "cancelada" && !!t.prazo && new Date(t.prazo) < new Date(new Date().toDateString()); }
function shortD(iso?: string | null): string { if (!iso) return ""; const d = new Date(iso); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; }
function uid(): string { try { return crypto.randomUUID(); } catch { return "id" + Date.now() + Math.random().toString(36).slice(2); } }
function prog(ts: Tarefa[]): number { return ts.length ? Math.round(ts.filter(t => t.status === "concluida").length / ts.length * 100) : 0; }

export function MapaProjetosPage() {
  const { pessoa: me } = useAuth();
  const { rid } = useParams<{ rid: string }>();
  const { can } = useCanAcao(rid || "");
  const podeGerenciar = !!me?.isMaster || can("mapaProjetos", "gerenciar");

  const [areas, setAreas] = useState<TarefaProjeto[]>([]);
  const [subs, setSubs] = useState<TarefaSubprojeto[]>([]);
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [projetos, setProjetos] = useState<MapaProjeto[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["root"]));
  const seededRef = useRef(false);

  const [overlay, setOverlay] = useState<{ pid: string; view: "roadmap" | "lista"; alt: "marcos" | "tarefas" } | null>(null);
  const [projModal, setProjModal] = useState<{ mode: "new" | "edit"; proj?: MapaProjeto } | null>(null);
  const [taskModal, setTaskModal] = useState<{ pid: string } | null>(null);
  const [toast, setToast] = useState("");

  useEffect(() => ouvirProjetos(setAreas), []);
  useEffect(() => ouvirSubprojetos(setSubs), []);
  useEffect(() => ouvirTodasTarefas(setTarefas), []);
  useEffect(() => { if (!me?.id) return; return ouvirMapaProjetos(me.isMaster ? null : me.id, setProjetos); }, [me?.id, me?.isMaster]);

  useEffect(() => {
    if (seededRef.current || projetos.length === 0) return;
    seededRef.current = true;
    setExpanded(prev => { const n = new Set(prev); n.add("root"); projetos.forEach(p => n.add(`root/p:${p.id}`)); return n; });
  }, [projetos]);

  function say(m: string) { setToast(m); setTimeout(() => setToast(""), 2600); }

  const areaById = useMemo(() => new Map(areas.map(a => [a.id, a])), [areas]);
  const subById = useMemo(() => new Map(subs.map(s => [s.id, s])), [subs]);
  const tasksByProj = useMemo(() => {
    const m = new Map<string, Tarefa[]>();
    for (const t of tarefas) { if (!t.projetoMapaId || t.status === "cancelada" || t.deletadoEm) continue; if (!m.has(t.projetoMapaId)) m.set(t.projetoMapaId, []); m.get(t.projetoMapaId)!.push(t); }
    return m;
  }, [tarefas]);
  const projTasks = (p: MapaProjeto) => tasksByProj.get(p.id) || [];
  // classificação (área/sub) do projeto — com fallback pro modelo antigo (incSubs)
  function projClass(p: MapaProjeto): { area?: TarefaProjeto; subNome?: string } {
    let aId = p.areaId, sId = p.subareaId;
    if (!aId && p.incSubs?.length) { const s0 = subById.get(p.incSubs[0]); if (s0) { aId = s0.projetoId; sId = p.incSubs[0]; } }
    return { area: aId ? areaById.get(aId) : undefined, subNome: sId ? subById.get(sId)?.nome : undefined };
  }

  function kidsOf(node: Desc | { type: NType; nid: string }): Desc[] {
    if (node.type === "root") return projetos.map(p => ({ type: "proj" as NType, nid: `root/p:${p.id}`, ref: p, proj: p, c: p.cor }));
    const n = node as MNode;
    if (n.type === "proj") return projTasks(n.ref as MapaProjeto).map(t => ({ type: "task" as NType, nid: `${n.nid}/t:${t.id}`, ref: t, proj: n.ref as MapaProjeto, c: (n.ref as MapaProjeto).cor }));
    return [];
  }

  const layout = useMemo(() => {
    const visible: MNode[] = [];
    let leaf = 0;
    const countLeaves = (node: Desc | { type: NType; nid: string }): number => { const k = expanded.has(node.nid) ? kidsOf(node) : []; return k.length ? k.reduce((s, c) => s + countLeaves(c), 0) : 1; };
    const root: Desc = { type: "root", nid: "root" };
    const step = (2 * Math.PI) / Math.max(1, countLeaves(root));
    const place = (node: Desc, depth: number, parentNid?: string): MNode => {
      const kids = expanded.has(node.nid) ? kidsOf(node) : [];
      const hasKids = kidsOf(node).length > 0;
      let angle: number; const childNodes: MNode[] = [];
      if (!kids.length) { angle = -Math.PI / 2 + leaf * step; leaf++; }
      else { kids.forEach(k => childNodes.push(place(k, depth + 1, node.nid))); angle = (childNodes[0].angle + childNodes[childNodes.length - 1].angle) / 2; }
      const R = depth === 0 ? 0 : RING1 + (depth - 1) * GAP;
      const mn: MNode = { ...node, depth, angle, x: R * Math.cos(angle), y: R * Math.sin(angle), px: 0, py: 0, hasKids, open: expanded.has(node.nid) && hasKids, parentNid };
      visible.push(mn); return mn;
    };
    place(root, 0);
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    visible.forEach(n => { minX = Math.min(minX, n.x - 130); maxX = Math.max(maxX, n.x + 130); minY = Math.min(minY, n.y - 52); maxY = Math.max(maxY, n.y + 52); });
    const pad = 90, offX = pad - minX, offY = pad - minY;
    visible.forEach(n => { n.px = n.x + offX; n.py = n.y + offY; });
    const byNid = new Map(visible.map(n => [n.nid, n]));
    const links = visible.filter(n => n.parentNid && byNid.has(n.parentNid)).map(n => { const p = byNid.get(n.parentNid!)!; return { x1: p.px, y1: p.py, x2: n.px, y2: n.py, c: n.c || "#c3cad6" }; });
    const maxDepth = visible.reduce((m, n) => Math.max(m, n.depth), 0);
    return { visible, links, worldW: maxX - minX + pad * 2, worldH: maxY - minY + pad * 2, rootX: offX, rootY: offY, maxDepth };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projetos, tarefas, expanded]);

  // altura real do canvas (container do app tem altura automática)
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageH, setStageH] = useState(560);
  useEffect(() => {
    function calc() { const el = stageRef.current; if (!el) return; const top = el.getBoundingClientRect().top; setStageH(Math.max(380, window.innerHeight - top - 14)); }
    const t = setTimeout(calc, 30); window.addEventListener("resize", calc);
    return () => { clearTimeout(t); window.removeEventListener("resize", calc); };
  }, []);

  const [tf, setTf] = useState({ s: 0.8, x: 0, y: 0 });
  const fitDoneRef = useRef(false);
  function fit() {
    const st = stageRef.current; if (!st) return; const r = st.getBoundingClientRect();
    const s = Math.max(0.3, Math.min(Math.min(r.width / layout.worldW, r.height / layout.worldH) * 0.94, 1));
    setTf({ s, x: (r.width - layout.worldW * s) / 2, y: (r.height - layout.worldH * s) / 2 });
  }
  useEffect(() => { if (!fitDoneRef.current && projetos.length) { fitDoneRef.current = true; setTimeout(fit, 80); } /* eslint-disable-next-line */ }, [projetos.length, layout.worldW]);
  useEffect(() => {
    const st = stageRef.current; if (!st) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const r = st.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; setTf(p => { const ns = Math.max(0.3, Math.min(p.s * (1 - e.deltaY * 0.0016), 2.4)); return { s: ns, x: mx - (mx - p.x) * (ns / p.s), y: my - (my - p.y) * (ns / p.s) }; }); };
    st.addEventListener("wheel", onWheel, { passive: false });
    return () => st.removeEventListener("wheel", onWheel);
  }, []);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  function onDown(e: React.PointerEvent) { if ((e.target as HTMLElement).closest(".mnode")) return; drag.current = { x: e.clientX, y: e.clientY, tx: tf.x, ty: tf.y }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }
  function onMove(e: React.PointerEvent) { if (!drag.current) return; setTf(p => ({ ...p, x: drag.current!.tx + (e.clientX - drag.current!.x), y: drag.current!.ty + (e.clientY - drag.current!.y) })); }
  function onUp() { drag.current = null; }
  function zoomBtn(dir: "in" | "out") { const st = stageRef.current; if (!st) return; const r = st.getBoundingClientRect(); const mx = r.width / 2, my = r.height / 2; setTf(p => { const ns = Math.max(0.3, Math.min(dir === "in" ? p.s * 1.2 : p.s / 1.2, 2.4)); return { s: ns, x: mx - (mx - p.x) * (ns / p.s), y: my - (my - p.y) * (ns / p.s) }; }); }

  function toggle(nid: string) { setExpanded(prev => { const n = new Set(prev); n.has(nid) ? n.delete(nid) : n.add(nid); return n; }); }
  function expandAll() { const all = new Set<string>(["root"]); const walk = (node: Desc | { type: NType; nid: string }) => { all.add(node.nid); kidsOf(node).forEach(walk); }; walk({ type: "root", nid: "root" }); setExpanded(all); setTimeout(fit, 40); }
  async function toggleTask(t: Tarefa) { if (!podeGerenciar) return; await mudarStatus(t.id, t.status === "concluida" ? "a_fazer" : "concluida", { id: me?.id || "", nome: me?.nome || "—" }); say(t.status === "concluida" ? "↺ Reaberta no Gestor" : "✓ Concluída no Gestor"); }

  function NodeCard({ n }: { n: MNode }) {
    const outward = Math.cos(n.angle) >= 0 ? "right" : "left";
    const tog = n.hasKids ? (
      <button onClick={(e) => { e.stopPropagation(); toggle(n.nid); }}
        className="absolute z-10 w-5 h-5 rounded-full bg-white dark:bg-gray-900 border border-gray-400 dark:border-gray-600 text-xs font-bold text-gray-500 grid place-items-center"
        style={{ top: "50%", [outward]: -10, transform: "translateY(-50%)" }}>{n.open ? "−" : "+"}</button>
    ) : null;

    if (n.type === "root") {
      const all = projetos.flatMap(projTasks); const okc = all.filter(t => t.status === "concluida").length;
      return <div className="rounded-full aspect-square w-[150px] bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 grid place-content-center text-center shadow-xl px-4">
        <div className="font-extrabold text-[13px]">Meus projetos</div>
        <div className="text-[10px] opacity-70 mt-0.5">{projetos.length} · {all.length ? Math.round(okc / all.length * 100) : 0}%</div>
      </div>;
    }
    if (n.type === "proj") {
      const p = n.ref as MapaProjeto; const ts = projTasks(p); const cls = projClass(p);
      return <div className="relative w-[220px] rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-md p-3" style={{ borderLeft: `4px solid ${p.cor}` }}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg grid place-items-center text-white flex-shrink-0" style={{ background: p.cor }}><GitFork size={16} /></div>
          <div className="min-w-0 flex-1"><div className="font-bold text-[13px] leading-tight text-gray-900 dark:text-gray-100 truncate">{p.nome}</div>
            {cls.area && <div className="text-[9.5px] text-gray-500 truncate flex items-center gap-1 mt-0.5"><span className="w-2 h-2 rounded-sm" style={{ background: cls.area.cor }} />{cls.area.nome}{cls.subNome ? ` › ${cls.subNome}` : ""}</div>}
          </div>
          <Ring pct={prog(ts)} c={p.cor} />
        </div>
        <div className="flex gap-1 mt-2">
          <VBtn on={n.open} c={p.cor} onClick={(e) => { e.stopPropagation(); toggle(n.nid); }} label="🕸 Mapa" />
          <VBtn c={p.cor} onClick={(e) => { e.stopPropagation(); setOverlay({ pid: p.id, view: "roadmap", alt: (p.marcos && p.marcos.length ? "marcos" : "tarefas") }); }} label="📅 Roadmap" />
          <VBtn c={p.cor} onClick={(e) => { e.stopPropagation(); setOverlay({ pid: p.id, view: "lista", alt: "tarefas" }); }} label="☰ Lista" />
        </div>
        <div className="text-[10px] text-gray-400 mt-1.5">{ts.length ? `${ts.filter(t => t.status === "concluida").length}/${ts.length} tarefas` : "sem tarefas ainda"}</div>
        {podeGerenciar && <>
          <button onClick={(e) => { e.stopPropagation(); setProjModal({ mode: "edit", proj: p }); }} className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 grid place-items-center text-gray-500 shadow"><Pencil size={11} /></button>
          <button onClick={(e) => { e.stopPropagation(); setTaskModal({ pid: p.id }); }} className="absolute -bottom-2 -right-2 w-6 h-6 rounded-full text-white grid place-items-center shadow" style={{ background: p.cor }} title="Nova tarefa neste projeto"><Plus size={13} /></button>
        </>}
        {tog}
      </div>;
    }
    const t = n.ref as Tarefa; const b = stBucket(t.status); const late = isLate(t);
    return <div onClick={(e) => { e.stopPropagation(); toggleTask(t); }} className={`w-[210px] rounded-xl bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 shadow-sm p-2 px-2.5 flex items-start gap-2 ${t.status === "concluida" ? "opacity-70" : ""}`}>
      <span className="w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0" style={{ background: SC[b] }} />
      <div className="min-w-0 flex-1">
        <div className={`text-[11.5px] font-semibold leading-tight ${t.status === "concluida" ? "line-through text-gray-500" : "text-gray-900 dark:text-gray-100"}`}>{t.titulo}</div>
        <div className="text-[9.5px] text-gray-500 mt-0.5 flex gap-1.5 flex-wrap items-center">
          {t.responsavelNome && <span>{t.responsavelNome}</span>}
          {t.prazo && <span className={late ? "text-rose-600 font-bold" : ""}>📅 {shortD(t.prazo)}</span>}
        </div>
      </div>
    </div>;
  }

  const overlayProj = overlay ? projetos.find(p => p.id === overlay.pid) || null : null;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex-wrap">
        <GitFork size={18} className="text-indigo-500" />
        <div className="font-bold text-[15px]">Mapa de Projetos</div>
        <div className="text-[11px] text-gray-500 hidden sm:block">radial · cada projeto: Mapa · Roadmap · Lista</div>
        <div className="flex-1" />
        <button onClick={expandAll} className="text-[12.5px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">Expandir tudo</button>
        {podeGerenciar && <button onClick={() => setProjModal({ mode: "new" })} className="text-[12.5px] font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white inline-flex items-center gap-1"><Plus size={14} /> Novo projeto</button>}
        <div className="inline-flex items-center gap-0.5 border border-gray-200 dark:border-gray-700 rounded-lg p-0.5 bg-gray-50 dark:bg-gray-900">
          <button onClick={() => zoomBtn("out")} className="w-7 h-7 grid place-items-center rounded-md"><Minus size={14} /></button>
          <span className="text-[11px] text-gray-500 w-9 text-center tabular-nums">{Math.round(tf.s * 100)}%</span>
          <button onClick={() => zoomBtn("in")} className="w-7 h-7 grid place-items-center rounded-md"><Plus size={14} /></button>
          <button onClick={fit} className="w-7 h-7 grid place-items-center rounded-md" title="Centralizar"><Maximize2 size={13} /></button>
        </div>
      </div>

      <div ref={stageRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        className="relative overflow-hidden cursor-grab bg-gray-50 dark:bg-gray-950" style={{ height: stageH }}>
        {projetos.length === 0 ? (
          <div className="absolute inset-0 grid place-content-center text-center px-6">
            <GitFork size={40} className="mx-auto text-gray-300 mb-3" />
            <div className="font-semibold text-gray-700 dark:text-gray-300">Nenhum projeto ainda</div>
            <div className="text-sm text-gray-500 mt-1 max-w-sm">Crie um projeto (dentro de uma área/sub-área) e vá criando/atribuindo tarefas a ele. Só tarefas do projeto aparecem aqui.</div>
            {podeGerenciar && <button onClick={() => setProjModal({ mode: "new" })} className="mt-4 mx-auto text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white inline-flex items-center gap-1"><Plus size={15} /> Criar primeiro projeto</button>}
          </div>
        ) : (
          <div className="absolute top-0 left-0 origin-top-left" style={{ width: layout.worldW, height: layout.worldH, transform: `translate(${tf.x}px,${tf.y}px) scale(${tf.s})` }}>
            <svg width={layout.worldW} height={layout.worldH} className="absolute top-0 left-0 overflow-visible pointer-events-none">
              {Array.from({ length: layout.maxDepth }).map((_, i) => <circle key={i} cx={layout.rootX} cy={layout.rootY} r={RING1 + i * GAP} fill="none" stroke="currentColor" className="text-gray-200 dark:text-gray-800" strokeDasharray="3 6" />)}
              {layout.links.map((l, i) => <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.c} strokeWidth={2} opacity={0.45} />)}
            </svg>
            {layout.visible.map(n => (
              <div key={n.nid} className="mnode absolute cursor-pointer" style={{ left: n.px, top: n.py, transform: "translate(-50%,-50%)" }}
                onClick={() => { if (n.type === "task") return; if (n.hasKids) toggle(n.nid); }}>
                <NodeCard n={n} />
              </div>
            ))}
          </div>
        )}
        <div className="absolute left-1/2 -translate-x-1/2 bottom-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-full px-3.5 py-1.5 text-[11px] text-gray-500 shadow hidden sm:flex gap-3">
          <span>🕸 abre as tarefas</span><span>📅 Roadmap</span><span>☰ Lista</span><span>arraste / scroll</span>
        </div>
      </div>

      {overlayProj && overlay && <ProjOverlay proj={overlayProj} view={overlay.view} alt={overlay.alt}
        setView={(v) => setOverlay(o => o ? { ...o, view: v } : o)} setAlt={(a) => setOverlay(o => o ? { ...o, alt: a } : o)}
        close={() => setOverlay(null)} tasks={projTasks(overlayProj)} cls={projClass(overlayProj)}
        onNovaTarefa={() => setTaskModal({ pid: overlayProj.id })} onToggleTask={toggleTask} podeGerenciar={podeGerenciar}
        onSetMarco={async (tId, mId) => { const tm = { ...(overlayProj.taskMarco || {}) }; if (mId) tm[tId] = mId; else delete tm[tId]; await salvarMapaProjeto({ ...overlayProj, taskMarco: tm }); }} />}

      {projModal && <ProjetoModal mode={projModal.mode} proj={projModal.proj} areas={areas} subs={subs} tarefas={tarefas} me={me} onClose={() => setProjModal(null)} onSay={say} />}
      {taskModal && <NovaTarefaModal proj={projetos.find(p => p.id === taskModal.pid)!} areaById={areaById} subById={subById} me={me} onClose={() => setTaskModal(null)} onSay={say} />}

      {toast && <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-xl z-[70]">{toast}</div>}
    </div>
  );
}

function Ring({ pct, c }: { pct: number; c: string }) {
  const C = 2 * Math.PI * 15, off = C * (1 - pct / 100);
  return <div className="relative w-[34px] h-[34px] flex-shrink-0">
    <svg width="34" height="34" style={{ transform: "rotate(-90deg)" }}><circle cx="17" cy="17" r="15" fill="none" strokeWidth="3.5" className="stroke-gray-200 dark:stroke-gray-800" /><circle cx="17" cy="17" r="15" fill="none" stroke={c} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={off} /></svg>
    <div className="absolute inset-0 grid place-items-center text-[9px] font-extrabold">{pct}%</div>
  </div>;
}
function VBtn({ label, c, on, onClick }: { label: string; c: string; on?: boolean; onClick: (e: React.MouseEvent) => void }) {
  return <button onClick={onClick} className="flex-1 text-[10px] font-bold px-1.5 py-1 rounded-md border transition-colors"
    style={on ? { background: c, color: "#fff", borderColor: "transparent" } : { borderColor: "#e5e7eb", color: "#6b7280", background: "transparent" }}>{label}</button>;
}

// ── Overlay: Roadmap + Lista ─────────────────────────────────────────────────
type OverlayProps = {
  proj: MapaProjeto; view: "roadmap" | "lista"; alt: "marcos" | "tarefas";
  setView: (v: "roadmap" | "lista") => void; setAlt: (a: "marcos" | "tarefas") => void; close: () => void;
  tasks: Tarefa[]; cls: { area?: TarefaProjeto; subNome?: string };
  onNovaTarefa: () => void; onToggleTask: (t: Tarefa) => void; podeGerenciar: boolean; onSetMarco: (tId: string, mId: string) => void;
};
function ProjOverlay(props: OverlayProps) {
  const { proj, view, alt, setView, setAlt, close, tasks, cls } = props;
  const marcos = proj.marcos || [];
  const pc = prog(tasks);
  const datas = [...tasks.map(t => t.prazo).filter(Boolean) as string[], ...marcos.map(m => m.data)];
  const now = new Date();
  let ini = new Date(now.getFullYear(), now.getMonth(), 1);
  let fim = new Date(now.getFullYear(), now.getMonth() + 3, 1);
  if (datas.length) { const ds = datas.map(d => new Date(d)).sort((a, b) => a.getTime() - b.getTime()); ini = new Date(ds[0].getFullYear(), ds[0].getMonth(), 1); const last = ds[ds.length - 1]; fim = new Date(last.getFullYear(), last.getMonth() + 1, 1); if (fim.getTime() - ini.getTime() < 1000 * 3600 * 24 * 60) fim = new Date(ini.getFullYear(), ini.getMonth() + 2, 1); }
  const months: { l: string }[] = []; { const c = new Date(ini); while (c < fim) { months.push({ l: c.toLocaleDateString("pt-BR", { month: "short" }) + " '" + String(c.getFullYear()).slice(2) }); c.setMonth(c.getMonth() + 1); } }
  const span = fim.getTime() - ini.getTime();
  const xF = (d: string) => Math.max(0, Math.min(1, (new Date(d).getTime() - ini.getTime()) / span));
  // lanes na altitude "tarefas": por marco (+ Sem marco)
  const lanes: { id: string; nome: string; ts: Tarefa[] }[] = marcos.length
    ? [...marcos.map(m => ({ id: m.id, nome: m.nome, ts: tasks.filter(t => proj.taskMarco?.[t.id] === m.id) })), { id: "_none", nome: "Sem marco", ts: tasks.filter(t => !proj.taskMarco?.[t.id]) }].filter(l => l.ts.length || l.id !== "_none")
    : [{ id: "_all", nome: "Tarefas", ts: tasks }];

  return <div className="fixed inset-0 z-[60] bg-white dark:bg-gray-950 flex flex-col">
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex-wrap">
      <button onClick={close} className="inline-flex items-center gap-1 text-sm font-semibold px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900"><ArrowLeft size={15} /> Voltar ao mapa</button>
      <div className="w-9 h-9 rounded-lg grid place-items-center text-white" style={{ background: proj.cor }}><GitFork size={18} /></div>
      <div><div className="font-extrabold text-[16px]">{proj.nome}</div><div className="text-[11px] text-gray-500">{cls.area ? `${cls.area.nome}${cls.subNome ? " › " + cls.subNome : ""} · ` : ""}{tasks.length} tarefas · {pc}% feito</div></div>
      <div className="flex-1" />
      {props.podeGerenciar && <button onClick={props.onNovaTarefa} className="text-[12.5px] font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white inline-flex items-center gap-1"><Plus size={14} /> Nova tarefa</button>}
      <div className="inline-flex bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-0.5">
        <TabBtn on={view === "roadmap"} onClick={() => setView("roadmap")}><CalendarDays size={14} /> Roadmap</TabBtn>
        <TabBtn on={view === "lista"} onClick={() => setView("lista")}><ListTree size={14} /> Lista</TabBtn>
      </div>
      <button onClick={close} className="w-9 h-9 grid place-items-center rounded-lg border border-gray-200 dark:border-gray-700"><X size={17} /></button>
    </div>

    <div className="flex-1 overflow-auto p-4">
      {tasks.length === 0 ? (
        <div className="text-center py-16 text-gray-500"><div className="font-semibold">Nenhuma tarefa neste projeto ainda</div><div className="text-sm mt-1">Clique em "Nova tarefa" (ou no + do projeto no mapa).</div></div>
      ) : view === "roadmap" ? (<>
        <div className="inline-flex bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-0.5 mb-4">
          {marcos.length > 0 && <AltBtn on={alt === "marcos"} onClick={() => setAlt("marcos")}>Marcos</AltBtn>}
          <AltBtn on={alt === "tarefas" || marcos.length === 0} onClick={() => setAlt("tarefas")}>Tarefas</AltBtn>
        </div>
        <div className="min-w-[680px]">
          <div className="grid sticky top-0 bg-white dark:bg-gray-950 z-10 pb-1.5 border-b border-gray-200 dark:border-gray-800 mb-2" style={{ gridTemplateColumns: `160px repeat(${months.length},1fr)` }}>
            <div />{months.map((m, i) => <div key={i} className="text-[11px] font-bold text-gray-500 uppercase tracking-wide text-center border-l border-dashed border-gray-200 dark:border-gray-800 py-1 first:border-0">{m.l}</div>)}
          </div>
          {alt === "marcos" && marcos.length > 0 ? (
            <div className="grid items-center" style={{ gridTemplateColumns: "160px 1fr" }}>
              <div className="text-[11px] font-bold text-gray-500 uppercase">Marcos</div>
              <div className="relative h-[80px] border-l border-dashed border-gray-200 dark:border-gray-800">
                {months.map((_, i) => <div key={i} className="absolute top-0 bottom-0 border-l border-dashed border-gray-200 dark:border-gray-800" style={{ left: `${(i / months.length) * 100}%` }} />)}
                {marcos.slice().sort((a, b) => a.data.localeCompare(b.data)).map(mc => {
                  const mts = tasks.filter(t => proj.taskMarco?.[t.id] === mc.id); const mp = prog(mts); const col = mp >= 100 ? "#16a34a" : mp > 0 ? proj.cor : "#94a3b8";
                  return <div key={mc.id} className="absolute top-2 w-[120px] -translate-x-1/2 text-center" style={{ left: `${xF(mc.data) * 100}%` }}>
                    <div className="w-3 h-3 rounded-full mx-auto mb-1 border-2 border-white dark:border-gray-950" style={{ background: col }} />
                    <div className="text-[11px] font-bold">{mc.nome}</div><div className="text-[9.5px] text-gray-500">{shortD(mc.data)} · {mts.filter(t => t.status === "concluida").length}/{mts.length}</div>
                    <div className="h-1.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-800 mt-1 overflow-hidden"><div className="h-full" style={{ width: `${mp}%`, background: col }} /></div>
                  </div>;
                })}
              </div>
            </div>
          ) : (
            lanes.map(lane => <div key={lane.id} className="grid border-b border-gray-200 dark:border-gray-800 min-h-[50px]" style={{ gridTemplateColumns: "160px 1fr" }}>
              <div className="flex items-center gap-2 p-2 text-[12px] font-bold text-gray-700 dark:text-gray-300">{lane.nome}</div>
              <div className="relative border-l border-dashed border-gray-200 dark:border-gray-800">
                {months.map((_, i) => <div key={i} className="absolute top-0 bottom-0 border-l border-dashed border-gray-200 dark:border-gray-800" style={{ left: `${(i / months.length) * 100}%` }} />)}
                {marcos.map(mc => <div key={mc.id} className="absolute top-0 bottom-0 border-l-2 border-dotted" style={{ left: `${xF(mc.data) * 100}%`, borderColor: proj.cor, opacity: .4 }} />)}
                {lane.ts.slice().sort((a, b) => (a.prazo || "").localeCompare(b.prazo || "")).map((t, i) => { const done = t.status === "concluida", late = isLate(t); return <div key={t.id} onClick={() => props.onToggleTask(t)} title={`${t.titulo} · ${shortD(t.prazo)}`} className="absolute h-[22px] -translate-y-1/2 rounded-lg text-[10px] font-bold text-white flex items-center px-2 whitespace-nowrap overflow-hidden shadow cursor-pointer max-w-[240px]" style={{ left: `calc(${xF(t.prazo || new Date().toISOString()) * 100}% - 4px)`, top: `calc(50% + ${(i % 2 ? 14 : -14)}px)`, background: done ? "#16a34a" : late ? "#e11d48" : proj.cor, opacity: done ? .65 : 1 }}>{done ? "✓ " : late ? "⚠ " : ""}{t.titulo}</div>; })}
              </div>
            </div>)
          )}
        </div>
      </>) : (
        <div className="max-w-[760px]">
          {lanes.map(lane => <div key={lane.id} className="mb-3">
            {(marcos.length > 0) && <div className="text-[11px] font-bold text-gray-500 uppercase mb-1">{lane.nome}</div>}
            <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
              {lane.ts.length === 0 ? <div className="text-xs text-gray-400 p-3">—</div> : lane.ts.map((t, i) => { const b = stBucket(t.status); const late = isLate(t); return (
                <div key={t.id} className={`flex items-start gap-2 px-3 py-2 ${i ? "border-t border-gray-100 dark:border-gray-800" : ""}`}>
                  <button onClick={() => props.onToggleTask(t)} className="w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: SC[b] }} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-[12.5px] font-semibold ${t.status === "concluida" ? "line-through text-gray-500" : ""}`}>{t.titulo}</div>
                    <div className="text-[10.5px] text-gray-500 mt-0.5 flex gap-2 flex-wrap items-center">
                      {t.responsavelNome && <span>{t.responsavelNome}</span>}
                      {t.prazo && <span className={late ? "text-rose-600 font-bold" : ""}>📅 {fmtBR(t.prazo)}</span>}
                      {marcos.length > 0 && <select value={proj.taskMarco?.[t.id] || ""} onChange={(e) => props.onSetMarco(t.id, e.target.value)} className="text-[10px] border border-gray-200 dark:border-gray-700 rounded px-1 py-0.5 bg-transparent">
                        <option value="">— marco —</option>{marcos.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                      </select>}
                    </div>
                  </div>
                </div>); })}
            </div>
          </div>)}
        </div>
      )}
    </div>
  </div>;
}

function TabBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) { return <button onClick={onClick} className={`inline-flex items-center gap-1.5 text-[12.5px] font-bold px-3 py-1.5 rounded-md ${on ? "bg-white dark:bg-gray-800 shadow text-gray-900 dark:text-gray-100" : "text-gray-500"}`}>{children}</button>; }
function AltBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) { return <button onClick={onClick} className={`text-[12px] font-bold px-3 py-1.5 rounded-md ${on ? "bg-white dark:bg-gray-800 shadow text-gray-900 dark:text-gray-100" : "text-gray-500"}`}>{children}</button>; }

// ── Modal: criar/editar projeto ──────────────────────────────────────────────
function ProjetoModal(props: { mode: "new" | "edit"; proj?: MapaProjeto; areas: TarefaProjeto[]; subs: TarefaSubprojeto[]; tarefas: Tarefa[]; me: ReturnType<typeof useAuth>["pessoa"]; onClose: () => void; onSay: (m: string) => void }) {
  const { mode, proj, areas, subs, tarefas, me, onClose, onSay } = props;
  const [nome, setNome] = useState(proj?.nome || "");
  const [cor, setCor] = useState(proj?.cor || PALETA[0]);
  const [areaId, setAreaId] = useState(proj?.areaId || "");
  const [subareaId, setSubareaId] = useState(proj?.subareaId || "");
  const [marcos, setMarcos] = useState<MapaMarco[]>(proj?.marcos || []);
  const [busca, setBusca] = useState("");
  // tarefas atualmente neste projeto + edições de vínculo
  const [inc, setInc] = useState<Set<string>>(new Set(proj ? tarefas.filter(t => t.projetoMapaId === proj.id).map(t => t.id) : []));

  const areasOrd = useMemo(() => areas.slice().sort((a, b) => (a.nome || "").localeCompare(b.nome || "")), [areas]);
  const subsDaArea = useMemo(() => subs.filter(s => s.projetoId === areaId), [subs, areaId]);
  const candidatas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return tarefas.filter(t => t.status !== "cancelada" && !t.deletadoEm)
      .filter(t => q ? t.titulo.toLowerCase().includes(q) : (areaId ? t.projetoId === areaId : true))
      .slice(0, 60);
  }, [tarefas, busca, areaId]);

  function toggleTask(id: string) { setInc(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  async function salvar() {
    if (!nome.trim()) return;
    const now = new Date().toISOString();
    const p: MapaProjeto = {
      id: proj?.id || uid(), nome: nome.trim(), cor, areaId: areaId || undefined, subareaId: subareaId || undefined,
      marcos, taskMarco: proj?.taskMarco || {}, ownerId: proj?.ownerId || me?.id || "", ownerNome: me?.nome,
      ordem: proj?.ordem ?? Date.now(), ativo: true, criadoEm: proj?.criadoEm || now, criadoPor: proj?.criadoPor || (me?.id || ""),
    };
    try {
      await salvarMapaProjeto(p);
      // aplica vínculos de tarefa (projetoMapaId) que mudaram
      const antes = new Set(tarefas.filter(t => t.projetoMapaId === p.id).map(t => t.id));
      const autor = { id: me?.id || "", nome: me?.nome || "—" };
      const ops: Promise<unknown>[] = [];
      inc.forEach(id => { if (!antes.has(id)) ops.push(atualizarTarefa(id, { projetoMapaId: p.id }, autor)); });
      antes.forEach(id => { if (!inc.has(id)) ops.push(atualizarTarefa(id, { projetoMapaId: null }, autor)); });
      await Promise.all(ops);
      onSay(mode === "new" ? "✓ Projeto criado" : "✓ Projeto salvo"); onClose();
    } catch (e) { console.error("[MapaProjetos] salvar projeto", e, p); alert("Não consegui salvar: " + (e instanceof Error ? e.message : String(e))); }
  }
  async function excluir() { if (!proj) return; if (!confirm(`Excluir o projeto "${proj.nome}"? As tarefas do Gestor continuam (só perdem o vínculo).`)) return; try { const autor = { id: me?.id || "", nome: me?.nome || "—" }; await Promise.all(tarefas.filter(t => t.projetoMapaId === proj.id).map(t => atualizarTarefa(t.id, { projetoMapaId: null }, autor))); await excluirMapaProjeto(proj.id); onSay("Projeto excluído"); onClose(); } catch (e) { alert("Falha ao excluir: " + (e instanceof Error ? e.message : String(e))); } }

  return <div className="fixed inset-0 z-[80] bg-black/40 grid place-items-center p-4" onClick={onClose}>
    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-[560px] max-w-full max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
      <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center gap-2"><div className="font-extrabold text-[15px]">{mode === "new" ? "Novo projeto" : "Editar projeto"}</div><div className="flex-1" /><button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-lg bg-gray-100 dark:bg-gray-800"><X size={16} /></button></div>
      <div className="p-4 overflow-auto space-y-4">
        <div><label className="text-[11px] font-bold text-gray-500 uppercase">Nome</label>
          <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex.: Abrir pro 1º cliente" className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm" autoFocus /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="text-[11px] font-bold text-gray-500 uppercase">Área</label>
            <select value={areaId} onChange={e => { setAreaId(e.target.value); setSubareaId(""); }} className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm h-9">
              <option value="">— escolher área —</option>{areasOrd.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
            </select></div>
          <div><label className="text-[11px] font-bold text-gray-500 uppercase">Sub-área <span className="text-gray-400 normal-case">(opcional)</span></label>
            <select value={subareaId} onChange={e => setSubareaId(e.target.value)} disabled={!areaId} className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm h-9 disabled:opacity-50">
              <option value="">— nenhuma —</option>{subsDaArea.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select></div>
        </div>
        <div><label className="text-[11px] font-bold text-gray-500 uppercase">Cor</label>
          <div className="flex gap-1.5 mt-1 flex-wrap">{PALETA.map(c => <button key={c} onClick={() => setCor(c)} className={`w-7 h-7 rounded-full ${cor === c ? "ring-2 ring-offset-2 ring-gray-400 dark:ring-offset-gray-900" : ""}`} style={{ background: c }} />)}</div></div>
        <div><label className="text-[11px] font-bold text-gray-500 uppercase">Tarefas neste projeto <span className="text-gray-400 normal-case">(marque pra vincular)</span></label>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder={areaId ? "🔍 buscar em todas, ou veja as da área abaixo…" : "🔍 buscar tarefa por nome…"} className="w-full mt-1 mb-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm" />
          <div className="max-h-52 overflow-auto space-y-1 border border-gray-100 dark:border-gray-800 rounded-lg p-2">
            {candidatas.length === 0 && <div className="text-xs text-gray-500 p-2">Nenhuma tarefa. Você pode criar tarefas direto pelo botão + do projeto no mapa.</div>}
            {candidatas.map(t => { const on = inc.has(t.id); const outro = t.projetoMapaId && t.projetoMapaId !== proj?.id; return (
              <button key={t.id} onClick={() => toggleTask(t.id)} className={`w-full text-left flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${on ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40" : "border-gray-200 dark:border-gray-700"}`}>
                <span className={`w-4 h-4 rounded border grid place-items-center text-[10px] ${on ? "bg-indigo-600 text-white border-indigo-600" : "border-gray-300"}`}>{on ? "✓" : ""}</span>
                <span className="text-[12px] flex-1 truncate">{t.titulo}</span>
                {outro && <span className="text-[9px] text-amber-600">em outro projeto</span>}
              </button>); })}
          </div>
          <div className="text-[11px] text-gray-500 mt-1">{inc.size} tarefa(s) vinculada(s)</div></div>
        <div><label className="text-[11px] font-bold text-gray-500 uppercase">Marcos (roadmap) — opcional</label>
          <div className="space-y-1.5 mt-1">
            {marcos.map((m, i) => <div key={m.id} className="flex gap-1.5 items-center">
              <input value={m.nome} onChange={e => setMarcos(ms => ms.map((x, j) => j === i ? { ...x, nome: e.target.value } : x))} placeholder="Nome do marco" className="flex-1 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm" />
              <input type="date" value={m.data} onChange={e => setMarcos(ms => ms.map((x, j) => j === i ? { ...x, data: e.target.value } : x))} className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm" />
              <button onClick={() => setMarcos(ms => ms.filter((_, j) => j !== i))} className="w-7 h-7 grid place-items-center rounded-lg text-rose-500"><Trash2 size={14} /></button>
            </div>)}
            <button onClick={() => setMarcos(ms => [...ms, { id: uid(), nome: "", data: new Date().toISOString().slice(0, 10) }])} className="text-[12px] font-semibold text-indigo-600 inline-flex items-center gap-1"><Plus size={13} /> Adicionar marco</button>
          </div></div>
      </div>
      <div className="p-4 border-t border-gray-200 dark:border-gray-800 flex gap-2">
        {mode === "edit" && <button onClick={excluir} className="px-3 py-2 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 text-sm font-semibold inline-flex items-center gap-1"><Trash2 size={14} /> Excluir</button>}
        <div className="flex-1" /><button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold">Cancelar</button>
        <button onClick={salvar} disabled={!nome.trim()} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-bold disabled:opacity-50">Salvar</button>
      </div>
    </div>
  </div>;
}

// ── Modal: nova tarefa (grava no Gestor já vinculada ao projeto) ─────────────
function NovaTarefaModal(props: { proj: MapaProjeto; areaById: Map<string, TarefaProjeto>; subById: Map<string, TarefaSubprojeto>; me: ReturnType<typeof useAuth>["pessoa"]; onClose: () => void; onSay: (m: string) => void }) {
  const { proj, areaById, subById, me, onClose, onSay } = props;
  const area = proj.areaId ? areaById.get(proj.areaId) : undefined;
  const subNome = proj.subareaId ? subById.get(proj.subareaId)?.nome : undefined;
  const [titulo, setTitulo] = useState("");
  const [prazo, setPrazo] = useState("");
  const [prio, setPrio] = useState<Tarefa["prioridade"]>("normal");
  const [salvando, setSalvando] = useState(false);
  async function criar() {
    if (!titulo.trim()) return;
    if (!proj.areaId) { alert("Defina a Área do projeto antes de criar tarefas (edite o projeto)."); return; }
    setSalvando(true);
    try {
      await criarTarefa({
        projetoId: proj.areaId, subprojetoId: proj.subareaId || "", titulo: titulo.trim(),
        responsavelId: me?.id || "", responsavelNome: me?.nome, prazo: prazo || null,
        status: "a_fazer", prioridade: prio, origem: "manual", projetoMapaId: proj.id,
        criadoPor: me?.id || "", criadoPorNome: me?.nome,
      } as Omit<Tarefa, "id" | "criadoEm" | "atualizadoEm">);
      onSay("✓ Tarefa criada no Gestor"); onClose();
    } catch (e) { alert("Não consegui criar a tarefa: " + (e instanceof Error ? e.message : String(e))); setSalvando(false); }
  }
  return <div className="fixed inset-0 z-[80] bg-black/40 grid place-items-center p-4" onClick={onClose}>
    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-[400px] max-w-full p-5" onClick={e => e.stopPropagation()}>
      <div className="font-extrabold text-[15px]">Nova tarefa</div>
      <div className="text-[11.5px] text-gray-500 mb-3">no projeto <b>{proj.nome}</b>{area ? ` · ${area.nome}${subNome ? " › " + subNome : ""}` : ""}</div>
      <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="O que precisa ser feito?" autoFocus className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm mb-2" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
        <input type="date" value={prazo} onChange={e => setPrazo(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm" />
        <select value={prio} onChange={e => setPrio(e.target.value as Tarefa["prioridade"])} className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm">
          <option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option>
        </select>
      </div>
      <div className="flex gap-2 justify-end"><button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold">Cancelar</button>
        <button onClick={criar} disabled={!titulo.trim() || salvando} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-bold disabled:opacity-50">Criar no Gestor</button></div>
      <div className="text-[10.5px] text-gray-400 mt-3 text-center">grava em <b>tarefas</b> (Gestor) já vinculada a este projeto</div>
    </div>
  </div>;
}
