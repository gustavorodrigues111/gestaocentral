// ════════════════════════════════════════════════════════════════════════════
//  Histórico de alterações de um Cargo.
//
//  Mostra:
//    1. Mudanças AGENDADAS pendentes (em /mudancasAgendadas) — com cancel
//    2. Histórico APLICADO (em /historicos/cargo_<id>_<campo>) por campo
//       crítico: pontos, semGorjeta, recebeProducao, tipoVinculo
//    3. Audit log relacionado (referência por entityId)
//
//  Ações:
//    - ❌ Cancelar agendamento (delete /mudancasAgendadas + limpa histórico)
//    - ↩  Reverter (cria contra-mudança via applyVersionedChange — preserva
//         a trilha auditável)
//    - 🗑 Excluir versão (DESTRUTIVO — remove do histórico e restaura o doc
//         principal pro valor anterior; só master)
//
//  Acessível pelo botão "📜 Histórico" em cada CargoRow da CargosTab.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import {
  collection, deleteDoc, doc, getDocs, onSnapshot, query,
  setDoc, updateDoc, where,
} from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { applyVersionedChange, logAudit } from "../../core/audit/versionedChange";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { TIPO_VINCULO_LABEL } from "../../core/types";
import type {
  Cargo, Historico, HistoricoVersao, MudancaAgendada, AuditLog, TipoVinculo,
} from "../../core/types";

type Props = {
  cargo: Cargo;
  restaurantId: string;
  onClose: () => void;
};

// Campos versionados que importam pra cargo. Ordem = ordem de exibição.
const CAMPOS_CRITICOS: Array<{ campo: string; label: string }> = [
  { campo: "recebeProducao", label: "Recebe produção (todo dia)" },
  { campo: "pontos",         label: "Pontos da gorjeta" },
  { campo: "semGorjeta",     label: "Sem gorjeta" },
  { campo: "tipoVinculo",    label: "Tipo de vínculo" },
];

/** Formata o valor de um campo crítico pra exibição humana. */
function fmtValor(campo: string, valor: unknown): string {
  if (valor === null || valor === undefined) return "—";
  if (campo === "recebeProducao" || campo === "semGorjeta") {
    return valor === true ? "Sim" : "Não";
  }
  if (campo === "tipoVinculo") {
    return TIPO_VINCULO_LABEL[valor as TipoVinculo] || String(valor);
  }
  return String(valor);
}

