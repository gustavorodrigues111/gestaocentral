import { useMemo, useState } from "react";
import { Building2, CalendarDays, Package, Banknote, Send, TriangleAlert, FolderOpen, FileText, Check, X, Copy, Plus, Pencil, Trash2, type LucideIcon } from "lucide-react";
import { deleteDoc, doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { Modal } from "../../core/ui/Modal";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import {
  PEDIDO_STATUS_LABEL, UNIDADES_LABEL,
} from "../../core/types";
import type { Pedido, PedidoStatus, PedidoItem, Insumo, RecebimentoNota } from "../../core/types";
import { normalizar } from "../contagens/sugestoesRecebimento";

type Props = {
  pedidos: Pedido[];
  podeConfig: boolean;
  insumos?: Insumo[];
  recebimentos?: RecebimentoNota[];
  onNovoPedido?: () => void;
};

const STATUS_CLS: Record<PedidoStatus, string> = {
  rascunho:     "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  aprovado:     "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  enviado:      "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  recebido_ok:  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  recebido_div: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  cancelado:    "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
};

const PEDIDO_STATUS_LUCIDE: Record<PedidoStatus, LucideIcon> = {
  rascunho:     FileText,
  aprovado:     Check,
  enviado:      Send,
  recebido_ok:  Package,
  recebido_div: TriangleAlert,
  cancelado:    X,
};

export function PedidosTab({ pedidos, podeConfig, insumos = [], recebimentos = [], onNovoPedido }: Props) {
  const [filtroStatus, setFiltroStatus] = useState<"abertos" | "todos" | PedidoStatus>("abertos");
  const [search, setSearch] = useState("");
  const [recebendo, setRecebendo] = useState<Pedido | null>(null);

  const filtered = useMemo(() => {
    return pedidos.filter(p => {
      if (filtroStatus === "abertos") {
        if (p.status === "recebido_ok" || p.status === "recebido_div" || p.status === "cancelado") return false;
      } else if (filtroStatus !== "todos" && p.status !== filtroStatus) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        if (
          !p.fornecedorNomeSnapshot.toLowerCase().includes(s) &&
          !p.itens.some(it => it.insumoNomeSnapshot.toLowerCase().includes(s))
        ) return false;
      }
      return true;
    });
  }, [pedidos, filtroStatus, search]);

  const NovoPedidoCard = onNovoPedido ? (
    <button type="button" onClick={onNovoPedido}
      className="group w-full flex items-center gap-3 rounded-xl border-2 border-dashed border-indigo-300 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-900/10 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:border-indigo-400 px-4 py-3.5 text-left transition-all">
      <span className="w-9 h-9 rounded-lg bg-indigo-600 text-white inline-flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform"><Plus size={20} /></span>
      <span className="min-w-0">
        <span className="block font-semibold text-indigo-700 dark:text-indigo-300">Novo pedido</span>
        <span className="block text-[12px] text-indigo-600/70 dark:text-indigo-400/70">A partir de uma contagem ou avulso (por fornecedor / categoria)</span>
      </span>
    </button>
  ) : null;

  return (
    <div className="space-y-3">
      <Input
        placeholder="🔍 Buscar por fornecedor ou item..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Status:</span>
        {(["abertos", "rascunho", "aprovado", "enviado", "recebido_ok", "recebido_div", "cancelado", "todos"] as const).map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltroStatus(f)}
            className={`px-3 py-1 rounded-full text-xs font-medium ${
              filtroStatus === f
                ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200"
            }`}
          >
            {(() => {
              if (f === "abertos") return <span className="inline-flex items-center gap-1"><FolderOpen size={13} /> Abertos</span>;
              if (f === "todos") return "Todos";
              const Ic = PEDIDO_STATUS_LUCIDE[f];
              return <span className="inline-flex items-center gap-1"><Ic size={13} /> {PEDIDO_STATUS_LABEL[f]}</span>;
            })()}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {NovoPedidoCard}
        {filtered.map(p => (
          <PedidoCard
            key={p.id}
            pedido={p}
            podeConfig={podeConfig}
            insumos={insumos}
            onVincularReceb={() => setRecebendo(p)}
          />
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-6 text-sm text-gray-400">
            {search || filtroStatus !== "abertos" ? "Nenhum pedido encontrado nesse filtro." : "Nenhum pedido aberto ainda — clique em Novo pedido acima."}
          </div>
        )}
      </div>

      {recebendo && (
        <ReceberModal
          pedido={recebendo}
          insumos={insumos}
          recebimentos={recebimentos}
          onClose={() => setRecebendo(null)}
        />
      )}
    </div>
  );
}

// ── PedidoCard ─────────────────────────────────────────────────────────────

const undPed = (u: string) => u === "outro" ? "" : (UNIDADES_LABEL[u as keyof typeof UNIDADES_LABEL] || u || "").slice(0, 3).toLowerCase();

function PedidoCard({ pedido, podeConfig, insumos, onVincularReceb }: {
  pedido: Pedido;
  podeConfig: boolean;
  insumos: Insumo[];
  onVincularReceb: () => void;
}) {
  const { pessoa: me } = useAuth();
  const [busy, setBusy] = useState(false);
  const [expandido, setExpandido] = useState(false);
  const [enviarOpen, setEnviarOpen] = useState(false);
  const [editarOpen, setEditarOpen] = useState(false);

  async function setStatus(status: PedidoStatus, extra?: Partial<Pedido>) {
    if (!me) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const patch: Partial<Pedido> = { status, atualizadoEm: now, ...extra };
      if (status === "enviado" && !pedido.enviadoEm) { patch.enviadoEm = now; patch.enviadoPor = me.id; }
      await updateDoc(doc(db, "pedidos", pedido.id), sanitizeForFirestore(patch));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro");
    } finally { setBusy(false); }
  }

  async function excluir() {
    if (!confirm(`Excluir o pedido pra "${pedido.fornecedorNomeSnapshot}"? Não dá pra desfazer.`)) return;
    setBusy(true);
    try { await deleteDoc(doc(db, "pedidos", pedido.id)); } finally { setBusy(false); }
  }

  const isFinal = pedido.status === "recebido_ok" || pedido.status === "recebido_div" || pedido.status === "cancelado";

  return (
    <div className={`bg-white dark:bg-gray-900 border rounded-xl p-3 ${isFinal ? "border-gray-200 dark:border-gray-800 opacity-90" : "border-gray-200 dark:border-gray-800"}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><Building2 size={16} /> {pedido.fornecedorNomeSnapshot}</h3>
            {(() => { const Ic = PEDIDO_STATUS_LUCIDE[pedido.status]; return (
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${STATUS_CLS[pedido.status]}`}>
              <Ic size={11} /> {PEDIDO_STATUS_LABEL[pedido.status]}
            </span>); })()}
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 flex gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1"><CalendarDays size={12} /> {new Date(pedido.criadoEm).toLocaleDateString("pt-BR")}</span>
            <span className="inline-flex items-center gap-1"><Package size={12} /> {pedido.itens.length} item(ns)</span>
            {pedido.totalEstimado != null && pedido.totalEstimado > 0 && (
              <span className="inline-flex items-center gap-1"><Banknote size={12} /> R$ {pedido.totalEstimado.toFixed(2)}</span>
            )}
          </div>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {podeConfig && pedido.status === "rascunho" && (
            <Button variant="secondary" size="sm" onClick={() => setEditarOpen(true)}><span className="inline-flex items-center gap-1.5"><Pencil size={14} /> Editar</span></Button>
          )}
          {podeConfig && !isFinal && (
            <Button size="sm" onClick={() => setEnviarOpen(true)}><span className="inline-flex items-center gap-1.5"><Send size={14} /> {pedido.status === "enviado" ? "Reenviar" : "Enviar pedido"}</span></Button>
          )}
          {podeConfig && !isFinal && (
            <Button variant="secondary" size="sm" onClick={onVincularReceb}><span className="inline-flex items-center gap-1.5"><Package size={14} /> Vincular recebimento</span></Button>
          )}
          {podeConfig && !isFinal && (pedido.status === "rascunho"
            ? <Button variant="secondary" size="sm" onClick={() => void excluir()} disabled={busy}><span className="inline-flex items-center gap-1.5"><Trash2 size={14} /> Excluir</span></Button>
            : <Button variant="secondary" size="sm" onClick={() => { if (confirm("Cancelar este pedido?")) void setStatus("cancelado"); }} disabled={busy}><span className="inline-flex items-center gap-1.5"><X size={14} /> Cancelar</span></Button>)}
          <Button variant="secondary" size="sm" onClick={() => setExpandido(s => !s)}>{expandido ? "▴ itens" : "▾ itens"}</Button>
        </div>
      </div>

      {expandido && (
        <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 space-y-1">
          {pedido.itens.map(it => {
            const recebido = it.qtdRecebida;
            const div = recebido != null && recebido !== it.qtdPedida;
            return (
              <div key={it.insumoId} className="flex items-center gap-2 text-sm">
                <span className="flex-1 min-w-0 truncate text-gray-800 dark:text-gray-200">{it.insumoNomeSnapshot}</span>
                <span className="w-24 text-right tabular-nums text-gray-600 dark:text-gray-400">{it.qtdPedida} {undPed(it.unidadeSnapshot)}</span>
                {recebido != null
                  ? <span className={`w-24 text-right text-xs font-medium ${div ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}>rec {recebido}{div ? ` (${recebido > it.qtdPedida ? "+" : ""}${recebido - it.qtdPedida})` : " ✓"}</span>
                  : <span className="w-24 text-right tabular-nums text-xs text-gray-500">{it.precoUnit != null ? `R$ ${(it.precoUnit * it.qtdPedida).toFixed(2)}` : "—"}</span>}
              </div>
            );
          })}
          {pedido.observacaoGeral && <div className="text-xs text-gray-700 dark:text-gray-300 italic mt-2">{pedido.observacaoGeral}</div>}
          {pedido.observacaoRecebimento && <div className="text-xs text-amber-700 dark:text-amber-400 italic mt-2 inline-flex items-center gap-1"><Package size={12} className="shrink-0" /> {pedido.observacaoRecebimento}</div>}
        </div>
      )}

      {enviarOpen && <EnviarPedidoModal pedido={pedido} onEnviado={() => void setStatus("enviado")} onClose={() => setEnviarOpen(false)} />}
      {editarOpen && <EditarPedidoModal pedido={pedido} insumos={insumos} onClose={() => setEditarOpen(false)} />}
    </div>
  );
}

// ── EnviarPedidoModal — copiar OU abrir no WhatsApp (wa.me) ───────────────────
function EnviarPedidoModal({ pedido, onEnviado, onClose }: { pedido: Pedido; onEnviado: () => void; onClose: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const msg = useMemo(() => {
    // Sem preço/total na mensagem do fornecedor — ele cota com o preço dele.
    const linhas = [`*Pedido — ${pedido.fornecedorNomeSnapshot}*`, `Data: ${new Date(pedido.criadoEm).toLocaleDateString("pt-BR")}`, "",
      ...pedido.itens.map(it => `• ${it.insumoNomeSnapshot}: ${it.qtdPedida} ${undPed(it.unidadeSnapshot)}`.trimEnd())];
    if (pedido.observacaoGeral) linhas.push("", pedido.observacaoGeral);
    return linhas.join("\n");
  }, [pedido]);
  const num = (pedido.fornecedorWhatsappSnapshot || "").replace(/\D/g, "");
  async function copiar() { try { await navigator.clipboard.writeText(msg); setCopiado(true); setTimeout(() => setCopiado(false), 1800); } catch { /* ignore */ } }
  function abrirWhats() { if (!num) return; window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, "_blank"); onEnviado(); onClose(); }
  return (
    <Modal title={<span className="inline-flex items-center gap-2"><Send size={18} /> Enviar pedido — {pedido.fornecedorNomeSnapshot}</span>} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <textarea readOnly value={msg} rows={Math.min(14, pedido.itens.length + 5)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 font-mono resize-y" />
        {pedido.totalEstimado != null && pedido.totalEstimado > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/60 dark:bg-indigo-900/15 px-3 py-2">
            <span className="text-[12px] text-gray-600 dark:text-gray-300 inline-flex items-center gap-1.5"><Banknote size={14} className="text-indigo-500" /> Total estimado <span className="text-gray-400">(interno — não vai na mensagem)</span></span>
            <span className="text-sm font-bold tabular-nums text-indigo-700 dark:text-indigo-300">R$ {pedido.totalEstimado.toFixed(2)}</span>
          </div>
        )}
        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="secondary" onClick={() => void copiar()}><span className="inline-flex items-center gap-1.5"><Copy size={15} /> {copiado ? "Copiado!" : "Copiar mensagem"}</span></Button>
          {num
            ? <Button onClick={abrirWhats}><span className="inline-flex items-center gap-1.5"><Send size={15} /> Abrir no WhatsApp</span></Button>
            : <span className="text-[12px] text-amber-600 dark:text-amber-400 self-center">Fornecedor sem WhatsApp — copie e envie por fora.</span>}
        </div>
        <div className="pt-2 border-t border-gray-200 dark:border-gray-800 flex justify-end">
          <button type="button" onClick={() => { onEnviado(); onClose(); }} className="text-[12px] text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 inline-flex items-center gap-1"><Check size={13} /> já enviei — marcar como enviado</button>
        </div>
      </div>
    </Modal>
  );
}

// ── EditarPedidoModal — muda quantidades / remove itens / observação ──────────
function EditarPedidoModal({ pedido, insumos, onClose }: { pedido: Pedido; insumos: Insumo[]; onClose: () => void }) {
  const { pessoa: me } = useAuth();
  const [itens, setItens] = useState<PedidoItem[]>(() => pedido.itens.map(it => ({ ...it })));
  const [obs, setObs] = useState(pedido.observacaoGeral || "");
  const [addBusca, setAddBusca] = useState("");
  const [salvando, setSalvando] = useState(false);
  const jaTem = new Set(itens.map(i => i.insumoId));
  const addOpcoes = useMemo(() => {
    const b = addBusca.trim().toLowerCase(); if (!b) return [] as Insumo[];
    return insumos.filter(i => i.ativo && !jaTem.has(i.id) && (i.nome || "").toLowerCase().includes(b)).slice(0, 6);
  }, [insumos, addBusca, itens]);
  const total = itens.reduce((s, it) => s + ((it.precoUnit || 0) * (it.qtdPedida || 0)), 0);
  function setQtd(id: string, v: string) { const n = parseFloat(v.replace(",", ".")); setItens(arr => arr.map(it => it.insumoId === id ? { ...it, qtdPedida: isNaN(n) ? 0 : n } : it)); }
  function remover(id: string) { setItens(arr => arr.filter(it => it.insumoId !== id)); }
  function adicionar(i: Insumo) { setItens(arr => [...arr, { insumoId: i.id, insumoNomeSnapshot: i.nome, unidadeSnapshot: i.unidade, qtdPedida: i.fatorCompra && i.fatorCompra > 1 ? i.fatorCompra : 1, precoUnit: i.precoEstimado, incluido: true }]); setAddBusca(""); }
  async function salvar() {
    if (!me) return;
    const validos = itens.filter(it => (it.qtdPedida || 0) > 0);
    if (!validos.length) { if (!confirm("Nenhum item com quantidade — isso vai deixar o pedido vazio. Continuar?")) return; }
    setSalvando(true);
    try {
      const totalEst = validos.reduce((s, it) => s + ((it.precoUnit || 0) * it.qtdPedida), 0);
      await updateDoc(doc(db, "pedidos", pedido.id), sanitizeForFirestore({ itens: validos, totalEstimado: totalEst > 0 ? totalEst : undefined, observacaoGeral: obs.trim() || undefined, atualizadoEm: new Date().toISOString() }));
      onClose();
    } catch (e) { alert(e instanceof Error ? e.message : "Erro"); } finally { setSalvando(false); }
  }
  return (
    <Modal title={<span className="inline-flex items-center gap-2"><Pencil size={18} /> Editar pedido — {pedido.fornecedorNomeSnapshot}</span>} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 max-h-[50vh] overflow-auto">
          {itens.length === 0 && <div className="text-sm text-gray-400 p-4 text-center">Sem itens — adicione abaixo.</div>}
          {itens.map(it => (
            <div key={it.insumoId} className="flex items-center gap-2 px-3 py-1.5">
              <span className="flex-1 min-w-0 truncate text-sm text-gray-900 dark:text-gray-100">{it.insumoNomeSnapshot}</span>
              <input type="number" min={0} step="any" value={it.qtdPedida} onChange={e => setQtd(it.insumoId, e.target.value)} className="w-20 px-2 py-1 text-sm text-right rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums" />
              <span className="text-[10px] text-gray-400 w-6">{undPed(it.unidadeSnapshot)}</span>
              <button type="button" onClick={() => remover(it.insumoId)} className="text-gray-300 hover:text-rose-500 p-1"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
        <div>
          <input value={addBusca} onChange={e => setAddBusca(e.target.value)} placeholder="+ adicionar item ao pedido…" className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
          {addOpcoes.length > 0 && (
            <div className="mt-1 rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
              {addOpcoes.map(i => <button key={i.id} type="button" onClick={() => adicionar(i)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10">{i.nome}</button>)}
            </div>
          )}
        </div>
        <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2} placeholder="Observação do pedido (opcional)" className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 resize-y" />
        <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-800">
          <span className="text-sm text-gray-500">Total: <strong className="text-gray-800 dark:text-gray-100">R$ {total.toFixed(2)}</strong></span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── ReceberModal ───────────────────────────────────────────────────────────

function ReceberModal({ pedido, insumos, recebimentos, onClose }: { pedido: Pedido; insumos: Insumo[]; recebimentos: RecebimentoNota[]; onClose: () => void }) {
  const { pessoa: me } = useAuth();
  const [recebido, setRecebido] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const it of pedido.itens) m[it.insumoId] = String(it.qtdRecebida ?? it.qtdPedida);
    return m;
  });
  const [obs, setObs] = useState(pedido.observacaoRecebimento || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [notaId, setNotaId] = useState<string | null>(pedido.recebimentoNotaId || null);
  const [verTodas, setVerTodas] = useState(false);

  const insumoById = useMemo(() => new Map(insumos.map(i => [i.id, i])), [insumos]);
  const fornNorm = normalizar(pedido.fornecedorNomeSnapshot);

  // NFs candidatas: mesmo fornecedor (emissor parecido) e ainda não vinculadas a
  // outro pedido. Ordena por data desc. "Ver todas" mostra o resto também.
  const candidatas = useMemo(() => {
    const disp = recebimentos.filter(n => !n.pedidoVinculadoId || n.pedidoVinculadoId === pedido.id);
    const casa = (n: RecebimentoNota) => { const e = normalizar(n.emissor || ""); return !!e && (e.includes(fornNorm) || fornNorm.includes(e)); };
    const sug = disp.filter(casa);
    const resto = disp.filter(n => !casa(n));
    const ord = (a: RecebimentoNota, b: RecebimentoNota) => (b.dataEmissao || b.recebidoEm || "").localeCompare(a.dataEmissao || a.recebidoEm || "");
    return { sug: sug.sort(ord), resto: resto.sort(ord) };
  }, [recebimentos, fornNorm, pedido.id]);
  const notaSel = notaId ? recebimentos.find(n => n.id === notaId) || null : null;

  // Ao escolher uma NF: casa os itens da nota (por descrição normalizada × aliases/
  // nome do insumo) e preenche a qtd recebida de cada item do pedido.
  function aplicarNota(n: RecebimentoNota | null) {
    setNotaId(n?.id || null);
    if (!n) return;
    const m: Record<string, string> = { ...recebido };
    for (const it of pedido.itens) {
      const ins = insumoById.get(it.insumoId);
      const chaves = new Set<string>([normalizar(it.insumoNomeSnapshot), ...(ins?.aliases || []), ...(ins ? [normalizar(ins.nome)] : [])]);
      const casado = (n.itens || []).find(ni => { const d = normalizar(ni.descricao || ""); return d && (chaves.has(d) || [...chaves].some(k => k && (d.includes(k) || k.includes(d)))); });
      if (casado?.quantidade != null) m[it.insumoId] = String(casado.quantidade);
    }
    setRecebido(m);
  }

  async function confirmar() {
    if (!me) return;
    setSaving(true); setErr("");
    try {
      let temDivergencia = false;
      const itensRec: PedidoItem[] = pedido.itens.map(it => {
        const rec = parseFloat(recebido[it.insumoId] || "0");
        if (!isNaN(rec) && rec !== it.qtdPedida) temDivergencia = true;
        return { ...it, qtdRecebida: isNaN(rec) ? 0 : rec };
      });
      const status: PedidoStatus = temDivergencia ? "recebido_div" : "recebido_ok";
      const now = new Date().toISOString();
      await updateDoc(doc(db, "pedidos", pedido.id), sanitizeForFirestore({
        itens: itensRec, status, recebidoEm: now, recebidoPor: me.id,
        observacaoRecebimento: obs.trim() || undefined,
        recebimentoNotaId: notaId || undefined,
        recebimentoVinculadoEm: notaId ? now : undefined,
        recebimentoVinculadoPor: notaId ? me.id : undefined,
        atualizadoEm: now,
      }));
      // Mão dupla: marca a NF como vinculada a este pedido (baixa).
      if (notaId) {
        await updateDoc(doc(db, "recebimentos", notaId), sanitizeForFirestore({
          pedidoVinculadoId: pedido.id, pedidoVinculadoEm: now, pedidoVinculadoPor: { id: me.id, nome: me.nome },
        })).catch(() => {});
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro");
    } finally { setSaving(false); }
  }

  const divergencias = pedido.itens.filter(it => {
    const rec = parseFloat(recebido[it.insumoId] || "0");
    return !isNaN(rec) && rec !== it.qtdPedida;
  }).length;
  const fmtD = (s?: string) => s ? new Date(s.length <= 10 ? s + "T12:00:00" : s).toLocaleDateString("pt-BR") : "";

  return (
    <Modal title={<span className="inline-flex items-center gap-2"><Package size={18} /> Receber — {pedido.fornecedorNomeSnapshot}</span>} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        {/* Vincular a uma NF do Recebimento */}
        <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-900/10 p-2.5 space-y-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Vincular à nota do Recebimento (dá baixa)</div>
          {notaSel ? (
            <div className="flex items-center justify-between gap-2 text-[13px] bg-white dark:bg-gray-900 rounded-lg border border-indigo-200 dark:border-indigo-800 px-2.5 py-1.5">
              <span className="min-w-0"><strong className="text-gray-900 dark:text-gray-100">{notaSel.emissor || "NF"}</strong> <span className="text-gray-500">· nº {notaSel.numeroNota || "—"} · {fmtD(notaSel.dataEmissao || notaSel.recebidoEm)}{notaSel.valorTotal != null ? ` · R$ ${notaSel.valorTotal.toFixed(2)}` : ""}</span></span>
              <button type="button" onClick={() => setNotaId(null)} className="shrink-0 text-[11px] text-rose-500 hover:underline">desvincular</button>
            </div>
          ) : (
            <>
              {candidatas.sug.length === 0 && !verTodas && <div className="text-[12px] text-gray-500">Nenhuma NF do fornecedor "{pedido.fornecedorNomeSnapshot}" encontrada. <button type="button" onClick={() => setVerTodas(true)} className="text-indigo-600 dark:text-indigo-400 hover:underline">ver todas as notas</button></div>}
              {candidatas.sug.map(n => (
                <button key={n.id} type="button" onClick={() => aplicarNota(n)} className="w-full text-left text-[13px] bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 hover:border-indigo-300 px-2.5 py-1.5 flex items-center justify-between gap-2">
                  <span className="min-w-0"><strong>{n.emissor || "NF"}</strong> <span className="text-gray-500">· nº {n.numeroNota || "—"} · {fmtD(n.dataEmissao || n.recebidoEm)}{n.valorTotal != null ? ` · R$ ${n.valorTotal.toFixed(2)}` : ""}</span></span>
                  <span className="shrink-0 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">é esta ›</span>
                </button>
              ))}
              {(verTodas || candidatas.sug.length > 0) && (
                <details className="text-[12px]">
                  <summary className="cursor-pointer text-gray-500 hover:text-gray-700">Outra nota… ({candidatas.resto.length})</summary>
                  <div className="mt-1 space-y-1 max-h-48 overflow-y-auto">
                    {candidatas.resto.map(n => (
                      <button key={n.id} type="button" onClick={() => aplicarNota(n)} className="w-full text-left bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 hover:border-indigo-300 px-2.5 py-1.5">
                        <strong>{n.emissor || "NF"}</strong> <span className="text-gray-500">· nº {n.numeroNota || "—"} · {fmtD(n.dataEmissao || n.recebidoEm)}</span>
                      </button>
                    ))}
                  </div>
                </details>
              )}
              <p className="text-[10px] text-gray-400">Opcional — dá pra confirmar o recebimento sem NF. Vincular preenche as quantidades a partir da nota e marca a baixa nos dois lados.</p>
            </>
          )}
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400">
          Confira o que foi entregue{notaSel ? " (quantidades vieram da NF — ajuste se preciso)" : ""}. Se diferente do pedido, ajuste a quantidade.
        </p>

        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl divide-y divide-gray-100 dark:divide-gray-800">
          <div className="grid grid-cols-12 gap-2 p-2 bg-gray-50 dark:bg-gray-800/50 text-xs uppercase tracking-wider text-gray-600 dark:text-gray-400 font-semibold">
            <div className="col-span-6">Insumo</div>
            <div className="col-span-2 text-right">Pedido</div>
            <div className="col-span-3 text-right">Recebido</div>
            <div className="col-span-1 text-right">Diff</div>
          </div>
          {pedido.itens.map(it => {
            const rec = parseFloat(recebido[it.insumoId] || "0");
            const diff = isNaN(rec) ? 0 : rec - it.qtdPedida;
            return (
              <div key={it.insumoId} className="grid grid-cols-12 gap-2 p-2 items-center">
                <div className="col-span-6">
                  <div className="text-sm font-medium">{it.insumoNomeSnapshot}</div>
                  <div className="text-[10px] text-gray-500">{UNIDADES_LABEL[it.unidadeSnapshot]}</div>
                </div>
                <div className="col-span-2 text-right text-sm">{it.qtdPedida}</div>
                <div className="col-span-3 text-right">
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={recebido[it.insumoId] || ""}
                    onChange={(e) => setRecebido(s => ({ ...s, [it.insumoId]: e.target.value }))}
                    className={`w-full px-2 py-1 text-sm text-right rounded border font-mono ${
                      diff !== 0
                        ? "border-amber-400 bg-amber-50 dark:bg-amber-900/20"
                        : "border-emerald-400 bg-emerald-50 dark:bg-emerald-900/10"
                    }`}
                  />
                </div>
                <div className={`col-span-1 text-right text-xs font-bold ${
                  diff > 0 ? "text-blue-600" : diff < 0 ? "text-rose-600" : "text-emerald-600"
                }`}>
                  {diff > 0 ? `+${diff}` : diff}
                </div>
              </div>
            );
          })}
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Observação do recebimento</label>
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={2}
            placeholder="ex: Caixa 'X' veio amassada, item 'Y' substituído..."
            className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 resize-y"
          />
        </div>

        {divergencias > 0 ? (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
            <span className="inline-flex items-center gap-1"><TriangleAlert size={14} className="shrink-0" /> <strong>{divergencias}</strong> item(ns) com divergência. Será marcado como "Recebido c/ diff".</span>
          </div>
        ) : (
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
            ✓ Tudo bate com o pedido. Será marcado como "Recebido OK".
          </div>
        )}

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirmar} disabled={saving}>{saving ? "..." : "✓ Confirmar recebimento"}</Button>
        </div>
      </div>
    </Modal>
  );
}
