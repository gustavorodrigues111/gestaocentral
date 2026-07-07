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
import { exportarFaturasXLSX, exportarFaturasPDF } from "./exportFaturas";
import type { CartaoCategoria, CartaoFatura, CartaoLancamento } from "../../core/types";

const CARTOES = ["Master Itaú", "Visa Itaú", "Master Santander", "Visa Santander"];
// Categorias sugeridas (quick-add) — cobrem gastos comuns de restaurante + pessoal.
const CATEGORIAS_SUGERIDAS = [
  "Insumos / Mercado", "Bebidas", "Hortifruti", "Carnes", "Embalagens",
  "Manutenção", "Equipamentos", "Limpeza", "Gás", "Uniformes",
  "Marketing", "Softwares / Assinaturas", "Telefonia", "Transporte", "Combustível",
  "Viagem", "Alimentação", "Contabilidade", "Impostos / Taxas", "Material de escritório",
];
const fmtBRL = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const normNome = (s: string) => (s || "").toUpperCase().replace(/\d/g, "").replace(/[^A-Z ]/g, "").trim().slice(0, 18);
const mesAtual = () => new Date().toISOString().slice(0, 7);

// Select com cara de chip/pílula colorida por estado.
const chipSelect = (v: "empresa" | "neutro" | "ok" | "vazio"): string => {
  const base = "text-xs font-medium rounded-full pl-2.5 pr-1 py-1 border cursor-pointer max-w-[160px] ";
  const styles: Record<typeof v, string> = {
    empresa: "border-violet-300 bg-violet-50 text-violet-700 dark:bg-violet-900/25 dark:text-violet-300 dark:border-violet-700",
    neutro: "border-gray-200 bg-gray-50 text-gray-600 dark:bg-gray-800/50 dark:text-gray-300 dark:border-gray-700",
    ok: "border-indigo-300 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/25 dark:text-indigo-300 dark:border-indigo-700",
    vazio: "border-amber-300 border-dashed bg-amber-50/60 text-amber-700 dark:text-amber-300 dark:border-amber-700 dark:bg-transparent",
  };
  return base + styles[v];
};

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
  const [faturas, setFaturas] = useState<CartaoFatura[]>([]);

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
    const u3 = onSnapshot(query(collection(db, "cartaoFaturas"), where("restaurantId", "==", rid)), snap =>
      setFaturas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as CartaoFatura)));
    return () => { u1(); u2(); u3(); };
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
        {([["visualizacao", "Visualização"], ...(podeClassificar ? [["classificacao", "Classificação"] as const] : []), ...(podeCategorias ? [["categorias", "Config"] as const] : [])] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => setAba(v)}
            className={`px-4 py-2 text-sm font-semibold -mb-px border-b-2 ${aba === v ? "border-indigo-500 text-indigo-600 dark:text-indigo-300" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>{l}</button>
        ))}
      </nav>

      {aba === "visualizacao" && <Visualizacao minhas={minhas} outras={outras} catNome={catNome} restNome={restNome} meId={me?.id} meNome={me?.nome} />}
      {aba === "classificacao" && podeClassificar && (
        <Classificacao rid={rid} meId={me?.id} pixPadrao={activeRestaurant?.cartaoChavePixPadrao} cartoes={activeRestaurant?.cartoesCadastrados || []} empresaPropriaNome={activeRestaurant?.nome || restNome[rid] || ""} outrasEmpresas={outrasEmpresas} catsDe={catsDe} minhas={minhas} faturas={faturas} />
      )}
      {aba === "categorias" && podeCategorias && <Categorias rid={rid} categorias={catsDe(rid)} pixPadrao={activeRestaurant?.cartaoChavePixPadrao || ""} cartoes={activeRestaurant?.cartoesCadastrados || []} />}
    </div>
  );
}

// ─── Visualização ────────────────────────────────────────────────────────────
function Visualizacao({ minhas, outras: outrasRaw, catNome, restNome, meId, meNome }: { minhas: CartaoLancamento[]; outras: CartaoLancamento[]; catNome: (id?: string | null) => string; restNome: Record<string, string>; meId?: string; meNome?: string }) {
  const [sub, setSub] = useState<"minhas" | "outras">("minhas");
  const [pagando, setPagando] = useState("");
  // Filtro multi-cartão (vazio = todos).
  const [cartoesSel, setCartoesSel] = useState<Set<string>>(() => new Set());
  const cartoesDisp = useMemo(() => [...new Set([...minhas, ...outrasRaw].map(l => l.cartao).filter(Boolean))].sort(), [minhas, outrasRaw]);
  const passaCartao = (l: CartaoLancamento) => cartoesSel.size === 0 || cartoesSel.has(l.cartao);
  const toggleCartao = (c: string) => setCartoesSel(prev => { const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n; });

  // Só reembolsos de faturas FECHADAS (publicadas) aparecem pra outra empresa.
  const outras = outrasRaw.filter(l => l.publicado && passaCartao(l));
  const minhasProprias = minhas.filter(l => l.destinoTipo === "propria" && passaCartao(l));
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

  const exportarLancs = sub === "minhas" ? minhasProprias : outras;
  const exportarTitulo = sub === "minhas" ? "Minhas faturas" : "Reembolsos a receber";

  return (
    <div>
      {cartoesDisp.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <span className="text-[11px] text-gray-400 mr-0.5">Cartões:</span>
          <SubChip ativo={cartoesSel.size === 0} onClick={() => setCartoesSel(new Set())}>Todos</SubChip>
          {cartoesDisp.map(c => <SubChip key={c} ativo={cartoesSel.has(c)} onClick={() => toggleCartao(c)}>{c}</SubChip>)}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex gap-1.5">
          <SubChip ativo={sub === "minhas"} onClick={() => setSub("minhas")}>Minhas faturas · {fmtBRL(totalMinhas)}</SubChip>
          <SubChip ativo={sub === "outras"} onClick={() => setSub("outras")}>Outras faturas (reembolso) · {fmtBRL(totalOutrasPend)}</SubChip>
        </div>
        {exportarLancs.length > 0 && (
          <div className="flex gap-1.5">
            <button type="button" onClick={() => void exportarFaturasXLSX(exportarLancs, catNome, exportarTitulo)} className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50">⬇ Excel</button>
            <button type="button" onClick={() => void exportarFaturasPDF(exportarLancs, catNome, exportarTitulo)} className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50">⬇ PDF</button>
          </div>
        )}
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

// ─── Classificação (subir + extrair + classificar + rascunho/fechar) ─────────
function Classificacao({ rid, meId, pixPadrao, cartoes, empresaPropriaNome, outrasEmpresas, catsDe, minhas, faturas }: {
  rid: string; meId?: string; pixPadrao?: string; cartoes: string[]; empresaPropriaNome: string; outrasEmpresas: { id: string; nome: string }[];
  catsDe: (entId: string) => CartaoCategoria[]; minhas: CartaoLancamento[]; faturas: CartaoFatura[];
}) {
  const [faturaId, setFaturaId] = useState<string | null>(null);  // fatura sendo editada (null = nova)
  const [cartao, setCartao] = useState("");        // identificado pela IA; editável
  const [subindo, setSubindo] = useState(false);
  const [erro, setErro] = useState("");
  const [linhas, setLinhas] = useState<Extraido[]>([]);
  const [venc, setVenc] = useState<string | null>(null);
  const [totalFatura, setTotalFatura] = useState<number | null>(null);
  const [salvando, setSalvando] = useState(false);
  // Competência derivada do vencimento (mês/ano da fatura) — sem input manual.
  const competencia = venc && /^\d{4}-\d{2}/.test(venc) ? venc.slice(0, 7) : mesAtual();

  const rascunhos = faturas.filter(f => (f.status || "rascunho") === "rascunho").sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
  const editando = linhas.length > 0;

  // Carrega um rascunho salvo de volta pro editor.
  function carregarRascunho(f: CartaoFatura) {
    const lancs = minhas.filter(l => l.faturaId === f.id).sort((a, b) => (a.data || "").localeCompare(b.data || ""));
    setFaturaId(f.id); setCartao(f.cartao || ""); setVenc(f.vencimento || null); setTotalFatura(f.totalFatura ?? null); setErro("");
    setLinhas(lancs.map(l => ({
      data: l.dataOriginal || (l.data ? l.data.slice(8, 10) + "/" + l.data.slice(5, 7) : ""),
      descricao: l.descricao, valor: l.valor, parcela: l.parcela || null,
      destinoTipo: l.destinoTipo, empresaAtribuidaId: l.empresaAtribuidaId || null, categoriaId: l.categoriaId || null,
    })));
  }
  function limpar() { setLinhas([]); setVenc(null); setTotalFatura(null); setCartao(""); setFaturaId(null); setErro(""); }
  async function descartar() {
    if (!confirm(faturaId ? "Descartar este rascunho? Os lançamentos salvos serão apagados." : "Descartar esta fatura não salva?")) return;
    if (faturaId) {
      const batch = writeBatch(db);
      batch.delete(doc(db, "cartaoFaturas", faturaId));
      for (const old of minhas.filter(l => l.faturaId === faturaId)) batch.delete(doc(db, "cartaoLancamentos", old.id));
      await batch.commit();
    }
    limpar();
  }

  // Memória de comerciante: por nome normalizado → última classificação usada.
  const memoria = useMemo(() => {
    const m = new Map<string, { destinoTipo: "propria" | "empresa"; empresaAtribuidaId: string | null; categoriaId: string | null }>();
    for (const l of minhas) { const k = normNome(l.descricao); if (k && !m.has(k)) m.set(k, { destinoTipo: l.destinoTipo, empresaAtribuidaId: l.empresaAtribuidaId || null, categoriaId: l.categoriaId || null }); }
    return m;
  }, [minhas]);

  async function subirEExtrair(file: File) {
    setErro(""); setSubindo(true); setFaturaId(null);  // PDF novo = fatura nova
    try {
      const path = `faturas-cartao/${rid}/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, "_")}`;
      const snap = await uploadBytes(storageRef(storage, path), file, { contentType: "application/pdf" });
      const url = await getDownloadURL(snap.ref);
      const empresasNomes = outrasEmpresas.map(e => e.nome);
      const catNomes = [...new Set([rid, ...outrasEmpresas.map(e => e.id)].flatMap(id => catsDe(id).map(c => c.nome)))];
      const r = await fetch("/api/fatura-extrair", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ pdfUrl: url, cartoes, empresaPropria: empresaPropriaNome, empresas: empresasNomes, categorias: catNomes }) });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || "Falha na extração."); return; }
      setVenc(j.vencimento || null); setTotalFatura(typeof j.totalFatura === "number" ? j.totalFatura : null);
      setCartao(typeof j.cartao === "string" && j.cartao ? j.cartao : "");
      const novas: Extraido[] = (j.lancamentos || []).map((l: { data: string; descricao: string; valor: number; parcela: string | null; destinoEmpresa?: string | null; categoriaSugerida?: string | null }) => {
        // 1) sugestão da IA: destino (outra empresa) + categoria
        let destinoTipo: "propria" | "empresa" = "propria";
        let empresaAtribuidaId: string | null = null;
        if (l.destinoEmpresa) {
          const emp = outrasEmpresas.find(e => e.nome.toLowerCase() === l.destinoEmpresa!.toLowerCase());
          if (emp) { destinoTipo = "empresa"; empresaAtribuidaId = emp.id; }
        }
        const destEnt = destinoTipo === "propria" ? rid : empresaAtribuidaId;
        let categoriaId: string | null = null;
        if (l.categoriaSugerida && destEnt) {
          const cat = catsDe(destEnt).find(c => c.nome.toLowerCase() === l.categoriaSugerida!.toLowerCase());
          if (cat) categoriaId = cat.id;
        }
        // 2) fallback: memória de comerciante (só se a IA não sugeriu nada)
        if (destinoTipo === "propria" && !categoriaId) {
          const mem = memoria.get(normNome(l.descricao));
          if (mem) { destinoTipo = mem.destinoTipo; empresaAtribuidaId = mem.empresaAtribuidaId; categoriaId = mem.categoriaId; }
        }
        return { data: l.data, descricao: l.descricao, valor: l.valor, parcela: l.parcela, destinoTipo, empresaAtribuidaId, categoriaId };
      });
      setLinhas(novas);
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao subir/extrair."); }
    finally { setSubindo(false); }
  }

  function setLinha(i: number, patch: Partial<Extraido>) { setLinhas(prev => prev.map((l, j) => j === i ? { ...l, ...patch } : l)); }
  // Ao trocar destino, preserva a categoria pelo NOME se a nova empresa tiver
  // uma igual; senão zera (as categorias são por entidade).
  function setDestino(i: number, tipo: "propria" | "empresa", empresaId: string | null) {
    setLinhas(prev => prev.map((l, j) => {
      if (j !== i) return l;
      const oldEnt = l.destinoTipo === "propria" ? rid : l.empresaAtribuidaId;
      const newEnt = tipo === "propria" ? rid : empresaId;
      let categoriaId: string | null = null;
      if (l.categoriaId && oldEnt && newEnt) {
        const nome = catsDe(oldEnt).find(c => c.id === l.categoriaId)?.nome;
        if (nome) categoriaId = catsDe(newEnt).find(c => c.nome.toLowerCase() === nome.toLowerCase())?.id || null;
      }
      return { ...l, destinoTipo: tipo, empresaAtribuidaId: empresaId, categoriaId };
    }));
  }

  const somaClass = linhas.reduce((s, l) => s + (l.valor || 0), 0);
  const diff = totalFatura != null ? Math.round((somaClass - totalFatura) * 100) / 100 : null;
  const naoClassificados = linhas.filter(l => !l.categoriaId).length;

  function ymdDe(dataDDMM: string): string {
    const [d, m] = (dataDDMM || "").split("/");
    if (!d || !m) return competencia + "-01";
    // Usa o ano da competência (fatura pode ter compras de meses anteriores; aproximação).
    return `${competencia.slice(0, 4)}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // Salva rascunho (fechar=false, não publica) ou fecha a fatura (fechar=true,
  // publica os reembolsos pras outras empresas). Idempotente por faturaId.
  async function persistir(fechar: boolean) {
    if (linhas.length === 0) return;
    if (cartoes.length > 0 && !cartao) { alert("Escolha o cartão antes de salvar."); return; }
    if (fechar) {
      const semCat = linhas.filter(l => !l.categoriaId).length;
      const msg = semCat > 0
        ? `Fechar a fatura vai publicar os reembolsos pras outras empresas. Ainda há ${semCat} lançamento(s) sem categoria. Fechar assim mesmo?`
        : "Fechar a fatura? Os gastos atribuídos a outras empresas serão publicados pra elas como reembolso.";
      if (!confirm(msg)) return;
    }
    setSalvando(true);
    try {
      const agora = new Date().toISOString();
      const fid = faturaId || `fat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const faturaAtual = faturas.find(f => f.id === fid);
      const batch = writeBatch(db);
      batch.set(doc(db, "cartaoFaturas", fid), sanitizeForFirestore({
        id: fid, restaurantId: rid, cartao, competencia, vencimento: venc, totalFatura,
        status: fechar ? "fechada" : "rascunho",
        fechadaEm: fechar ? agora : null, fechadaPor: fechar ? (meId || null) : null,
        criadoEm: faturaAtual?.criadoEm || agora, criadoPor: faturaAtual?.criadoPor || meId || null,
      }));
      // Apaga lançamentos antigos desta fatura e regrava os atuais (ids determinísticos).
      for (const old of minhas.filter(l => l.faturaId === fid)) batch.delete(doc(db, "cartaoLancamentos", old.id));
      linhas.forEach((l, i) => {
        const id = `${fid}_${i}`;
        const ehEmpresa = l.destinoTipo === "empresa";
        batch.set(doc(db, "cartaoLancamentos", id), sanitizeForFirestore({
          id, restaurantId: rid, faturaId: fid, cartao,
          data: ymdDe(l.data), dataOriginal: l.data, descricao: l.descricao, valor: l.valor, parcela: l.parcela, obs: null,
          destinoTipo: l.destinoTipo, empresaAtribuidaId: ehEmpresa ? l.empresaAtribuidaId : null,
          categoriaId: l.categoriaId,
          publicado: fechar,                                 // só publica ao fechar
          reembolsoStatus: fechar && ehEmpresa ? "pendente" : null,
          reembolsoDataPagamento: fechar && ehEmpresa ? (venc || null) : null,
          reembolsoChavePix: fechar && ehEmpresa ? (pixPadrao || null) : null,
          pagoEm: null, pagoPor: null, pagoPorNome: null,
          criadoEm: agora, criadoPor: meId || null,
        }));
      });
      await batch.commit();
      if (fechar) { limpar(); alert("✅ Fatura fechada. Reembolsos publicados pras outras empresas."); }
      else { setFaturaId(fid); alert("💾 Rascunho salvo. Dá pra continuar editando depois na lista de rascunhos."); }
    } catch (e) { alert("Erro ao salvar: " + (e instanceof Error ? e.message : "?")); }
    finally { setSalvando(false); }
  }

  const inp = "px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900";
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 text-indigo-700 dark:text-indigo-300 cursor-pointer font-medium">
            {subindo ? "Lendo a fatura…" : "📄 Subir PDF da fatura"}
            <input type="file" accept="application/pdf" className="hidden" disabled={subindo} onChange={e => { const f = e.target.files?.[0]; if (f) void subirEExtrair(f); e.currentTarget.value = ""; }} />
          </label>
          <span className="text-xs text-gray-500">A IA lê o PDF e identifica sozinha o cartão, o vencimento e os lançamentos.</span>
        </div>
        {cartoes.length === 0 && <p className="text-xs text-amber-600 mt-2">⚠️ Cadastre seus cartões na aba <b>Config</b> pra IA saber de qual cartão é cada fatura.</p>}
        {erro && <p className="text-xs text-rose-600 mt-2">{erro}</p>}
      </div>

      {/* Rascunhos em aberto — continuar editando (só quando não está editando) */}
      {!editando && rascunhos.length > 0 && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-2">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">📝 Rascunhos em aberto</div>
          <p className="text-xs text-gray-500">Faturas salvas mas ainda não fechadas — nada foi publicado pras outras empresas.</p>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {rascunhos.map(f => {
              const n = minhas.filter(l => l.faturaId === f.id).length;
              return (
                <div key={f.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0 text-sm">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{f.cartao || "Cartão —"}</span>
                    <span className="text-gray-400"> · {n} lançamento{n === 1 ? "" : "s"}{f.vencimento ? ` · venc ${f.vencimento.split("-").reverse().join("/")}` : ""}</span>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => carregarRascunho(f)}>Continuar</Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {editando && (
        <>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500">Cartão:</span>
                {cartoes.length > 0 ? (
                  <select value={cartao} onChange={e => setCartao(e.target.value)} className={`${inp} py-1 ${!cartao ? "border-amber-300" : ""}`}>
                    <option value="">— escolher —</option>
                    {cartoes.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : <b>{cartao || "—"}</b>}
                {cartoes.length > 0 && cartao && <span className="text-[10px] text-emerald-600">✓ identificado</span>}
              </div>
              <span className="text-gray-500">Vencimento: <b className="text-gray-800 dark:text-gray-200">{venc ? venc.split("-").reverse().join("/") : "—"}</b></span>
              <span className="text-gray-500">Total: <b className="text-gray-800 dark:text-gray-200">{totalFatura != null ? fmtBRL(totalFatura) : "—"}</b></span>
              <span className="text-gray-500">Classificado: <b className="text-gray-800 dark:text-gray-200">{fmtBRL(somaClass)}</b></span>
              {diff != null && <span className={Math.abs(diff) < 0.01 ? "text-emerald-600" : "text-amber-600"}>Diferença: <b>{fmtBRL(diff)}</b></span>}
              {naoClassificados > 0 && <span className="text-amber-600">{naoClassificados} sem categoria</span>}
              {faturaId && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">rascunho</span>}
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => void descartar()} disabled={salvando}>Descartar</Button>
              <Button size="sm" variant="secondary" onClick={() => void persistir(false)} disabled={salvando}>{salvando ? "…" : "💾 Salvar rascunho"}</Button>
              <Button size="sm" onClick={() => void persistir(true)} disabled={salvando || (cartoes.length > 0 && !cartao)}>{salvando ? "…" : "✓ Fechar fatura"}</Button>
            </div>
          </div>
          <p className="text-[11px] text-gray-500 flex items-center gap-1">✨ A IA já sugeriu <b className="text-violet-600 dark:text-violet-300">destino</b> e <b className="text-indigo-600 dark:text-indigo-300">categoria</b> — clique nas pílulas pra ajustar o que precisar.</p>
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
                          className={chipSelect(l.destinoTipo === "empresa" ? "empresa" : "neutro")}>
                          <option value="__minha__">Minha</option>
                          {outrasEmpresas.map(em => <option key={em.id} value={em.id}>{em.nome}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <select value={l.categoriaId || ""} onChange={e => setLinha(i, { categoriaId: e.target.value || null })} className={chipSelect(l.categoriaId ? "ok" : "vazio")}>
                          <option value="">+ categoria</option>
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

// ─── Config: Cartões + Pix + Categorias ──────────────────────────────────────
function Categorias({ rid, categorias, pixPadrao, cartoes }: { rid: string; categorias: CartaoCategoria[]; pixPadrao: string; cartoes: string[] }) {
  const [nome, setNome] = useState("");
  const [pix, setPix] = useState(pixPadrao);
  const [salvandoPix, setSalvandoPix] = useState(false);
  const [novoCartao, setNovoCartao] = useState("");
  useEffect(() => { setPix(pixPadrao); }, [pixPadrao]);
  async function criarNome(n: string) { const nome = n.trim(); if (!nome || categorias.some(c => c.nome.toLowerCase() === nome.toLowerCase())) return; await addDoc(collection(db, "cartaoCategorias"), sanitizeForFirestore({ restaurantId: rid, nome, ativo: true, criadoEm: new Date().toISOString() })); }
  async function criar() { await criarNome(nome); setNome(""); }
  async function addTodasSugeridas() { for (const c of catsSugeridas) await criarNome(c); }
  async function excluir(id: string) { if (confirm("Excluir categoria?")) await deleteDoc(doc(db, "cartaoCategorias", id)); }
  const catsSugeridas = CATEGORIAS_SUGERIDAS.filter(c => !categorias.some(x => x.nome.toLowerCase() === c.toLowerCase()));
  async function salvarPix() { setSalvandoPix(true); try { await updateDoc(doc(db, "restaurants", rid), { cartaoChavePixPadrao: pix.trim() }); } finally { setSalvandoPix(false); } }
  const pixMudou = pix.trim() !== (pixPadrao || "").trim();
  async function addCartao(nomeCartao: string) { const n = nomeCartao.trim(); if (!n || cartoes.some(c => c.toLowerCase() === n.toLowerCase())) return; await updateDoc(doc(db, "restaurants", rid), { cartoesCadastrados: [...cartoes, n] }); setNovoCartao(""); }
  async function removerCartao(nomeCartao: string) { await updateDoc(doc(db, "restaurants", rid), { cartoesCadastrados: cartoes.filter(c => c !== nomeCartao) }); }
  const sugestoes = CARTOES.filter(c => !cartoes.some(x => x.toLowerCase() === c.toLowerCase()));
  return (
    <div className="max-w-lg space-y-5">
      {/* Cartões cadastrados — a IA casa cada fatura com um deles */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-2.5">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">💳 Meus cartões</div>
        <p className="text-xs text-gray-500">Cadastre os cartões cujas faturas você sobe aqui. Ao subir um PDF, a IA identifica sozinha de qual cartão é.</p>
        {cartoes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {cartoes.map(c => (
              <span key={c} className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                {c}
                <button type="button" onClick={() => void removerCartao(c)} className="text-gray-400 hover:text-rose-600 leading-none">×</button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input value={novoCartao} onChange={e => setNovoCartao(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void addCartao(novoCartao); }} placeholder="Ex: Master Itaú, Visa Santander…"
            className="flex-1 px-3 py-2 text-base rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
          <Button onClick={() => void addCartao(novoCartao)} disabled={!novoCartao.trim()}>+ Adicionar</Button>
        </div>
        {sugestoes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            <span className="text-[11px] text-gray-400 self-center">Sugestões:</span>
            {sugestoes.map(c => (
              <button key={c} type="button" onClick={() => void addCartao(c)} className="text-[11px] px-2 py-0.5 rounded-full border border-dashed border-gray-300 dark:border-gray-700 text-gray-500 hover:border-indigo-400 hover:text-indigo-600">+ {c}</button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-2">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">🔑 Chave Pix pra receber reembolsos</div>
        <p className="text-xs text-gray-500">Quando você atribui um gasto a outra empresa, essa chave vai junto pra ela te pagar.</p>
        <div className="flex gap-2">
          <input value={pix} onChange={e => setPix(e.target.value)} placeholder="CPF, e-mail, telefone ou chave aleatória"
            className="flex-1 px-3 py-2 text-base rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
          <Button onClick={() => void salvarPix()} disabled={!pixMudou || salvandoPix}>{salvandoPix ? "…" : "Salvar"}</Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-500">Categorias desta entidade. São usadas pra classificar os gastos das faturas.</p>
        {catsSugeridas.length > 0 && <button type="button" onClick={() => void addTodasSugeridas()} className="text-[11px] font-medium whitespace-nowrap px-2.5 py-1 rounded-lg border border-indigo-300 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20">+ Adicionar sugeridas</button>}
      </div>
      <div className="flex gap-2">
        <input value={nome} onChange={e => setNome(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void criar(); }} placeholder="Nova categoria (ex: Viagem, Mercado, Telefonia)"
          className="flex-1 px-3 py-2 text-base rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
        <Button onClick={() => void criar()} disabled={!nome.trim()}>+ Adicionar</Button>
      </div>
      {catsSugeridas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[11px] text-gray-400 self-center">Sugestões:</span>
          {catsSugeridas.map(c => (
            <button key={c} type="button" onClick={() => void criarNome(c)} className="text-[11px] px-2 py-0.5 rounded-full border border-dashed border-gray-300 dark:border-gray-700 text-gray-500 hover:border-indigo-400 hover:text-indigo-600">+ {c}</button>
          ))}
        </div>
      )}
      {categorias.length === 0 ? <Vazio texto="Nenhuma categoria ainda. Use as sugestões acima ou crie a sua." /> : (
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
