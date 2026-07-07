// Módulo Faturas de Cartão. Sobe o PDF da fatura → a IA extrai os lançamentos →
// você classifica cada um por CATEGORIA e DESTINO (própria entidade ou outra
// empresa = reembolso). Duas abas: Visualização (Minhas faturas / Outras
// faturas a reembolsar) e Classificação. Categorias são por entidade.
import { useEffect, useMemo, useRef, useState } from "react";
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
import type { CartaoCategoria, CartaoFatura, CartaoLancamento, CartaoRateioParte } from "../../core/types";

type RateioSimples = { empresaId: string; percentual: number };
const round2 = (v: number) => Math.round(v * 100) / 100;

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

type Extraido = { data: string; descricao: string; valor: number; parcela: string | null; rateio: RateioSimples[]; categoriaId: string | null; ignorar?: boolean };

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
    const u2 = onSnapshot(query(collection(db, "cartaoLancamentos"), where("empresasRateadas", "array-contains", rid)), snap =>
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

      {aba === "visualizacao" && <Visualizacao rid={rid} minhas={minhas} outras={outras} catNome={catNome} restNome={restNome} meId={me?.id} meNome={me?.nome} />}
      {aba === "classificacao" && podeClassificar && (
        <Classificacao rid={rid} meId={me?.id} pixPadrao={activeRestaurant?.cartaoChavePixPadrao} cartoes={activeRestaurant?.cartoesCadastrados || []} empresaPropriaNome={activeRestaurant?.nome || restNome[rid] || ""} outrasEmpresas={outrasEmpresas} catsDe={catsDe} minhas={minhas} faturas={faturas} />
      )}
      {aba === "categorias" && podeCategorias && <Categorias rid={rid} categorias={catsDe(rid)} pixPadrao={activeRestaurant?.cartaoChavePixPadrao || ""} cartoes={activeRestaurant?.cartoesCadastrados || []} outrasEmpresas={outrasEmpresas} />}
    </div>
  );
}

