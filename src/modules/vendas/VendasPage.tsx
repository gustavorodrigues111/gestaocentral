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
import { Modal } from "../../core/ui/Modal";
import { whatsLink } from "../../core/excecoes/whatsapp";
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
  const [tab, setTab] = useState<Tab>("vendas");

  const [vendas, setVendas] = useState<Venda[]>([]);
  const [vendasRecebidas, setVendasRecebidas] = useState<Venda[]>([]); // de terceiros PRA mim (permuta)
  const [produtos, setProdutos] = useState<VendaProduto[]>([]);
  const [clientes, setClientes] = useState<VendaCliente[]>([]);
  const [formas, setFormas] = useState<VendaFormaPagamento[]>([]);

  const [novaVenda, setNovaVenda] = useState(false);
  const [cobrando, setCobrando] = useState(false);
  const [pagarVenda, setPagarVenda] = useState<Venda | null>(null);
  const [filtro, setFiltro] = useState<VendaStatus | "todas">("todas");

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
    const arr = filtro === "todas" ? vendas : vendas.filter(v => v.status === filtro);
    return arr.slice().sort((a, b) => (b.data || "").localeCompare(a.data || "") || (b.numero || "").localeCompare(a.numero || ""));
  }, [vendas, filtro]);

  const cont = useMemo(() => ({
    todas: vendas.length,
    aberta: vendas.filter(v => v.status === "aberta").length,
    cobranca_enviada: vendas.filter(v => v.status === "cobranca_enviada").length,
    quitada: vendas.filter(v => v.status === "quitada").length,
    aberto: Math.round(vendas.filter(v => v.status !== "quitada").reduce((s, v) => s + (v.saldo ?? v.valorTotal), 0) * 100) / 100,
  }), [vendas]);

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

  if (!rid) return <div className="text-center py-12 text-gray-500">Selecione uma empresa.</div>;
  if (!can("vendas", "ver")) return <div className="text-center py-12 text-gray-500">Você não tem acesso a Vendas.</div>;

  const podeLancar = can("vendas", "lancar");
  const podeQuitar = can("vendas", "quitar");
  const podeCobrar = can("vendas", "cobrar");
  const podeConfig = can("vendas", "config");

  return (
    <div className="max-w-6xl mx-auto p-4">
      <header className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">🧾 Vendas</h1>
          <p className="text-xs text-gray-500">{activeRestaurant?.nome} · registro fora do sistema fiscal (entre empresas, permutas)</p>
        </div>
        <div className="flex gap-2">
          {podeCobrar && <Button size="sm" variant="secondary" onClick={() => setCobrando(true)}>📤 Gerar cobrança</Button>}
          {podeLancar && <Button onClick={() => setNovaVenda(true)}>+ Nova venda</Button>}
        </div>
      </header>

      <nav className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
        <TabBtn ativo={tab === "vendas"} onClick={() => setTab("vendas")}>Vendas</TabBtn>
        {podeConfig && <TabBtn ativo={tab === "produtos"} onClick={() => setTab("produtos")}>Produtos</TabBtn>}
        {podeConfig && <TabBtn ativo={tab === "clientes"} onClick={() => setTab("clientes")}>Clientes</TabBtn>}
        {podeConfig && <TabBtn ativo={tab === "formas"} onClick={() => setTab("formas")}>Formas de pgto</TabBtn>}
      </nav>

      {tab === "vendas" && (
        <div>
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div className="flex gap-2 overflow-x-auto">
              <Chip ativo={filtro === "todas"} onClick={() => setFiltro("todas")}>Todas ({cont.todas})</Chip>
              <Chip ativo={filtro === "aberta"} onClick={() => setFiltro("aberta")} cor="amber">Abertas ({cont.aberta})</Chip>
              <Chip ativo={filtro === "cobranca_enviada"} onClick={() => setFiltro("cobranca_enviada")} cor="blue">Cobrança enviada ({cont.cobranca_enviada})</Chip>
              <Chip ativo={filtro === "quitada"} onClick={() => setFiltro("quitada")} cor="green">Quitadas ({cont.quitada})</Chip>
            </div>
            {cont.aberto > 0 && <div className="text-xs text-gray-500">Em aberto: <strong className="text-gray-800 dark:text-gray-200">{fmtMoeda(cont.aberto)}</strong></div>}
          </div>

          {vendasFiltradas.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">
              Nenhuma venda {filtro !== "todas" ? "nesse status" : "registrada"} ainda.
            </div>
          ) : (
            <div className="space-y-2">
              {vendasFiltradas.map(v => (
                <VendaCard
                  key={v.id} venda={v} empresaNome={empresaNome}
                  podeQuitar={podeQuitar}
                  onPagar={() => setPagarVenda(v)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "produtos" && <CadastroProdutos rid={rid} produtos={produtos} />}
      {tab === "clientes" && <CadastroClientes rid={rid} clientes={clientes} restaurants={restaurants} />}
      {tab === "formas" && <CadastroFormas formas={formas} />}

      {novaVenda && (
        <NovaVendaModal
          rid={rid} produtos={produtos} clientes={clientes} vendas={vendas}
          meId={pessoa?.id} meNome={pessoa?.nome}
          onClose={() => setNovaVenda(false)}
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

// ─── Card de venda ──────────────────────────────────────────────────────────
function VendaCard({ venda: v, empresaNome, podeQuitar, onPagar }: {
  venda: Venda; empresaNome: (id?: string | null) => string; podeQuitar: boolean; onPagar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
      <div className="p-3 flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => setAberto(a => !a)} className="flex-1 min-w-0 text-left flex items-center gap-2">
          <span className="text-gray-400 text-xs w-3">{aberto ? "▾" : "▸"}</span>
          <div className="min-w-0">
            <div className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
              {v.numero} · {v.clienteNomeSnapshot}
              {v.clienteTipo === "interna" && <span className="ml-1 text-[10px] uppercase text-indigo-500">interna</span>}
            </div>
            <div className="text-[11px] text-gray-500">{fmtBR(v.data)}</div>
          </div>
        </button>
        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${STATUS_COR[v.status]}`}>{VENDA_STATUS_LABEL[v.status]}</span>
        <div className="text-right">
          <div className="font-bold text-sm text-gray-900 dark:text-gray-100 tabular-nums">{fmtMoeda(v.valorTotal)}</div>
          {v.status !== "quitada" && v.saldo < v.valorTotal && <div className="text-[10px] text-gray-500">saldo {fmtMoeda(v.saldo)}</div>}
        </div>
      </div>
      {aberto && (
        <div className="px-3 pb-3 border-t border-gray-100 dark:border-gray-800 pt-2 space-y-2">
          <div className="text-xs">
            {v.itens?.map((it, i) => (
              <div key={i} className="flex justify-between gap-2 text-gray-600 dark:text-gray-300">
                <span className="truncate">{it.qtd} × {it.descricao}</span>
                <span className="tabular-nums shrink-0">{fmtMoeda(it.total)}</span>
              </div>
            ))}
          </div>
          {v.observacoes && <div className="text-[11px] text-gray-500 italic">{v.observacoes}</div>}
          {(v.pagamentos?.length ?? 0) > 0 && (
            <div className="text-[11px] text-gray-600 dark:text-gray-300 space-y-0.5 border-t border-gray-100 dark:border-gray-800 pt-1.5">
              <div className="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">Pagamentos</div>
              {v.pagamentos.map((p, i) => (
                <div key={i} className="flex justify-between gap-2">
                  <span className="truncate">
                    {fmtBR(p.data)} · {p.tipo === "permuta"
                      ? `permuta${p.permutaVendaNumero ? ` (${p.permutaVendaNumero}${p.permutaEmpresaNome ? ` · ${p.permutaEmpresaNome}` : ""})` : p.permutaDescricao ? ` (${p.permutaDescricao})` : ""}`
                      : p.formaNome || "pagamento"}
                    {p.comprovanteUrl && <> · <a href={p.comprovanteUrl} target="_blank" rel="noreferrer" className="text-indigo-600 dark:text-indigo-400 underline">comprovante</a></>}
                    {p.infoRecebimento && ` · ${p.infoRecebimento}`}
                  </span>
                  <span className="tabular-nums shrink-0">{fmtMoeda(p.valor)}</span>
                </div>
              ))}
            </div>
          )}
          {v.status !== "quitada" && podeQuitar && (
            <div className="flex justify-end">
              <Button size="sm" onClick={onPagar}>💰 Registrar pagamento</Button>
            </div>
          )}
          {v.clienteTipo === "interna" && <div className="text-[10px] text-gray-400">Empresa vendedora: {empresaNome(v.restaurantId)}</div>}
        </div>
      )}
    </div>
  );
}

// ─── Modal: nova venda ────────────────────────────────────────────────────
function NovaVendaModal({ rid, produtos, clientes, vendas, meId, meNome, onClose }: {
  rid: string; produtos: VendaProduto[]; clientes: VendaCliente[]; vendas: Venda[];
  meId?: string; meNome?: string; onClose: () => void;
}) {
  const [clienteId, setClienteId] = useState("");
  const [data, setData] = useState(hojeYmd());
  const [itens, setItens] = useState<VendaItem[]>([]);
  const [obs, setObs] = useState("");
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
      const ano = Number(data.slice(0, 4)) || new Date().getFullYear();
      const numero = proximoNumero("VENDA", ano, vendas.map(v => v.numero));
      const id = `venda_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const venda: Venda = {
        id, restaurantId: rid, numero, data,
        clienteId: cliente.id, clienteNomeSnapshot: cliente.nome, clienteTipo: cliente.tipo,
        clienteWhatsappSnapshot: cliente.whatsapp || null,
        clienteRestauranteVinculadoId: cliente.tipo === "interna" ? (cliente.restauranteVinculadoId || null) : null,
        itens: validos,
        valorTotal: Math.round(total * 100) / 100,
        status: "aberta",
        pagamentos: [], valorPago: 0, saldo: Math.round(total * 100) / 100,
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
    <Modal title="Nova venda" onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-xs">
            <span className="text-gray-500">Cliente</span>
            <select value={clienteId} onChange={e => setClienteId(e.target.value)} className="mt-0.5 w-full px-2 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
              <option value="">Selecione…</option>
              {clientesAtivos.map(c => <option key={c.id} value={c.id}>{c.nome}{c.tipo === "interna" ? " (interna)" : ""}</option>)}
            </select>
          </label>
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
          <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar venda"}</Button>
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
            <label className="text-xs">
              <span className="text-gray-500">Forma</span>
              <select value={formaId} onChange={e => setFormaId(e.target.value)} className="mt-0.5 w-full px-2 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
                <option value="">Selecione…</option>
                {formasAtivas.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </label>
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
                <label className="text-xs">
                  <span className="text-gray-500">Usar venda de {venda.clienteNomeSnapshot} como permuta</span>
                  <select value={permutaVendaId} onChange={e => { setPermutaVendaId(e.target.value); const r = reciprocas.find(x => x.id === e.target.value); if (r) setValorStr(maskMoeda(String(Math.round(Math.min(r.saldo, venda.saldo) * 100)))); }} className="mt-0.5 w-full px-2 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
                    <option value="">Selecione…</option>
                    {reciprocas.map(r => <option key={r.id} value={r.id}>{r.numero} · saldo {fmtMoeda(r.saldo)}</option>)}
                  </select>
                  {permutaSel && <span className="text-[11px] text-gray-500">Quita reciprocamente {permutaSel.numero} ({empresaNome(permutaSel.restaurantId)}) no valor aplicado.</span>}
                </label>
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
      // Abre o WhatsApp do comprador com a mensagem.
      const link = whatsLink(cliente.whatsapp || undefined, msg);
      if (link) window.open(link, "_blank");
      else { window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank"); }
      onClose();
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : String(e)));
    } finally { setEnviando(false); }
  }

  return (
    <Modal title="Gerar cobrança (WhatsApp)" onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <label className="text-xs">
          <span className="text-gray-500">Cliente</span>
          <select value={clienteId} onChange={e => { setClienteId(e.target.value); setSel(new Set()); }} className="mt-0.5 w-full px-2 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
            <option value="">Selecione…</option>
            {clientes.filter(c => c.ativo !== false).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </label>

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
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
        <Input label="Produto" value={nome} onChange={e => setNome(e.target.value)} placeholder="ex: Costela suína" />
        <label className="text-xs"><span className="text-gray-500">Preço padrão</span>
          <div className="mt-0.5 flex items-center rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2"><span className="text-gray-400 text-xs">R$</span>
            <input value={preco} onChange={e => setPreco(maskMoeda(e.target.value))} inputMode="numeric" placeholder="0,00" className="w-full px-1 py-2 bg-transparent text-right outline-none" /></div>
        </label>
        <Input label="Unidade" value={unidade} onChange={e => setUnidade(e.target.value)} placeholder="un, kg, cx" />
        <Button onClick={add}>+ Adicionar</Button>
      </div>
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
        {ativos.length === 0 ? <div className="p-4 text-sm text-gray-500 text-center">Nenhum produto.</div> : ativos.map(p => (
          <div key={p.id} className="flex items-center justify-between gap-2 p-2.5 text-sm">
            <span className="text-gray-800 dark:text-gray-200">{p.nome}{p.unidade ? ` · ${p.unidade}` : ""}</span>
            <div className="flex items-center gap-3">
              {p.precoPadrao ? <span className="text-gray-500 tabular-nums">{fmtMoeda(p.precoPadrao)}</span> : null}
              <button type="button" onClick={() => updateDoc(doc(db, "vendasProdutos", p.id), { ativo: false })} className="text-red-500 hover:text-red-700 text-xs">excluir</button>
            </div>
          </div>
        ))}
      </div>
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
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
        <label className="text-xs"><span className="text-gray-500">Tipo</span>
          <select value={tipo} onChange={e => setTipo(e.target.value as "externa" | "interna")} className="mt-0.5 w-full px-2 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
            <option value="externa">Externa</option>
            <option value="interna">Interna (empresa do sistema)</option>
          </select>
        </label>
        {tipo === "interna" ? (
          <label className="text-xs"><span className="text-gray-500">Empresa</span>
            <select value={restVinc} onChange={e => setRestVinc(e.target.value)} className="mt-0.5 w-full px-2 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
              <option value="">Selecione…</option>
              {outrasEmpresas.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
            </select>
          </label>
        ) : (
          <Input label="Nome" value={nome} onChange={e => setNome(e.target.value)} placeholder="ex: Fulano / Empresa X" />
        )}
        <Input label="WhatsApp" value={whats} onChange={e => setWhats(e.target.value)} placeholder="(91) 90000-0000" />
        <Button onClick={add}>+ Adicionar</Button>
      </div>
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
        {ativos.length === 0 ? <div className="p-4 text-sm text-gray-500 text-center">Nenhum cliente.</div> : ativos.map(c => (
          <div key={c.id} className="flex items-center justify-between gap-2 p-2.5 text-sm">
            <span className="text-gray-800 dark:text-gray-200">{c.nome} {c.tipo === "interna" && <span className="text-[10px] uppercase text-indigo-500">interna</span>}</span>
            <div className="flex items-center gap-3">
              {c.whatsapp && <span className="text-gray-500 text-xs">{c.whatsapp}</span>}
              <button type="button" onClick={() => updateDoc(doc(db, "vendasClientes", c.id), { ativo: false })} className="text-red-500 hover:text-red-700 text-xs">excluir</button>
            </div>
          </div>
        ))}
      </div>
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
    <div className="space-y-3">
      <div className="text-[11px] text-gray-500">Formas de pagamento são globais (valem pra todas as empresas). Permuta é um tipo à parte no pagamento — não precisa cadastrar aqui.</div>
      <div className="flex gap-2 items-end">
        <Input label="Forma de pagamento" value={nome} onChange={e => setNome(e.target.value)} placeholder="ex: PIX, Dinheiro, Transferência" />
        <Button onClick={add}>+ Adicionar</Button>
      </div>
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
        {ativas.length === 0 ? <div className="p-4 text-sm text-gray-500 text-center">Nenhuma forma cadastrada.</div> : ativas.map(f => (
          <div key={f.id} className="flex items-center justify-between gap-2 p-2.5 text-sm">
            <span className="text-gray-800 dark:text-gray-200">{f.nome}</span>
            <button type="button" onClick={() => deleteDoc(doc(db, "vendasFormasPagamento", f.id))} className="text-red-500 hover:text-red-700 text-xs">excluir</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── UI atoms ───────────────────────────────────────────────────────────────
function TabBtn({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${ativo ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"}`}>
      {children}
    </button>
  );
}
function Chip({ ativo, onClick, cor, children }: { ativo: boolean; onClick: () => void; cor?: "amber" | "blue" | "green"; children: React.ReactNode }) {
  const base = ativo
    ? (cor === "amber" ? "bg-amber-600 text-white" : cor === "blue" ? "bg-blue-600 text-white" : cor === "green" ? "bg-emerald-600 text-white" : "bg-indigo-600 text-white")
    : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-200";
  return <button type="button" onClick={onClick} className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${base}`}>{children}</button>;
}
