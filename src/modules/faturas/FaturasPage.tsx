// Módulo Faturas de Cartão. Sobe o PDF da fatura → a IA extrai os lançamentos →
// você classifica cada um por CATEGORIA e DESTINO (própria entidade ou outra
// empresa = reembolso). Duas abas: Visualização (Minhas faturas / Outras
// faturas a reembolsar) e Classificação. Categorias são por entidade.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where, writeBatch } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { authHeader } from "../../core/firebase/idToken";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import type { CartaoCategoria, CartaoLancamento } from "../../core/types";

const CARTOES = ["Master Itaú", "Visa Itaú", "Master Santander", "Visa Santander"];
const fmtBRL = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const normNome = (s: string) => (s || "").toUpperCase().replace(/\d/g, "").replace(/[^A-Z ]/g, "").trim().slice(0, 18);
const mesAtual = () => new Date().toISOString().slice(0, 7);

type Extraido = { data: string; descricao: string; valor: number; parcela: string | null; destinoTipo: "propria" | "empresa"; empresaAtribuidaId: string | null; categoriaId: string | null };

export function FaturasPage() {
  const { pessoa: me } = useAuth();
  const { rid } = useParams<{ rid: string }>();
  const { restaurants, activeRestaurant } = useRestaurant();
  const isMaster = !!me?.isMaster;
  const { can } = useCanAcao(rid || "");
  const podeVer = isMaster || can("faturas", "ver");
  const podeClassificar = isMaster || can("faturas", "classificar");
  const podeCategorias = isMaster || can("faturas", "categorias");

  const [aba, setAba] = useState<"visualizacao" | "classificacao" | "categorias">("visualizacao");
  const [categorias, setCategorias] = useState<CartaoCategoria[]>([]);
  const [minhas, setMinhas] = useState<CartaoLancamento[]>([]);
  const [outras, setOutras] = useState<CartaoLancamento[]>([]);

  const ridsKey = restaurants.map(r => r.id).join(",");
  const restNome = useMemo(() => Object.fromEntries(restaurants.map(r => [r.id, r.nome])), [restaurants]);
  const outrasEmpresas = restaurants.filter(r => r.id !== rid);

  // Categorias de todas as entidades do usuário (pra classificar atribuições).
  useEffect(() => {
    const rids = ridsKey ? ridsKey.split(",").slice(0, 10) : [];
    if (!rids.length) { setCategorias([]); return; }
    const u = onSnapshot(query(collection(db, "cartaoCategorias"), where("restaurantId", "in", rids)), snap =>
      setCategorias(snap.docs.map(d => ({ id: d.id, ...d.data() }) as CartaoCategoria).filter(c => c.ativo !== false)));
    return () => u();
  }, [ridsKey]);

  // Minhas faturas (lançamentos desta entidade) + Outras (atribuídos a mim).
  useEffect(() => {
    if (!rid) return;
    const u1 = onSnapshot(query(collection(db, "cartaoLancamentos"), where("restaurantId", "==", rid)), snap =>
      setMinhas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as CartaoLancamento)));
    const u2 = onSnapshot(query(collection(db, "cartaoLancamentos"), where("empresaAtribuidaId", "==", rid)), snap =>
      setOutras(snap.docs.map(d => ({ id: d.id, ...d.data() }) as CartaoLancamento)));
    return () => { u1(); u2(); };
  }, [rid]);

  const catsDe = (entId: string) => categorias.filter(c => c.restaurantId === entId).sort((a, b) => a.nome.localeCompare(b.nome));
  const catNome = (id?: string | null) => categorias.find(c => c.id === id)?.nome || "—";

  if (!rid) return <div className="text-center py-12 text-gray-500">Selecione uma empresa.</div>;
  if (!podeVer) return <div className="max-w-2xl mx-auto py-12 text-center"><div className="text-4xl mb-3">🔒</div><p className="text-gray-700 dark:text-gray-300 font-medium">Sem acesso ao módulo Faturas.</p></div>;

  return (
    <div className="max-w-6xl">
      <header className="mb-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">💳 Faturas</h1>
        <p className="text-xs text-gray-500">{activeRestaurant?.nome} · faturas de cartão, classificação e reembolsos</p>
      </header>

      <nav className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-4">
        {([["visualizacao", "Visualização"], ...(podeClassificar ? [["classificacao", "Classificação"] as const] : []), ...(podeCategorias ? [["categorias", "Categorias"] as const] : [])] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => setAba(v)}
            className={`px-4 py-2 text-sm font-semibold -mb-px border-b-2 ${aba === v ? "border-indigo-500 text-indigo-600 dark:text-indigo-300" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>{l}</button>
        ))}
      </nav>

      {aba === "visualizacao" && <Visualizacao minhas={minhas} outras={outras} catNome={catNome} restNome={restNome} meId={me?.id} meNome={me?.nome} />}
      {aba === "classificacao" && podeClassificar && (
        <Classificacao rid={rid} meId={me?.id} pixPadrao={activeRestaurant?.cartaoChavePixPadrao} outrasEmpresas={outrasEmpresas} catsDe={catsDe} minhas={minhas} />
      )}
      {aba === "categorias" && podeCategorias && <Categorias rid={rid} categorias={catsDe(rid)} pixPadrao={activeRestaurant?.cartaoChavePixPadrao || ""} />}
    </div>
  );
}

// ─── Visualização ────────────────────────────────────────────────────────────
function Visualizacao({ minhas, outras, catNome, restNome, meId, meNome }: { minhas: CartaoLancamento[]; outras: CartaoLancamento[]; catNome: (id?: string | null) => string; restNome: Record<string, string>; meId?: string; meNome?: string }) {
  const [sub, setSub] = useState<"minhas" | "outras">("minhas");
  const [pagando, setPagando] = useState("");
  const minhasProprias = minhas.filter(l => l.destinoTipo === "propria");
  const totalMinhas = minhasProprias.reduce((s, l) => s + (l.valor || 0), 0);
  const outrasPend = outras.filter(l => l.reembolsoStatus !== "pago");
  const totalOutrasPend = outrasPend.reduce((s, l) => s + (l.valor || 0), 0);

  // Agrupa "outras" por dono (restaurantId).
  const outrasPorDono = useMemo(() => {
    const m = new Map<string, CartaoLancamento[]>();
    for (const l of outras) { const arr = m.get(l.restaurantId) || []; arr.push(l); m.set(l.restaurantId, arr); }
    return [...m.entries()];
  }, [outras]);

  async function marcarPago(lancs: CartaoLancamento[], donoNome: string) {
    const pend = lancs.filter(l => l.reembolsoStatus !== "pago");
    if (!pend.length) return;
    if (!confirm(`Confirmar pagamento de ${fmtBRL(pend.reduce((s, l) => s + (l.valor || 0), 0))} pra ${donoNome}?`)) return;
    setPagando(lancs[0].restaurantId);
    try {
      const batch = writeBatch(db);
      const agora = new Date().toISOString();
      for (const l of pend) batch.update(doc(db, "cartaoLancamentos", l.id), { reembolsoStatus: "pago", pagoEm: agora, pagoPor: meId || null, pagoPorNome: meNome || null });
      await batch.commit();
    } catch (e) { alert("Erro ao marcar pago: " + (e instanceof Error ? e.message : "?")); }
    finally { setPagando(""); }
  }

  return (
    <div>
      <div className="flex gap-1.5 mb-3">
        <SubChip ativo={sub === "minhas"} onClick={() => setSub("minhas")}>Minhas faturas · {fmtBRL(totalMinhas)}</SubChip>
        <SubChip ativo={sub === "outras"} onClick={() => setSub("outras")}>Outras faturas (reembolso) · {fmtBRL(totalOutrasPend)}</SubChip>
      </div>

      {sub === "minhas" ? (
        minhasProprias.length === 0 ? <Vazio texto="Nenhum lançamento classificado ainda. Vá em Classificação e suba uma fatura." /> : (
          <LancTabela lancs={minhasProprias} catNome={catNome} />
        )
      ) : (
        outrasPorDono.length === 0 ? <Vazio texto="Nenhum reembolso atribuído a esta empresa." /> : (
          <div className="space-y-5">
            {outrasPorDono.map(([dono, lancs]) => {
              const donoNome = restNome[dono] || "outra entidade";
              const pend = lancs.filter(l => l.reembolsoStatus !== "pago");
              const pix = lancs.find(l => l.reembolsoChavePix)?.reembolsoChavePix;
              const dataPag = lancs.find(l => l.reembolsoDataPagamento)?.reembolsoDataPagamento;
              return (
                <div key={dono} className="rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-800">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">💳 De {donoNome} · {fmtBRL(lancs.reduce((s, l) => s + (l.valor || 0), 0))}</div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500 mt-0.5">
                        {pix && <span>Pix: <b className="text-gray-700 dark:text-gray-300 select-all">{pix}</b></span>}
                        {dataPag && <span>Pagar até: <b>{dataPag.split("-").reverse().join("/")}</b></span>}
                        {pend.length === 0 ? <span className="text-emerald-600 font-medium">✓ Tudo pago</span> : <span className="text-amber-600 font-medium">Pendente: {fmtBRL(pend.reduce((s, l) => s + (l.valor || 0), 0))}</span>}
                      </div>
                    </div>
                    {pend.length > 0 && (
                      <Button size="sm" onClick={() => void marcarPago(lancs, donoNome)} disabled={pagando === dono}>{pagando === dono ? "…" : "✓ Marcar como pago"}</Button>
                    )}
                  </div>
                  <LancTabela lancs={lancs} catNome={catNome} mostrarStatus />
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}

function LancTabela({ lancs, catNome, mostrarStatus }: { lancs: CartaoLancamento[]; catNome: (id?: string | null) => string; mostrarStatus?: boolean }) {
  const ordenados = [...lancs].sort((a, b) => (a.data || "").localeCompare(b.data || ""));
  return (
    <div className={mostrarStatus ? "overflow-x-auto" : "overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800"}>
      <table className="w-full min-w-[520px] text-sm">
        <thead><tr className="text-[11px] uppercase text-gray-400 bg-gray-50 dark:bg-gray-900/40">
          <th className="text-left px-3 py-2">Data</th><th className="text-left px-3 py-2">Descrição</th><th className="text-left px-3 py-2">Categoria</th><th className="text-left px-3 py-2">Cartão</th><th className="text-right px-3 py-2">Valor</th>{mostrarStatus && <th className="text-right px-3 py-2">Status</th>}
        </tr></thead>
        <tbody>
          {ordenados.map(l => (
            <tr key={l.id} className="border-t border-gray-100 dark:border-gray-800">
              <td className="px-3 py-1.5 whitespace-nowrap text-gray-500">{l.dataOriginal || l.data}</td>
              <td className="px-3 py-1.5">{l.descricao}{l.parcela && <span className="ml-1 text-[10px] text-gray-400">({l.parcela})</span>}</td>
              <td className="px-3 py-1.5 text-gray-600 dark:text-gray-300">{catNome(l.categoriaId)}</td>
              <td className="px-3 py-1.5 text-[11px] text-gray-400">{l.cartao}</td>
              <td className={`px-3 py-1.5 text-right tabular-nums ${l.valor < 0 ? "text-emerald-600" : "text-gray-900 dark:text-gray-100"}`}>{fmtBRL(l.valor)}</td>
              {mostrarStatus && <td className="px-3 py-1.5 text-right whitespace-nowrap">{l.reembolsoStatus === "pago" ? <span className="text-[10px] font-semibold text-emerald-600">✓ pago</span> : <span className="text-[10px] font-semibold text-amber-600">pendente</span>}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Classificação (subir + extrair + classificar + salvar) ──────────────────
function Classificacao({ rid, meId, pixPadrao, outrasEmpresas, catsDe, minhas }: {
  rid: string; meId?: string; pixPadrao?: string; outrasEmpresas: { id: string; nome: string }[];
  catsDe: (entId: string) => CartaoCategoria[]; minhas: CartaoLancamento[];
}) {
  const [cartao, setCartao] = useState(CARTOES[0]);
  const [competencia, setCompetencia] = useState(mesAtual());
  const [subindo, setSubindo] = useState(false);
  const [erro, setErro] = useState("");
  const [linhas, setLinhas] = useState<Extraido[]>([]);
  const [venc, setVenc] = useState<string | null>(null);
  const [totalFatura, setTotalFatura] = useState<number | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Memória de comerciante: por nome normalizado → última classificação usada.
  const memoria = useMemo(() => {
    const m = new Map<string, { destinoTipo: "propria" | "empresa"; empresaAtribuidaId: string | null; categoriaId: string | null }>();
    for (const l of minhas) { const k = normNome(l.descricao); if (k && !m.has(k)) m.set(k, { destinoTipo: l.destinoTipo, empresaAtribuidaId: l.empresaAtribuidaId || null, categoriaId: l.categoriaId || null }); }
    return m;
  }, [minhas]);

  async function subirEExtrair(file: File) {
    setErro(""); setSubindo(true);
    try {
      const path = `faturas-cartao/${rid}/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, "_")}`;
      const snap = await uploadBytes(storageRef(storage, path), file, { contentType: "application/pdf" });
      const url = await getDownloadURL(snap.ref);
      const r = await fetch("/api/fatura-extrair", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ pdfUrl: url, cartao }) });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || "Falha na extração."); return; }
      setVenc(j.vencimento || null); setTotalFatura(typeof j.totalFatura === "number" ? j.totalFatura : null);
      const novas: Extraido[] = (j.lancamentos || []).map((l: { data: string; descricao: string; valor: number; parcela: string | null }) => {
        const mem = memoria.get(normNome(l.descricao));
        return { data: l.data, descricao: l.descricao, valor: l.valor, parcela: l.parcela,
          destinoTipo: mem?.destinoTipo || "propria", empresaAtribuidaId: mem?.empresaAtribuidaId || null, categoriaId: mem?.categoriaId || null };
      });
      setLinhas(novas);
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao subir/extrair."); }
    finally { setSubindo(false); }
  }

  function setLinha(i: number, patch: Partial<Extraido>) { setLinhas(prev => prev.map((l, j) => j === i ? { ...l, ...patch } : l)); }
  // Ao trocar destino, zera categoria (é de outra lista).
  function setDestino(i: number, tipo: "propria" | "empresa", empresaId: string | null) { setLinha(i, { destinoTipo: tipo, empresaAtribuidaId: empresaId, categoriaId: null }); }

  const somaClass = linhas.reduce((s, l) => s + (l.valor || 0), 0);
  const diff = totalFatura != null ? Math.round((somaClass - totalFatura) * 100) / 100 : null;
  const naoClassificados = linhas.filter(l => !l.categoriaId).length;

  function ymdDe(dataDDMM: string): string {
    const [d, m] = (dataDDMM || "").split("/");
    if (!d || !m) return competencia + "-01";
    // Usa o ano da competência (fatura pode ter compras de meses anteriores; aproximação).
    return `${competencia.slice(0, 4)}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  async function salvar() {
    if (linhas.length === 0) return;
    setSalvando(true);
    try {
      const faturaId = `fat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const batch = writeBatch(db);
      batch.set(doc(db, "cartaoFaturas", faturaId), sanitizeForFirestore({
        id: faturaId, restaurantId: rid, cartao, competencia, vencimento: venc, totalFatura,
        criadoEm: new Date().toISOString(), criadoPor: meId || null,
      }));
      for (const l of linhas) {
        const id = `lan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        batch.set(doc(db, "cartaoLancamentos", id), sanitizeForFirestore({
          id, restaurantId: rid, faturaId, cartao,
          data: ymdDe(l.data), dataOriginal: l.data, descricao: l.descricao, valor: l.valor, parcela: l.parcela, obs: null,
          destinoTipo: l.destinoTipo, empresaAtribuidaId: l.destinoTipo === "empresa" ? l.empresaAtribuidaId : null,
          categoriaId: l.categoriaId, reembolsoStatus: l.destinoTipo === "empresa" ? "pendente" : null,
          reembolsoDataPagamento: l.destinoTipo === "empresa" ? (venc || null) : null,
          reembolsoChavePix: l.destinoTipo === "empresa" ? (pixPadrao || null) : null,
          pagoEm: null, pagoPor: null,
          criadoEm: new Date().toISOString(), criadoPor: meId || null,
        }));
      }
      await batch.commit();
      setLinhas([]); setVenc(null); setTotalFatura(null);
      alert("✅ Fatura salva e classificada.");
    } catch (e) { alert("Erro ao salvar: " + (e instanceof Error ? e.message : "?")); }
    finally { setSalvando(false); }
  }

  const inp = "px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900";
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex flex-wrap items-end gap-3">
        <div><label className="text-[11px] text-gray-500 block mb-0.5">Cartão</label>
          <select value={cartao} onChange={e => setCartao(e.target.value)} className={inp}>{CARTOES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
        <div><label className="text-[11px] text-gray-500 block mb-0.5">Competência</label>
          <input type="month" value={competencia} onChange={e => setCompetencia(e.target.value)} className={inp} /></div>
        <label className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 text-indigo-700 dark:text-indigo-300 cursor-pointer">
          {subindo ? "Lendo a fatura…" : "📄 Subir PDF da fatura"}
          <input type="file" accept="application/pdf" className="hidden" disabled={subindo} onChange={e => { const f = e.target.files?.[0]; if (f) void subirEExtrair(f); e.currentTarget.value = ""; }} />
        </label>
        {erro && <span className="text-xs text-rose-600">{erro}</span>}
      </div>

      {linhas.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
            <div className="flex gap-3 flex-wrap">
              <span>Vencimento: <b>{venc ? venc.split("-").reverse().join("/") : "—"}</b></span>
              <span>Total fatura: <b>{totalFatura != null ? fmtBRL(totalFatura) : "—"}</b></span>
              <span>Classificado: <b>{fmtBRL(somaClass)}</b></span>
              {diff != null && <span className={Math.abs(diff) < 0.01 ? "text-emerald-600" : "text-amber-600"}>Diferença: <b>{fmtBRL(diff)}</b></span>}
              {naoClassificados > 0 && <span className="text-amber-600">{naoClassificados} sem categoria</span>}
            </div>
            <Button size="sm" onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando…" : "✓ Salvar fatura"}</Button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="text-[11px] uppercase text-gray-400 bg-gray-50 dark:bg-gray-900/40">
                <th className="text-left px-2 py-2">Data</th><th className="text-left px-2 py-2">Descrição</th><th className="text-right px-2 py-2">Valor</th><th className="text-left px-2 py-2">Destino</th><th className="text-left px-2 py-2">Categoria</th>
              </tr></thead>
              <tbody>
                {linhas.map((l, i) => {
                  const destinoEnt = l.destinoTipo === "propria" ? rid : (l.empresaAtribuidaId || "");
                  const cats = destinoEnt ? catsDe(destinoEnt) : [];
                  return (
                    <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="px-2 py-1.5 whitespace-nowrap text-gray-500">{l.data}</td>
                      <td className="px-2 py-1.5">{l.descricao}{l.parcela && <span className="ml-1 text-[10px] text-gray-400">({l.parcela})</span>}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums ${l.valor < 0 ? "text-emerald-600" : ""}`}>{fmtBRL(l.valor)}</td>
                      <td className="px-2 py-1.5">
                        <select value={l.destinoTipo === "propria" ? "__minha__" : (l.empresaAtribuidaId || "")}
                          onChange={e => { const v = e.target.value; v === "__minha__" ? setDestino(i, "propria", null) : setDestino(i, "empresa", v); }}
                          className={`${inp} py-1 text-xs`}>
                          <option value="__minha__">Minha</option>
                          {outrasEmpresas.map(em => <option key={em.id} value={em.id}>{em.nome}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <select value={l.categoriaId || ""} onChange={e => setLinha(i, { categoriaId: e.target.value || null })} className={`${inp} py-1 text-xs ${!l.categoriaId ? "border-amber-300" : ""}`}>
                          <option value="">— categoria —</option>
                          {cats.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Categorias + Pix ────────────────────────────────────────────────────────
function Categorias({ rid, categorias, pixPadrao }: { rid: string; categorias: CartaoCategoria[]; pixPadrao: string }) {
  const [nome, setNome] = useState("");
  const [pix, setPix] = useState(pixPadrao);
  const [salvandoPix, setSalvandoPix] = useState(false);
  useEffect(() => { setPix(pixPadrao); }, [pixPadrao]);
  async function criar() { const n = nome.trim(); if (!n) return; await addDoc(collection(db, "cartaoCategorias"), sanitizeForFirestore({ restaurantId: rid, nome: n, ativo: true, criadoEm: new Date().toISOString() })); setNome(""); }
  async function excluir(id: string) { if (confirm("Excluir categoria?")) await deleteDoc(doc(db, "cartaoCategorias", id)); }
  async function salvarPix() { setSalvandoPix(true); try { await updateDoc(doc(db, "restaurants", rid), { cartaoChavePixPadrao: pix.trim() }); } finally { setSalvandoPix(false); } }
  const pixMudou = pix.trim() !== (pixPadrao || "").trim();
  return (
    <div className="max-w-lg space-y-5">
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-2">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">🔑 Chave Pix pra receber reembolsos</div>
        <p className="text-xs text-gray-500">Quando você atribui um gasto a outra empresa, essa chave vai junto pra ela te pagar.</p>
        <div className="flex gap-2">
          <input value={pix} onChange={e => setPix(e.target.value)} placeholder="CPF, e-mail, telefone ou chave aleatória"
            className="flex-1 px-3 py-2 text-base rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
          <Button onClick={() => void salvarPix()} disabled={!pixMudou || salvandoPix}>{salvandoPix ? "…" : "Salvar"}</Button>
        </div>
      </div>

      <p className="text-xs text-gray-500">Categorias desta entidade. São usadas pra classificar os gastos das faturas.</p>
      <div className="flex gap-2">
        <input value={nome} onChange={e => setNome(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void criar(); }} placeholder="Nova categoria (ex: Viagem, Mercado, Telefonia)"
          className="flex-1 px-3 py-2 text-base rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
        <Button onClick={() => void criar()} disabled={!nome.trim()}>+ Adicionar</Button>
      </div>
      {categorias.length === 0 ? <Vazio texto="Nenhuma categoria ainda." /> : (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {categorias.map(c => (
            <div key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>{c.nome}</span>
              <button type="button" onClick={() => void excluir(c.id)} className="text-[11px] text-gray-400 hover:text-rose-600">excluir</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SubChip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${ativo ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}>{children}</button>;
}
function Vazio({ texto }: { texto: string }) {
  return <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">{texto}</div>;
}
