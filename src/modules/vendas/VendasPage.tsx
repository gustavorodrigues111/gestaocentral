// Módulo de Vendas — registro de vendas fora do sistema fiscal principal
// (entre empresas, permutas, sem margem). Ver planejamento no CLAUDE/PR.
//
// Empresa = restaurante ativo (vendedora). Cliente interno = outro restaurante
// do sistema; externo = nome/contato livre. Cadastros: produtos e clientes por
// empresa; formas de pagamento globais.
import { useEffect, useMemo, useState } from "react";
import {
  addDoc, collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc, where,
} from "firebase/firestore";
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { Select } from "../../core/ui/Select";
import { Modal } from "../../core/ui/Modal";
import { useAbrirWhatsapp } from "../../core/whatsapp/roteios";
import { fmtBR } from "../../core/utils/date";
import type {
  Venda, VendaCliente, VendaCobranca, VendaFormaPagamento, VendaItem, VendaPagamento,
  VendaProduto, VendaStatus,
} from "../../core/types";
import { VENDA_STATUS_LABEL } from "../../core/types";
import {
  fmtMoeda, hojeYmd, maskMoeda, montarMensagemCobranca, parseMoeda, proximoNumero,
  recomputarVenda, vendasReciprocasDisponiveis,
} from "./helpers";

const MAX_COMPROV_MB = 20;
type Tab = "vendas" | "produtos" | "clientes" | "formas";
const STATUS_COR: Record<VendaStatus, string> = {
  aberta: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  cobranca_enviada: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  quitada: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};

