// Padroniza os emissores das notas: agrupa o que é o mesmo fornecedor (mesmo
// CNPJ, erro de digitação, abreviação — a IA refina os casos difíceis) e aplica
// um nome canônico em massa. Limpa a fonte que alimenta as Contagens.
import { useMemo, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { Sparkles, Check, Wand2 } from "lucide-react";
import { db, auth } from "../../core/firebase/config";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import type { RecebimentoNota } from "../../core/types";

const norm = (s?: string | null) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const titulo = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase().split(" ").map((p) => /\d/.test(p) ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
function lev(a: string, b: string): number {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}

type Emissor = { nome: string; cnpjs: Set<string>; notaIds: string[]; count: number };
type Cluster = { canonico: string; membros: Emissor[]; count: number; cnpjs: Set<string>; norm: string };

export function PadronizarFornecedoresModal({ recebimentos, onClose }: { recebimentos: RecebimentoNota[]; onClose: () => void }) {
  const emissores = useMemo(() => {
    const m = new Map<string, Emissor>();
    for (const n of recebimentos) {
      const raw = (n.emissor || "").trim(); if (!raw) continue;
      const e = m.get(raw) || { nome: raw, cnpjs: new Set<string>(), notaIds: [], count: 0 };
      if (n.cnpjEmissor) e.cnpjs.add(String(n.cnpjEmissor)); e.notaIds.push(n.id); e.count++;
      m.set(raw, e);
    }
    return [...m.values()];
  }, [recebimentos]);

  const clusterInicial = useMemo(() => clusterizar(emissores), [emissores]);
  const [clusters, setClusters] = useState<Cluster[]>(clusterInicial);
  const [override, setOverride] = useState<Record<number, string>>({});
  const [iaCarregando, setIaCarregando] = useState(false);
  const [aplicando, setAplicando] = useState<number | "todos" | null>(null);
  const [feitos, setFeitos] = useState<Set<number>>(new Set());
  const [erro, setErro] = useState("");

  const canonDe = (c: Cluster, i: number) => override[i] ?? c.canonico;
  // Só mostra o que muda algo (2+ grafias, ou o canônico difere do nome cru).
  const acionaveis = clusters.map((c, i) => ({ c, i })).filter(({ c }) => c.membros.length > 1 || c.membros.some((m) => m.nome !== c.canonico));

  async function refinarIa() {
    setIaCarregando(true); setErro("");
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const r = await fetch("/api/fornecedores-agrupar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        idToken, fornecedores: emissores.map((e) => ({ nome: e.nome, cnpj: [...e.cnpjs][0] || "" })),
      }) });
      const j = await r.json() as { grupos?: Array<{ canonico: string; membros: string[] }>; error?: string };
      if (!r.ok || !Array.isArray(j.grupos)) { setErro(j.error || "Falha na IA."); return; }
      const porNome = new Map(emissores.map((e) => [e.nome, e]));
      const novos: Cluster[] = [];
      const usados = new Set<string>();
      for (const g of j.grupos) {
        const membros = (g.membros || []).map((nm) => porNome.get(nm)).filter((x): x is Emissor => !!x);
        if (!membros.length) continue;
        for (const mm of membros) usados.add(mm.nome);
        const cnpjs = new Set<string>(); for (const mm of membros) for (const c of mm.cnpjs) cnpjs.add(c);
        novos.push({ canonico: titulo(g.canonico || membros[0].nome), membros: membros.sort((a, b) => b.count - a.count), count: membros.reduce((s, x) => s + x.count, 0), cnpjs, norm: norm(g.canonico) });
      }
      for (const e of emissores) if (!usados.has(e.nome)) novos.push({ canonico: titulo(e.nome), membros: [e], count: e.count, cnpjs: e.cnpjs, norm: norm(e.nome) });
      setClusters(novos.sort((a, b) => b.membros.length - a.membros.length || b.count - a.count));
      setOverride({}); setFeitos(new Set());
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro"); } finally { setIaCarregando(false); }
  }

  async function aplicar(c: Cluster, i: number) {
    const canonico = canonDe(c, i).trim(); if (!canonico) return;
    setAplicando(i); setErro("");
    try {
      for (const mm of c.membros) if (mm.nome !== canonico) for (const id of mm.notaIds) await updateDoc(doc(db, "recebimentos", id), { emissor: canonico });
      setFeitos((s) => new Set(s).add(i));
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao aplicar"); } finally { setAplicando(null); }
  }
  async function aplicarTodos() {
    setAplicando("todos");
    for (const { c, i } of acionaveis) if (!feitos.has(i)) await aplicar(c, i);
    setAplicando(null);
  }

  return (
    <Modal title="Padronizar fornecedores" onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-xs text-gray-500 dark:text-gray-400 flex-1">Junta os emissores que são o mesmo fornecedor (CNPJ igual, erro de digitação, abreviação) e aplica um nome único nas notas. {emissores.length} emissores → {acionaveis.length} grupo(s) a revisar.</p>
          <Button size="sm" variant="secondary" disabled={iaCarregando} onClick={() => void refinarIa()}><span className="inline-flex items-center gap-1.5"><Wand2 size={14} /> {iaCarregando ? "Analisando…" : "Refinar com IA"}</span></Button>
        </div>
        {erro && <div className="text-sm text-rose-600">{erro}</div>}

        {acionaveis.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">Nada pra padronizar — os emissores já estão consistentes. Use "Refinar com IA" pra pegar abreviações/nomes diferentes.</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto space-y-2">
            {acionaveis.map(({ c, i }) => (
              <div key={i} className={`rounded-xl border p-3 ${feitos.has(i) ? "border-emerald-300 bg-emerald-50/40 dark:border-emerald-800 dark:bg-emerald-900/10" : "border-gray-200 dark:border-gray-800"}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <label className="text-[10px] uppercase tracking-wide text-gray-400">Nome final</label>
                    <Input value={canonDe(c, i)} onChange={(e) => setOverride((o) => ({ ...o, [i]: e.target.value }))} />
                  </div>
                  {feitos.has(i)
                    ? <span className="text-xs font-semibold text-emerald-600 inline-flex items-center gap-1 mt-4"><Check size={14} /> aplicado</span>
                    : <Button size="sm" disabled={aplicando !== null} onClick={() => void aplicar(c, i)}>{aplicando === i ? "Aplicando…" : "Aplicar"}</Button>}
                </div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5 flex flex-wrap gap-1.5">
                  {c.membros.map((m) => <span key={m.nome} className={`px-1.5 py-0.5 rounded ${m.nome === canonDe(c, i) ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300" : "bg-gray-100 dark:bg-gray-800"}`} title={`${m.count} nota(s)${m.cnpjs.size ? " · CNPJ " + [...m.cnpjs][0] : ""}`}>{m.nome} ({m.count})</span>)}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-between items-center pt-3 border-t border-gray-200 dark:border-gray-800">
          <span className="text-[11px] text-gray-400 inline-flex items-center gap-1"><Sparkles size={11} /> aplicar renomeia o emissor em todas as notas do grupo</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Fechar</Button>
            <Button disabled={aplicando !== null || acionaveis.length === 0} onClick={() => void aplicarTodos()}>{aplicando === "todos" ? "Aplicando…" : "Aplicar todos"}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function clusterizar(emissores: Emissor[]): Cluster[] {
  const clusters: Cluster[] = [];
  for (const e of emissores.slice().sort((a, b) => b.count - a.count)) {
    const eNorm = norm(e.nome);
    const alvo = clusters.find((c) => {
      if (c.cnpjs.size && [...e.cnpjs].some((x) => c.cnpjs.has(x))) return true;
      const d = lev(eNorm, c.norm); const lim = Math.max(eNorm.length, c.norm.length);
      return lim >= 6 && d <= 2 && d / lim <= 0.2;
    });
    if (alvo) { alvo.membros.push(e); alvo.count += e.count; for (const x of e.cnpjs) alvo.cnpjs.add(x); }
    else clusters.push({ canonico: "", membros: [e], count: e.count, cnpjs: new Set(e.cnpjs), norm: eNorm });
  }
  for (const c of clusters) { const melhor = c.membros.slice().sort((a, b) => b.count - a.count || b.nome.length - a.nome.length)[0]; c.canonico = titulo(melhor.nome); c.membros.sort((a, b) => b.count - a.count); }
  return clusters;
}
