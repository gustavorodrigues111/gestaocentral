// Download de Apps (master) — catálogo dos apps desktop do grupo pra baixar.
// Master cadastra app (nome, versão, auto-update, arquivos por plataforma + URL)
// e qualquer master baixa por aqui. URLs apontam pros instaladores (ex.: feed
// /pdv-update/ ou /painel-update/ no Storage).
import { useEffect, useMemo, useState } from "react";
import { Download, Plus, Trash2, Pencil, Check, X, MonitorDown, Lock, RefreshCw, Apple, Monitor } from "lucide-react";
import { useAuth } from "../../core/auth/AuthContext";
import { PageContainer } from "../../core/ui/PageContainer";
import type { DownloadApp, DownloadAppArquivo } from "../../core/types";
import * as repo from "./appsDownloadRepo";
import { uid } from "./appsDownloadRepo";
import { EstacoesPainel } from "./EstacoesPainel";

const INPUT = "w-full h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm";
const hoje = () => new Date().toISOString();
const PLAT: { v: DownloadAppArquivo["plataforma"]; label: string }[] = [
  { v: "windows", label: "Windows" }, { v: "mac", label: "macOS" }, { v: "outro", label: "Outro" },
];
const PlatIcon = ({ p }: { p: string }) => p === "mac" ? <Apple size={15} /> : p === "windows" ? <Monitor size={15} /> : <MonitorDown size={15} />;

