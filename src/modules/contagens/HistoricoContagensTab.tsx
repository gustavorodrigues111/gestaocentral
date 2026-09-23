// Histórico de contagens (sessões). Ao vivo no topo (continuar/abortar já é no
// Lançar). Finalizadas/editadas/pedido/canceladas: clicáveis → detalhe (ver), com
// canetinha pra editar (só com permissão e se não travada por pedido). Cancelada
// → retomar. Editar re-materializa as contagens daquela sessão.
import { useMemo, useState } from "react";
import { Radio, CheckCircle2, PencilLine, ShoppingCart, Ban, Pencil, RotateCcw, Lock } from "lucide-react";
import { addDoc, collection, deleteDoc, doc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { UNIDADES_LABEL } from "../../core/types";
import type { ContagemSessao, ContagemSessaoStatus, Insumo } from "../../core/types";

const STATUS_INFO: Record<ContagemSessaoStatus, { label: string; cls: string; Icon: typeof Radio }> = {
  em_andamento: { label: "Ao vivo", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", Icon: Radio },
  realizada:    { label: "Realizada", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300", Icon: CheckCircle2 },
  editada:      { label: "Editada", cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300", Icon: PencilLine },
  pedido:       { label: "Pedido feito", cls: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300", Icon: ShoppingCart },
  cancelada:    { label: "Cancelada", cls: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400", Icon: Ban },
};
const statusDe = (s: ContagemSessao): ContagemSessaoStatus => s.status || "em_andamento";
const und = (i?: Insumo) => i ? (i.unidade === "outro" ? (i.unidadeOutroLabel || "un") : (UNIDADES_LABEL[i.unidade] || i.unidade)).slice(0, 3).toLowerCase() : "";
const fmtDia = (d?: string) => d ? new Date(d + "T12:00:00").toLocaleDateString("pt-BR") : "—";
const fmtHora = (iso?: string) => iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

export function HistoricoContagensTab({ sessoes, insumos, rid, podeEditar, onContinuar }: {
  sessoes: ContagemSessao[]; insumos: Insumo[]; rid: string; podeEditar: boolean; onContinuar: (data: string, turno: string) => void;
}) {
  const [aberta, setAberta] = useState<ContagemSessao | null>(null);
  const vivas = useMemo(() => sessoes.filter(s => statusDe(s) === "em_andamento"), [sessoes]);
  const historico = useMemo(() => sessoes.filter(s => statusDe(s) !== "em_andamento")
    .sort((a, b) => (b.atualizadoEm || b.finalizadaEm || "").localeCompare(a.atualizadoEm || a.finalizadaEm || "")), [sessoes]);

  return (
    <div className="space-y-3">
      {vivas.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Em andamento (ao vivo)</div>
          {vivas.map(s => (
            <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/15 px-3 py-2.5">
              <div className="min-w-0 text-sm">
                <Radio size={13} className="inline text-emerald-500 animate-pulse mr-1" />
                <strong className="text-gray-900 dark:text-gray-100">{fmtDia(s.data)}</strong>
                {s.turno && <span className="ml-1.5 text-[11px] uppercase text-emerald-700 dark:text-emerald-300">{s.turno}</span>}
                <span className="ml-2 text-xs text-gray-500">{Object.keys(s.valores || {}).length} item(ns) · {s.atualizadoPorNome || s.iniciadoPorNome}</span>
              </div>
              <Button size="sm" onClick={() => onContinuar(s.data, s.turno || "")}>Continuar</Button>
            </div>
          ))}
        </div>
      )}

      {historico.length === 0 ? (
        <div className="text-sm text-gray-400 py-10 text-center">Nenhuma contagem finalizada ainda.</div>
      ) : (
        <div className="space-y-1.5">
          {historico.map(s => {
            const st = statusDe(s); const info = STATUS_INFO[st];
            return (
              <button key={s.id} type="button" onClick={() => setAberta(s)}
                className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2.5 hover:border-indigo-300 flex items-center justify-between gap-3">
                <div className="min-w-0 text-sm">
                  <strong className="text-gray-900 dark:text-gray-100">{fmtDia(s.data)}</strong>
                  {s.turno && <span className="ml-1.5 text-[11px] uppercase text-gray-500">{s.turno}</span>}
                  <span className={`ml-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${info.cls}`}><info.Icon size={10} /> {info.label}</span>
                  <div className="text-[11px] text-gray-500 mt-0.5">{s.totalItens ?? Object.keys(s.valores || {}).length} itens · {s.finalizadaPorNome || s.canceladaPorNome || s.iniciadoPorNome} · {fmtHora(s.atualizadoEm || s.finalizadaEm)}</div>
                </div>
                <span className="shrink-0 text-gray-300">›</span>
              </button>
            );
          })}
        </div>
      )}

      {aberta && <DetalheModal key={aberta.id} sessao={aberta} insumos={insumos} rid={rid} podeEditar={podeEditar} onContinuar={onContinuar} onClose={() => setAberta(null)} />}
    </div>
  );
}

function DetalheModal({ sessao, insumos, rid, podeEditar, onContinuar, onClose }: {
  sessao: ContagemSessao; insumos: Insumo[]; rid: string; podeEditar: boolean; onContinuar: (data: string, turno: string) => void; onClose: () => void;
}) {
  const { pessoa: me } = useAuth();
  const st = statusDe(sessao);
  const travada = st === "pedido";
  const insumoById = useMemo(() => new Map(insumos.map(i => [i.id, i])), [insumos]);
  const [editando, setEditando] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const [id, v] of Object.entries(sessao.valores || {})) m[id] = String(v.qty);
    return m;
  });
  const [salvando, setSalvando] = useState(false);
  const [err, setErr] = useState("");

  const linhas = useMemo(() => Object.entries(sessao.valores || {})
    .map(([id, v]) => ({ id, v, insumo: insumoById.get(id) }))
    .sort((a, b) => (a.insumo?.nome || a.id).localeCompare(b.insumo?.nome || b.id, "pt-BR")), [sessao, insumoById]);

  async function salvarEdicao() {
    if (!me) return;
    setSalvando(true); setErr("");
    try {
      const now = new Date().toISOString();
      const novosValores: ContagemSessao["valores"] = {};
      for (const { id, v } of linhas) {
        const raw = edits[id];
        const qty = parseFloat((raw ?? "").replace(",", "."));
        if (isNaN(qty) || (raw ?? "").trim() === "") continue;   // vazio = remove o item
        novosValores[id] = { ...v, qty, porId: me.id, porNome: me.nome, em: now };
      }
      // Re-materializa as contagens desta sessão (apaga as antigas e regrava).
      const snap = await getDocs(query(collection(db, "contagens"), where("sessaoId", "==", sessao.id)));
      for (const d of snap.docs) await deleteDoc(d.ref);
      for (const [id, v] of Object.entries(novosValores)) {
        const insumo = insumoById.get(id); if (!insumo) continue;
        await addDoc(collection(db, "contagens"), sanitizeForFirestore({
          restaurantId: rid, insumoId: id, insumoNomeSnapshot: insumo.nome, unidadeSnapshot: insumo.unidade,
          qty: v.qty, data: sessao.data, observacao: v.obs || undefined, registradoEm: now, registradoPor: me.id, registradoNome: me.nome,
          sessaoId: sessao.id, turno: sessao.turno || undefined,
        }));
      }
      await updateDoc(doc(db, "contagemSessoes", sessao.id), sanitizeForFirestore({
        valores: novosValores, status: "editada", editadaEm: now, editadaPorNome: me.nome, totalItens: Object.keys(novosValores).length, atualizadoEm: now, atualizadoPorNome: me.nome,
      }));
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : "Erro ao salvar"); }
    finally { setSalvando(false); }
  }

  async function retomar() {
    if (!me) return;
    if (!confirm("Retomar esta contagem cancelada? Ela volta a ficar em andamento (ao vivo) nesta data/turno.")) return;
    setSalvando(true); setErr("");
    try {
      const now = new Date().toISOString();
      const liveId = `${rid}_${sessao.data}_${sessao.turno || "_"}`;
      await setDoc(doc(db, "contagemSessoes", liveId), sanitizeForFirestore({
        restaurantId: rid, data: sessao.data, turno: sessao.turno || undefined, status: "em_andamento",
        valores: sessao.valores || {}, iniciadoPor: me.id, iniciadoPorNome: me.nome, iniciadoEm: now, atualizadoEm: now, atualizadoPorNome: me.nome,
      }), { merge: true });
      await deleteDoc(doc(db, "contagemSessoes", sessao.id)).catch(() => {});   // consome a cancelada
      onClose();
      onContinuar(sessao.data, sessao.turno || "");
    } catch (e) { setErr(e instanceof Error ? e.message : "Erro ao retomar"); }
    finally { setSalvando(false); }
  }

  const info = STATUS_INFO[st];
  return (
    <Modal title={<span className="inline-flex items-center gap-2">Contagem · {fmtDia(sessao.data)}{sessao.turno ? ` · ${sessao.turno}` : ""}</span>} onClose={onClose} maxWidth="max-w-lg"
      headerAction={podeEditar && !travada && st !== "cancelada" && !editando ? <button type="button" onClick={() => setEditando(true)} title="Editar contagem" className="text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-1"><Pencil size={16} /></button> : undefined}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-[12px] text-gray-500">
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${info.cls}`}><info.Icon size={10} /> {info.label}</span>
          <span>{sessao.finalizadaPorNome || sessao.canceladaPorNome || sessao.iniciadoPorNome} · {fmtHora(sessao.atualizadoEm || sessao.finalizadaEm)}</span>
        </div>

        {travada && <div className="text-[12px] inline-flex items-center gap-1.5 text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/15 border border-violet-200 dark:border-violet-800 rounded-lg px-2.5 py-1.5"><Lock size={13} /> Um pedido foi gerado a partir desta contagem — ela ficou travada. Edite o pedido no módulo Compras.</div>}

        <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 max-h-[50vh] overflow-auto">
          {linhas.length === 0 && <div className="text-sm text-gray-400 p-4 text-center">Sem itens.</div>}
          {linhas.map(({ id, v, insumo }) => (
            <div key={id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
              <div className="min-w-0">
                <span className="text-gray-900 dark:text-gray-100">{insumo?.nome || id}</span>
                {v.obs && <span className="ml-1.5 text-[11px] text-gray-400 italic">{v.obs}</span>}
                {v.porNome && !editando && <span className="ml-1.5 text-[10px] text-gray-400">· {v.porNome}</span>}
              </div>
              {editando ? (
                <input type="number" min={0} step="any" value={edits[id] ?? ""} onChange={e => setEdits(s => ({ ...s, [id]: e.target.value }))}
                  className="w-20 px-2 py-1 text-sm text-right rounded border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-gray-900 tabular-nums" />
              ) : (
                <span className="shrink-0 tabular-nums font-semibold text-gray-800 dark:text-gray-100">{v.qty} {und(insumo)}</span>
              )}
            </div>
          ))}
        </div>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
          {st === "cancelada" && <Button variant="secondary" onClick={() => void retomar()} disabled={salvando}><span className="inline-flex items-center gap-1.5"><RotateCcw size={14} /> Retomar</span></Button>}
          {editando ? (
            <>
              <Button variant="secondary" onClick={() => setEditando(false)} disabled={salvando}>Cancelar</Button>
              <Button onClick={() => void salvarEdicao()} disabled={salvando}>{salvando ? "Salvando…" : "Salvar edição"}</Button>
            </>
          ) : (
            <Button variant="secondary" onClick={onClose}>Fechar</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