function fmtData(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

function fmtDataHora(iso: string): string {
  try {
    const dt = new Date(iso);
    const d = String(dt.getDate()).padStart(2, "0");
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const y = dt.getFullYear();
    const hh = String(dt.getHours()).padStart(2, "0");
    const mm = String(dt.getMinutes()).padStart(2, "0");
    return `${d}/${m}/${y} ${hh}:${mm}`;
  } catch { return iso; }
}

function previousDay(ymd: string): string {
  const d = new Date(ymd + "T12:00:00");
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function HistoricoCargoModal({ cargo, restaurantId, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const isMaster = !!me?.isMaster;
  const [historicos, setHistoricos] = useState<Record<string, Historico>>({});
  const [agendadas, setAgendadas] = useState<MudancaAgendada[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // ── Carrega histórico de cada campo ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const map: Record<string, Historico> = {};
        await Promise.all(CAMPOS_CRITICOS.map(async ({ campo }) => {
          const histId = `cargo_${cargo.id}_${campo}`;
          const q = query(collection(db, "historicos"), where("entityId", "==", cargo.id), where("campo", "==", campo));
          const snap = await getDocs(q);
          if (!snap.empty) {
            map[campo] = { id: histId, ...(snap.docs[0].data() as Omit<Historico, "id">) };
          }
        }));
        if (!cancelled) setHistoricos(map);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [cargo.id]);

  // ── Mudanças agendadas (tempo real, podem ser canceladas) ──
  useEffect(() => {
    const q = query(
      collection(db, "mudancasAgendadas"),
      where("entityType", "==", "cargo"),
      where("entityId", "==", cargo.id),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: MudancaAgendada[] = snap.docs.map((d) => ({
        id: d.id, ...(d.data() as Omit<MudancaAgendada, "id">),
      }));
      // Só pendentes (não aplicadas ainda)
      list.sort((a, b) => a.aplicarEm.localeCompare(b.aplicarEm));
      setAgendadas(list.filter(m => !m.aplicadoEm));
    });
    return () => unsub();
  }, [cargo.id]);

  // ── Audit log do cargo ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const q = query(
        collection(db, "auditLog"),
        where("entityType", "==", "cargo"),
        where("entityId", "==", cargo.id),
      );
      const snap = await getDocs(q);
      if (cancelled) return;
      const list: AuditLog[] = snap.docs.map((d) => ({
        id: d.id, ...(d.data() as Omit<AuditLog, "id">),
      }));
      list.sort((a, b) => b.registradoEm.localeCompare(a.registradoEm));
      setAuditLogs(list);
    }
    load();
    return () => { cancelled = true; };
  }, [cargo.id]);

  // ─── Cancelar mudança agendada ────────────────────────────────────────
  async function cancelarAgendada(ag: MudancaAgendada) {
    if (!me) return;
    if (!confirm(`Cancelar mudança agendada de "${fmtCampoLabel(ag.campo)}" pra ${fmtData(ag.aplicarEm)}?\nA mudança NÃO será aplicada e o histórico será limpo.`)) return;
    setBusy(true);
    setErr("");
    try {
      // 1. Deletar a mudança agendada
      await deleteDoc(doc(db, "mudancasAgendadas", ag.id));

      // 2. Limpar a versão correspondente do histórico
      //    (applyVersionedChange já tinha pré-gravado a versão futura)
      const histId = `cargo_${cargo.id}_${ag.campo}`;
      const h = historicos[ag.campo];
      if (h) {
        let versoes = [...h.versoes];
        // Remove versão que tem inicio = aplicarEm e valor = valorNovo
        const idxRemovida = versoes.findIndex(
          v => v.inicio === ag.aplicarEm && v.valor === ag.valorNovo
        );
        if (idxRemovida >= 0) {
          versoes.splice(idxRemovida, 1);
        }
        // Reabre o `fim` da versão anterior (a que tinha sido fechada
        // com previousDay(aplicarEm)). Match por fim = previousDay(aplicarEm).
        const fimAnterior = previousDay(ag.aplicarEm);
        versoes = versoes.map(v => v.fim === fimAnterior ? { ...v, fim: null } : v);

        await setDoc(doc(db, "historicos", histId), sanitizeForFirestore({
          ...h,
          versoes,
          updatedAt: new Date().toISOString(),
        }));
        setHistoricos(prev => ({ ...prev, [ag.campo]: { ...h, versoes } }));
      }

      // 3. Audit log
      await logAudit({
        entityType: "cargo",
        entityId: cargo.id,
        restaurantId,
        acao: "alterado",
        motivo: `Cancelado agendamento de "${ag.campo}" pra ${ag.aplicarEm}`,
        registradoPor: me.id,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao cancelar.");
    } finally {
      setBusy(false);
    }
  }

  // ─── Reverter versão atualmente vigente (via contra-mudança) ─────────
  //   Cria uma nova applyVersionedChange invertendo o valor — preserva
  //   trilha auditável. Vigência = hoje.
  async function reverterVersaoVigente(campo: string, versaoAtual: HistoricoVersao, valorAnterior: unknown) {
    if (!me) return;
    if (!confirm(
      `Reverter "${fmtCampoLabel(campo)}" de "${fmtValor(campo, versaoAtual.valor)}" pra "${fmtValor(campo, valorAnterior)}"?\nIsso cria uma nova mudança vigente a partir de hoje, preservando o histórico.`
    )) return;
    setBusy(true);
    setErr("");
    try {
      await applyVersionedChange({
        entityType: "cargo",
        entityId: cargo.id,
        restaurantId,
        campo,
        valorAntes: versaoAtual.valor,
        valorDepois: valorAnterior,
        vigenteApartir: todayYmd(),
        motivo: `Reversão pra valor anterior (${fmtValor(campo, valorAnterior)})`,
        registradoPor: me.id,
      });
      // Recarrega histórico desse campo
      const q = query(collection(db, "historicos"), where("entityId", "==", cargo.id), where("campo", "==", campo));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const histId = `cargo_${cargo.id}_${campo}`;
        setHistoricos(prev => ({
          ...prev,
          [campo]: { id: histId, ...(snap.docs[0].data() as Omit<Historico, "id">) },
        }));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao reverter.");
    } finally {
      setBusy(false);
    }
  }

  // ─── Excluir versão (destrutivo, master only) ────────────────────────
  //   Remove a versão do histórico, reabre o `fim` da versão anterior, e
  //   atualiza o doc principal /cargos pro valor da versão anterior se
  //   a versão removida era a vigente.
  async function excluirVersaoDestrutivo(campo: string, idx: number) {
    if (!me || !isMaster) return;
    const h = historicos[campo];
    if (!h) return;
    const versao = h.versoes[idx];
    if (!versao) return;

    if (!confirm(
      `⚠ DESTRUTIVO\n\nExcluir definitivamente esta entrada do histórico de "${fmtCampoLabel(campo)}"?\n\nValor: ${fmtValor(campo, versao.valor)}\nVigência: ${fmtData(versao.inicio)} → ${fmtData(versao.fim) || "vigente"}\n\nNão é possível desfazer. Use "Reverter" se quer preservar a trilha.`
    )) return;
    if (!confirm("Tem certeza absoluta? Última chance.")) return;

    setBusy(true);
    setErr("");
    try {
      const versoes = [...h.versoes];
      const removida = versoes.splice(idx, 1)[0];
      // Se a removida estava vigente (fim=null), a versão imediatamente
      // anterior (cuja fim casa com previousDay(removida.inicio)) tem que
      // voltar a ter fim=null.
      if (!removida.fim) {
        const fimAnterior = previousDay(removida.inicio);
        let reabriu = false;
        for (let i = versoes.length - 1; i >= 0; i--) {
          if (versoes[i].fim === fimAnterior) {
            versoes[i] = { ...versoes[i], fim: null };
            reabriu = true;
            break;
          }
        }
        // Se reabriu, sincroniza o /cargos pra refletir o valor da
        // versão que voltou a ser vigente
        if (reabriu) {
          const novoValor = versoes[versoes.length - 1].valor;
          await updateDoc(doc(db, "cargos", cargo.id), {
            [campo]: novoValor,
          });
        }
      }

      await setDoc(doc(db, "historicos", h.id), sanitizeForFirestore({
        ...h, versoes, updatedAt: new Date().toISOString(),
      }));
      setHistoricos(prev => ({ ...prev, [campo]: { ...h, versoes } }));

      await logAudit({
        entityType: "cargo",
        entityId: cargo.id,
        restaurantId,
        acao: "alterado",
        motivo: `[DESTRUTIVO] Excluída versão "${campo}" inicio=${versao.inicio} valor=${fmtValor(campo, versao.valor)}`,
        diff: { [campo]: { antes: versao.valor, depois: "[removida do histórico]" } },
        registradoPor: me.id,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao excluir.");
    } finally {
      setBusy(false);
    }
  }

  const temAlgumHistorico = useMemo(
    () => Object.values(historicos).some(h => h.versoes && h.versoes.length > 0),
    [historicos],
  );

  return (
    <Modal title={`📜 Histórico — ${cargo.nome}`} onClose={onClose} maxWidth="max-w-3xl">
      <div className="space-y-5">
        {err && (
          <div className="rounded-lg border border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-900/20 p-3 text-sm text-rose-700 dark:text-rose-300">
            {err}
          </div>
        )}

        {/* ── Mudanças agendadas pendentes ── */}
        {agendadas.length > 0 && (
          <section>
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">
              ⏳ Mudanças agendadas (ainda não aplicadas)
            </h3>
            <div className="space-y-2">
              {agendadas.map((ag) => (
                <div key={ag.id} className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/20 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                        {fmtCampoLabel(ag.campo)} → {fmtValor(ag.campo, ag.valorNovo)}
                      </p>
                      <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
                        Vigência: <strong>{fmtData(ag.aplicarEm)}</strong>
                        {ag.motivo && <> · {ag.motivo}</>}
                      </p>
                      <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-1">
                        Agendada em {fmtDataHora(ag.registradoEm)}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => cancelarAgendada(ag)}
                      disabled={busy}
                    >
                      ❌ Cancelar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Histórico por campo crítico ── */}
        <section>
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">
            📚 Histórico aplicado
          </h3>
          {loading ? (
            <div className="text-sm text-gray-500">Carregando…</div>
          ) : !temAlgumHistorico ? (
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4 text-sm text-gray-500 dark:text-gray-400 text-center">
              Nenhuma alteração registrada nos campos críticos.
              <br />
              <span className="text-xs">
                Versionamento é gravado quando você muda <em>pontos</em>, <em>sem gorjeta</em>, <em>recebe produção</em> ou <em>tipo de vínculo</em>.
              </span>
            </div>
          ) : (
            <div className="space-y-4">
              {CAMPOS_CRITICOS.map(({ campo, label }) => {
                const h = historicos[campo];
                if (!h || !h.versoes || h.versoes.length === 0) return null;
                // ordenar versão mais recente primeiro (inicio desc)
                const versoes = [...h.versoes].sort(
                  (a, b) => b.inicio.localeCompare(a.inicio),
                );
                const vigenteIdx = versoes.findIndex(v => !v.fim);
                return (
                  <div key={campo} className="rounded-lg border border-gray-200 dark:border-gray-800">
                    <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-800">
                      <p className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                        {label}
                      </p>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-gray-800">
                      {versoes.map((v, sortedIdx) => {
                        // idx real no h.versoes original (preserva pra exclusão)
                        const realIdx = h.versoes.findIndex(
                          o => o.inicio === v.inicio && o.registradoEm === v.registradoEm,
                        );
                        const vigente = !v.fim;
                        const proximaMaisAntiga = versoes[sortedIdx + 1];
                        return (
                          <div key={`${v.inicio}_${v.registradoEm}`} className="px-3 py-2.5 flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                  {fmtValor(campo, v.valor)}
                                </span>
                                {vigente && (
                                  <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                    Vigente
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                {fmtData(v.inicio)} → {v.fim ? fmtData(v.fim) : "agora"}
                              </p>
                              {v.motivo && (
                                <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5 italic">
                                  Motivo: {v.motivo}
                                </p>
                              )}
                              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                                Registrado em {fmtDataHora(v.registradoEm)}
                              </p>
                            </div>
                            <div className="flex flex-col gap-1 items-end">
                              {vigente && proximaMaisAntiga && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => reverterVersaoVigente(campo, v, proximaMaisAntiga.valor)}
                                  disabled={busy}
                                  title={`Cria nova mudança hoje voltando pra ${fmtValor(campo, proximaMaisAntiga.valor)}`}
                                >
                                  ↩ Reverter
                                </Button>
                              )}
                              {isMaster && (
                                <button
                                  type="button"
                                  onClick={() => excluirVersaoDestrutivo(campo, realIdx)}
                                  disabled={busy}
                                  className="text-[10px] text-rose-600 dark:text-rose-400 hover:underline disabled:opacity-50"
                                  title="DESTRUTIVO — apaga entrada do histórico"
                                >
                                  🗑 Excluir versão
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Audit log resumido ── */}
        {auditLogs.length > 0 && (
          <section>
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">
              🧾 Trilha de auditoria <span className="text-xs text-gray-500 font-normal">({auditLogs.length})</span>
            </h3>
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 max-h-64 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800 text-xs">
              {auditLogs.map(log => (
                <div key={log.id} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-700 dark:text-gray-300 capitalize">
                      {log.acao}
                      {log.vigenteApartir && (
                        <span className="text-gray-500 ml-2 font-normal">
                          vigente {fmtData(log.vigenteApartir)}
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {fmtDataHora(log.registradoEm)}
                    </span>
                  </div>
                  {log.diff && (
                    <div className="mt-1 text-gray-600 dark:text-gray-400 space-y-0.5">
                      {Object.entries(log.diff).map(([k, v]) => (
                        <div key={k}>
                          <span className="font-mono">{k}</span>:{" "}
                          <span className="line-through opacity-60">{fmtValor(k, v.antes)}</span>
                          {" → "}
                          <span>{fmtValor(k, v.depois)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {log.motivo && (
                    <p className="mt-1 text-gray-500 dark:text-gray-400 italic">{log.motivo}</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="flex justify-end pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </Modal>
  );
}

function fmtCampoLabel(campo: string): string {
  const x = CAMPOS_CRITICOS.find(c => c.campo === campo);
  return x ? x.label : campo;
}
