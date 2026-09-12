import { useMemo, useState } from "react";
import { Building2, CalendarDays, Package, Banknote, MessageSquare, Send, TriangleAlert, ClipboardList, FolderOpen, FileText, Check, X, type LucideIcon } from "lucide-react";
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
import type { Pedido, PedidoStatus, PedidoItem } from "../../core/types";
import { useAbrirWhatsapp } from "../../core/whatsapp/roteios";

type Props = {
  pedidos: Pedido[];
  podeConfig: boolean;
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

export function PedidosTab({ pedidos, podeConfig }: Props) {
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

      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="flex justify-center mb-3 text-gray-400"><ClipboardList size={40} /></div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">
            {search || filtroStatus !== "abertos" ? "Nenhum pedido encontrado" : "Nenhum pedido aberto"}
          </p>
          {!search && filtroStatus === "abertos" && (
            <p className="text-sm text-gray-500 mt-2">Gere pedidos a partir das Sugestões.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(p => (
            <PedidoCard
              key={p.id}
              pedido={p}
              podeConfig={podeConfig}
              onReceber={() => setRecebendo(p)}
            />
          ))}
        </div>
      )}

      {recebendo && (
        <ReceberModal
          pedido={recebendo}
          onClose={() => setRecebendo(null)}
        />
      )}
    </div>
  );
}

// ── PedidoCard ─────────────────────────────────────────────────────────────