export function VendasPage() {
  const { pessoa } = useAuth();
  const { activeRestaurant, restaurants } = useRestaurant();
  const rid = activeRestaurant?.id;
  const { can } = useCanAcao(rid || "");
  const abrirWhatsapp = useAbrirWhatsapp();
  const [tab, setTab] = useState<Tab>("vendas");

  const [vendas, setVendas] = useState<Venda[]>([]);
  const [vendasRecebidas, setVendasRecebidas] = useState<Venda[]>([]); // de terceiros PRA mim (permuta)
  const [produtos, setProdutos] = useState<VendaProduto[]>([]);
  const [clientes, setClientes] = useState<VendaCliente[]>([]);
  const [formas, setFormas] = useState<VendaFormaPagamento[]>([]);

  const [novaVenda, setNovaVenda] = useState(false);
  const [editVenda, setEditVenda] = useState<Venda | null>(null);
  const [cobrando, setCobrando] = useState(false);
  const [pagarVenda, setPagarVenda] = useState<Venda | null>(null);
  const [filtro, setFiltro] = useState<VendaStatus | "todas">("todas");
  const [busca, setBusca] = useState("");

  const empresaNome = (id?: string | null) => restaurants.find(r => r.id === id)?.nome || "—";

  useEffect(() => {
    if (!rid) return;
    const u1 = onSnapshot(query(collection(db, "vendas"), where("restaurantId", "==", rid)),
      s => setVendas(s.docs.map(d => ({ id: d.id, ...d.data() } as Venda))));
    const u2 = onSnapshot(query(collection(db, "vendas"), where("clienteRestauranteVinculadoId", "==", rid)),
      s => setVendasRecebidas(s.docs.map(d => ({ id: d.id, ...d.data() } as Venda))));
    const u3 = onSnapshot(query(collection(db, "vendasProdutos"), where("restaurantId", "==", rid)),
      s => setProdutos(s.docs.map(d => ({ id: d.id, ...d.data() } as VendaProduto))));
    const u4 = onSnapshot(query(collection(db, "vendasClientes"), where("restaurantId", "==", rid)),
      s => setClientes(s.docs.map(d => ({ id: d.id, ...d.data() } as VendaCliente))));
    const u5 = onSnapshot(collection(db, "vendasFormasPagamento"),
      s => setFormas(s.docs.map(d => ({ id: d.id, ...d.data() } as VendaFormaPagamento))));
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, [rid]);

  const vendasFiltradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const arr = (filtro === "todas" ? vendas : vendas.filter(v => v.status === filtro))
      .filter(v => !q || v.clienteNomeSnapshot.toLowerCase().includes(q) || (v.numero || "").toLowerCase().includes(q));
    return arr.slice().sort((a, b) => (b.data || "").localeCompare(a.data || "") || (b.numero || "").localeCompare(a.numero || ""));
  }, [vendas, filtro, busca]);

  const cont = useMemo(() => ({
    todas: vendas.length,
    aberta: vendas.filter(v => v.status === "aberta").length,
    cobranca_enviada: vendas.filter(v => v.status === "cobranca_enviada").length,
    quitada: vendas.filter(v => v.status === "quitada").length,
    aberto: Math.round(vendas.filter(v => v.status !== "quitada").reduce((s, v) => s + (v.saldo ?? v.valorTotal), 0) * 100) / 100,
  }), [vendas]);

  // KPIs do topo — recebido/permutas do mês corrente.
  const kpi = useMemo(() => {
    const mes = new Date().toISOString().slice(0, 7);
    let recebidoMes = 0, permutasMes = 0;
    for (const v of vendas) for (const p of v.pagamentos || []) {
      if (!(p.data || "").startsWith(mes)) continue;
      if (p.tipo === "permuta") permutasMes += p.valor || 0;
      else recebidoMes += p.valor || 0;
    }
    return {
      emAberto: cont.aberto,
      abertasCount: cont.aberta + cont.cobranca_enviada,
      recebidoMes: Math.round(recebidoMes * 100) / 100,
      permutasMes: Math.round(permutasMes * 100) / 100,
    };
  }, [vendas, cont]);

  // Salva um pagamento numa venda (recomputa) e, se for permuta interna,
  // quita reciprocamente a venda da outra empresa.
  async function registrarPagamento(venda: Venda, pag: VendaPagamento) {
    const atualizada = recomputarVenda({ ...venda, pagamentos: [...(venda.pagamentos || []), pag] });
    await updateDoc(doc(db, "vendas", venda.id), sanitizeForFirestore({
      pagamentos: atualizada.pagamentos, valorPago: atualizada.valorPago,
      saldo: atualizada.saldo, status: atualizada.status, quitadoEm: atualizada.quitadoEm,
    }));
    if (pag.tipo === "permuta" && pag.permutaVendaId) {
      const recip = vendasRecebidas.find(v => v.id === pag.permutaVendaId);
      if (recip) {
        const pagRecip: VendaPagamento = {
          id: `pag_${Date.now()}_r`,
          tipo: "permuta",
          valor: pag.valor,
          data: pag.data,
          permutaVendaId: venda.id,
          permutaVendaNumero: venda.numero,
          permutaEmpresaNome: empresaNome(venda.restaurantId),
          permutaDescricao: `Permuta recíproca com ${venda.numero}`,
          registradoPor: pessoa?.id,
          registradoPorNome: pessoa?.nome,
          registradoEm: new Date().toISOString(),
        };
        const recAtu = recomputarVenda({ ...recip, pagamentos: [...(recip.pagamentos || []), pagRecip] });
        await updateDoc(doc(db, "vendas", recip.id), sanitizeForFirestore({
          pagamentos: recAtu.pagamentos, valorPago: recAtu.valorPago,
          saldo: recAtu.saldo, status: recAtu.status, quitadoEm: recAtu.quitadoEm,
        }));
      }
    }
  }

  async function excluirVenda(v: Venda) {
    if (!confirm(`Excluir a venda ${v.numero} de ${v.clienteNomeSnapshot}? Essa ação não pode ser desfeita.`)) return;
    await deleteDoc(doc(db, "vendas", v.id));
  }

  // Cobrança rápida de UMA venda: abre o WhatsApp do cliente e marca como
  // "cobrança enviada".
  async function cobrarUma(v: Venda) {
    const cliente = clientes.find(c => c.id === v.clienteId) || null;
    if (v.status === "aberta") await updateDoc(doc(db, "vendas", v.id), { status: "cobranca_enviada" });
    // Cliente INTERNO (empresa do sistema): a cobrança vira aviso na Central de
    // Avisos da empresa vinculada — não abre WhatsApp.
    if (v.clienteTipo === "interna" && v.clienteRestauranteVinculadoId) {
      alert(`✅ Cobrança enviada pra Central de Avisos de ${v.clienteNomeSnapshot}.`);
      return;
    }
    const msg = montarMensagemCobranca(activeRestaurant?.nome || "", cliente, [v]);
    void abrirWhatsapp(rid || "", "vendas", v.clienteWhatsappSnapshot || cliente?.whatsapp || "", v.clienteNomeSnapshot, msg);
  }

  if (!rid) return <div className="text-center py-12 text-gray-500">Selecione uma empresa.</div>;
  if (!can("vendas", "ver")) return <div className="text-center py-12 text-gray-500">Você não tem acesso a Vendas.</div>;

  const podeLancar = can("vendas", "lancar");
  const podeQuitar = can("vendas", "quitar");
  const podeCobrar = can("vendas", "cobrar");
  const podeConfig = can("vendas", "config");

  return (
    <div className="max-w-6xl mx-auto p-4">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">🧾 Vendas</h1>
          <p className="text-xs text-gray-500">{activeRestaurant?.nome} · registro fora do sistema fiscal (entre empresas, permutas)</p>
        </div>
        <div className="flex gap-2">
          {podeCobrar && <Button size="sm" variant="secondary" className="flex-1 sm:flex-none" onClick={() => setCobrando(true)}>📤 Gerar cobrança</Button>}
          {podeLancar && <Button className="flex-1 sm:flex-none" onClick={() => setNovaVenda(true)}>+ Nova venda</Button>}
        </div>
      </header>

      <nav className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-4">
        <TabBtn ativo={tab === "vendas"} onClick={() => setTab("vendas")}>Vendas</TabBtn>
        {podeConfig && <TabBtn ativo={tab === "produtos"} onClick={() => setTab("produtos")}>Produtos</TabBtn>}
        {podeConfig && <TabBtn ativo={tab === "clientes"} onClick={() => setTab("clientes")}>Clientes</TabBtn>}
        {podeConfig && <TabBtn ativo={tab === "formas"} onClick={() => setTab("formas")}><span className="sm:hidden">Formas</span><span className="hidden sm:inline">Formas de pgto</span></TabBtn>}
      </nav>

      {tab === "vendas" && (
        <div>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-4">
            <KpiCard label="Em aberto" valor={fmtMoeda(kpi.emAberto)} hint={`${kpi.abertasCount} venda(s)`} />
            <KpiCard label="Recebido no mês" valor={fmtMoeda(kpi.recebidoMes)} hint="pagamentos" />
            <KpiCard label="Permutas no mês" valor={fmtMoeda(kpi.permutasMes)} hint="entre empresas" />
            <KpiCard label="Cobranças enviadas" valor={String(cont.cobranca_enviada)} hint="aguardando" />
          </div>

          {/* Filtro segmentado + busca — 2 colunas no mobile (sem rolagem lateral) */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
            <div className="grid grid-cols-2 sm:inline-flex gap-1 sm:gap-0 rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
              <Seg ativo={filtro === "todas"} onClick={() => setFiltro("todas")}>Todas ({cont.todas})</Seg>
              <Seg ativo={filtro === "aberta"} onClick={() => setFiltro("aberta")}>Abertas ({cont.aberta})</Seg>
              <Seg ativo={filtro === "cobranca_enviada"} onClick={() => setFiltro("cobranca_enviada")}>Cobrança ({cont.cobranca_enviada})</Seg>
              <Seg ativo={filtro === "quitada"} onClick={() => setFiltro("quitada")}>Quitadas ({cont.quitada})</Seg>
            </div>
            <div className="flex items-center gap-2 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm w-full sm:w-auto sm:min-w-[200px]">
              <span className="text-gray-400 text-sm">🔎</span>
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar cliente ou nº…" className="w-full py-2 bg-transparent text-sm outline-none dark:text-gray-100" />
            </div>
          </div>

          {vendasFiltradas.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">
              {busca ? "Nada encontrado pra essa busca." : `Nenhuma venda ${filtro !== "todas" ? "nesse status" : "registrada"} ainda.`}
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden divide-y divide-gray-100 dark:divide-gray-800">
              {vendasFiltradas.map(v => (
                <VendaRow
                  key={v.id} venda={v} empresaNome={empresaNome}
                  podeQuitar={podeQuitar} podeLancar={podeLancar} podeCobrar={podeCobrar}
                  onPagar={() => setPagarVenda(v)}
                  onEditar={() => setEditVenda(v)}
                  onExcluir={() => excluirVenda(v)}
                  onCobrar={() => cobrarUma(v)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "produtos" && <CadastroProdutos rid={rid} produtos={produtos} />}
      {tab === "clientes" && <CadastroClientes rid={rid} clientes={clientes} restaurants={restaurants} />}
      {tab === "formas" && <CadastroFormas formas={formas} />}

      {(novaVenda || editVenda) && (
        <NovaVendaModal
          rid={rid} produtos={produtos} clientes={clientes} vendas={vendas}
          vendaEdit={editVenda}
          meId={pessoa?.id} meNome={pessoa?.nome}
          onClose={() => { setNovaVenda(false); setEditVenda(null); }}
        />
      )}
      {cobrando && (
        <CobrancaModal
          rid={rid} empresaNome={activeRestaurant?.nome || ""} vendas={vendas} clientes={clientes}
          meId={pessoa?.id} meNome={pessoa?.nome}
          onClose={() => setCobrando(false)}
        />
      )}
      {pagarVenda && (
        <PagamentoModal
          venda={pagarVenda} formas={formas} vendasRecebidas={vendasRecebidas}
          empresaNome={empresaNome} meId={pessoa?.id} meNome={pessoa?.nome}
          onSalvar={registrarPagamento}
          onClose={() => setPagarVenda(null)}
        />
      )}
    </div>
  );
}

// ─── Linha de venda (estilo fatura) ─────────────────────────────────────────
function iniciais(nome: string): string {
  const p = (nome || "").trim().split(/\s+/);
  return ((p[0]?.[0] || "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() || "–";
}
function VendaRow({ venda: v, empresaNome, podeQuitar, podeLancar, podeCobrar, onPagar, onEditar, onExcluir, onCobrar }: {
  venda: Venda; empresaNome: (id?: string | null) => string;
  podeQuitar: boolean; podeLancar: boolean; podeCobrar: boolean;
  onPagar: () => void; onEditar: () => void; onExcluir: () => void; onCobrar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const itensResumo = v.itens?.map(i => i.descricao).filter(Boolean).slice(0, 3).join(", ");
  return (
    <div className={aberto ? "bg-gray-50/60 dark:bg-gray-800/30" : ""}>
      <button type="button" onClick={() => setAberto(a => !a)} className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${v.clienteTipo === "interna" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"}`}>{iniciais(v.clienteNomeSnapshot)}</div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {v.clienteNomeSnapshot}
            {v.clienteTipo === "interna" && <span className="ml-2 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">interna</span>}
          </div>
          <div className="text-xs text-gray-500 truncate">{v.numero} · {fmtBR(v.data)}{itensResumo ? ` · ${itensResumo}` : ""}</div>
        </div>
        <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full shrink-0 ${STATUS_COR[v.status]}`}>{VENDA_STATUS_LABEL[v.status]}</span>
        <div className="text-right shrink-0 min-w-[84px]">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{fmtMoeda(v.valorTotal)}</div>
          {v.status === "quitada"
            ? <div className="text-[10px] text-emerald-600 dark:text-emerald-400">✓ paga</div>
            : v.saldo < v.valorTotal && <div className="text-[10px] text-gray-500">saldo {fmtMoeda(v.saldo)}</div>}
        </div>
        <span className="text-gray-400 text-xs w-3 shrink-0">{aberto ? "▲" : "▼"}</span>
      </button>

      {aberto && (
        <div className="px-4 pb-4 sm:pl-16 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Itens</div>
              <div className="space-y-0.5">
                {v.itens?.map((it, i) => (
                  <div key={i} className="flex justify-between gap-2 text-xs text-gray-600 dark:text-gray-300 border-b border-gray-100 dark:border-gray-800 last:border-0 py-0.5">
                    <span className="truncate">{it.qtd} × {it.descricao}</span>
                    <span className="tabular-nums shrink-0">{fmtMoeda(it.total)}</span>
                  </div>
                ))}
              </div>
              {v.observacoes && <div className="text-[11px] text-gray-500 italic mt-1">{v.observacoes}</div>}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Pagamentos</div>
              {(v.pagamentos?.length ?? 0) === 0 ? (
                <div className="text-xs text-gray-400 italic">Nenhum pagamento ainda.</div>
              ) : (
                <div className="space-y-0.5">
                  {v.pagamentos.map((p, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 py-0.5">
                      <span className="shrink-0">{p.tipo === "permuta" ? "🔄" : "💵"}</span>
                      <span className="flex-1 min-w-0 truncate">
                        {p.tipo === "permuta"
                          ? `Permuta${p.permutaVendaNumero ? ` · ${p.permutaVendaNumero}${p.permutaEmpresaNome ? ` (${p.permutaEmpresaNome})` : ""}` : p.permutaDescricao ? ` · ${p.permutaDescricao}` : ""}`
                          : p.formaNome || "Pagamento"}
                        {p.infoRecebimento && ` · ${p.infoRecebimento}`}
                        {p.comprovanteUrl && <> · <a href={p.comprovanteUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-indigo-600 dark:text-indigo-400 underline">comprovante</a></>}
                        <span className="text-gray-400"> · {fmtBR(p.data)}</span>
                      </span>
                      <span className="tabular-nums shrink-0 font-medium">{fmtMoeda(p.valor)}</span>
                    </div>
                  ))}
                  {v.status !== "quitada" && (
                    <div className="flex items-center gap-2 text-xs text-gray-500 pt-0.5">
                      <span className="shrink-0">⏳</span><span className="flex-1">Saldo a receber</span>
                      <span className="tabular-nums font-semibold text-gray-800 dark:text-gray-100">{fmtMoeda(v.saldo)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {v.status !== "quitada" && podeQuitar && <Button size="sm" onClick={onPagar}>💰 Registrar pagamento</Button>}
            {v.status !== "quitada" && podeCobrar && <Button size="sm" variant="secondary" onClick={onCobrar}>💬 Cobrar no WhatsApp</Button>}
            {podeLancar && <Button size="sm" variant="ghost" onClick={onEditar}>✏️ Editar</Button>}
            {podeLancar && <Button size="sm" variant="ghost" onClick={onExcluir}>🗑️ Excluir</Button>}
          </div>
          {v.clienteTipo === "interna" && <div className="text-[10px] text-gray-400">Empresa vendedora: {empresaNome(v.restaurantId)}</div>}
        </div>
      )}
    </div>
  );
}

// ─── Modal: nova venda / editar ──────────────────────────────────────────────
function NovaVendaModal({ rid, produtos, clientes, vendas, vendaEdit, meId, meNome, onClose }: {
  rid: string; produtos: VendaProduto[]; clientes: VendaCliente[]; vendas: Venda[];
  vendaEdit?: Venda | null; meId?: string; meNome?: string; onClose: () => void;
}) {
  const editando = !!vendaEdit;
  const [clienteId, setClienteId] = useState(vendaEdit?.clienteId || "");
  const [data, setData] = useState(vendaEdit?.data || hojeYmd());
  const [itens, setItens] = useState<VendaItem[]>(vendaEdit?.itens ? [...vendaEdit.itens] : []);
  const [obs, setObs] = useState(vendaEdit?.observacoes || "");
  const [salvando, setSalvando] = useState(false);
  const clientesAtivos = clientes.filter(c => c.ativo !== false);
  const produtosAtivos = produtos.filter(p => p.ativo !== false);

  const total = itens.reduce((s, it) => s + it.total, 0);

  function addProduto() {
    setItens(a => [...a, { produtoId: null, descricao: "", qtd: 1, precoUnit: 0, total: 0 }]);
  }
  function setItem(i: number, patch: Partial<VendaItem>) {
    setItens(a => a.map((it, idx) => {
      if (idx !== i) return it;
      const next = { ...it, ...patch };
      next.total = Math.round((next.qtd || 0) * (next.precoUnit || 0) * 100) / 100;
      return next;
    }));
  }
  function escolherProduto(i: number, produtoId: string) {
    const p = produtos.find(x => x.id === produtoId);
    if (!p) { setItem(i, { produtoId: null }); return; }
    setItens(a => a.map((it, idx) => idx === i
      ? { ...it, produtoId: p.id, descricao: p.nome, precoUnit: p.precoPadrao || 0, total: Math.round((it.qtd || 1) * (p.precoPadrao || 0) * 100) / 100 }
      : it));
  }

  async function salvar() {
    const cliente = clientes.find(c => c.id === clienteId);
    if (!cliente) { alert("Escolha um cliente."); return; }
    const validos = itens.filter(it => it.descricao.trim() && it.total > 0);
    if (validos.length === 0) { alert("Adicione ao menos um item com descrição e valor."); return; }
    setSalvando(true);
    try {
      const valorTotal = Math.round(total * 100) / 100;
      if (editando && vendaEdit) {
        // Recalcula saldo/status a partir dos pagamentos existentes + novo total.
        const atu = recomputarVenda({ ...vendaEdit, itens: validos, valorTotal });
        await updateDoc(doc(db, "vendas", vendaEdit.id), sanitizeForFirestore({
          clienteId: cliente.id, clienteNomeSnapshot: cliente.nome, clienteTipo: cliente.tipo,
          clienteWhatsappSnapshot: cliente.whatsapp || null,
          clienteRestauranteVinculadoId: cliente.tipo === "interna" ? (cliente.restauranteVinculadoId || null) : null,
          data, itens: validos, valorTotal,
          observacoes: obs.trim() || null,
          saldo: atu.saldo, status: atu.status, quitadoEm: atu.quitadoEm,
        }));
        onClose();
        return;
      }
      const ano = Number(data.slice(0, 4)) || new Date().getFullYear();
      const numero = proximoNumero("VENDA", ano, vendas.map(v => v.numero));
      const id = `venda_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const venda: Venda = {
        id, restaurantId: rid, numero, data,
        clienteId: cliente.id, clienteNomeSnapshot: cliente.nome, clienteTipo: cliente.tipo,
        clienteWhatsappSnapshot: cliente.whatsapp || null,
        clienteRestauranteVinculadoId: cliente.tipo === "interna" ? (cliente.restauranteVinculadoId || null) : null,
        itens: validos,
        valorTotal,
        status: "aberta",
        pagamentos: [], valorPago: 0, saldo: valorTotal,
        cobrancaId: null,
        observacoes: obs.trim() || null,
        criadoEm: new Date().toISOString(), criadoPor: meId, criadoPorNome: meNome, quitadoEm: null,
      };
      await setDoc(doc(db, "vendas", id), sanitizeForFirestore(venda));
      onClose();
    } catch (e) {
      alert("Erro ao salvar: " + (e instanceof Error ? e.message : String(e)));
    } finally { setSalvando(false); }
  }

  return (
    <Modal title={editando ? `Editar ${vendaEdit?.numero}` : "Nova venda"} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Select label="Cliente" value={clienteId} onChange={e => setClienteId(e.target.value)}>
            <option value="">Selecione…</option>
            {clientesAtivos.map(c => <option key={c.id} value={c.id}>{c.nome}{c.tipo === "interna" ? " (interna)" : ""}</option>)}
          </Select>
          <Input label="Data" type="date" value={data} onChange={e => setData(e.target.value)} />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Itens</span>
            <button type="button" onClick={addProduto} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">+ adicionar item</button>
          </div>
          <div className="space-y-2">
            {itens.map((it, i) => (
              <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
                <select value={it.produtoId || ""} onChange={e => escolherProduto(i, e.target.value)} className="col-span-4 px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs">
                  <option value="">Linha livre</option>
                  {produtosAtivos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
                <input value={it.descricao} onChange={e => setItem(i, { descricao: e.target.value })} placeholder="descrição" className="col-span-4 px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs" />
                <input value={it.qtd} onChange={e => setItem(i, { qtd: Number(e.target.value.replace(",", ".")) || 0 })} inputMode="decimal" placeholder="qtd" className="col-span-1 px-1 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs text-right" />
                <div className="col-span-2 flex items-center rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-1">
                  <span className="text-[10px] text-gray-400">R$</span>
                  <input value={it.precoUnit ? it.precoUnit.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : ""} onChange={e => setItem(i, { precoUnit: parseMoeda(e.target.value) })} inputMode="numeric" placeholder="0,00" className="w-full px-1 py-1.5 bg-transparent text-right text-xs outline-none" />
                </div>
                <button type="button" onClick={() => setItens(a => a.filter((_, idx) => idx !== i))} className="col-span-1 text-red-500 hover:text-red-700 text-sm">✕</button>
              </div>
            ))}
            {itens.length === 0 && <div className="text-xs text-gray-400 italic">Nenhum item. Clique em "adicionar item".</div>}
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-500">Observações</label>
          <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2} className="mt-0.5 w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-800">
          <span className="text-sm text-gray-500">Total</span>
          <span className="text-lg font-bold text-gray-900 dark:text-gray-100">{fmtMoeda(total)}</span>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : editando ? "Salvar alterações" : "Salvar venda"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal: registrar pagamento (forma OU permuta) ──────────────────────────
function PagamentoModal({ venda, formas, vendasRecebidas, empresaNome, meId, meNome, onSalvar, onClose }: {
  venda: Venda; formas: VendaFormaPagamento[]; vendasRecebidas: Venda[];
  empresaNome: (id?: string | null) => string; meId?: string; meNome?: string;
  onSalvar: (v: Venda, p: VendaPagamento) => Promise<void>; onClose: () => void;
}) {
  const [tipo, setTipo] = useState<"forma" | "permuta">("forma");
  const [formaId, setFormaId] = useState("");
  const [valorStr, setValorStr] = useState(maskMoeda(String(Math.round((venda.saldo || 0) * 100))));
  const [data, setData] = useState(hojeYmd());
  const [info, setInfo] = useState("");
  const [permutaVendaId, setPermutaVendaId] = useState("");
  const [permutaDesc, setPermutaDesc] = useState("");
  const [comprovante, setComprovante] = useState<{ url: string; nome: string } | null>(null);
  const [subindo, setSubindo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const formasAtivas = formas.filter(f => f.ativo !== false);

  const reciprocas = useMemo(() => vendasReciprocasDisponiveis(venda, [...vendasRecebidas]), [venda, vendasRecebidas]);
  const ehInterna = venda.clienteTipo === "interna";
  const permutaSel = reciprocas.find(v => v.id === permutaVendaId);

  // Ao escolher uma permuta interna, o valor entra travado no menor saldo.
  const valor = parseMoeda(valorStr);

  function uploadComprovante(file: File) {
    if (file.size / (1024 * 1024) > MAX_COMPROV_MB) { alert(`Arquivo muito grande (máx ${MAX_COMPROV_MB}MB).`); return; }
    setSubindo(true);
    const id = `comp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const ext = file.name.split(".").pop() || "bin";
    const path = `vendas-comprovantes/${venda.restaurantId}/${venda.id}/${id}.${ext}`;
    const task = uploadBytesResumable(storageRef(storage, path), file, { customMetadata: { vendaId: venda.id } });
    task.on("state_changed", undefined,
      (err) => { alert("Erro no upload: " + err.message + "\n(Regras do Storage podem precisar de deploy.)"); setSubindo(false); },
      async () => { const url = await getDownloadURL(task.snapshot.ref); setComprovante({ url, nome: file.name }); setSubindo(false); });
  }

  async function salvar() {
    if (tipo === "permuta" && ehInterna && !permutaVendaId) { alert("Escolha a venda da outra empresa pra usar como permuta."); return; }
    if (tipo === "permuta" && !ehInterna && !permutaDesc.trim()) { alert("Descreva a compra usada como permuta."); return; }
    if (valor <= 0) { alert("Informe o valor."); return; }
    setSalvando(true);
    try {
      const pag: VendaPagamento = {
        id: `pag_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        tipo, valor, data,
        registradoPor: meId, registradoPorNome: meNome, registradoEm: new Date().toISOString(),
      };
      if (tipo === "forma") {
        const f = formas.find(x => x.id === formaId);
        pag.formaId = formaId || null;
        pag.formaNome = f?.nome || "Pagamento";
        pag.comprovanteUrl = comprovante?.url || null;
        pag.comprovanteNome = comprovante?.nome || null;
        pag.infoRecebimento = info.trim() || null;
      } else if (ehInterna && permutaSel) {
        pag.permutaVendaId = permutaSel.id;
        pag.permutaVendaNumero = permutaSel.numero;
        pag.permutaEmpresaNome = empresaNome(permutaSel.restaurantId);
        pag.permutaDescricao = `Permuta com ${permutaSel.numero}`;
      } else {
        pag.permutaDescricao = permutaDesc.trim();
      }
      await onSalvar(venda, pag);
      onClose();
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : String(e)));
    } finally { setSalvando(false); }
  }

  return (
    <Modal title={`Pagamento — ${venda.numero}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <div className="text-sm text-gray-600 dark:text-gray-300 flex justify-between">
          <span>{venda.clienteNomeSnapshot} · total {fmtMoeda(venda.valorTotal)}</span>
          <span>saldo <strong>{fmtMoeda(venda.saldo)}</strong></span>
        </div>

        <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5 w-full">
          <button type="button" onClick={() => setTipo("forma")} className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded ${tipo === "forma" ? "bg-white dark:bg-gray-900 text-indigo-700 dark:text-indigo-300 shadow-sm" : "text-gray-500"}`}>Forma de pagamento</button>
          <button type="button" onClick={() => setTipo("permuta")} className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded ${tipo === "permuta" ? "bg-white dark:bg-gray-900 text-indigo-700 dark:text-indigo-300 shadow-sm" : "text-gray-500"}`}>Permuta</button>
        </div>

        {tipo === "forma" ? (
          <>
            <Select label="Forma" value={formaId} onChange={e => setFormaId(e.target.value)}>
              <option value="">Selecione…</option>
              {formasAtivas.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </Select>
            <Input label="Info do recebimento (opcional)" value={info} onChange={e => setInfo(e.target.value)} placeholder="ex: PIX recebido na conta X" />
            <div>
              <label className="text-xs text-gray-500">Comprovante (opcional)</label>
              <div className="mt-0.5 flex items-center gap-2">
                <input type="file" accept="image/*,application/pdf" className="hidden" id="comp-input" onChange={e => { const f = e.target.files?.[0]; if (f) uploadComprovante(f); }} />
                <label htmlFor="comp-input" className="px-3 py-1.5 rounded-lg border border-dashed border-indigo-300 dark:border-indigo-700 text-xs text-indigo-700 dark:text-indigo-300 cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-900/20">
                  {subindo ? "Enviando…" : comprovante ? `✓ ${comprovante.nome}` : "📎 Anexar comprovante"}
                </label>
                {comprovante && <button type="button" onClick={() => setComprovante(null)} className="text-red-500 text-xs">remover</button>}
              </div>
            </div>
          </>
        ) : (
          <>
            {ehInterna ? (
              reciprocas.length === 0 ? (
                <div className="text-xs text-gray-500 rounded-lg border border-gray-200 dark:border-gray-800 p-3">
                  Nenhuma venda em aberto de <strong>{venda.clienteNomeSnapshot}</strong> pra você usar como permuta. (Lance a venda dessa empresa pra você primeiro, ou registre como permuta externa.)
                </div>
              ) : (
                <div>
                  <Select label={`Usar venda de ${venda.clienteNomeSnapshot} como permuta`} value={permutaVendaId} onChange={e => { setPermutaVendaId(e.target.value); const r = reciprocas.find(x => x.id === e.target.value); if (r) setValorStr(maskMoeda(String(Math.round(Math.min(r.saldo, venda.saldo) * 100)))); }}>
                    <option value="">Selecione…</option>
                    {reciprocas.map(r => <option key={r.id} value={r.id}>{r.numero} · saldo {fmtMoeda(r.saldo)}</option>)}
                  </Select>
                  {permutaSel && <span className="block mt-1 text-[11px] text-gray-500">Quita reciprocamente {permutaSel.numero} ({empresaNome(permutaSel.restaurantId)}) no valor aplicado.</span>}
                </div>
              )
            ) : (
              <Input label="Identifique a compra usada como permuta" value={permutaDesc} onChange={e => setPermutaDesc(e.target.value)} placeholder="ex: NF 123 / produção entregue em jun" />
            )}
          </>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">
            <span className="text-gray-500">Valor</span>
            <div className="mt-0.5 flex items-center rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2">
              <span className="text-gray-400 text-xs">R$</span>
              <input value={valorStr} onChange={e => setValorStr(maskMoeda(e.target.value))} inputMode="numeric" placeholder="0,00" className="w-full px-1 py-2 bg-transparent text-right outline-none" />
            </div>
          </label>
          <Input label="Data" type="date" value={data} onChange={e => setData(e.target.value)} />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando || subindo}>{salvando ? "Salvando…" : "Registrar pagamento"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal: gerar cobrança (WhatsApp) ───────────────────────────────────────
function CobrancaModal({ rid, empresaNome, vendas, clientes, meId, meNome, onClose }: {
  rid: string; empresaNome: string; vendas: Venda[]; clientes: VendaCliente[];
  meId?: string; meNome?: string; onClose: () => void;
}) {
  const [clienteId, setClienteId] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState(false);
  const abrirWhatsapp = useAbrirWhatsapp();
  const cliente = clientes.find(c => c.id === clienteId) || null;
  const abertasDoCliente = useMemo(
    () => vendas.filter(v => v.clienteId === clienteId && v.status !== "quitada").sort((a, b) => (a.data || "").localeCompare(b.data || "")),
    [vendas, clienteId],
  );
  const selecionadas = abertasDoCliente.filter(v => sel.has(v.id));
  const totalSel = Math.round(selecionadas.reduce((s, v) => s + (v.saldo || v.valorTotal), 0) * 100) / 100;
  const msg = montarMensagemCobranca(empresaNome, cliente, selecionadas);

  async function gerar() {
    if (!cliente || selecionadas.length === 0) { alert("Escolha o cliente e ao menos uma venda."); return; }
    setEnviando(true);
    try {
      const ano = new Date().getFullYear();
      const numeros = vendas.map(v => v.numero); // cobranças usam prefixo próprio, mas ano igual
      void numeros;
      const id = `cob_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const numero = proximoNumero("COB", ano, []);
      const cob: VendaCobranca = {
        id, restaurantId: rid, numero,
        clienteId: cliente.id, clienteNomeSnapshot: cliente.nome,
        vendaIds: selecionadas.map(v => v.id), valorTotal: totalSel,
        criadoEm: new Date().toISOString(), criadoPor: meId, criadoPorNome: meNome,
      };
      await addDoc(collection(db, "vendasCobrancas"), sanitizeForFirestore(cob));
      // Marca as vendas como cobrança enviada.
      for (const v of selecionadas) {
        if (v.status === "aberta") await updateDoc(doc(db, "vendas", v.id), { status: "cobranca_enviada", cobrancaId: id });
        else await updateDoc(doc(db, "vendas", v.id), { cobrancaId: id });
      }
      // Cliente INTERNO: a cobrança vira aviso na Central de Avisos da empresa
      // vinculada (deriva do status cobranca_enviada) — não abre WhatsApp.
      if (cliente.tipo === "interna" && cliente.restauranteVinculadoId) {
        alert(`✅ Cobrança enviada pra Central de Avisos de ${cliente.nome}.`);
        onClose();
        return;
      }
      // Externo: abre a conversa do comprador no WhatsApp interno com a mensagem.
      void abrirWhatsapp(rid, "vendas", cliente.whatsapp || "", cliente.nome, msg);
      onClose();
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : String(e)));
    } finally { setEnviando(false); }
  }

  return (
    <Modal title="Gerar cobrança (WhatsApp)" onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <Select label="Cliente" value={clienteId} onChange={e => { setClienteId(e.target.value); setSel(new Set()); }}>
          <option value="">Selecione…</option>
          {clientes.filter(c => c.ativo !== false).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </Select>

        {clienteId && (
          abertasDoCliente.length === 0 ? (
            <div className="text-xs text-gray-500">Nenhuma venda em aberto pra esse cliente.</div>
          ) : (
            <div className="space-y-1">
              {abertasDoCliente.map(v => (
                <label key={v.id} className="flex items-center gap-2 p-2 rounded-lg border border-gray-200 dark:border-gray-800 text-sm cursor-pointer">
                  <input type="checkbox" checked={sel.has(v.id)} onChange={() => setSel(s => { const n = new Set(s); if (n.has(v.id)) n.delete(v.id); else n.add(v.id); return n; })} className="w-4 h-4 accent-indigo-600" />
                  <span className="flex-1 min-w-0 truncate">{v.numero} · {fmtBR(v.data)}</span>
                  <span className="tabular-nums">{fmtMoeda(v.saldo || v.valorTotal)}</span>
                </label>
              ))}
            </div>
          )
        )}

        {selecionadas.length > 0 && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 p-2 text-xs whitespace-pre-wrap text-gray-700 dark:text-gray-200 max-h-40 overflow-y-auto">{msg}</div>
        )}

        {!cliente?.whatsapp && clienteId && <div className="text-[11px] text-amber-600">Esse cliente não tem WhatsApp cadastrado — vai abrir o WhatsApp sem número (você escolhe o contato).</div>}

        <div className="flex items-center justify-between pt-1">
          <span className="text-sm text-gray-500">Total: <strong className="text-gray-800 dark:text-gray-200">{fmtMoeda(totalSel)}</strong></span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button onClick={gerar} disabled={enviando || selecionadas.length === 0}>📤 Abrir WhatsApp</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── Cadastros ──────────────────────────────────────────────────────────────
function CadastroProdutos({ rid, produtos }: { rid: string; produtos: VendaProduto[] }) {
  const [nome, setNome] = useState("");
  const [preco, setPreco] = useState("");
  const [unidade, setUnidade] = useState("");
  async function add() {
    if (!nome.trim()) return;
    const id = `prod_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await setDoc(doc(db, "vendasProdutos", id), sanitizeForFirestore({
      id, restaurantId: rid, nome: nome.trim(), precoPadrao: parseMoeda(preco) || null, unidade: unidade.trim() || null, ativo: true,
    } as VendaProduto));
    setNome(""); setPreco(""); setUnidade("");
  }
  const ativos = produtos.filter(p => p.ativo !== false).sort((a, b) => a.nome.localeCompare(b.nome));
  return (
    <div className="space-y-4">
      <FormCard titulo="Novo produto">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_170px_130px_auto] gap-3 items-end">
          <Input label="Produto" value={nome} onChange={e => setNome(e.target.value)} placeholder="ex: Costela suína" />
          <CampoMoeda label="Preço padrão" value={preco} onChange={e => setPreco(maskMoeda(e.target.value))} />
          <Input label="Unidade" value={unidade} onChange={e => setUnidade(e.target.value)} placeholder="un, kg, cx" />
          <Button onClick={add}>+ Adicionar</Button>
        </div>
      </FormCard>
      <ListaCard vazio={ativos.length === 0} vazioTexto="Nenhum produto cadastrado.">
        {ativos.map(p => (
          <ItemLinha key={p.id} emoji="📦" titulo={p.nome} sub={p.unidade || undefined}
            direita={p.precoPadrao ? <span className="text-gray-600 dark:text-gray-300 font-medium tabular-nums">{fmtMoeda(p.precoPadrao)}</span> : null}
            onExcluir={() => updateDoc(doc(db, "vendasProdutos", p.id), { ativo: false })} />
        ))}
      </ListaCard>
    </div>
  );
}

function CadastroClientes({ rid, clientes, restaurants }: { rid: string; clientes: VendaCliente[]; restaurants: { id: string; nome: string }[] }) {
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<"externa" | "interna">("externa");
  const [restVinc, setRestVinc] = useState("");
  const [whats, setWhats] = useState("");
  async function add() {
    if (!nome.trim() && tipo === "externa") return;
    const rest = restaurants.find(r => r.id === restVinc);
    const nomeFinal = tipo === "interna" ? (rest?.nome || nome.trim()) : nome.trim();
    if (!nomeFinal) return;
    if (tipo === "interna" && !restVinc) { alert("Escolha a empresa interna."); return; }
    const id = `cli_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await setDoc(doc(db, "vendasClientes", id), sanitizeForFirestore({
      id, restaurantId: rid, nome: nomeFinal, tipo,
      restauranteVinculadoId: tipo === "interna" ? restVinc : null,
      whatsapp: whats.trim() || null, contato: null, ativo: true,
    } as VendaCliente));
    setNome(""); setWhats(""); setRestVinc("");
  }
  const ativos = clientes.filter(c => c.ativo !== false).sort((a, b) => a.nome.localeCompare(b.nome));
  const outrasEmpresas = restaurants.filter(r => r.id !== rid);
  return (
    <div className="space-y-4">
      <FormCard titulo="Novo cliente">
        <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr_180px_auto] gap-3 items-end">
          <Select label="Tipo" value={tipo} onChange={e => setTipo(e.target.value as "externa" | "interna")}>
            <option value="externa">Externa</option>
            <option value="interna">Interna (empresa do sistema)</option>
          </Select>
          {tipo === "interna" ? (
            <Select label="Empresa" value={restVinc} onChange={e => setRestVinc(e.target.value)}>
              <option value="">Selecione…</option>
              {outrasEmpresas.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
            </Select>
          ) : (
            <Input label="Nome" value={nome} onChange={e => setNome(e.target.value)} placeholder="ex: Fulano / Empresa X" />
          )}
          {tipo === "interna"
            ? <div className="text-[11px] text-gray-500 dark:text-gray-400 self-end pb-2.5">💬 Cobrança vai pela Central de Avisos da empresa — sem WhatsApp.</div>
            : <Input label="WhatsApp" value={whats} onChange={e => setWhats(e.target.value)} placeholder="(91) 90000-0000" />}
          <Button onClick={add}>+ Adicionar</Button>
        </div>
      </FormCard>
      <ListaCard vazio={ativos.length === 0} vazioTexto="Nenhum cliente cadastrado.">
        {ativos.map(c => (
          <ItemLinha key={c.id} emoji={c.tipo === "interna" ? "🏢" : "👤"}
            titulo={c.nome} badge={c.tipo === "interna" ? "interna" : undefined}
            sub={c.whatsapp || undefined}
            onExcluir={() => updateDoc(doc(db, "vendasClientes", c.id), { ativo: false })} />
        ))}
      </ListaCard>
    </div>
  );
}

function CadastroFormas({ formas }: { formas: VendaFormaPagamento[] }) {
  const [nome, setNome] = useState("");
  async function add() {
    if (!nome.trim()) return;
    const id = `forma_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await setDoc(doc(db, "vendasFormasPagamento", id), sanitizeForFirestore({ id, nome: nome.trim(), ativo: true } as VendaFormaPagamento));
    setNome("");
  }
  const ativas = formas.filter(f => f.ativo !== false).sort((a, b) => a.nome.localeCompare(b.nome));
  return (
    <div className="space-y-4">
      <FormCard titulo="Nova forma de pagamento" nota="Globais — valem pra todas as empresas. Permuta é um tipo à parte no pagamento, não precisa cadastrar aqui.">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
          <Input label="Forma de pagamento" value={nome} onChange={e => setNome(e.target.value)} placeholder="ex: PIX, Dinheiro, Transferência" />
          <Button onClick={add}>+ Adicionar</Button>
        </div>
      </FormCard>
      <ListaCard vazio={ativas.length === 0} vazioTexto="Nenhuma forma cadastrada.">
        {ativas.map(f => (
          <ItemLinha key={f.id} emoji="💳" titulo={f.nome}
            onExcluir={() => deleteDoc(doc(db, "vendasFormasPagamento", f.id))} />
        ))}
      </ListaCard>
    </div>
  );
}

// ─── UI atoms ───────────────────────────────────────────────────────────────
// Card do formulário "adicionar" — borda suave + sombra, acabamento moderno.
function FormCard({ titulo, nota, children }: { titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-4">
      <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-3">{titulo}</div>
      {children}
      {nota && <div className="mt-2 text-[11px] text-gray-400">{nota}</div>}
    </div>
  );
}
// Container da lista de cadastros.
function ListaCard({ vazio, vazioTexto, children }: { vazio: boolean; vazioTexto: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden divide-y divide-gray-100 dark:divide-gray-800">
      {vazio ? <div className="p-8 text-sm text-gray-400 text-center">{vazioTexto}</div> : children}
    </div>
  );
}
// Linha de item na lista de cadastros.
function ItemLinha({ emoji, titulo, sub, badge, direita, onExcluir }: {
  emoji: string; titulo: string; sub?: string; badge?: string; direita?: React.ReactNode; onExcluir: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors group">
      <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-base shrink-0">{emoji}</div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
          {titulo}
          {badge && <span className="ml-2 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">{badge}</span>}
        </div>
        {sub && <div className="text-xs text-gray-500 truncate">{sub}</div>}
      </div>
      {direita}
      <button type="button" onClick={onExcluir} className="text-gray-400 hover:text-red-600 text-xs opacity-0 group-hover:opacity-100 transition-opacity shrink-0">Excluir</button>
    </div>
  );
}
// Campo de moeda com a MESMA altura do Input (prefixo R$).
function CampoMoeda({ label, value, onChange }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">{label}</label>
      <div className="flex items-center gap-1 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm focus-within:ring-2 focus-within:ring-indigo-500/30 focus-within:border-indigo-500">
        <span className="text-gray-400 text-xs">R$</span>
        <input value={value} onChange={onChange} inputMode="numeric" placeholder="0,00" className="w-full py-2 bg-transparent text-right text-sm outline-none dark:text-gray-100" />
      </div>
    </div>
  );
}
// Card de indicador (KPI) no topo da aba Vendas.
function KpiCard({ label, valor, hint }: { label: string; valor: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 p-3">
      <div className="text-[11px] text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums">{valor}</div>
      {hint && <div className="text-[10px] text-gray-400">{hint}</div>}
    </div>
  );
}
// Botão do controle segmentado (filtro de status).
function Seg({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`w-full sm:w-auto px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap text-center transition-colors ${ativo ? "bg-white dark:bg-gray-900 text-indigo-700 dark:text-indigo-300 shadow-sm" : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"}`}>
      {children}
    </button>
  );
}
function TabBtn({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex-1 sm:flex-none px-2 sm:px-3 py-2 text-[13px] sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap text-center ${ativo ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"}`}>
      {children}
    </button>
  );
}
