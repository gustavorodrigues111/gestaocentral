import { useMemo, useState, type ReactNode } from "react";
import { Building2, Smartphone, Mail, MessageSquare, Ban, Check, GitMerge, Sparkles, ChevronRight, Pencil, Clock, Package, FileText, User, Search } from "lucide-react";
import { authHeader } from "../../core/firebase/idToken";
import { addDoc, collection, deleteDoc, doc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAbrirWhatsapp } from "../../core/whatsapp/roteios";
import { normalizar, tituloCaso, levenshtein } from "../contagens/sugestoesRecebimento";
import type { Fornecedor, Insumo } from "../../core/types";

type Props = {
  fornecedores: Fornecedor[];
  insumos?: Insumo[];
  restaurantId: string;
  podeConfig: boolean;
  emissoresNota?: { emissor?: string; cnpjEmissor?: string }[];
};

export function FornecedoresTab({ fornecedores, insumos = [], restaurantId, podeConfig, emissoresNota = [] }: Props) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Fornecedor | "new" | null>(null);
  const [prefill, setPrefill] = useState<{ nome?: string; cnpj?: string } | null>(null);
  const [verSugestoes, setVerSugestoes] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [selMode, setSelMode] = useState(false);                         // modo "mesclar manual"
  const [selIds, setSelIds] = useState<Set<string>>(new Set());          // fornecedores marcados
  const [mergeAlvo, setMergeAlvo] = useState<Fornecedor[] | null>(null);  // selecionados no modal de escolha do principal
  const [sobrevSel, setSobrevSel] = useState<string>("");                // id do fornecedor que sobrevive
  const [viewing, setViewing] = useState<Fornecedor | null>(null);       // modal de visualização (clica na linha)
  const abrirWhatsapp = useAbrirWhatsapp();

  // Clusters de possíveis DUPLICADOS: mesmo nome normalizado (caixa/acento) OU
  // muito parecido (1-2 letras, ex.: "Sobrinho" vs "Sorrinho").
  const duplicados = useMemo(() => {
    const fs = fornecedores;
    if (fs.length < 2) return [] as Fornecedor[][];
    const norm = fs.map(f => normalizar(f.nome));
    const parent = fs.map((_, i) => i);
    const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
      const a = norm[i], b = norm[j];
      if (a === b) { parent[find(i)] = find(j); continue; }   // idêntico (caixa/acento)
      const lim = Math.max(a.length, b.length);
      if (lim >= 5 && levenshtein(a, b) <= 2 && levenshtein(a, b) / lim <= 0.25) parent[find(i)] = find(j);
    }
    const m = new Map<number, Fornecedor[]>();
    fs.forEach((f, i) => { const r = find(i); (m.get(r) || m.set(r, []).get(r)!).push(f); });
    return [...m.values()].filter(c => c.length >= 2);
  }, [fornecedores]);

  // Nomes fora do padrão (não são "Primeira Maiúscula") — pra o botão Padronizar.
  const foraPadrao = useMemo(() => fornecedores.filter(f => f.nome !== tituloCaso(f.nome)), [fornecedores]);

  // Sugestões a partir dos emissores das notas de recebimento. Duas coisas:
  //  • sugNovos: quem já emitiu NF mas NÃO é fornecedor (nem por CNPJ nem por
  //    nome). Agrupa por CNPJ quando existe (colapsa variações de OCR do mesmo
  //    CNPJ num só), senão por nome normalizado.
  //  • sugCnpj: emissor cujo nome bate (igual ou parecido) com um fornecedor JÁ
  //    cadastrado que ainda NÃO tem CNPJ → sugere preencher o CNPJ visto na nota.
  const { sugNovos, sugCnpj } = useMemo(() => {
    const fornNorm = fornecedores.map(f => ({ f, n: normalizar(f.nome) }));
    const fornPorCnpj = new Map<string, Fornecedor>();
    for (const f of fornecedores) { const c = onlyDigits(f.cnpj || ""); if (c.length === 14) fornPorCnpj.set(c, f); }

    type Agg = { cnpj: string; count: number; nomes: Map<string, number> };
    const byKey = new Map<string, Agg>();
    for (const e of emissoresNota) {
      const nomeRaw = (e.emissor || "").trim();
      const cnpj = onlyDigits(e.cnpjEmissor || "");
      const temCnpj = cnpj.length === 14;
      const chaveNome = normalizar(nomeRaw);
      if (!temCnpj && !chaveNome) continue;
      const key = temCnpj ? `c:${cnpj}` : `n:${chaveNome}`;
      let a = byKey.get(key);
      if (!a) { a = { cnpj: temCnpj ? cnpj : "", count: 0, nomes: new Map() }; byKey.set(key, a); }
      a.count++;
      if (!a.cnpj && temCnpj) a.cnpj = cnpj;
      if (nomeRaw) a.nomes.set(nomeRaw, (a.nomes.get(nomeRaw) || 0) + 1);
    }

    // Fornecedor cadastrado compatível com QUALQUER variante do nome (igual
    // normalizado ou muito parecido por Levenshtein — pega erro de OCR).
    const acharForn = (nomes: string[]): Fornecedor | null => {
      const alvos = nomes.map(normalizar).filter(Boolean);
      for (const { f, n } of fornNorm) if (alvos.includes(n)) return f;
      for (const alvo of alvos) for (const { f, n } of fornNorm) {
        const lim = Math.max(alvo.length, n.length);
        if (lim >= 5 && levenshtein(alvo, n) <= 2 && levenshtein(alvo, n) / lim <= 0.25) return f;
      }
      return null;
    };
    const melhorNome = (nomes: Map<string, number>): string => {
      let best = ""; let bc = -1;
      for (const [nm, c] of nomes) if (c > bc || (c === bc && nm.length > best.length)) { best = nm; bc = c; }
      return tituloCaso(best);
    };

    const novos: { nome: string; cnpj: string; count: number }[] = [];
    const cnpjPara: { forn: Fornecedor; cnpj: string; count: number }[] = [];
    for (const a of byKey.values()) {
      if (a.cnpj && fornPorCnpj.has(a.cnpj)) continue;              // já cadastrado (CNPJ bate)
      const match = acharForn([...a.nomes.keys()]);
      if (match) {
        if (a.cnpj && !onlyDigits(match.cnpj || "")) cnpjPara.push({ forn: match, cnpj: a.cnpj, count: a.count });
        continue;                                                   // já existe pelo nome
      }
      novos.push({ nome: melhorNome(a.nomes), cnpj: a.cnpj, count: a.count });
    }
    novos.sort((x, y) => y.count - x.count);
    cnpjPara.sort((x, y) => y.count - x.count);
    return { sugNovos: novos, sugCnpj: cnpjPara };
  }, [emissoresNota, fornecedores]);

  // Padroniza os nomes (tituloCaso) de todos os que estão fora do padrão.
  async function padronizarNomes() {
    if (foraPadrao.length === 0) return;
    if (!confirm(`Padronizar ${foraPadrao.length} nome(s) para "Primeira Maiúscula, resto minúsculo"?`)) return;
    setOcupado(true);
    try {
      const batch = writeBatch(db);
      for (const f of foraPadrao) batch.update(doc(db, "fornecedores", f.id), { nome: tituloCaso(f.nome) });
      await batch.commit();
    } catch (e) { alert("Erro: " + (e instanceof Error ? e.message : "?")); }
    finally { setOcupado(false); }
  }

  // Mescla um cluster num sobrevivente (mais completo). Repointa os insumos
  // vinculados (fornecedorPreferredId + fornecedores[]) e exclui os duplicados.
  async function mesclarCluster(cluster: Fornecedor[], sobrevId?: string): Promise<boolean> {
    const score = (f: Fornecedor) => (f.whatsapp ? 1 : 0) + (f.email ? 1 : 0) + (f.observacoes ? 1 : 0) + (f.ativo ? 1 : 0);
    // Sobrevivente = o escolhido (merge manual) OU o mais completo (auto).
    const sobrev = (sobrevId && cluster.find(f => f.id === sobrevId)) || [...cluster].sort((a, b) => score(b) - score(a))[0];
    const dupes = cluster.filter(f => f.id !== sobrev.id);
    const nomeFinal = tituloCaso(sobrev.nome);
    if (!confirm(`Mesclar ${cluster.length} fornecedores em "${nomeFinal}"?\n\nOs insumos vinculados passam pra ele e os outros ${dupes.length} são excluídos. Pedidos antigos preservam o nome que tinham.`)) return false;
    setOcupado(true);
    try {
      const dupeIds = new Set(dupes.map(d => d.id));
      const patch: Partial<Fornecedor> = { nome: nomeFinal };
      if (!sobrev.whatsapp) { const d = dupes.find(x => x.whatsapp); if (d) patch.whatsapp = d.whatsapp; }
      if (!sobrev.email) { const d = dupes.find(x => x.email); if (d) patch.email = d.email; }
      if (!sobrev.observacoes) { const d = dupes.find(x => x.observacoes); if (d) patch.observacoes = d.observacoes; }
      const batch = writeBatch(db);
      batch.update(doc(db, "fornecedores", sobrev.id), sanitizeForFirestore(patch));
      for (const ins of insumos) {
        const upd: Record<string, unknown> = {};
        if (ins.fornecedorPreferredId && dupeIds.has(ins.fornecedorPreferredId)) upd.fornecedorPreferredId = sobrev.id;
        if ((ins.fornecedores || []).some(x => x.fornecedorId && dupeIds.has(x.fornecedorId))) {
          upd.fornecedores = (ins.fornecedores || []).map(x => x.fornecedorId && dupeIds.has(x.fornecedorId) ? { ...x, fornecedorId: sobrev.id, nome: nomeFinal } : x);
        }
        if (Object.keys(upd).length) batch.update(doc(db, "insumos", ins.id), sanitizeForFirestore(upd));
      }
      for (const d of dupes) batch.delete(doc(db, "fornecedores", d.id));
      await batch.commit();
      return true;
    } catch (e) { alert("Erro ao mesclar: " + (e instanceof Error ? e.message : "?")); return false; }
    finally { setOcupado(false); }
  }

  // Merge MANUAL: abre o modal pra escolher qual dos marcados é o principal.
  function abrirMergeManual() {
    const sel = fornecedores.filter(f => selIds.has(f.id));
    if (sel.length < 2) return;
    const score = (f: Fornecedor) => (f.whatsapp ? 1 : 0) + (f.email ? 1 : 0) + (f.observacoes ? 1 : 0) + (f.ativo ? 1 : 0) + f.nome.length * 0.001;
    setSobrevSel([...sel].sort((a, b) => score(b) - score(a))[0].id);   // sugere o mais completo/longo
    setMergeAlvo(sel);
  }
  async function confirmarMergeManual() {
    if (!mergeAlvo) return;
    const ok = await mesclarCluster(mergeAlvo, sobrevSel);
    setMergeAlvo(null);
    if (ok) { setSelIds(new Set()); setSelMode(false); }
  }

  function toggleSel(id: string) {
    setSelIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return fornecedores;
    const s = search.toLowerCase();
    return fornecedores.filter(f =>
      f.nome.toLowerCase().includes(s) ||
      (f.whatsapp || "").toLowerCase().includes(s) ||
      (f.email || "").toLowerCase().includes(s)
    );
  }, [fornecedores, search]);

  async function excluir(f: Fornecedor) {
    if (!confirm(`Excluir fornecedor "${f.nome}"? Pedidos antigos preservam o snapshot do nome.`)) return;
    await deleteDoc(doc(db, "fornecedores", f.id));
  }

  async function toggleAtivo(f: Fornecedor) {
    await updateDoc(doc(db, "fornecedores", f.id), { ativo: !f.ativo });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Input
          placeholder="🔍 Buscar..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-md"
        />
        <div className="flex items-center gap-2 flex-wrap">
          {podeConfig && selMode ? (
            <>
              <span className="text-xs text-gray-500 dark:text-gray-400">{selIds.size} marcado(s)</span>
              <Button onClick={abrirMergeManual} disabled={selIds.size < 2 || ocupado} title="Mesclar os fornecedores marcados">
                <span className="inline-flex items-center gap-1.5"><GitMerge size={14} /> Mesclar ({selIds.size})</span>
              </Button>
              <Button variant="secondary" onClick={() => { setSelMode(false); setSelIds(new Set()); }}>Cancelar</Button>
            </>
          ) : podeConfig && (
            <>
              {foraPadrao.length > 0 && (
                <Button variant="secondary" onClick={() => void padronizarNomes()} disabled={ocupado} title="Corrige a caixa dos nomes (Primeira Maiúscula, resto minúsculo)">
                  <span className="inline-flex items-center gap-1.5"><Sparkles size={14} /> Padronizar nomes ({foraPadrao.length})</span>
                </Button>
              )}
              <Button variant="secondary" onClick={() => { setSelMode(true); setSelIds(new Set()); }} title="Marcar fornecedores manualmente pra mesclar (mesmo que estejam em grupos diferentes)">
                <span className="inline-flex items-center gap-1.5"><GitMerge size={14} /> Mesclar manual</span>
              </Button>
              <Button onClick={() => setEditing("new")}>+ Novo fornecedor</Button>
            </>
          )}
        </div>
      </div>

      {/* Possíveis duplicados — mesmo nome (caixa/acento) ou muito parecido. */}
      {podeConfig && duplicados.length > 0 && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-900/10 p-3 space-y-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300 inline-flex items-center gap-1"><GitMerge size={12} /> Possíveis duplicados ({duplicados.length})</div>
          {duplicados.map((cluster, i) => (
            <div key={i} className="flex items-center justify-between gap-2 flex-wrap text-[13px] bg-white dark:bg-gray-900 rounded-md border border-rose-100 dark:border-rose-900/40 px-2.5 py-1.5">
              <span className="text-gray-800 dark:text-gray-100">{cluster.map(f => f.nome).join("  ≈  ")}</span>
              <button type="button" onClick={() => void mesclarCluster(cluster)} disabled={ocupado} className="text-[11px] font-semibold px-2 py-1 rounded-md bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60 inline-flex items-center gap-1"><GitMerge size={11} /> Mesclar</button>
            </div>
          ))}
          <p className="text-[10px] text-rose-600/70 dark:text-rose-400/70">Ao mesclar, os insumos vinculados passam pro fornecedor que sobra e os duplicados são excluídos.</p>
        </div>
      )}

      {/* Sugestões do recebimento — emissores de NF (agrupados por CNPJ) que ainda
          não são fornecedores + CNPJ pra fornecedor cadastrado sem CNPJ. */}
      {podeConfig && (sugNovos.length > 0 || sugCnpj.length > 0) && (
        <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/70 dark:bg-indigo-900/10 p-3 space-y-2">
          <button type="button" onClick={() => setVerSugestoes(v => !v)} className="w-full flex items-center justify-between gap-2 text-left">
            <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300 inline-flex items-center gap-1">
              <FileText size={12} /> Sugestões do recebimento ({sugNovos.length + sugCnpj.length})
            </span>
            <ChevronRight size={14} className={`text-indigo-500 transition-transform ${verSugestoes ? "rotate-90" : ""}`} />
          </button>
          {verSugestoes && (
            <div className="space-y-3">
              {sugCnpj.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Preencher CNPJ de quem já está cadastrado ({sugCnpj.length})</p>
                  <div className="flex flex-wrap gap-1.5">
                    {sugCnpj.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => { setPrefill({ cnpj: fmtCnpj(s.cnpj) }); setEditing(s.forn); }}
                        title={`CNPJ ${fmtCnpj(s.cnpj)} visto em ${s.count} nota(s) — clique pra preencher no cadastro`}
                        className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-lg bg-white dark:bg-gray-900 border border-emerald-200 dark:border-emerald-900/40 text-gray-800 dark:text-gray-100 hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
                      >
                        <span className="truncate max-w-[160px]">{s.forn.nome}</span>
                        <span className="text-[10px] text-emerald-600">+ CNPJ</span>
                        <span className="text-[10px] text-gray-400">{s.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {sugNovos.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-400">Emissores de NF sem cadastro ({sugNovos.length})</p>
                  <div className="flex flex-wrap gap-1.5">
                    {sugNovos.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => { setPrefill({ nome: s.nome, cnpj: s.cnpj ? fmtCnpj(s.cnpj) : "" }); setEditing("new"); }}
                        title={s.cnpj ? `CNPJ ${fmtCnpj(s.cnpj)} · ${s.count} nota(s) — clique pra cadastrar` : `${s.count} nota(s) — clique pra cadastrar`}
                        className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-lg bg-white dark:bg-gray-900 border border-indigo-200 dark:border-indigo-900/40 text-gray-800 dark:text-gray-100 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                      >
                        <span className="truncate max-w-[180px]">{s.nome}</span>
                        {s.cnpj && <span className="text-[10px] text-indigo-500">CNPJ</span>}
                        <span className="text-[10px] text-gray-400">{s.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-[10px] text-indigo-600/70 dark:text-indigo-400/70">Agrupado por CNPJ (variações de nome do OCR viram um só). Clique pra abrir o cadastro pré-preenchido — depois use "Receita" pra completar.</p>
            </div>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="flex justify-center mb-3 text-gray-400"><Building2 size={40} /></div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">
            {search ? "Nenhum fornecedor encontrado" : "Sem fornecedores"}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden divide-y divide-gray-100 dark:divide-gray-800">
          {filtered.map(f => {
            const sel = selIds.has(f.id);
            return (
              <div
                key={f.id}
                onClick={() => selMode ? toggleSel(f.id) : setViewing(f)}
                className={`flex items-center gap-3 px-3.5 py-3 cursor-pointer transition-colors ${!f.ativo ? "opacity-60" : ""} ${sel ? "bg-rose-50 dark:bg-rose-950/20" : "hover:bg-gray-50 dark:hover:bg-gray-800/40"}`}
              >
                {selMode
                  ? <input type="checkbox" checked={sel} onChange={() => toggleSel(f.id)} onClick={(e) => e.stopPropagation()} className="shrink-0 w-4 h-4 accent-rose-600" />
                  : <span className={`shrink-0 w-9 h-9 rounded-full inline-flex items-center justify-center text-[13px] font-semibold ${avatarCor(f.nome)}`}>{iniciais(f.nome)}</span>}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">{f.nome}</span>
                    {!f.ativo && <span className="text-[10px] uppercase text-gray-400 shrink-0">Inativo</span>}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex gap-3 flex-wrap min-w-0">
                    {f.whatsapp && <span className="inline-flex items-center gap-1 truncate"><Smartphone size={12} /> {f.whatsapp}</span>}
                    {f.nomeVendedor && <span className="inline-flex items-center gap-1 truncate"><User size={12} /> {f.nomeVendedor}</span>}
                    {f.cnpj && <span className="truncate">CNPJ {f.cnpj}</span>}
                    {!f.whatsapp && !f.nomeVendedor && !f.cnpj && f.email && <span className="inline-flex items-center gap-1 truncate"><Mail size={12} /> {f.email}</span>}
                  </div>
                </div>
                {!selMode && <ChevronRight size={18} className="shrink-0 text-gray-300 dark:text-gray-600" />}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <FornecedorModal
          fornecedor={editing === "new" ? null : editing}
          fornecedores={fornecedores}
          restaurantId={restaurantId}
          prefill={prefill}
          onClose={() => { setEditing(null); setPrefill(null); }}
        />
      )}

      {/* Modal de VISUALIZAÇÃO — clica na linha; editar/inativar/excluir ficam DENTRO. */}
      {viewing && (
        <Modal
          title={<span className="inline-flex items-center gap-2.5 min-w-0"><span className={`w-8 h-8 rounded-full inline-flex items-center justify-center text-xs font-semibold shrink-0 ${avatarCor(viewing.nome)}`}>{iniciais(viewing.nome)}</span><span className="truncate">{viewing.nome}</span></span>}
          onClose={() => setViewing(null)}
          maxWidth="max-w-md"
        >
          <div>
            {(viewing.nomeVendedor || !viewing.ativo) && (
              <div className="text-[13px] text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-2">
                {viewing.nomeVendedor && <span className="inline-flex items-center gap-1"><User size={13} /> {viewing.nomeVendedor}</span>}
                {!viewing.ativo && <span className="text-[10px] uppercase text-gray-400">inativo</span>}
              </div>
            )}
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {viewing.cnpj && <ViewRow icon={<Building2 size={15} />} label="CNPJ" val={viewing.cnpj} />}
              {viewing.whatsapp && <ViewRow icon={<Smartphone size={15} />} label="WhatsApp" val={viewing.whatsapp} />}
              {viewing.email && <ViewRow icon={<Mail size={15} />} label="E-mail" val={viewing.email} />}
              {viewing.prazoEntrega && <ViewRow icon={<Clock size={15} />} label="Prazo de entrega" val={viewing.prazoEntrega} />}
              {viewing.formaPedido && <ViewRow icon={<FileText size={15} />} label="Forma de pedido" val={viewing.formaPedido} />}
              {viewing.pedidoMinimo && <ViewRow icon={<Package size={15} />} label="Pedido mínimo" val={viewing.pedidoMinimo} />}
            </div>
            {viewing.observacoes && <div className="text-sm text-gray-600 dark:text-gray-300 italic mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">{viewing.observacoes}</div>}

            <div className="flex items-center gap-2 pt-4 mt-3 border-t border-gray-100 dark:border-gray-800">
              <Button onClick={() => { const f = viewing; setViewing(null); setEditing(f); }}>
                <span className="inline-flex items-center gap-1.5"><Pencil size={14} /> Editar</span>
              </Button>
              {viewing.whatsapp && (
                <Button variant="secondary" onClick={() => void abrirWhatsapp(restaurantId, "fornecedores", viewing.whatsapp!, viewing.nome)}>
                  <span className="inline-flex items-center gap-1.5"><MessageSquare size={14} /> WhatsApp</span>
                </Button>
              )}
              <div className="flex-1" />
              {podeConfig && <Button variant="secondary" size="sm" onClick={() => { toggleAtivo(viewing); setViewing(null); }} title={viewing.ativo ? "Inativar" : "Ativar"}>{viewing.ativo ? <Ban size={15} /> : <Check size={15} />}</Button>}
              {podeConfig && <Button variant="danger" size="sm" onClick={() => { const f = viewing; setViewing(null); excluir(f); }} title="Excluir">×</Button>}
            </div>
          </div>
        </Modal>
      )}

      {/* Merge manual: escolher qual dos marcados é o PRINCIPAL (nome/registro que fica). */}
      {mergeAlvo && (
        <Modal title={<span className="inline-flex items-center gap-2"><GitMerge size={18} /> Mesclar {mergeAlvo.length} fornecedores</span>} onClose={() => setMergeAlvo(null)} maxWidth="max-w-lg">
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">Escolha qual <b>fica como principal</b> — os outros {mergeAlvo.length - 1} são excluídos e os insumos vinculados passam pro escolhido (pedidos antigos preservam o nome que tinham).</p>
            <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
              {mergeAlvo.map(f => (
                <label key={f.id} className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer ${sobrevSel === f.id ? "border-rose-400 bg-rose-50 dark:bg-rose-950/20" : "border-gray-200 dark:border-gray-700"}`}>
                  <input type="radio" name="sobrev" checked={sobrevSel === f.id} onChange={() => setSobrevSel(f.id)} className="mt-1 accent-rose-600" />
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-gray-900 dark:text-gray-100">{f.nome}</div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 flex gap-2 flex-wrap mt-0.5">
                      {f.cnpj && <span>CNPJ {f.cnpj}</span>}
                      {f.whatsapp && <span>{f.whatsapp}</span>}
                      {f.email && <span>{f.email}</span>}
                      {f.nomeVendedor && <span>👤 {f.nomeVendedor}</span>}
                      {!f.ativo && <span className="uppercase">inativo</span>}
                    </div>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setMergeAlvo(null)}>Cancelar</Button>
              <Button onClick={() => void confirmarMergeManual()} disabled={ocupado || !sobrevSel}>
                <span className="inline-flex items-center gap-1.5"><GitMerge size={14} /> Mesclar</span>
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ViewRow({ icon, label, val }: { icon: ReactNode; label: string; val: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-sm text-gray-500 dark:text-gray-400 inline-flex items-center gap-1.5 shrink-0">{icon} {label}</span>
      <span className="text-sm text-gray-800 dark:text-gray-100 text-right break-words">{val}</span>
    </div>
  );
}

function iniciais(nome: string): string {
  const p = (nome || "").trim().split(/\s+/).filter(Boolean);
  return (((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase()) || "?";
}
const AVATAR_CORES = [
  "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  "bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  "bg-pink-50 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
  "bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
];
function avatarCor(nome: string): string {
  let h = 0; for (const c of (nome || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_CORES[h % AVATAR_CORES.length];
}

export function onlyDigits(s: string): string {
  return s.replace(/\D/g, "");
}

// Formata 14 dígitos como 00.000.000/0000-00 (deixa como veio se não tiver 14).
function fmtCnpj(s: string): string {
  const d = onlyDigits(s);
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : s;
}

// ── FornecedorModal ────────────────────────────────────────────────────────

function FornecedorModal({
  fornecedor, fornecedores, restaurantId, prefill, onClose,
}: {
  fornecedor: Fornecedor | null;
  fornecedores: Fornecedor[];
  restaurantId: string;
  prefill?: { nome?: string; cnpj?: string } | null;
  onClose: () => void;
}) {
  const { pessoa: me } = useAuth();
  const isNew = !fornecedor;

  const [nome, setNome] = useState(fornecedor?.nome || prefill?.nome || "");
  const [whatsapp, setWhatsapp] = useState(fornecedor?.whatsapp || "");
  const [email, setEmail] = useState(fornecedor?.email || "");
  const [cnpj, setCnpj] = useState(fornecedor?.cnpj || prefill?.cnpj || "");
  const [nomeVendedor, setNomeVendedor] = useState(fornecedor?.nomeVendedor || "");
  const [prazoEntrega, setPrazoEntrega] = useState(fornecedor?.prazoEntrega || "");
  const [formaPedido, setFormaPedido] = useState(fornecedor?.formaPedido || "");
  const [pedidoMinimo, setPedidoMinimo] = useState(fornecedor?.pedidoMinimo || "");
  const [observacoes, setObservacoes] = useState(fornecedor?.observacoes || "");
  const [ativo, setAtivo] = useState(fornecedor?.ativo ?? true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const [cnpjMsg, setCnpjMsg] = useState("");

  // Consulta cadastral na Receita (BrasilAPI via /api/cnpj) e pré-preenche o que
  // estiver VAZIO — nunca sobrescreve o que você já digitou.
  async function buscarCnpj() {
    const digits = cnpj.replace(/\D/g, "");
    if (digits.length !== 14) { setCnpjMsg("Digite os 14 dígitos do CNPJ."); return; }
    setBuscandoCnpj(true); setCnpjMsg("");
    try {
      const r = await fetch(`/api/cnpj?cnpj=${digits}`, { headers: await authHeader() });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setCnpjMsg(j.error || "Falha na consulta."); return; }
      if (!nome.trim()) setNome(j.nomeFantasia || j.razaoSocial || "");
      if (!email.trim() && j.email) setEmail(j.email);
      if (!whatsapp.trim() && j.telefone) setWhatsapp(j.telefone);
      if (!observacoes.trim()) {
        const partes = [j.razaoSocial, j.endereco, j.situacao ? `situação: ${j.situacao}` : "", j.atividade].filter(Boolean);
        if (partes.length) setObservacoes(partes.join(" · "));
      }
      setCnpjMsg(`✓ ${j.razaoSocial || j.nomeFantasia || "encontrado"}${j.situacao ? ` · ${j.situacao}` : ""}`);
    } catch { setCnpjMsg("Erro ao consultar a Receita."); }
    finally { setBuscandoCnpj(false); }
  }

  async function salvar() {
    if (!nome.trim()) { setErr("Nome obrigatório"); return; }
    if (!me) return;
    const nomeLimpo = tituloCaso(nome.trim());   // Primeira Maiúscula, resto minúsculo
    // Dedup por nome normalizado (sem acento/caixa) — bloqueia criar duplicado.
    const chave = normalizar(nomeLimpo);
    const jaExiste = fornecedores.find(f => f.id !== fornecedor?.id && normalizar(f.nome) === chave);
    if (jaExiste) { setErr(`Já existe um fornecedor "${jaExiste.nome}". Edite esse em vez de criar outro.`); return; }
    setErr("");
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const payload: Omit<Fornecedor, "id"> = {
        restaurantId,
        nome: nomeLimpo,
        whatsapp: whatsapp.trim() || undefined,
        email: email.trim() || undefined,
        cnpj: cnpj.trim() || undefined,
        nomeVendedor: nomeVendedor.trim() ? tituloCaso(nomeVendedor.trim()) : undefined,
        prazoEntrega: prazoEntrega.trim() || undefined,
        formaPedido: formaPedido.trim() || undefined,
        pedidoMinimo: pedidoMinimo.trim() || undefined,
        observacoes: observacoes.trim() || undefined,
        ativo,
        criadoEm: fornecedor?.criadoEm || now,
        criadoPor: fornecedor?.criadoPor || me.id,
      };
      if (isNew) {
        await addDoc(collection(db, "fornecedores"), sanitizeForFirestore(payload));
      } else {
        await updateDoc(doc(db, "fornecedores", fornecedor.id), sanitizeForFirestore(payload));
      }
      onClose();
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isNew ? "+ Novo fornecedor" : `Editar — ${fornecedor.nome}`} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <Input
          label="Nome *"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="ex: Distribuidora Joaquim"
          autoFocus
        />
        <Input
          label="WhatsApp (com DDI 55)"
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          placeholder="ex: 5511999998888"
        />
        <p className="text-[10px] text-gray-500 -mt-2">
          Formato internacional (55 + DDD + número). Usado pra abrir wa.me/&lt;numero&gt;
        </p>
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="flex items-end gap-2">
              <Input label="CNPJ" value={cnpj} onChange={(e) => { setCnpj(e.target.value); setCnpjMsg(""); }} placeholder="00.000.000/0000-00" className="flex-1" />
              <Button type="button" variant="secondary" onClick={() => void buscarCnpj()} disabled={buscandoCnpj || cnpj.replace(/\D/g, "").length !== 14} title="Buscar dados na Receita Federal">
                {buscandoCnpj ? "Buscando…" : <span className="inline-flex items-center gap-1.5"><Search size={14} /> Receita</span>}
              </Button>
            </div>
            {cnpjMsg && <p className="text-[11px] mt-1 text-gray-500 dark:text-gray-400">{cnpjMsg}</p>}
          </div>
          <Input label="Vendedor (contato)" value={nomeVendedor} onChange={(e) => setNomeVendedor(e.target.value)} placeholder="ex: João" />
          <Input label="Prazo de entrega" value={prazoEntrega} onChange={(e) => setPrazoEntrega(e.target.value)} placeholder="ex: 2 dias úteis" />
          <Input label="Como fazer o pedido" value={formaPedido} onChange={(e) => setFormaPedido(e.target.value)} placeholder="ex: WhatsApp, e-mail, site" />
          <Input label="Pedido mínimo" value={pedidoMinimo} onChange={(e) => setPedidoMinimo(e.target.value)} placeholder="ex: R$ 300 ou 10 cx" />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Observações</label>
          <textarea
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            rows={2}
            placeholder="ex: dia de entrega, condições de pagamento..."
            className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 resize-y"
          />
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          <span className="font-medium">Fornecedor ativo</span>
        </label>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>{saving ? "..." : isNew ? "Criar" : "Salvar"}</Button>
        </div>
      </div>
    </Modal>
  );
}