// ─── Visualização ────────────────────────────────────────────────────────────
function Visualizacao({ rid, minhas, outras: outrasRaw, catNome, restNome, meId, meNome }: { rid: string; minhas: CartaoLancamento[]; outras: CartaoLancamento[]; catNome: (id?: string | null) => string; restNome: Record<string, string>; meId?: string; meNome?: string }) {
  const [sub, setSub] = useState<"minhas" | "outras">("minhas");
  const [pagando, setPagando] = useState("");
  // Filtro multi-cartão (vazio = todos).
  const [cartoesSel, setCartoesSel] = useState<Set<string>>(() => new Set());
  const cartoesDisp = useMemo(() => [...new Set([...minhas, ...outrasRaw].map(l => l.cartao).filter(Boolean))].sort(), [minhas, outrasRaw]);
  const passaCartao = (l: CartaoLancamento) => cartoesSel.size === 0 || cartoesSel.has(l.cartao);
  const toggleCartao = (c: string) => setCartoesSel(prev => { const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n; });

  // Minha fatia (empresa atual = rid) no rateio de um lançamento de outra empresa.
  const minhaParte = (l: CartaoLancamento) => (l.rateio || []).find(p => p.empresaId === rid);
  // Total a reembolsar de um lançamento meu (soma das fatias das outras empresas).
  const aReembolsar = (l: CartaoLancamento) => (l.rateio || []).reduce((s, p) => s + (p.valor || 0), 0);

  // Só reembolsos de faturas FECHADAS (publicadas) aparecem pra outra empresa.
  const outras = outrasRaw.filter(l => l.publicado && passaCartao(l));
  // Minhas faturas = a fatura inteira é minha; os itens a reembolsar ganham selo.
  const minhasTodas = minhas.filter(passaCartao);
  const totalMinhas = minhasTodas.filter(l => !l.ignorado).reduce((s, l) => s + (l.valor || 0), 0);
  const totalAReceber = minhasTodas.reduce((s, l) => s + aReembolsar(l), 0);
  const totalOutrasPend = outras.reduce((s, l) => { const p = minhaParte(l); return s + (p && p.status !== "pago" ? (p.valor || 0) : 0); }, 0);

  // "A me reembolsar" agrupado por empresa (respeita o filtro de cartão).
  const aReceberPorEmpresa = (() => {
    const m = new Map<string, { total: number; pend: number; pago: number }>();
    for (const l of minhasTodas) { if (l.ignorado) continue; for (const p of l.rateio || []) {
      const g = m.get(p.empresaId) || { total: 0, pend: 0, pago: 0 };
      g.total += p.valor || 0; if (p.status === "pago") g.pago += p.valor || 0; else g.pend += p.valor || 0;
      m.set(p.empresaId, g);
    } }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
  })();

  // Agrupa "outras" por dono (restaurantId).
  const outrasPorDono = useMemo(() => {
    const m = new Map<string, CartaoLancamento[]>();
    for (const l of outras) { const arr = m.get(l.restaurantId) || []; arr.push(l); m.set(l.restaurantId, arr); }
    return [...m.entries()];
  }, [outras]);

  async function marcarPago(lancs: CartaoLancamento[], donoNome: string) {
    const alvo = lancs.filter(l => { const p = minhaParte(l); return p && p.status !== "pago"; });
    if (!alvo.length) return;
    const totalPagar = alvo.reduce((s, l) => s + (minhaParte(l)?.valor || 0), 0);
    if (!confirm(`Confirmar pagamento de ${fmtBRL(totalPagar)} pra ${donoNome}?`)) return;
    setPagando(alvo[0].restaurantId);
    try {
      const batch = writeBatch(db);
      const agora = new Date().toISOString();
      for (const l of alvo) {
        const novoRateio = (l.rateio || []).map(p => p.empresaId === rid ? { ...p, status: "pago", pagoEm: agora, pagoPor: meId || null, pagoPorNome: meNome || null } : p);
        batch.update(doc(db, "cartaoLancamentos", l.id), { rateio: novoRateio });
      }
      await batch.commit();
    } catch (e) { alert("Erro ao marcar pago: " + (e instanceof Error ? e.message : "?")); }
    finally { setPagando(""); }
  }

  const exportarLancs = sub === "minhas" ? minhasTodas.filter(l => !l.ignorado) : outras;
  const exportarTitulo = sub === "minhas" ? "Minhas faturas" : "Reembolsos a pagar";

  return (
    <div>
      {/* 1. Filtro principal: minhas faturas × reembolsos a pagar (acima dos cartões) */}
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex gap-1.5">
          <SubChip ativo={sub === "minhas"} onClick={() => setSub("minhas")}>Minhas faturas · {fmtBRL(totalMinhas)}</SubChip>
          <SubChip ativo={sub === "outras"} onClick={() => setSub("outras")}>A reembolsar a outros · {fmtBRL(totalOutrasPend)}</SubChip>
        </div>
        {exportarLancs.length > 0 && (
          <div className="flex gap-1.5">
            <button type="button" onClick={() => void exportarFaturasXLSX(exportarLancs, catNome, exportarTitulo)} className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50">⬇ Excel</button>
            <button type="button" onClick={() => void exportarFaturasPDF(exportarLancs, catNome, exportarTitulo)} className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50">⬇ PDF</button>
          </div>
        )}
      </div>
      {/* 2. Filtro por cartão */}
      {cartoesDisp.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <span className="text-[11px] text-gray-400 mr-0.5">Cartões:</span>
          <SubChip ativo={cartoesSel.size === 0} onClick={() => setCartoesSel(new Set())}>Todos</SubChip>
          {cartoesDisp.map(c => <SubChip key={c} ativo={cartoesSel.has(c)} onClick={() => toggleCartao(c)}>{c}</SubChip>)}
        </div>
      )}

      {sub === "minhas" ? (
        minhasTodas.length === 0 ? <Vazio texto="Nenhum lançamento classificado ainda. Vá em Classificação e suba uma fatura." /> : (
          <>
            {/* 3. A me reembolsar — total + por empresa (respeita o cartão filtrado) */}
            {aReceberPorEmpresa.length > 0 && (
              <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 mb-3">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1.5">↩ A me reembolsar · <span className="text-violet-600 dark:text-violet-300">{fmtBRL(totalAReceber)}</span></div>
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {aReceberPorEmpresa.map(([empId, g]) => (
                    <div key={empId} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                      <span className="text-gray-800 dark:text-gray-200">{restNome[empId] || "empresa"}</span>
                      <span className="flex items-center gap-2.5 whitespace-nowrap">
                        {g.pend > 0 && <span className="text-[11px] text-amber-600">pendente {fmtBRL(g.pend)}</span>}
                        {g.pago > 0 && <span className="text-[11px] text-emerald-600">pago {fmtBRL(g.pago)}</span>}
                        <b className="tabular-nums text-gray-900 dark:text-gray-100">{fmtBRL(g.total)}</b>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <LancTabela lancs={minhasTodas} catNome={catNome} restNome={restNome} mostrarReembolso />
          </>
        )
      ) : (
        outrasPorDono.length === 0 ? <Vazio texto="Nenhum reembolso a pagar a outra empresa." /> : (
          <div className="space-y-5">
            {outrasPorDono.map(([dono, lancs]) => {
              const donoNome = restNome[dono] || "outra entidade";
              const linhasParte = lancs.map(l => ({ l, parte: minhaParte(l)! })).filter(x => x.parte)
                .sort((a, b) => (a.l.data || "").localeCompare(b.l.data || ""));
              const totalDono = linhasParte.reduce((s, x) => s + (x.parte.valor || 0), 0);
              const pend = linhasParte.filter(x => x.parte.status !== "pago");
              const totalPend = pend.reduce((s, x) => s + (x.parte.valor || 0), 0);
              const pix = lancs.find(l => l.reembolsoChavePix)?.reembolsoChavePix;
              const dataPag = lancs.find(l => l.reembolsoDataPagamento)?.reembolsoDataPagamento;
              return (
                <div key={dono} className="rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-800">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">💳 A pagar pra {donoNome} · {fmtBRL(totalDono)}</div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500 mt-0.5">
                        {pix && <span>Pix: <b className="text-gray-700 dark:text-gray-300 select-all">{pix}</b></span>}
                        {dataPag && <span>Pagar até: <b>{dataPag.split("-").reverse().join("/")}</b></span>}
                        {pend.length === 0 ? <span className="text-emerald-600 font-medium">✓ Tudo pago</span> : <span className="text-amber-600 font-medium">Pendente: {fmtBRL(totalPend)}</span>}
                      </div>
                    </div>
                    {pend.length > 0 && (
                      <Button size="sm" onClick={() => void marcarPago(lancs, donoNome)} disabled={pagando === dono}>{pagando === dono ? "…" : "✓ Marcar como pago"}</Button>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-sm">
                      <thead><tr className="text-[11px] uppercase text-gray-400 bg-gray-50 dark:bg-gray-900/40">
                        <th className="text-left px-3 py-2">Data</th><th className="text-left px-3 py-2">Descrição</th><th className="text-left px-3 py-2">Categoria</th><th className="text-right px-3 py-2">Sua fatia</th><th className="text-right px-3 py-2">Status</th>
                      </tr></thead>
                      <tbody>
                        {linhasParte.map(({ l, parte }) => (
                          <tr key={l.id} className="border-t border-gray-100 dark:border-gray-800">
                            <td className="px-3 py-1.5 whitespace-nowrap text-gray-500">{l.dataOriginal || l.data}</td>
                            <td className="px-3 py-1.5">{l.descricao}{l.parcela && <span className="ml-1 text-[10px] text-gray-400">({l.parcela})</span>}</td>
                            <td className="px-3 py-1.5 text-gray-600 dark:text-gray-300">{catNome(l.categoriaId)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{fmtBRL(parte.valor)} {parte.percentual < 100 && <span className="text-[10px] text-gray-400">({parte.percentual}%)</span>}</td>
                            <td className="px-3 py-1.5 text-right whitespace-nowrap">{parte.status === "pago" ? <span className="text-[10px] font-semibold text-emerald-600">✓ pago</span> : <span className="text-[10px] font-semibold text-amber-600">pendente</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}

function LancTabela({ lancs, catNome, mostrarStatus, mostrarReembolso, restNome }: { lancs: CartaoLancamento[]; catNome: (id?: string | null) => string; mostrarStatus?: boolean; mostrarReembolso?: boolean; restNome?: Record<string, string> }) {
  const ordenados = [...lancs].sort((a, b) => (a.data || "").localeCompare(b.data || ""));
  return (
    <div className={mostrarStatus ? "overflow-x-auto" : "overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800"}>
      <table className="w-full min-w-[520px] text-sm">
        <thead><tr className="text-[11px] uppercase text-gray-400 bg-gray-50 dark:bg-gray-900/40">
          <th className="text-left px-3 py-2">Data</th><th className="text-left px-3 py-2">Descrição</th><th className="text-left px-3 py-2">Categoria</th><th className="text-left px-3 py-2">Cartão</th><th className="text-right px-3 py-2">Valor</th>{mostrarStatus && <th className="text-right px-3 py-2">Status</th>}
        </tr></thead>
        <tbody>
          {ordenados.map(l => {
            const partes = l.rateio || [];
            const ehReembolso = mostrarReembolso && partes.length > 0;
            const todasPagas = partes.length > 0 && partes.every(p => p.status === "pago");
            const seloTxt = partes.length === 1
              ? `${restNome?.[partes[0].empresaId] || "empresa"}${partes[0].percentual < 100 ? ` ${partes[0].percentual}%` : ""}`
              : `rateio · ${partes.length} empresas`;
            return (
            <tr key={l.id} className={`border-t border-gray-100 dark:border-gray-800 ${l.ignorado ? "opacity-45" : ""}`}>
              <td className="px-3 py-1.5 whitespace-nowrap text-gray-500">{l.dataOriginal || l.data}</td>
              <td className="px-3 py-1.5">
                <span className={l.ignorado ? "line-through" : ""}>{l.descricao}</span>{l.parcela && <span className="ml-1 text-[10px] text-gray-400">({l.parcela})</span>}
                {l.ignorado && <span className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 whitespace-nowrap">ignorado</span>}
                {ehReembolso && !l.ignorado && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 whitespace-nowrap">↩ {seloTxt}{todasPagas ? " · pago" : ""}</span>}
              </td>
              <td className="px-3 py-1.5 text-gray-600 dark:text-gray-300">{catNome(l.categoriaId)}</td>
              <td className="px-3 py-1.5 text-[11px] text-gray-400">{l.cartao}</td>
              <td className={`px-3 py-1.5 text-right tabular-nums ${l.ignorado ? "line-through text-gray-400" : l.valor < 0 ? "text-emerald-600" : "text-gray-900 dark:text-gray-100"}`}>{fmtBRL(l.valor)}</td>
              {mostrarStatus && <td className="px-3 py-1.5 text-right whitespace-nowrap">{l.reembolsoStatus === "pago" ? <span className="text-[10px] font-semibold text-emerald-600">✓ pago</span> : <span className="text-[10px] font-semibold text-amber-600">pendente</span>}</td>}
            </tr>
            );
          })}
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
  const [rateioRow, setRateioRow] = useState<number | null>(null);  // linha com o editor de rateio aberto
  const [trocandoCartao, setTrocandoCartao] = useState(false);      // revela o select de cartão numa fatura já salva
  // Competência derivada do vencimento (mês/ano da fatura) — sem input manual.
  const competencia = venc && /^\d{4}-\d{2}/.test(venc) ? venc.slice(0, 7) : mesAtual();
  const nomeEmpresa = (id: string) => outrasEmpresas.find(e => e.id === id)?.nome || "?";
  const resumoRateio = (r: RateioSimples[]): string => {
    if (!r.length) return "Meu";
    if (r.length === 1) return `${nomeEmpresa(r[0].empresaId)}${r[0].percentual < 100 ? ` ${r[0].percentual}%` : ""}`;
    return `Rateio · ${r.length} empresas`;
  };

  // Organização por competência (mês/ano). Default = mais recente.
  const [compSel, setCompSel] = useState<string>("");
  const competencias = useMemo(() => [...new Set(faturas.map(f => f.competencia).filter(Boolean) as string[])].sort().reverse(), [faturas]);
  const compAtual = compSel && competencias.includes(compSel) ? compSel : (competencias[0] || "");
  const compLabel = (c: string) => { const M = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]; const [y, m] = c.split("-"); return `${M[Number(m) - 1] || m}/${y}`; };
  // Faturas do mês selecionado (rascunho E fechada), editáveis pelos chips.
  const faturasLista = faturas.filter(f => f.competencia === compAtual).sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
  const statusFatura = (id: string | null) => faturas.find(f => f.id === id)?.status;
  const ehFechada = statusFatura(faturaId) === "fechada";
  const bloqueado = ehFechada;   // publicada = travada; reabrir pra editar
  const editando = linhas.length > 0;

  // Ao abrir a Classificação, carrega automaticamente a 1ª fatura da lista (uma vez).
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (!autoLoaded.current && faturasLista.length > 0 && !editando && !faturaId) {
      autoLoaded.current = true;
      carregarRascunho(faturasLista[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faturasLista.length]);

  // Carrega um rascunho salvo de volta pro editor.
  function carregarRascunho(f: CartaoFatura) {
    const lancs = minhas.filter(l => l.faturaId === f.id).sort((a, b) => (a.data || "").localeCompare(b.data || ""));
    setFaturaId(f.id); setCartao(f.cartao || ""); setVenc(f.vencimento || null); setTotalFatura(f.totalFatura ?? null); setErro(""); setTrocandoCartao(false);
    setLinhas(lancs.map(l => ({
      data: l.dataOriginal || (l.data ? l.data.slice(8, 10) + "/" + l.data.slice(5, 7) : ""),
      descricao: l.descricao, valor: l.valor, parcela: l.parcela || null,
      rateio: rateioDeLanc(l), categoriaId: l.categoriaId || null, ignorar: l.ignorado || undefined,
    })));
  }
  function limpar() { setLinhas([]); setVenc(null); setTotalFatura(null); setCartao(""); setFaturaId(null); setErro(""); setTrocandoCartao(false); }
  // Troca a fatura sendo editada (navegação por chips). Avisa se há fatura nova não salva.
  function trocarPara(f: CartaoFatura) {
    if (f.id === faturaId) return;
    if (!faturaId && linhas.length && !confirm("Você tem uma fatura não salva. Descartar e abrir a outra?")) return;
    setTrocandoCartao(false);
    carregarRascunho(f);
  }
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

  // Rateio de um lançamento salvo → forma simples (compat: legado empresaAtribuidaId = 1 empresa 100%).
  function rateioDeLanc(l: CartaoLancamento): RateioSimples[] {
    if (Array.isArray(l.rateio) && l.rateio.length) return l.rateio.map(r => ({ empresaId: r.empresaId, percentual: r.percentual }));
    if (l.destinoTipo === "empresa" && l.empresaAtribuidaId) return [{ empresaId: l.empresaAtribuidaId, percentual: 100 }];
    return [];
  }
  // Rateio padrão de uma categoria (minha).
  const catRateioPadrao = (catId: string | null): RateioSimples[] => (catId && catsDe(rid).find(c => c.id === catId)?.rateioPadrao) || [];

  // Memória de comerciante: por nome normalizado → última classificação (categoria + rateio).
  const memoria = useMemo(() => {
    const m = new Map<string, { categoriaId: string | null; rateio: RateioSimples[] }>();
    for (const l of minhas) { if (l.ignorado) continue; const k = normNome(l.descricao); if (k && !m.has(k)) m.set(k, { categoriaId: l.categoriaId || null, rateio: rateioDeLanc(l) }); }
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minhas]);

  async function subirEExtrair(file: File) {
    setErro(""); setSubindo(true); setFaturaId(null);  // PDF novo = fatura nova
    try {
      const path = `faturas-cartao/${rid}/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, "_")}`;
      const snap = await uploadBytes(storageRef(storage, path), file, { contentType: "application/pdf" });
      const url = await getDownloadURL(snap.ref);
      const empresasNomes = outrasEmpresas.map(e => e.nome);
      const catNomes = catsDe(rid).map(c => c.nome);  // categoria é sempre da minha entidade
      const r = await fetch("/api/fatura-extrair", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ pdfUrl: url, cartoes, empresaPropria: empresaPropriaNome, empresas: empresasNomes, categorias: catNomes }) });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || "Falha na extração."); return; }
      setVenc(j.vencimento || null); setTotalFatura(typeof j.totalFatura === "number" ? j.totalFatura : null);
      setCartao(typeof j.cartao === "string" && j.cartao ? j.cartao : "");
      const novas: Extraido[] = (j.lancamentos || []).map((l: { data: string; descricao: string; valor: number; parcela: string | null; destinoEmpresa?: string | null; categoriaSugerida?: string | null }) => {
        // categoria (minha) sugerida pela IA
        let categoriaId: string | null = null;
        if (l.categoriaSugerida) categoriaId = catsDe(rid).find(c => c.nome.toLowerCase() === l.categoriaSugerida!.toLowerCase())?.id || null;
        // rateio sugerido: 1) rateio padrão da categoria; 2) empresa única da IA; 3) memória
        let rateio: RateioSimples[] = catRateioPadrao(categoriaId);
        if (!rateio.length && l.destinoEmpresa) {
          const emp = outrasEmpresas.find(e => e.nome.toLowerCase() === l.destinoEmpresa!.toLowerCase());
          if (emp) rateio = [{ empresaId: emp.id, percentual: 100 }];
        }
        if (!categoriaId && !rateio.length) {
          const mem = memoria.get(normNome(l.descricao));
          if (mem) { categoriaId = mem.categoriaId; rateio = mem.rateio.length ? mem.rateio : catRateioPadrao(mem.categoriaId); }
        }
        // pré-ignora pagamento da própria fatura (quitação anterior) se a IA deixar passar
        const ignorar = l.valor < 0 && /pagamento de fatura|pagto\.?\s*fatura|pagamento efetuad|pagamento recebid|pagamento online|pgto.*d[eé]bito|d[eé]bito autom[aá]tico/i.test(l.descricao) ? true : undefined;
        return { data: l.data, descricao: l.descricao, valor: l.valor, parcela: l.parcela, rateio, categoriaId, ignorar };
      });
      setLinhas(novas);
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao subir/extrair."); }
    finally { setSubindo(false); }
  }

  function setLinha(i: number, patch: Partial<Extraido>) { setLinhas(prev => prev.map((l, j) => j === i ? { ...l, ...patch } : l)); }
  function setRateio(i: number, rateio: RateioSimples[]) { setLinha(i, { rateio }); }
  // Ao escolher categoria: se ela tem rateio padrão e a linha ainda não tem
  // rateio próprio, aplica o padrão da categoria.
  function setCategoria(i: number, categoriaId: string | null) {
    setLinhas(prev => prev.map((l, j) => {
      if (j !== i) return l;
      const padrao = catRateioPadrao(categoriaId);
      const rateio = l.rateio.length ? l.rateio : padrao;
      return { ...l, categoriaId, rateio };
    }));
  }

  const toggleIgnorar = (i: number) => setLinhas(prev => prev.map((l, j) => j === i ? { ...l, ignorar: !l.ignorar } : l));
  const linhasValidas = linhas.filter(l => !l.ignorar);
  const somaClass = linhasValidas.reduce((s, l) => s + (l.valor || 0), 0);
  const diff = totalFatura != null ? Math.round((somaClass - totalFatura) * 100) / 100 : null;
  const naoClassificados = linhasValidas.filter(l => !l.categoriaId).length;

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
    // TRAVA DE DUPLICADO: fatura NOVA do mesmo cartão + competência que outra já salva.
    if (!faturaId && cartao) {
      const dup = faturas.find(f => f.id !== faturaId && f.cartao === cartao && f.competencia === competencia);
      if (dup) {
        const st = dup.status === "fechada" ? "publicada" : "rascunho";
        if (!confirm(`⚠️ Já existe uma fatura de ${cartao} nesta competência (${competencia.split("-").reverse().join("/")}, ${st}). Salvar outra vai DUPLICAR os lançamentos. Continuar mesmo assim?`)) return;
      }
    }
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
      // Linhas ignoradas ficam salvas (ignorado:true), fora de totais/reembolso.
      for (const old of minhas.filter(l => l.faturaId === fid)) batch.delete(doc(db, "cartaoLancamentos", old.id));
      linhas.forEach((l, i) => {
        const id = `${fid}_${i}`;
        if (l.ignorar) {
          batch.set(doc(db, "cartaoLancamentos", id), sanitizeForFirestore({
            id, restaurantId: rid, faturaId: fid, cartao,
            data: ymdDe(l.data), dataOriginal: l.data, descricao: l.descricao, valor: l.valor, parcela: l.parcela, obs: null,
            destinoTipo: "propria", empresaAtribuidaId: null, rateio: null, empresasRateadas: null, categoriaId: null,
            ignorado: true, publicado: fechar, criadoEm: agora, criadoPor: meId || null,
          }));
          return;
        }
        // Rateio: normaliza (%>0) e calcula o valor de cada fatia. Preserva o
        // status de PAGO da versão anterior (editar fatura publicada sem zerar pagamentos).
        const antigo = minhas.find(x => x.id === id);
        const partes: CartaoRateioParte[] = (l.rateio || []).filter(p => p.empresaId && p.percentual > 0).map(p => {
          const ap = antigo?.rateio?.find(x => x.empresaId === p.empresaId);
          return {
            empresaId: p.empresaId, percentual: p.percentual, valor: round2((l.valor || 0) * p.percentual / 100),
            status: fechar ? (ap?.status || "pendente") : undefined,
            pagoEm: ap?.pagoEm ?? null, pagoPor: ap?.pagoPor ?? null, pagoPorNome: ap?.pagoPorNome ?? null,
          };
        });
        const ehEmpresa = partes.length > 0;
        batch.set(doc(db, "cartaoLancamentos", id), sanitizeForFirestore({
          id, restaurantId: rid, faturaId: fid, cartao,
          data: ymdDe(l.data), dataOriginal: l.data, descricao: l.descricao, valor: l.valor, parcela: l.parcela, obs: null,
          destinoTipo: ehEmpresa ? "empresa" : "propria",
          empresaAtribuidaId: partes.length === 1 ? partes[0].empresaId : null,   // legado (1 empresa)
          rateio: ehEmpresa ? partes : null,
          empresasRateadas: ehEmpresa ? partes.map(p => p.empresaId) : null,
          categoriaId: l.categoriaId, ignorado: false,
          publicado: fechar,                                 // só publica ao fechar
          reembolsoDataPagamento: fechar && ehEmpresa ? (venc || null) : null,
          reembolsoChavePix: fechar && ehEmpresa ? (pixPadrao || null) : null,
          criadoEm: agora, criadoPor: meId || null,
        }));
      });
      await batch.commit();
      if (fechar) { const jaEra = faturaAtual?.status === "fechada"; limpar(); alert(jaEra ? "✅ Alterações salvas (fatura publicada)." : "✅ Fatura fechada. Reembolsos publicados pras outras empresas."); }
      else { setFaturaId(fid); alert("💾 Salvo como rascunho. Dá pra continuar editando pelos chips no topo."); }
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
          {competencias.length > 0 && (
            <label className="ml-auto text-[11px] text-gray-500 flex items-center gap-1.5">📅 Mês
              <select value={compAtual} onChange={e => { const v = e.target.value; setCompSel(v); const first = faturas.filter(f => f.competencia === v).sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""))[0]; if (first) trocarPara(first); else limpar(); }}
                className="text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1">
                {competencias.map(c => <option key={c} value={c}>{compLabel(c)}</option>)}
              </select>
            </label>
          )}
        </div>
        {cartoes.length === 0 && <p className="text-xs text-amber-600 mt-2">⚠️ Cadastre seus cartões na aba <b>Config</b> pra IA saber de qual cartão é cada fatura.</p>}
        {erro && <p className="text-xs text-rose-600 mt-2">{erro}</p>}
      </div>

      {/* Chips de navegação entre faturas do mês — sempre no topo (rascunho + publicadas) */}
      {(faturasLista.length > 0 || editando) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-gray-400 mr-0.5">Faturas de {compLabel(compAtual)}:</span>
          {faturasLista.map(f => (
            <SubChip key={f.id} ativo={f.id === faturaId} onClick={() => trocarPara(f)}>{f.cartao || "Cartão —"}{f.vencimento ? ` · ${f.vencimento.slice(8, 10)}/${f.vencimento.slice(5, 7)}` : ""}{f.status === "fechada" ? " ✓" : ""}</SubChip>
          ))}
          {editando && !faturaId && <SubChip ativo onClick={() => { /* atual */ }}>{cartao || "Nova"} · não salva</SubChip>}
        </div>
      )}

      {!editando && faturasLista.length > 0 && (
        <Vazio texto="Selecione uma fatura acima pra editar, ou suba um novo PDF." />
      )}

      {editando && (
        <>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500">Cartão:</span>
                {cartoes.length === 0 ? (
                  <b>{cartao || "—"}</b>
                ) : (faturaId && !trocandoCartao) || bloqueado ? (
                  <>
                    <b className="text-gray-800 dark:text-gray-200">{cartao || "—"}</b>
                    {!bloqueado && <button type="button" onClick={() => setTrocandoCartao(true)} className="text-[10px] text-indigo-600 hover:text-indigo-700">trocar cartão</button>}
                  </>
                ) : (
                  <select value={cartao} autoFocus onChange={e => { setCartao(e.target.value); setTrocandoCartao(false); }} className={`${inp} py-1 ${!cartao ? "border-amber-300" : ""}`}>
                    <option value="">— escolher —</option>
                    {cartoes.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                {cartoes.length > 0 && cartao && !faturaId && <span className="text-[10px] text-emerald-600">✓ identificado</span>}
              </div>
              <span className="text-gray-500">Vencimento: <b className="text-gray-800 dark:text-gray-200">{venc ? venc.split("-").reverse().join("/") : "—"}</b></span>
              <span className="text-gray-500">Total: <b className="text-gray-800 dark:text-gray-200">{totalFatura != null ? fmtBRL(totalFatura) : "—"}</b></span>
              <span className="text-gray-500">Classificado: <b className="text-gray-800 dark:text-gray-200">{fmtBRL(somaClass)}</b></span>
              {diff != null && <span className={Math.abs(diff) < 0.01 ? "text-emerald-600" : "text-amber-600"}>Diferença: <b>{fmtBRL(diff)}</b></span>}
              {naoClassificados > 0 && <span className="text-amber-600">{naoClassificados} sem categoria</span>}
              {faturaId && (ehFechada
                ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">publicada</span>
                : <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">rascunho</span>)}
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant={faturaId ? "danger" : "ghost"} onClick={() => void descartar()} disabled={salvando}>{faturaId ? "🗑 Excluir fatura" : "Descartar"}</Button>
              {ehFechada ? (
                <Button size="sm" onClick={() => void persistir(false)} disabled={salvando}>{salvando ? "…" : "↩ Reabrir pra editar"}</Button>
              ) : (
                <>
                  <Button size="sm" variant="secondary" onClick={() => void persistir(false)} disabled={salvando}>{salvando ? "…" : "💾 Salvar rascunho"}</Button>
                  <Button size="sm" onClick={() => void persistir(true)} disabled={salvando || (cartoes.length > 0 && !cartao)}>{salvando ? "…" : "✓ Fechar fatura"}</Button>
                </>
              )}
            </div>
          </div>
          {bloqueado
            ? <p className="text-[11px] text-emerald-700 dark:text-emerald-400 flex items-center gap-1">🔒 Fatura <b>publicada</b> — clique <b>Reabrir pra editar</b> pra mexer nos lançamentos.</p>
            : <p className="text-[11px] text-gray-500 flex items-center gap-1">✨ A fatura é toda sua. A IA já marcou os itens a <b className="text-violet-600 dark:text-violet-300">reembolsar</b> por outra empresa e a <b className="text-indigo-600 dark:text-indigo-300">categoria</b> — clique nas pílulas pra ajustar.</p>}
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="text-[11px] uppercase text-gray-400 bg-gray-50 dark:bg-gray-900/40">
                <th className="text-left px-2 py-2">Data</th><th className="text-left px-2 py-2">Descrição</th><th className="text-right px-2 py-2">Valor</th><th className="text-left px-2 py-2">Reembolso</th><th className="text-left px-2 py-2">Categoria</th>
              </tr></thead>
              <tbody>
                {linhas.map((l, i) => (
                    <tr key={i} className={`border-t border-gray-100 dark:border-gray-800 ${l.ignorar ? "opacity-45" : ""}`}>
                      <td className="px-2 py-1.5 whitespace-nowrap text-gray-500">{l.data}</td>
                      <td className="px-2 py-1.5">
                        <span className={l.ignorar ? "line-through" : ""}>{l.descricao}</span>{l.parcela && <span className="ml-1 text-[10px] text-gray-400">({l.parcela})</span>}
                        {!bloqueado && <button type="button" onClick={() => toggleIgnorar(i)} className="ml-2 text-[10px] text-gray-400 hover:text-rose-600 align-middle">{l.ignorar ? "↩ reincluir" : "✕ ignorar"}</button>}
                      </td>
                      <td className={`px-2 py-1.5 text-right tabular-nums ${l.ignorar ? "line-through text-gray-400" : l.valor < 0 ? "text-emerald-600" : ""}`}>{fmtBRL(l.valor)}</td>
                      {l.ignorar ? (
                        <td className="px-2 py-1.5 text-[11px] text-gray-400 italic" colSpan={2}>ignorado — não entra na fatura</td>
                      ) : (
                        <>
                          <td className="px-2 py-1.5">
                            <button type="button" disabled={bloqueado} onClick={() => setRateioRow(i)} className={chipSelect(l.rateio.length ? "empresa" : "neutro") + " pr-2.5" + (bloqueado ? " opacity-70 cursor-default" : "")}>{resumoRateio(l.rateio)}{bloqueado ? "" : " ▾"}</button>
                          </td>
                          <td className="px-2 py-1.5">
                            <select value={l.categoriaId || ""} disabled={bloqueado} onChange={e => setCategoria(i, e.target.value || null)} className={chipSelect(l.categoriaId ? "ok" : "vazio") + (bloqueado ? " opacity-70" : "")}>
                              <option value="">+ categoria</option>
                              {catsDe(rid).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                            </select>
                          </td>
                        </>
                      )}
                    </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {rateioRow != null && linhas[rateioRow] && (
        <RateioModal
          titulo={`Reembolso · ${linhas[rateioRow].descricao}`}
          empresas={outrasEmpresas}
          valorBase={linhas[rateioRow].valor}
          value={linhas[rateioRow].rateio}
          onChange={r => setRateio(rateioRow, r)}
          onClose={() => setRateioRow(null)}
        />
      )}
    </div>
  );
}

// ─── Editor de rateio percentual (por lançamento e por categoria) ────────────
function RateioModal({ titulo, empresas, value, valorBase, onChange, onClose }: {
  titulo: string; empresas: { id: string; nome: string }[]; value: RateioSimples[];
  valorBase?: number; onChange: (r: RateioSimples[]) => void; onClose: () => void;
}) {
  const [pcts, setPcts] = useState<Record<string, number>>(() => Object.fromEntries(value.map(p => [p.empresaId, p.percentual])));
  const total = Object.values(pcts).reduce((s, v) => s + (v || 0), 0);
  const sobra = round2(100 - total);
  const set = (id: string, v: number) => setPcts(p => ({ ...p, [id]: v }));
  // Divide 100% igualmente entre os ids (o último recebe a sobra do arredondamento).
  const distribuir = (ids: string[]): Record<string, number> => {
    const n = ids.length; if (!n) return {};
    const base = Math.floor(10000 / n) / 100;   // 2 casas, pra baixo
    const out: Record<string, number> = {};
    ids.forEach((id, i) => { out[id] = i === n - 1 ? round2(100 - base * (n - 1)) : base; });
    return out;
  };
  // Ao marcar/desmarcar, redistribui igualmente entre as selecionadas (praxe; edita depois).
  const toggle = (id: string, on: boolean) => setPcts(p => {
    const ids = new Set(Object.keys(p));
    if (on) ids.add(id); else ids.delete(id);
    return distribuir([...ids]);
  });
  function salvar() {
    const r: RateioSimples[] = Object.entries(pcts).filter(([, v]) => v > 0).map(([empresaId, percentual]) => ({ empresaId, percentual: round2(percentual) }));
    onChange(r); onClose();
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-4 space-y-3" onClick={e => e.stopPropagation()}>
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Rateio percentual</div>
          <div className="text-[11px] text-gray-500 truncate">{titulo}</div>
        </div>
        <p className="text-xs text-gray-500">Marque uma ou mais empresas que reembolsam e o % de cada uma. O que sobrar fica como gasto seu (sem reembolso).</p>
        <div className="max-h-64 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
          {empresas.map(em => {
            const on = pcts[em.id] != null;
            return (
              <div key={em.id} className="flex items-center gap-2 py-2">
                <input type="checkbox" checked={on} onChange={e => toggle(em.id, e.target.checked)} />
                <span className="flex-1 text-sm">{em.nome}</span>
                {on && (
                  <div className="flex items-center gap-1">
                    <input type="number" min={0} max={100} value={pcts[em.id] || 0} onChange={e => set(em.id, Number(e.target.value))}
                      className="w-16 px-2 py-1 text-sm text-right rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
                    <span className="text-xs text-gray-400">%</span>
                    {valorBase != null && <span className="w-20 text-right text-[11px] text-gray-500 tabular-nums">{fmtBRL(round2((valorBase || 0) * (pcts[em.id] || 0) / 100))}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className={total > 100 ? "text-rose-600 font-medium" : "text-gray-500"}>Total: {round2(total)}% {total > 100 ? "(passou de 100%)" : sobra > 0 ? `· sobra ${sobra}% (meu)` : "· 100%"}</span>
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setPcts({})}>Limpar</Button>
            <Button size="sm" onClick={salvar} disabled={total > 100}>Aplicar</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Config: Cartões + Pix + Categorias ──────────────────────────────────────
function Categorias({ rid, categorias, pixPadrao, cartoes, outrasEmpresas }: { rid: string; categorias: CartaoCategoria[]; pixPadrao: string; cartoes: string[]; outrasEmpresas: { id: string; nome: string }[] }) {
  const [nome, setNome] = useState("");
  const [pix, setPix] = useState(pixPadrao);
  const [salvandoPix, setSalvandoPix] = useState(false);
  const [novoCartao, setNovoCartao] = useState("");
  const [rateioCat, setRateioCat] = useState<CartaoCategoria | null>(null);   // categoria com editor de rateio aberto
  const nomeEmp = (id: string) => outrasEmpresas.find(e => e.id === id)?.nome || "?";
  const resumoRateioCat = (r?: { empresaId: string; percentual: number }[]) => !r?.length ? "" : r.length === 1 ? `${nomeEmp(r[0].empresaId)} ${r[0].percentual}%` : `rateio ${r.length} empresas`;
  async function salvarRateioCat(cat: CartaoCategoria, r: { empresaId: string; percentual: number }[]) {
    await updateDoc(doc(db, "cartaoCategorias", cat.id), { rateioPadrao: r.length ? r : null });
  }
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
            <div key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">{c.nome}
                {c.rateioPadrao?.length ? <span className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">↩ {resumoRateioCat(c.rateioPadrao)}</span> : null}
              </span>
              <span className="flex items-center gap-2 whitespace-nowrap">
                <button type="button" onClick={() => setRateioCat(c)} className="text-[11px] text-indigo-600 hover:text-indigo-700" disabled={outrasEmpresas.length === 0}>rateio padrão</button>
                <button type="button" onClick={() => void excluir(c.id)} className="text-[11px] text-gray-400 hover:text-rose-600">excluir</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {rateioCat && (
        <RateioModal
          titulo={`Rateio padrão · ${rateioCat.nome}`}
          empresas={outrasEmpresas}
          value={(rateioCat.rateioPadrao || []).map(p => ({ empresaId: p.empresaId, percentual: p.percentual }))}
          onChange={r => void salvarRateioCat(rateioCat, r)}
          onClose={() => setRateioCat(null)}
        />
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
