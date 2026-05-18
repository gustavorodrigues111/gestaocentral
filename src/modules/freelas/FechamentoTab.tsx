import { useMemo, useState } from "react";
import { addDoc, collection, doc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import type { FreelaPagamento, FreelaPagamentoResumoPessoa, FreelaShift } from "../../core/types";
import {
  fmtBR, fmtHoras, onlyDigits, proximoNumeroLote,
} from "./helpers";

type Props = {
  restaurantId: string;
  shifts: FreelaShift[];
  pagamentos: FreelaPagamento[];
  podeEditar: boolean;
};

// Tab Fechamento: lista turnos com status="fechamento" e SEM lotePagamentoId.
// Usuário marca/desmarca turnos, clica "Gerar lote de pagamento" → cria
// FreelaPagamento status="pendente" agrupando os turnos selecionados.
export function FechamentoTab({ restaurantId, shifts, pagamentos, podeEditar }: Props) {
  const { pessoa: me } = useAuth();
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);

  const candidatos = useMemo(
    () => shifts
      .filter((s) => s.status === "fechamento" && !s.lotePagamentoId)
      .sort((a, b) => a.date.localeCompare(b.date) || a.nomeSnapshot.localeCompare(b.nomeSnapshot)),
    [shifts],
  );

  // Agrupado por pessoa pra exibir
  const porPessoa = useMemo(() => {
    const m = new Map<string, FreelaShift[]>();
    for (const s of candidatos) {
      const key = s.pessoaId ? `pes:${s.pessoaId}` : s.empregadoId ? `emp:${s.empregadoId}` : `nome:${onlyDigits(s.cpfSnapshot || "") || s.nomeSnapshot}`;
      const arr = m.get(key) || [];
      arr.push(s);
      m.set(key, arr);
    }
    return Array.from(m.entries()).map(([key, list]) => ({
      key,
      nome: list[0].nomeSnapshot,
      pix: list[0].pixSnapshot,
      cpf: list[0].cpfSnapshot,
      whatsapp: list[0].whatsappSnapshot,
      shifts: list,
    }));
  }, [candidatos]);

  const totaisSelec = useMemo(() => {
    const sel = candidatos.filter((s) => selecionados.has(s.id));
    const total = sel.reduce((acc, s) => acc + (s.totalCalc || 0), 0);
    const horas = sel.reduce((acc, s) => acc + (s.horas || 0), 0);
    const pessoas = new Set(sel.map((s) => s.pessoaId || s.empregadoId || s.nomeSnapshot));
    return { qtd: sel.length, total, horas, pessoas: pessoas.size };
  }, [candidatos, selecionados]);

  function toggle(id: string) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleGrupo(grupo: FreelaShift[]) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      const todosMarcados = grupo.every((s) => next.has(s.id));
      if (todosMarcados) grupo.forEach((s) => next.delete(s.id));
      else grupo.forEach((s) => next.add(s.id));
      return next;
    });
  }

  function marcarTodos() {
    if (selecionados.size === candidatos.length) {
      setSelecionados(new Set());
    } else {
      setSelecionados(new Set(candidatos.map((s) => s.id)));
    }
  }

  async function gerarLote() {
    if (!me) return;
    const selecShifts = candidatos.filter((s) => selecionados.has(s.id));
    if (selecShifts.length === 0) {
      alert("Selecione ao menos 1 turno pra gerar o lote.");
      return;
    }
    if (!confirm(`Gerar lote com ${selecShifts.length} turno(s) — ${fmtBR(totaisSelec.total)}?`)) return;
    setSalvando(true);
    try {
      // Monta resumo por pessoa
      const resumoMap = new Map<string, FreelaPagamentoResumoPessoa>();
      for (const s of selecShifts) {
        const key = s.pessoaId ? `pes:${s.pessoaId}` : s.empregadoId ? `emp:${s.empregadoId}` : `nome:${s.nomeSnapshot}`;
        const r = resumoMap.get(key) || {
          pessoaId: s.pessoaId || null,
          empregadoId: s.empregadoId || null,
          nome: s.nomeSnapshot,
          pix: s.pixSnapshot,
          cpf: s.cpfSnapshot,
          whatsapp: s.whatsappSnapshot,
          qtdShifts: 0,
          totalHoras: 0,
          totalValor: 0,
        };
        r.qtdShifts += 1;
        r.totalHoras += s.horas || 0;
        r.totalValor += s.totalCalc || 0;
        resumoMap.set(key, r);
      }
      const pessoasResumo = Array.from(resumoMap.values())
        .sort((a, b) => a.nome.localeCompare(b.nome))
        .map((r) => ({
          ...r,
          totalHoras: Math.round(r.totalHoras * 100) / 100,
          totalValor: Math.round(r.totalValor * 100) / 100,
        }));

      const now = new Date().toISOString();
      const numero = proximoNumeroLote(pagamentos);
      const totalGeral = pessoasResumo.reduce((a, p) => a + p.totalValor, 0);

      const payload: Omit<FreelaPagamento, "id"> = {
        restaurantId,
        numero,
        ...(obs.trim() ? { observacao: obs.trim() } : {}),
        shiftIds: selecShifts.map((s) => s.id),
        pessoasResumo,
        totalGeral: Math.round(totalGeral * 100) / 100,
        qtdShifts: selecShifts.length,
        qtdPessoas: pessoasResumo.length,
        status: "pendente",
        criadoEm: now,
        criadoPor: me.id,
        criadoPorNome: me.nome,
      };
      const ref = await addDoc(collection(db, "freelaPagamentos"), payload as Record<string, unknown>);

      // Atualiza shifts pra apontar pro lote
      const batch = writeBatch(db);
      for (const s of selecShifts) {
        batch.update(doc(db, "freelaShifts", s.id), {
          lotePagamentoId: ref.id,
          updatedAt: now,
        });
      }
      await batch.commit();
      setSelecionados(new Set());
      setObs("");
      alert(`Lote ${numero} criado. Vá pra aba Histórico pra confirmar pagamento.`);
    } catch (e) {
      console.error(e);
      alert("Erro ao gerar lote.");
    } finally {
      setSalvando(false);
    }
  }

  const lotesPendentes = pagamentos.filter((p) => p.status === "pendente");

  return (
    <div>
      {/* Lotes pendentes — destaque pra ações de pagamento */}
      {lotesPendentes.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3">
          <div className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-2">
            ⏳ {lotesPendentes.length} lote(s) pendente(s) de pagamento
          </div>
          <div className="space-y-1 text-xs text-amber-700 dark:text-amber-200">
            {lotesPendentes.map((p) => (
              <LotePendenteRow key={p.id} lote={p} podeEditar={podeEditar} />
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div className="text-sm text-gray-700 dark:text-gray-200">
          <strong>{candidatos.length}</strong> turno(s) em fechamento ·{" "}
          <strong>{fmtBR(candidatos.reduce((a, s) => a + (s.totalCalc || 0), 0))}</strong>
        </div>
        {candidatos.length > 0 && podeEditar && (
          <button
            type="button"
            onClick={marcarTodos}
            className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            {selecionados.size === candidatos.length ? "Desmarcar todos" : "Marcar todos"}
          </button>
        )}
      </div>

      {candidatos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">
          Nenhum turno aguardando fechamento. Confirme turnos na aba <strong>Lançamento</strong>.
        </div>
      ) : (
        <div className="space-y-3">
          {porPessoa.map((g) => {
            const todosMarcados = g.shifts.every((s) => selecionados.has(s.id));
            const algumMarcado = g.shifts.some((s) => selecionados.has(s.id));
            const totalGrupo = g.shifts.reduce((a, s) => a + (s.totalCalc || 0), 0);
            return (
              <div key={g.key} className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800/50 flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-100 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={todosMarcados}
                      ref={(el) => { if (el) el.indeterminate = !todosMarcados && algumMarcado; }}
                      onChange={() => toggleGrupo(g.shifts)}
                      disabled={!podeEditar}
                    />
                    {g.nome}
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 font-normal">
                      ({g.shifts.length} turno · {fmtBR(totalGrupo)})
                    </span>
                  </label>
                  {!g.pix && (
                    <span className="text-[10px] text-red-600 dark:text-red-400">⚠ sem PIX</span>
                  )}
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {g.shifts.map((s) => (
                    <label key={s.id} className="px-3 py-2 flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <input
                        type="checkbox"
                        checked={selecionados.has(s.id)}
                        onChange={() => toggle(s.id)}
                        disabled={!podeEditar}
                      />
                      <div className="flex-1 text-gray-700 dark:text-gray-200">
                        {s.date}
                        {s.entrada && s.saida && (
                          <span className="ml-2 text-gray-500">
                            {s.entrada}–{s.saida} ({fmtHoras(s.horas || 0)})
                          </span>
                        )}
                        {s.area && <span className="ml-2 text-gray-500">· {s.area}</span>}
                      </div>
                      <div className="font-medium text-gray-800 dark:text-gray-100">
                        {fmtBR(s.totalCalc || 0)}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {candidatos.length > 0 && podeEditar && (
        <div className="mt-4 rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-900/20 p-3">
          <div className="text-sm font-medium text-indigo-900 dark:text-indigo-200 mb-2">
            💰 {totaisSelec.qtd} turno(s) selecionado(s) · {totaisSelec.pessoas} pessoa(s) ·{" "}
            <strong>{fmtBR(totaisSelec.total)}</strong>
          </div>
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={2}
            placeholder="Observação do lote (opcional)…"
            className="w-full px-2 py-1.5 text-xs rounded border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-900 dark:text-gray-100 mb-2"
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={gerarLote} disabled={salvando || totaisSelec.qtd === 0}>
              {salvando ? "Gerando…" : "Gerar lote de pagamento"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function LotePendenteRow({ lote, podeEditar }: { lote: FreelaPagamento; podeEditar: boolean }) {
  const { pessoa: me } = useAuth();
  const [salvando, setSalvando] = useState(false);

  async function marcarPago() {
    if (!me) return;
    const forma = prompt("Forma de pagamento (PIX, dinheiro, etc.) — opcional:") || "";
    if (!confirm(`Confirmar PAGAMENTO do lote ${lote.numero} (${fmtBR(lote.totalGeral)})?`)) return;
    setSalvando(true);
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, "freelaPagamentos", lote.id), {
        status: "pago",
        pagoEm: now,
        pagoPor: me.id,
        pagoPorNome: me.nome,
        ...(forma.trim() ? { formaPagamento: forma.trim() } : {}),
      });
      // Marca cada shift do lote como pago
      const batch = writeBatch(db);
      for (const sid of lote.shiftIds) {
        batch.update(doc(db, "freelaShifts", sid), {
          status: "pago",
          pagoEm: now,
          updatedAt: now,
        });
      }
      await batch.commit();
    } catch (e) {
      console.error(e);
      alert("Erro ao confirmar pagamento.");
    } finally {
      setSalvando(false);
    }
  }

  async function cancelar() {
    if (!confirm(`Cancelar lote ${lote.numero}? Os turnos voltam pra "Em fechamento" e podem entrar em outro lote.`)) return;
    setSalvando(true);
    try {
      const batch = writeBatch(db);
      const now = new Date().toISOString();
      for (const sid of lote.shiftIds) {
        batch.update(doc(db, "freelaShifts", sid), {
          lotePagamentoId: null,
          updatedAt: now,
        });
      }
      batch.delete(doc(db, "freelaPagamentos", lote.id));
      await batch.commit();
    } catch (e) {
      console.error(e);
      alert("Erro ao cancelar lote.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <div className="flex-1 truncate">
        <strong>{lote.numero}</strong> · {lote.qtdPessoas} pessoa(s) · {lote.qtdShifts} turno(s) ·{" "}
        <strong>{fmtBR(lote.totalGeral)}</strong>
      </div>
      {podeEditar && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={cancelar}
            disabled={salvando}
            className="text-[11px] text-red-600 hover:underline disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={marcarPago}
            disabled={salvando}
            className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline disabled:opacity-50"
          >
            ✅ Marcar pago
          </button>
        </div>
      )}
    </div>
  );
}
