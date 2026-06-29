// Aba "Ajustes solicitados" do módulo Escala: líder/DP vê os pedidos de
// correção que os empregados fizeram (coleção `escalaSolicitacoes`) e
// aprova (aplica na praticada `real` + `realAjustes`) ou recusa.
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import type { EscalaMes, EscalaSolicitacao, ScheduleStatus } from "../../core/types";

const LABEL: Record<ScheduleStatus, string> = {
  trabalho: "Trabalho", folga: "Folga", freela: "Freela", comp: "Folga por compensação",
  comp_trab: "Trabalho por compensação", ferias: "Férias", falta_j: "Falta justificada", falta_i: "Falta injustificada",
};
const fmtDia = (d: string) => { const [a, m, dd] = d.split("-"); return `${dd}/${m}/${a}`; };
const fmtQuando = (iso: string) => { try { return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };

// Orientação pra quem aprova: classifica a mudança e avisa quando precisa
// mexer/conferir a Sólides (ponto). Aprovar continua sempre possível.
const TRABALHOU = new Set<ScheduleStatus>(["trabalho", "comp_trab", "freela"]);
const AUSENTE = new Set<ScheduleStatus>(["falta_i", "falta_j", "folga", "comp", "ferias"]);
function orientacao(de: ScheduleStatus | null | undefined, para: ScheduleStatus | undefined): { tom: "ok" | "warn"; texto: string } | null {
  if (!de || !para) return null;
  if ((de === "falta_i" && para === "falta_j") || (de === "falta_j" && para === "falta_i"))
    return { tom: "ok", texto: "Reclassificação de falta — não mexe na Sólides. Pode aceitar se a justificativa procede." };
  if (TRABALHOU.has(de) && AUSENTE.has(para))
    return { tom: "warn", texto: "Esse dia consta como TRABALHADO. Se aceitar a ausência, ajuste TAMBÉM na Sólides (o batimento de ponto) — senão o ponto fica divergente." };
  if (AUSENTE.has(de) && TRABALHOU.has(para))
    return { tom: "warn", texto: "Confira na Sólides se há batimento nesse dia. Se NÃO houver, o empregado precisa corrigir lá primeiro — marcação de ponto não se cria por aqui." };
  return null;
}

export function AjustesSolicitadosTab({ rid }: { rid: string }) {
  const { pessoa } = useAuth();
  const [todos, setTodos] = useState<EscalaSolicitacao[]>([]);
  const [verHistorico, setVerHistorico] = useState(false);
  const [processando, setProcessando] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, "escalaSolicitacoes"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setTodos(snap.docs.map((d) => ({ id: d.id, ...d.data() } as EscalaSolicitacao)));
    });
    return () => unsub();
  }, [rid]);

  const pendentes = useMemo(() => todos.filter((s) => s.status === "pendente").sort((a, b) => (a.data || "").localeCompare(b.data || "")), [todos]);
  const respondidos = useMemo(() => todos.filter((s) => s.status !== "pendente").sort((a, b) => (b.respondidoEm || "").localeCompare(a.respondidoEm || "")), [todos]);

  async function aprovar(s: EscalaSolicitacao) {
    setProcessando(s.id);
    try {
      // Pedido de HORÁRIO contratual: não aplica nada na escala — só marca
      // resolvido (o DP corrige a jornada em Pessoas → Horários).
      if (s.tipo === "horario" || !s.data || !s.anoMes || !s.statusSolicitado) {
        if (!window.confirm("Marcar como resolvido? (ajuste de horário contratual é feito em Pessoas → Horários; isto só fecha o pedido.)")) { setProcessando(null); return; }
      } else {
        const ref = doc(db, "escalas", `${rid}_${s.anoMes}`);
        const snap = await getDoc(ref);
        const esc = snap.exists() ? (snap.data() as EscalaMes) : null;
        if (esc?.fechadoEm && !window.confirm("O mês desse dia já foi FECHADO (praticada). Aplicar mesmo assim altera o registro final — usado em gorjeta/VT/folha. Confirmar?")) { setProcessando(null); return; }
        if (s.gorjetaPaga && !window.confirm("A gorjeta desse dia já foi publicada. Aplicar não recalcula o que já foi pago. Confirmar mesmo assim?")) { setProcessando(null); return; }
        const statusAnterior = esc?.real?.[s.empregadoId]?.[s.data] ?? s.statusAtual ?? undefined;
        await setDoc(ref, sanitizeForFirestore({
          real: { [s.empregadoId]: { [s.data]: s.statusSolicitado } },
          realAjustes: { [s.empregadoId]: { [s.data]: {
            origem: "manual",
            observacao: `Solicitação do empregado: ${s.motivo}`,
            ajustadoEm: new Date().toISOString(),
            ajustadoPor: pessoa?.id || "",
            ajustadoPorNome: pessoa?.nome || "",
            ...(statusAnterior ? { statusAnterior } : {}),
          } } },
          updatedAt: new Date().toISOString(),
        }), { merge: true });
      }
      await updateDoc(doc(db, "escalaSolicitacoes", s.id), sanitizeForFirestore({
        status: "aprovado", respondidoEm: new Date().toISOString(), respondidoPor: pessoa?.id || "", respondidoPorNome: pessoa?.nome || "",
      }));
    } catch (e) {
      alert("Falha ao aprovar: " + (e instanceof Error ? e.message : "erro"));
    } finally { setProcessando(null); }
  }

  async function recusar(s: EscalaSolicitacao) {
    const motivo = window.prompt("Motivo da recusa (o empregado verá):", "")?.trim();
    if (motivo == null) return;
    setProcessando(s.id);
    try {
      await updateDoc(doc(db, "escalaSolicitacoes", s.id), sanitizeForFirestore({
        status: "recusado", respostaMotivo: motivo || "Não aprovado.",
        respondidoEm: new Date().toISOString(), respondidoPor: pessoa?.id || "", respondidoPorNome: pessoa?.nome || "",
      }));
    } catch (e) {
      alert("Falha ao recusar: " + (e instanceof Error ? e.message : "erro"));
    } finally { setProcessando(null); }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Ajustes solicitados {pendentes.length > 0 && <span className="ml-1 text-sm font-semibold text-amber-600">({pendentes.length} pendente{pendentes.length > 1 ? "s" : ""})</span>}</h3>
        <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5">Correções que os empregados pediram na própria escala. Aprovar aplica o status na <strong>praticada</strong>.</p>
      </div>

      {pendentes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-400">Nenhum pedido pendente.</div>
      ) : (
        <div className="space-y-2">
          {pendentes.map((s) => {
            const ehHorario = s.tipo === "horario" || !s.data || !s.statusSolicitado;
            const guia = ehHorario ? null : orientacao(s.statusAtual, s.statusSolicitado);
            return (
              <div key={s.id} className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/10 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{s.empregadoNome || "Empregado"}{ehHorario ? "" : ` · ${fmtDia(s.data!)}`}</div>
                    {ehHorario ? (
                      <div className="text-[12px] text-gray-600 dark:text-gray-300 mt-0.5">🕐 Ajuste de <strong>horário contratual</strong> (jornada)</div>
                    ) : (
                      <div className="text-[12px] text-gray-600 dark:text-gray-300 mt-0.5">De <strong>{s.statusAtual ? LABEL[s.statusAtual] : "—"}</strong> → <strong className="text-indigo-700 dark:text-indigo-300">{s.statusSolicitado ? LABEL[s.statusSolicitado] : "—"}</strong></div>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-400 shrink-0">{fmtQuando(s.criadoEm)}</span>
                </div>
                <p className="text-[13px] text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900/50 rounded-lg px-2.5 py-1.5 border border-gray-100 dark:border-gray-800">“{s.motivo}”</p>
                {guia && (
                  <p className={`text-[12px] rounded-lg px-2.5 py-1.5 ${guia.tom === "warn" ? "bg-amber-100 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200" : "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-200"}`}>
                    {guia.tom === "warn" ? "⚠ " : "✓ "}{guia.texto}
                  </p>
                )}
                {ehHorario && <p className="text-[11px] text-gray-500 dark:text-gray-400">Corrija a jornada em <strong>Pessoas → Horários</strong> e marque como resolvido.</p>}
                {s.gorjetaPaga && <p className="text-[11px] text-rose-700 dark:text-rose-300">🔒 Gorjeta desse dia já paga.</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" disabled={processando === s.id} onClick={() => void recusar(s)}>Recusar</Button>
                  <Button size="sm" disabled={processando === s.id} onClick={() => void aprovar(s)}>{processando === s.id ? "…" : ehHorario ? "Marcar resolvido" : "Aprovar e aplicar"}</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {respondidos.length > 0 && (
        <div className="pt-2">
          <button type="button" onClick={() => setVerHistorico((v) => !v)} className="text-[12px] font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
            {verHistorico ? "▾" : "▸"} Histórico ({respondidos.length})
          </button>
          {verHistorico && (
            <div className="mt-2 space-y-1.5">
              {respondidos.map((s) => (
                <div key={s.id} className="rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2 text-[12px] flex items-center justify-between gap-2">
                  <span className="text-gray-700 dark:text-gray-300">{s.empregadoNome}{s.data ? ` · ${fmtDia(s.data)}` : " · horário"}{s.statusSolicitado ? ` · ${LABEL[s.statusSolicitado]}` : ""}</span>
                  <span className={`shrink-0 font-semibold ${s.status === "aprovado" ? "text-emerald-600" : "text-rose-600"}`}>{s.status === "aprovado" ? "✓ aprovado" : "✕ recusado"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