export function AppsDownloadPage() {
  const { pessoa: me } = useAuth();
  const isMaster = !!me?.isMaster;
  const [apps, setApps] = useState<DownloadApp[]>([]);
  const [editId, setEditId] = useState<string | null>(null);

  useEffect(() => { if (!isMaster) return; return repo.ouvirApps(setApps); }, [isMaster]);

  if (!isMaster) {
    return <PageContainer><div className="max-w-md mx-auto py-20 text-center text-gray-500"><Lock size={40} className="mx-auto mb-3 text-gray-400" />Só o master acessa o Download de Apps.</div></PageContainer>;
  }

  function novo() {
    const a: DownloadApp = { id: uid(), nome: "", descricao: "", icone: "monitor", versao: "", autoUpdate: true, ativo: true, ordem: apps.length, arquivos: [], criadoEm: hoje() };
    setApps((p) => [...p, a]); setEditId(a.id);
  }

  return (
    <PageContainer>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 flex items-center justify-center"><Download size={18} /></div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold leading-tight">Download de Apps</h1>
          <p className="text-xs text-gray-500">Apps desktop do grupo · auto-update embutido</p>
        </div>
        <button className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-indigo-600 text-white text-sm font-semibold" onClick={novo}><Plus size={16} /> Novo app</button>
      </div>

      <div className="space-y-3 mt-3">
        {apps.length === 0 && <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">Nenhum app cadastrado. Clique em <b>Novo app</b>.</div>}
        {apps.map((a) => editId === a.id
          ? <Editor key={a.id} app={a} onCancel={() => { setEditId(null); if (!a.nome) setApps((p) => p.filter((x) => x.id !== a.id)); }} onSaved={() => setEditId(null)} />
          : <AppCard key={a.id} app={a} onEdit={() => setEditId(a.id)} />)}
      </div>

      <EstacoesPainel />
    </PageContainer>
  );
}

function AppCard({ app, onEdit }: { app: DownloadApp; onEdit: () => void }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 grid place-items-center shrink-0"><MonitorDown size={22} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-semibold">{app.nome || "—"}</h2>
            {app.versao && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">v{app.versao}</span>}
            {app.autoUpdate && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 inline-flex items-center gap-1"><RefreshCw size={11} /> auto-update</span>}
            {!app.ativo && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-600">inativo</span>}
          </div>
          {app.descricao && <p className="text-sm text-gray-500 mt-0.5">{app.descricao}</p>}
          <div className="flex flex-wrap gap-2 mt-3">
            {app.arquivos.length === 0 && <span className="text-xs text-gray-400 italic">Sem arquivo pra download.</span>}
            {app.arquivos.map((f, i) => (
              <a key={i} href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold">
                <PlatIcon p={f.plataforma} /> {f.label || `Baixar ${PLAT.find((p) => p.v === f.plataforma)?.label || f.plataforma}`}
              </a>
            ))}
          </div>
        </div>
        <button className="text-gray-400 hover:text-indigo-600 shrink-0" onClick={onEdit} title="Editar"><Pencil size={16} /></button>
      </div>
    </div>
  );
}

function Editor({ app, onCancel, onSaved }: { app: DownloadApp; onCancel: () => void; onSaved: () => void }) {
  const [f, setF] = useState<DownloadApp>(app);
  const [salvando, setSalvando] = useState(false);
  const set = (patch: Partial<DownloadApp>) => setF((p) => ({ ...p, ...patch }));
  const setArq = (i: number, patch: Partial<DownloadAppArquivo>) => set({ arquivos: f.arquivos.map((a, j) => j === i ? { ...a, ...patch } : a) });
  const addArq = () => set({ arquivos: [...f.arquivos, { plataforma: "windows", label: "", url: "" }] });
  const rmArq = (i: number) => set({ arquivos: f.arquivos.filter((_, j) => j !== i) });
  const podeSalvar = useMemo(() => f.nome.trim().length > 0, [f.nome]);
  async function salvar() {
    setSalvando(true);
    await repo.salvarApp({ ...f, nome: f.nome.trim(), arquivos: f.arquivos.filter((a) => a.url.trim()).map((a) => ({ ...a, url: a.url.trim(), label: (a.label || "").trim() || null }) ) });
    setSalvando(false); onSaved();
  }

  return (
    <div className="rounded-2xl border border-indigo-300 dark:border-indigo-800 bg-white dark:bg-gray-900 p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input className={INPUT} placeholder="Nome do app *" value={f.nome} onChange={(e) => set({ nome: e.target.value })} />
        <input className={INPUT} placeholder="Versão (ex.: 1.0.0)" value={f.versao || ""} onChange={(e) => set({ versao: e.target.value })} />
      </div>
      <textarea className={`${INPUT} h-auto py-2`} rows={2} placeholder="Descrição (o que o app faz)" value={f.descricao || ""} onChange={(e) => set({ descricao: e.target.value })} />
      <div className="flex items-center gap-4 text-sm">
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!f.autoUpdate} onChange={(e) => set({ autoUpdate: e.target.checked })} /> Auto-update</label>
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={f.ativo} onChange={(e) => set({ ativo: e.target.checked })} /> Ativo</label>
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Arquivos de download</div>
        <div className="space-y-2">
          {f.arquivos.map((a, i) => (
            <div key={i} className="flex gap-2 items-center">
              <select className={`${INPUT} w-28 shrink-0`} value={a.plataforma} onChange={(e) => setArq(i, { plataforma: e.target.value as DownloadAppArquivo["plataforma"] })}>
                {PLAT.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
              </select>
              <input className={INPUT} placeholder="URL do instalador (https://…)" value={a.url} onChange={(e) => setArq(i, { url: e.target.value })} />
              <button className="text-gray-400 hover:text-rose-600 shrink-0" onClick={() => rmArq(i)}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
        <button className="mt-2 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-600 text-sm" onClick={addArq}><Plus size={14} /> Arquivo</button>
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <button className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-600 text-sm" onClick={onCancel}><X size={15} /> Cancelar</button>
        <button className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50" disabled={!podeSalvar || salvando} onClick={() => void salvar()}><Check size={15} /> {salvando ? "Salvando…" : "Salvar"}</button>
      </div>
      {app.arquivos.length === 0 && <div className="text-[11px] text-gray-400">Dica: o instalador do Windows fica no feed de update (ex.: <code>https://comandas.planejamento.app/pdv-update/&lt;arquivo&gt;.exe</code>).</div>}
    </div>
  );
}