function PedidoCard({ pedido, podeConfig, onReceber }: {
  pedido: Pedido;
  podeConfig: boolean;
  onReceber: () => void;
}) {
  const { pessoa: me } = useAuth();
  const [busy, setBusy] = useState(false);
  const [expandido, setExpandido] = useState(false);
  const abrirWhatsapp = useAbrirWhatsapp();

  async function setStatus(status: PedidoStatus, extra?: Partial<Pedido>) {
    if (!me) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const patch: Partial<Pedido> = { status, atualizadoEm: now, ...extra };
      if (status === "aprovado" && !pedido.aprovadoEm) {
        patch.aprovadoEm = now;
        patch.aprovadoPor = me.id;
      }
      if (status === "enviado" && !pedido.enviadoEm) {
        patch.enviadoEm = now;
        patch.enviadoPor = me.id;
      }
      await updateDoc(doc(db, "pedidos", pedido.id), sanitizeForFirestore(patch));
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  async function excluir() {
    if (!confirm(`Excluir pedido pra "${pedido.fornecedorNomeSnapshot}"? Não dá pra desfazer.`)) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, "pedidos", pedido.id));
    } finally {
      setBusy(false);
    }
  }

  function gerarMensagemWA(): string {
    const linhas = [
      `*Pedido — ${pedido.fornecedorNomeSnapshot}*`,
      `Data: ${new Date(pedido.criadoEm).toLocaleDateString("pt-BR")}`,
      "",
      ...pedido.itens.map(it =>
        `• ${it.insumoNomeSnapshot}: ${it.qtdPedida} ${it.unidadeSnapshot === "outro" ? "" : UNIDADES_LABEL[it.unidadeSnapshot].slice(0, 3).toLowerCase()}`
      ),
    ];
    if (pedido.totalEstimado != null && pedido.totalEstimado > 0) {
      linhas.push("", `Total estimado: R$ ${pedido.totalEstimado.toFixed(2)}`);
    }
    if (pedido.observacaoGeral) {
      linhas.push("", pedido.observacaoGeral);
    }
    return linhas.join("\n");
  }

  async function abrirWA() {
    if (!pedido.fornecedorWhatsappSnapshot) {
      alert("Fornecedor não tem WhatsApp cadastrado.");
      return;
    }
    const ok = await abrirWhatsapp(
      pedido.restaurantId,
      "fornecedores",
      pedido.fornecedorWhatsappSnapshot,
      pedido.fornecedorNomeSnapshot,
      gerarMensagemWA(),
    );
    // Marca como enviado se não estava e a conversa abriu
    if (ok && (pedido.status === "rascunho" || pedido.status === "aprovado")) {
      void setStatus("enviado");
    }
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
        <div className="flex gap-1 flex-wrap">
          {podeConfig && pedido.status === "rascunho" && (
            <Button variant="secondary" size="sm" onClick={() => setStatus("aprovado")} disabled={busy}>✓ Aprovar</Button>
          )}
          {podeConfig && (pedido.status === "rascunho" || pedido.status === "aprovado" || pedido.status === "enviado") && pedido.fornecedorWhatsappSnapshot && (
            <Button variant="secondary" size="sm" onClick={() => void abrirWA()}><span className="inline-flex items-center gap-1.5"><MessageSquare size={14} /> Enviar WhatsApp</span></Button>
          )}
          {podeConfig && (pedido.status === "rascunho" || pedido.status === "aprovado") && (
            <Button variant="secondary" size="sm" onClick={() => setStatus("enviado")} disabled={busy}><span className="inline-flex items-center gap-1.5"><Send size={14} /> Marcar enviado</span></Button>
          )}
          {podeConfig && (pedido.status === "enviado" || pedido.status === "aprovado") && (
            <Button variant="secondary" size="sm" onClick={onReceber}><span className="inline-flex items-center gap-1.5"><Package size={14} /> Receber</span></Button>
          )}
          {podeConfig && !isFinal && (
            <Button variant="secondary" size="sm" onClick={() => setStatus("cancelado")} disabled={busy}>✕ Cancelar</Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setExpandido(s => !s)}>
            {expandido ? "▴" : "▾"}
          </Button>
          {podeConfig && (
            <Button variant="danger" size="sm" onClick={excluir} disabled={busy}>×</Button>
          )}
        </div>
      </div>

      {expandido && (
        <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 space-y-1">
          {pedido.itens.map(it => {
            const recebido = it.qtdRecebida;
            const div = recebido != null && recebido !== it.qtdPedida;
            return (
              <div key={it.insumoId} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex-1 truncate">{it.insumoNomeSnapshot}</span>
                <span className="text-gray-600 dark:text-gray-400">
                  pedido: <strong>{it.qtdPedida}</strong> {it.unidadeSnapshot === "outro" ? "" : UNIDADES_LABEL[it.unidadeSnapshot].slice(0, 3).toLowerCase()}
                </span>
                {recebido != null && (
                  <span className={`font-medium ${div ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                    rec: {recebido}{div ? ` (${recebido > it.qtdPedida ? "+" : ""}${recebido - it.qtdPedida})` : " ✓"}
                  </span>
                )}
                {it.precoUnit != null && (
                  <span className="text-xs text-gray-500 w-20 text-right">R$ {((it.precoUnit) * it.qtdPedida).toFixed(2)}</span>
                )}
              </div>
            );
          })}
          {pedido.observacaoGeral && (
            <div className="text-xs text-gray-700 dark:text-gray-300 italic mt-2">{pedido.observacaoGeral}</div>
          )}
          {pedido.observacaoRecebimento && (
            <div className="text-xs text-amber-700 dark:text-amber-400 italic mt-2 inline-flex items-center gap-1"><Package size={12} className="shrink-0" /> {pedido.observacaoRecebimento}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── ReceberModal ───────────────────────────────────────────────────────────

function ReceberModal({ pedido, onClose }: { pedido: Pedido; onClose: () => void }) {
  const { pessoa: me } = useAuth();
  const [recebido, setRecebido] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const it of pedido.itens) {
      m[it.insumoId] = String(it.qtdRecebida ?? it.qtdPedida);
    }
    return m;
  });
  const [obs, setObs] = useState(pedido.observacaoRecebimento || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function confirmar() {
    if (!me) return;
    setSaving(true);
    setErr("");
    try {
      // Detecta divergência
      let temDivergencia = false;
      const itensRec: PedidoItem[] = pedido.itens.map(it => {
        const rec = parseFloat(recebido[it.insumoId] || "0");
        if (!isNaN(rec) && rec !== it.qtdPedida) temDivergencia = true;
        return { ...it, qtdRecebida: isNaN(rec) ? 0 : rec };
      });

      const status: PedidoStatus = temDivergencia ? "recebido_div" : "recebido_ok";
      const now = new Date().toISOString();
      await updateDoc(doc(db, "pedidos", pedido.id), sanitizeForFirestore({
        itens: itensRec,
        status,
        recebidoEm: now,
        recebidoPor: me.id,
        observacaoRecebimento: obs.trim() || undefined,
        atualizadoEm: now,
      }));
      onClose();
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  // Cálculo de divergências
  const divergencias = pedido.itens.filter(it => {
    const rec = parseFloat(recebido[it.insumoId] || "0");
    return !isNaN(rec) && rec !== it.qtdPedida;
  }).length;

  return (
    <Modal title={<span className="inline-flex items-center gap-2"><Package size={18} /> Receber — {pedido.fornecedorNomeSnapshot}</span>} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Confira o que foi entregue. Se diferente do pedido, ajuste a quantidade.
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
