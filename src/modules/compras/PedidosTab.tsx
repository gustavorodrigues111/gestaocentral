import { useEffect, useMemo, useState } from "react";
import { Building2, CalendarDays, Package, Banknote, Send, TriangleAlert, FolderOpen, FileText, Check, X, Copy, Plus, Pencil, Trash2, Sparkles, Minus, Clock, Store, ChevronDown, MoreHorizontal, type LucideIcon } from "lucide-react";
import { deleteDoc, doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { authHeader } from "../../core/firebase/idToken";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { Modal } from "../../core/ui/Modal";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import {
  PEDIDO_STATUS_LABEL, UNIDADES_LABEL, UNIDADES_LISTA,
} from "../../core/types";
import type { Pedido, PedidoStatus, PedidoItem, Insumo, RecebimentoNota, UnidadeMedida } from "../../core/types";
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
// Precisa atribuir unidade? (vazia). "outro" tem rótulo próprio no cadastro, então não conta.
const precisaUnidade = (u?: string) => !u;

// Stepper −/+ com o número no meio (mobile e desktop), ainda digitável.
export function QtyStepper({ value, onChange, step = 1, disabled, tone = "neutro" }: { value: number; onChange: (n: number) => void; step?: number; disabled?: boolean; tone?: "neutro" | "ok" | "warn" }) {
  const [txt, setTxt] = useState(String(value ?? 0));
  useEffect(() => { setTxt(String(value ?? 0)); }, [value]);
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const cur = () => { const n = parseFloat(txt.replace(",", ".")); return isNaN(n) ? 0 : n; };
  const bump = (d: number) => { if (disabled) return; const n = round(Math.max(0, cur() + d)); setTxt(String(n)); onChange(n); };
  const Btn = ({ d, icon }: { d: number; icon: React.ReactNode }) => (
    <button type="button" disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => bump(d)}
      className="px-2.5 flex items-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 active:bg-gray-200 dark:active:bg-gray-700 disabled:opacity-40 disabled:hover:bg-transparent transition-colors">{icon}</button>
  );
  const toneCls = tone === "ok" ? "border-emerald-400 dark:border-emerald-600 bg-emerald-50/60 dark:bg-emerald-900/10"
    : tone === "warn" ? "border-amber-400 dark:border-amber-600 bg-amber-50/60 dark:bg-amber-900/15"
    : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900";
  return (
    <div className={`inline-flex items-stretch h-9 rounded-lg border overflow-hidden shrink-0 ${toneCls} ${disabled ? "opacity-50" : ""}`}>
      <Btn d={-step} icon={<Minus size={14} />} />
      <input inputMode="decimal" value={txt} disabled={disabled}
        onChange={e => { setTxt(e.target.value); const n = parseFloat(e.target.value.replace(",", ".")); onChange(isNaN(n) ? 0 : n); }}
        onFocus={e => e.currentTarget.select()}
        onBlur={() => setTxt(String(value ?? 0))}
        className="w-12 text-center text-sm tabular-nums border-x border-current/20 bg-transparent focus:outline-none disabled:bg-transparent" />
      <Btn d={step} icon={<Plus size={14} />} />
    </div>
  );
}

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);

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

  const naoEnviado = pedido.status === "rascunho" || pedido.status === "aprovado";
  const dias = naoEnviado ? Math.floor((Date.now() - new Date(pedido.criadoEm).getTime()) / 86400000) : 0;

  // Sombreamento do card + badge conforme status e tempo sem envio.
  let tone: "gray" | "green" | "amber" | "red" | "rose" = "gray";
  let badgeCls = STATUS_CLS[pedido.status];
  let badgeLabel: string = PEDIDO_STATUS_LABEL[pedido.status];
  let BadgeIcon = PEDIDO_STATUS_LUCIDE[pedido.status];
  if (pedido.status === "enviado") { tone = "green"; badgeCls = "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"; }
  else if (naoEnviado && dias >= 3) { tone = "red"; badgeCls = "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"; badgeLabel = "há mais de 3 dias sem envio"; BadgeIcon = Clock; }
  else if (naoEnviado && dias >= 2) { tone = "amber"; badgeCls = "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"; badgeLabel = "há mais de 2 dias sem envio"; BadgeIcon = Clock; }
  else if (naoEnviado && dias >= 1) { tone = "amber"; badgeCls = "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"; badgeLabel = "há mais de 1 dia sem envio"; BadgeIcon = Clock; }
  else if (pedido.status === "recebido_ok") tone = "green";
  else if (pedido.status === "recebido_div") tone = "amber";
  else if (pedido.status === "cancelado") tone = "rose";
  const TONE_CARD: Record<typeof tone, string> = {
    gray:  "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900",
    green: "border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-900/10",
    amber: "border-amber-300 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-900/10",
    red:   "border-red-300 dark:border-red-900/50 bg-red-50/50 dark:bg-red-900/10",
    rose:  "border-rose-200 dark:border-rose-900/50 bg-rose-50/30 dark:bg-rose-900/10 opacity-90",
  };

  // Menu "Ações" conforme o estado.
  type Acao = { label: string; icon: LucideIcon; onClick: () => void; danger?: boolean };
  const acoes: Acao[] = [];
  if (podeConfig) {
    if (naoEnviado) {
      acoes.push({ label: "Editar", icon: Pencil, onClick: () => setEditarOpen(true) });
      acoes.push({ label: "Vincular recebimento", icon: Package, onClick: onVincularReceb });
      acoes.push({ label: "Excluir", icon: Trash2, onClick: () => void excluir(), danger: true });
    } else if (pedido.status === "enviado") {
      acoes.push({ label: "Vincular recebimento", icon: Package, onClick: onVincularReceb });
      acoes.push({ label: "Cancelar pedido", icon: X, onClick: () => { if (confirm("Cancelar este pedido?")) void setStatus("cancelado"); }, danger: true });
    } else {
      acoes.push({ label: "Excluir", icon: Trash2, onClick: () => void excluir(), danger: true });
    }
  }

  return (
    <div className={`border rounded-xl p-3 transition-colors ${TONE_CARD[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        {/* Área clicável: clicar na linha do pedido expande os itens */}
        <div role="button" tabIndex={0} onClick={() => setExpandido(s => !s)}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandido(s => !s); } }}
          className="flex-1 min-w-0 text-left cursor-pointer select-none">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><Building2 size={16} /> {pedido.fornecedorNomeSnapshot}</h3>
            {podeConfig && naoEnviado ? (
              <span className="relative inline-flex" onClick={e => e.stopPropagation()}>
                <button type="button" title="Alterar status" disabled={busy}
                  onClick={() => setStatusMenuOpen(o => !o)}
                  className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded hover:ring-1 hover:ring-current/30 ${badgeCls}`}>
                  <BadgeIcon size={11} /> {badgeLabel} <ChevronDown size={10} className="opacity-60" />
                </button>
                {statusMenuOpen && (
                  <>
                    <button type="button" aria-hidden className="fixed inset-0 z-10 cursor-default" onClick={() => setStatusMenuOpen(false)} />
                    <div className="absolute left-0 top-full mt-1 z-20 w-48 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1">
                      <div className="px-3 pb-1 pt-0.5 text-[10px] uppercase tracking-wider text-gray-400">Alterar status</div>
                      <button type="button" disabled={busy} onClick={() => { setStatusMenuOpen(false); void setStatus("enviado"); }}
                        className="w-full text-left px-3 py-1.5 text-sm inline-flex items-center gap-2 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300">
                        <Send size={14} /> Marcar como enviado
                      </button>
                    </div>
                  </>
                )}
              </span>
            ) : (
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${badgeCls}`}>
                <BadgeIcon size={11} /> {badgeLabel}
              </span>
            )}
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 flex gap-3 flex-wrap items-center">
            <span className="inline-flex items-center gap-1"><CalendarDays size={12} /> {new Date(pedido.criadoEm).toLocaleDateString("pt-BR")}</span>
            <span className="inline-flex items-center gap-1"><Package size={12} /> {pedido.itens.length} item(ns)</span>
            {pedido.totalEstimado != null && pedido.totalEstimado > 0 && (
              <span className="inline-flex items-center gap-1"><Banknote size={12} /> R$ {pedido.totalEstimado.toFixed(2)}</span>
            )}
            <span className="inline-flex items-center gap-0.5 text-gray-400">{expandido ? "ocultar" : "ver itens"} <ChevronDown size={12} className={`transition-transform ${expandido ? "rotate-180" : ""}`} /></span>
          </div>
        </div>

        {/* Ações: só Enviar pedido (primário) + menu Ações */}
        <div className="flex items-center gap-1.5 shrink-0">
          {podeConfig && naoEnviado && (
            <Button size="sm" onClick={() => setEnviarOpen(true)}><span className="inline-flex items-center gap-1.5"><Send size={14} /> Enviar pedido</span></Button>
          )}
          {podeConfig && pedido.status === "enviado" && (
            <Button variant="secondary" size="sm" onClick={() => setEnviarOpen(true)}><span className="inline-flex items-center gap-1.5"><Send size={14} /> Reenviar</span></Button>
          )}
          {acoes.length > 0 && (
            <div className="relative">
              <Button variant="secondary" size="sm" onClick={() => setMenuOpen(o => !o)}><span className="inline-flex items-center gap-1"><MoreHorizontal size={16} /> Ações</span></Button>
              {menuOpen && (
                <>
                  <button type="button" aria-hidden className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 w-52 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1">
                    {acoes.map((a, i) => (
                      <button key={i} type="button" disabled={busy}
                        onClick={() => { setMenuOpen(false); a.onClick(); }}
                        className={`w-full text-left px-3 py-1.5 text-sm inline-flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800 ${a.danger ? "text-rose-600 dark:text-rose-400" : "text-gray-700 dark:text-gray-200"}`}>
                        <a.icon size={14} /> {a.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
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

      {enviarOpen && <EnviarPedidoModal pedido={pedido} jaEnviado={pedido.status === "enviado"} onEnviado={() => void setStatus("enviado")} onClose={() => setEnviarOpen(false)} />}
      {editarOpen && <EditarPedidoModal pedido={pedido} insumos={insumos} onClose={() => setEditarOpen(false)} />}
    </div>
  );
}

// ── EnviarPedidoModal — copiar OU abrir no WhatsApp (wa.me) ───────────────────
function EnviarPedidoModal({ pedido, jaEnviado, onEnviado, onClose }: { pedido: Pedido; jaEnviado?: boolean; onEnviado: () => void; onClose: () => void }) {
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
  function abrirWhats() { if (!num) return; window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, "_blank"); }
  return (
    <Modal title={<span className="inline-flex items-center gap-2"><Send size={18} /> Enviar pedido — {pedido.fornecedorNomeSnapshot}</span>} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        {!num && <div className="text-[12px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-lg px-3 py-2 inline-flex items-center gap-1.5"><TriangleAlert size={13} className="shrink-0" /> Fornecedor sem WhatsApp cadastrado — copie a mensagem e envie por fora.</div>}
        <textarea readOnly value={msg} rows={Math.min(14, pedido.itens.length + 5)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 font-mono resize-y" />
        {pedido.totalEstimado != null && pedido.totalEstimado > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/60 dark:bg-indigo-900/15 px-3 py-2">
            <span className="text-[12px] text-gray-600 dark:text-gray-300 inline-flex items-center gap-1.5"><Banknote size={14} className="text-indigo-500" /> Total estimado <span className="text-gray-400">(interno — não vai na mensagem)</span></span>
            <span className="text-sm font-bold tabular-nums text-indigo-700 dark:text-indigo-300">R$ {pedido.totalEstimado.toFixed(2)}</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" className="w-full justify-center" onClick={() => void copiar()}><span className="inline-flex items-center gap-1.5"><Copy size={15} /> {copiado ? "Copiado!" : "Copiar mensagem"}</span></Button>
          <Button variant="secondary" className="w-full justify-center" disabled={!num} onClick={abrirWhats} title={num ? "Abrir a conversa no WhatsApp" : "Fornecedor sem WhatsApp"}><span className="inline-flex items-center gap-1.5"><Send size={15} /> Enviar no WhatsApp</span></Button>
        </div>
        {!jaEnviado && (
          <Button className="w-full justify-center" onClick={() => { onEnviado(); onClose(); }}><span className="inline-flex items-center gap-1.5"><Check size={15} /> Pedido enviado</span></Button>
        )}
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
  const [iaMsg, setIaMsg] = useState("");            // banner das unidades atribuídas pela IA
  const [iaFeitas, setIaFeitas] = useState<Set<string>>(new Set());
  const jaTem = new Set(itens.map(i => i.insumoId));
  const addOpcoes = useMemo(() => {
    const b = addBusca.trim().toLowerCase(); if (!b) return [] as Insumo[];
    return insumos.filter(i => i.ativo && !jaTem.has(i.id) && (i.nome || "").toLowerCase().includes(b)).slice(0, 6);
  }, [insumos, addBusca, itens]);
  const total = itens.reduce((s, it) => s + ((it.precoUnit || 0) * (it.qtdPedida || 0)), 0);
  function setQtd(id: string, n: number) { setItens(arr => arr.map(it => it.insumoId === id ? { ...it, qtdPedida: n } : it)); }
  function setUnidade(id: string, u: string) { setItens(arr => arr.map(it => it.insumoId === id ? { ...it, unidadeSnapshot: u as UnidadeMedida } : it)); }
  function remover(id: string) { setItens(arr => arr.filter(it => it.insumoId !== id)); }
  function adicionar(i: Insumo) { setItens(arr => [...arr, { insumoId: i.id, insumoNomeSnapshot: i.nome, unidadeSnapshot: i.unidade, qtdPedida: i.fatorCompra && i.fatorCompra > 1 ? i.fatorCompra : 1, precoUnit: i.precoEstimado, incluido: true }]); setAddBusca(""); }

  // IA: atribui unidade aos itens que estão sem — não trava o pedido; mostra banner.
  useEffect(() => {
    const faltam = pedido.itens.filter(it => precisaUnidade(it.unidadeSnapshot));
    if (faltam.length === 0) return;
    let vivo = true;
    (async () => {
      try {
        const r = await fetch("/api/insumo-unidade-ia", {
          method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) },
          body: JSON.stringify({ produtos: faltam.map(it => ({ id: it.insumoId, nome: it.insumoNomeSnapshot })) }),
        });
        const j = await r.json() as { sugestoes?: { id: string; unidade: string }[]; error?: string };
        if (!vivo || !r.ok || !Array.isArray(j.sugestoes) || j.sugestoes.length === 0) return;
        const byId: Record<string, string> = {}; for (const s of j.sugestoes) byId[s.id] = s.unidade;
        setItens(arr => arr.map(it => (precisaUnidade(it.unidadeSnapshot) && byId[it.insumoId]) ? { ...it, unidadeSnapshot: byId[it.insumoId] as UnidadeMedida } : it));
        setIaFeitas(new Set(Object.keys(byId)));
        const nomeDe = (id: string) => faltam.find(x => x.insumoId === id)?.insumoNomeSnapshot || id;
        setIaMsg(`A IA atribuiu unidade a ${j.sugestoes.length} produto(s) sem unidade: ${j.sugestoes.map(s => `${nomeDe(s.id)} → ${undPed(s.unidade) || s.unidade}`).join("; ")}. Confira; salvar também grava a unidade no cadastro do produto.`);
      } catch { /* silencioso: dá pra escolher na mão */ }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function salvar() {
    if (!me) return;
    const validos = itens.filter(it => (it.qtdPedida || 0) > 0);
    if (!validos.length) { if (!confirm("Nenhum item com quantidade — isso vai deixar o pedido vazio. Continuar?")) return; }
    setSalvando(true);
    try {
      const totalEst = validos.reduce((s, it) => s + ((it.precoUnit || 0) * it.qtdPedida), 0);
      await updateDoc(doc(db, "pedidos", pedido.id), sanitizeForFirestore({ itens: validos, totalEstimado: totalEst > 0 ? totalEst : undefined, observacaoGeral: obs.trim() || undefined, atualizadoEm: new Date().toISOString() }));
      // Grava a unidade escolhida no cadastro do insumo que estava sem — assim fica certo pra próxima.
      const now = new Date().toISOString();
      await Promise.all(validos.map(it => {
        const ins = insumos.find(i => i.id === it.insumoId);
        if (ins && precisaUnidade(ins.unidade) && !precisaUnidade(it.unidadeSnapshot)) {
          return updateDoc(doc(db, "insumos", ins.id), sanitizeForFirestore({ unidade: it.unidadeSnapshot, atualizadoEm: now }));
        }
        return Promise.resolve();
      })).catch(() => {});
      onClose();
    } catch (e) { alert(e instanceof Error ? e.message : "Erro"); } finally { setSalvando(false); }
  }
  const UNI_OPCOES = UNIDADES_LISTA.filter(u => u !== "outro");
  return (
    <Modal title={<span className="inline-flex items-center gap-2"><Pencil size={18} /> Editar pedido — {pedido.fornecedorNomeSnapshot}</span>} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        {iaMsg && (
          <div className="rounded-lg border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/60 dark:bg-indigo-900/15 px-3 py-2 text-[12px] text-indigo-800 dark:text-indigo-200 flex gap-2">
            <Sparkles size={14} className="shrink-0 mt-0.5 text-indigo-500" /><span>{iaMsg}</span>
          </div>
        )}
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 max-h-[50vh] overflow-auto">
          {itens.length === 0 && <div className="text-sm text-gray-400 p-4 text-center">Sem itens — adicione abaixo.</div>}
          {itens.map(it => {
            const semUni = precisaUnidade(it.unidadeSnapshot);
            const iaUni = iaFeitas.has(it.insumoId);
            return (
            <div key={it.insumoId} className="flex items-center gap-2 px-3 py-2">
              <span className="flex-1 min-w-0 truncate text-sm text-gray-900 dark:text-gray-100">{it.insumoNomeSnapshot}</span>
              <QtyStepper value={it.qtdPedida} onChange={n => setQtd(it.insumoId, n)} />
              {semUni ? (
                <select value="" onChange={e => e.target.value && setUnidade(it.insumoId, e.target.value)}
                  className="h-9 text-[11px] rounded-lg border border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 px-1">
                  <option value="">un?</option>
                  {UNI_OPCOES.map(u => <option key={u} value={u}>{undPed(u)}</option>)}
                </select>
              ) : (
                <select value={it.unidadeSnapshot} onChange={e => setUnidade(it.insumoId, e.target.value)}
                  title={iaUni ? "Unidade sugerida pela IA — ajuste se precisar" : "Unidade"}
                  className={`h-9 text-[11px] rounded-lg border px-1 bg-white dark:bg-gray-900 ${iaUni ? "border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-500"}`}>
                  {UNI_OPCOES.map(u => <option key={u} value={u}>{undPed(u)}</option>)}
                </select>
              )}
              <button type="button" onClick={() => remover(it.insumoId)} className="text-gray-300 hover:text-rose-500 p-1"><Trash2 size={15} /></button>
            </div>
          );})}
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
  const [verMais, setVerMais] = useState<"anteriores" | "resto" | null>(null);

  const insumoById = useMemo(() => new Map(insumos.map(i => [i.id, i])), [insumos]);
  const fornNorm = normalizar(pedido.fornecedorNomeSnapshot);

  // NFs candidatas: mesmo fornecedor (emissor parecido) e ainda não vinculadas a
  // outro pedido. A sugestão são só as notas emitidas DEPOIS do pedido (faz sentido:
  // a nota do que chegou é posterior ao pedido). Notas anteriores ao pedido vão pra
  // um box recolhido (exceção). Outros fornecedores idem.
  const pedidoDia = (pedido.enviadoEm || pedido.criadoEm || "").slice(0, 10);
  const candidatas = useMemo(() => {
    const disp = recebimentos.filter(n => !n.pedidoVinculadoId || n.pedidoVinculadoId === pedido.id);
    const casa = (n: RecebimentoNota) => { const e = normalizar(n.emissor || ""); return !!e && (e.includes(fornNorm) || fornNorm.includes(e)); };
    const notaDia = (n: RecebimentoNota) => (n.dataEmissao || n.recebidoEm || "").slice(0, 10);
    const posterior = (n: RecebimentoNota) => { const d = notaDia(n); return !pedidoDia || !d || d >= pedidoDia; };
    const doForn = disp.filter(casa);
    const resto = disp.filter(n => !casa(n));
    const ord = (a: RecebimentoNota, b: RecebimentoNota) => (b.dataEmissao || b.recebidoEm || "").localeCompare(a.dataEmissao || a.recebidoEm || "");
    return {
      sug: doForn.filter(posterior).sort(ord),          // sugestões (depois do pedido)
      anteriores: doForn.filter(n => !posterior(n)).sort(ord),  // exceção (antes do pedido)
      resto: resto.sort(ord),                            // outros fornecedores
    };
  }, [recebimentos, fornNorm, pedido.id, pedidoDia]);
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
        {/* Vincular a uma NF do Recebimento — box expansível */}
        <details open={!notaSel} className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-900/10 p-2.5 [&_summary]:list-none">
          <summary className="text-[11px] font-bold uppercase tracking-wide text-indigo-700 dark:text-indigo-300 cursor-pointer flex items-center justify-between gap-2">
            <span>Vincular à nota do Recebimento (dá baixa)</span>
            <span className="text-[10px] font-normal normal-case text-indigo-500">{notaSel ? "1 vinculada" : `${candidatas.sug.length} sugestão(ões)`}</span>
          </summary>
          <div className="space-y-1.5 mt-2">
          {notaSel ? (
            <div className="flex items-center justify-between gap-2 text-[13px] bg-white dark:bg-gray-900 rounded-lg border border-indigo-200 dark:border-indigo-800 px-2.5 py-1.5">
              <span className="min-w-0"><strong className="text-gray-900 dark:text-gray-100">{notaSel.emissor || "NF"}</strong> <span className="text-gray-500">· nº {notaSel.numeroNota || "—"} · {fmtD(notaSel.dataEmissao || notaSel.recebidoEm)}{notaSel.valorTotal != null ? ` · R$ ${notaSel.valorTotal.toFixed(2)}` : ""}</span></span>
              <button type="button" onClick={() => setNotaId(null)} className="shrink-0 text-[11px] text-rose-500 hover:underline">desvincular</button>
            </div>
          ) : (
            <>
              {candidatas.sug.length === 0
                ? <div className="text-[12px] text-gray-500">Nenhuma nota do fornecedor "{pedido.fornecedorNomeSnapshot}" emitida após o pedido. Veja as opções abaixo ou confirme sem NF.</div>
                : candidatas.sug.map(n => (
                  <button key={n.id} type="button" onClick={() => aplicarNota(n)} className="w-full text-left text-[13px] bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 hover:border-indigo-300 px-2.5 py-1.5 flex items-center justify-between gap-2">
                    <span className="min-w-0"><strong>{n.emissor || "NF"}</strong> <span className="text-gray-500">· nº {n.numeroNota || "—"} · {fmtD(n.dataEmissao || n.recebidoEm)}{n.valorTotal != null ? ` · R$ ${n.valorTotal.toFixed(2)}` : ""}</span></span>
                    <span className="shrink-0 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">é esta ›</span>
                  </button>
                ))}

              {/* Dois botões (largura completa): notas anteriores ao pedido / outro fornecedor */}
              {(candidatas.anteriores.length > 0 || candidatas.resto.length > 0) && (
                <div className="flex gap-2">
                  {candidatas.anteriores.length > 0 && (
                    <button type="button" onClick={() => setVerMais(v => v === "anteriores" ? null : "anteriores")}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-[12px] font-medium transition-colors ${verMais === "anteriores" ? "border-indigo-400 bg-indigo-100/70 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:border-indigo-300"}`}>
                      <Clock size={13} /> Anteriores ao pedido ({candidatas.anteriores.length}) <ChevronDown size={13} className={`transition-transform ${verMais === "anteriores" ? "rotate-180" : ""}`} />
                    </button>
                  )}
                  {candidatas.resto.length > 0 && (
                    <button type="button" onClick={() => setVerMais(v => v === "resto" ? null : "resto")}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-[12px] font-medium transition-colors ${verMais === "resto" ? "border-indigo-400 bg-indigo-100/70 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:border-indigo-300"}`}>
                      <Store size={13} /> Outro fornecedor ({candidatas.resto.length}) <ChevronDown size={13} className={`transition-transform ${verMais === "resto" ? "rotate-180" : ""}`} />
                    </button>
                  )}
                </div>
              )}
              {verMais && (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {(verMais === "anteriores" ? candidatas.anteriores : candidatas.resto).map(n => (
                    <button key={n.id} type="button" onClick={() => aplicarNota(n)} className="w-full text-left text-[13px] bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 hover:border-indigo-300 px-2.5 py-1.5 flex items-center justify-between gap-2">
                      <span className="min-w-0"><strong>{n.emissor || "NF"}</strong> <span className="text-gray-500">· nº {n.numeroNota || "—"} · {fmtD(n.dataEmissao || n.recebidoEm)}{n.valorTotal != null ? ` · R$ ${n.valorTotal.toFixed(2)}` : ""}</span></span>
                      <span className="shrink-0 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">vincular ›</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-gray-400">Opcional — dá pra confirmar o recebimento sem NF. Vincular preenche as quantidades a partir da nota e marca a baixa nos dois lados.</p>
            </>
          )}
          </div>
        </details>

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
                <div className="col-span-3 flex justify-end">
                  <QtyStepper
                    value={parseFloat((recebido[it.insumoId] || "0").replace(",", ".")) || 0}
                    onChange={n => setRecebido(s => ({ ...s, [it.insumoId]: String(n) }))}
                    tone={diff !== 0 ? "warn" : "ok"}
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
