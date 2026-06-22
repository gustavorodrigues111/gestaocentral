import { useEffect, useState } from "react";
import { addDoc, collection } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Modal } from "../../core/ui/Modal";
import { fetchJustificativas, corrigirPontoAtraso, editarBatida, excluirBatida, type Justificativa } from "../../core/ponto/solidesPontoClient";
import { fetchPunches } from "../../core/excecoes/solidesClient";
import type { SolidesPunch } from "../../core/excecoes/types";

const pad = (n: number) => String(n).padStart(2, "0");
// Converte qualquer YYYY-MM-DD (inclusive dentro de "X a Y") → DD/MM/YYYY.
const fmtBR = (s: string) => s.replace(/(\d{4})-(\d{2})-(\d{2})/g, "$3/$2/$1");

// ─── Modal "Batidas do dia": edita/exclui blocos direto na Sólides ──────────
export function BatidasDiaModal({
  info, shortCode, restaurantId, por, onClose, onChanged,
}: {
  info: { employeeId: number; colaborador: string; data: string };
  shortCode: string;
  restaurantId: string;
  por: { id: string; nome: string };
  onClose: () => void;
  onChanged: () => void;
}) {
  const [punches, setPunches] = useState<SolidesPunch[]>([]);
  const [edits, setEdits] = useState<Record<number, { in: string; out: string }>>({});
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<number | null>(null);
  const [erro, setErro] = useState("");
  const [justs, setJusts] = useState<Justificativa[]>([]);
  const [justId, setJustId] = useState<number | null>(null);
  const [novaHora, setNovaHora] = useState("");
  const [adicionando, setAdicionando] = useState(false);

  const msToInput = (ms?: number | null) => {
    if (!ms) return "";
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const inputToMs = (origMs: number, hhmm: string) => {
    const d = new Date(origMs);
    const [h, m] = hhmm.split(":").map(Number);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  const temSaida = (p: SolidesPunch) => typeof p.dateOut === "number" && p.dateOut > p.dateIn;

  async function recarregar() {
    setCarregando(true);
    try {
      const r = await fetchPunches(info.data, info.data, shortCode);
      const blocos = r.punches
        .filter((p) => p.employeeId === info.employeeId && p.date === info.data)
        .sort((a, b) => a.dateIn - b.dateIn);
      setPunches(blocos);
      const e: Record<number, { in: string; out: string }> = {};
      for (const p of blocos) e[p.id] = { in: msToInput(p.dateIn), out: temSaida(p) ? msToInput(p.dateOut) : "" };
      setEdits(e);
    } catch (ex) {
      setErro(ex instanceof Error ? ex.message : "Falha ao carregar as batidas do dia.");
    } finally {
      setCarregando(false);
    }
  }
  useEffect(() => { void recarregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [shortCode, info.employeeId, info.data]);

  useEffect(() => {
    let vivo = true;
    fetchJustificativas(shortCode)
      .then((js) => { if (vivo) { setJusts(js); if (js[0]) setJustId(js[0].id); } })
      .catch(() => { /* sem justificativas → bloqueia o adicionar */ });
    return () => { vivo = false; };
  }, [shortCode]);

  async function audit(tipo: string, extra: Record<string, unknown>) {
    try {
      await addDoc(collection(db, "pontoAuditoria"), {
        restaurantId, tipo, por: { id: por.id, nome: por.nome },
        employeeId: info.employeeId, colaborador: info.colaborador, data: info.data,
        ...extra, em: new Date().toISOString(),
      });
    } catch { /* auditoria não bloqueia */ }
  }

  async function salvarBloco(p: SolidesPunch) {
    const e = edits[p.id]; if (!e) return;
    const curIn = msToInput(p.dateIn);
    const curOut = temSaida(p) ? msToInput(p.dateOut) : "";
    const mudouIn = /^\d{2}:\d{2}$/.test(e.in) && e.in !== curIn;
    const mudouOut = curOut && /^\d{2}:\d{2}$/.test(e.out) && e.out !== curOut;
    if (!mudouIn && !mudouOut) { setErro("Nenhuma alteração nessa batida."); return; }
    if (!window.confirm(`Editar batida de ${info.colaborador} em ${fmtBR(info.data)}?\n${mudouIn ? `Entrada ${curIn} → ${e.in}\n` : ""}${mudouOut ? `Saída ${curOut} → ${e.out}\n` : ""}\nGrava na Sólides (dado trabalhista).`)) return;
    setErro(""); setSalvando(p.id);
    try {
      if (mudouIn) {
        await editarBatida(shortCode, { employeeId: info.employeeId, punchId: p.id, oldMs: p.dateIn, newMs: inputToMs(p.dateIn, e.in) });
        await audit("editar_batida", { punchId: p.id, campo: "entrada", de: curIn, para: e.in });
      }
      if (mudouOut) {
        await editarBatida(shortCode, { employeeId: info.employeeId, punchId: p.id, oldMs: p.dateOut, newMs: inputToMs(p.dateOut, e.out) });
        await audit("editar_batida", { punchId: p.id, campo: "saida", de: curOut, para: e.out });
      }
      await recarregar();
      onChanged();
    } catch (ex) {
      setErro(ex instanceof Error ? ex.message : "Falha ao editar a batida.");
    } finally {
      setSalvando(null);
    }
  }

  async function adicionarBatida() {
    if (!/^\d{2}:\d{2}$/.test(novaHora)) { setErro("Informe a hora da batida (HH:MM)."); return; }
    if (!justId) { setErro("Escolha uma justificativa."); return; }
    const dataHoraIso = `${info.data}T${novaHora}:00.000-0300`;
    if (!window.confirm(`Adicionar batida ${novaHora} para ${info.colaborador} em ${fmtBR(info.data)}?\n\nGrava na Sólides (a Sólides decide se é entrada ou saída e pareia).`)) return;
    setErro(""); setAdicionando(true);
    try {
      await corrigirPontoAtraso(shortCode, { employeeId: info.employeeId, dataHoraIso, justificativaId: justId });
      await audit("adicionar_batida", { hora: novaHora, justificativaId: justId });
      setNovaHora("");
      await recarregar();
      onChanged();
    } catch (ex) {
      setErro(ex instanceof Error ? ex.message : "Falha ao adicionar a batida.");
    } finally {
      setAdicionando(false);
    }
  }

  async function excluirBloco(p: SolidesPunch) {
    if (!window.confirm(`Excluir a batida ${msToInput(p.dateIn)}${temSaida(p) ? `–${msToInput(p.dateOut)}` : ""} de ${info.colaborador} em ${fmtBR(info.data)}?\n\nRemove na Sólides (dado trabalhista).`)) return;
    setErro(""); setSalvando(p.id);
    try {
      await excluirBatida(shortCode, { employeeId: info.employeeId, punchId: p.id, dateIn: p.dateIn, dateOut: temSaida(p) ? p.dateOut : undefined });
      await audit("excluir_batida", { punchId: p.id, entrada: msToInput(p.dateIn), saida: temSaida(p) ? msToInput(p.dateOut) : "" });
      await recarregar();
      onChanged();
    } catch (ex) {
      setErro(ex instanceof Error ? ex.message : "Falha ao excluir a batida.");
    } finally {
      setSalvando(null);
    }
  }

  return (
    <Modal title={`🛠️ Batidas do dia — ${info.colaborador}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {fmtBR(info.data)}. Edite a hora e clique em <strong>Salvar</strong>, ou <strong>Excluir</strong> o bloco. Grava direto na Sólides.
        </p>
        {erro && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">{erro}</div>}

        {carregando ? (
          <div className="py-6 text-center text-sm text-gray-400">Carregando batidas…</div>
        ) : punches.length === 0 ? (
          <div className="py-6 text-center text-sm text-gray-400">Nenhuma batida nesse dia. Use “Lançar ponto” pra adicionar.</div>
        ) : (
          <div className="space-y-2">
            {punches.map((p) => {
              const e = edits[p.id] || { in: "", out: "" };
              const busy = salvando === p.id;
              return (
                <div key={p.id} className="flex flex-wrap items-end gap-2 border border-gray-200 dark:border-gray-800 rounded-lg p-2.5">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-gray-500">Entrada</label>
                    <input type="time" value={e.in} disabled={busy}
                      onChange={(ev) => setEdits((c) => ({ ...c, [p.id]: { ...c[p.id], in: ev.target.value } }))}
                      className="px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-gray-500">Saída</label>
                    <input type="time" value={e.out} disabled={busy || !temSaida(p)}
                      onChange={(ev) => setEdits((c) => ({ ...c, [p.id]: { ...c[p.id], out: ev.target.value } }))}
                      className="px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 disabled:opacity-50 [color-scheme:light] dark:[color-scheme:dark]" />
                  </div>
                  {!temSaida(p) && <span className="text-[10px] text-amber-600 mb-2">em aberto</span>}
                  <div className="ml-auto flex items-center gap-1.5 mb-0.5">
                    <button type="button" disabled={busy} onClick={() => void salvarBloco(p)}
                      className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50">
                      {busy ? "…" : "Salvar"}
                    </button>
                    <button type="button" disabled={busy} onClick={() => void excluirBloco(p)}
                      className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">
                      Excluir
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Adicionar batida (lança ponto em atraso; a Sólides decide entrada/saída) */}
        <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">➕ Adicionar batida</div>
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-gray-500">Hora</label>
              <input type="time" value={novaHora} disabled={adicionando} onChange={(ev) => setNovaHora(ev.target.value)}
                className="px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]" />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
              <label className="text-[10px] font-semibold text-gray-500">Justificativa</label>
              <select value={justId ?? ""} disabled={adicionando} onChange={(ev) => setJustId(Number(ev.target.value))}
                className="px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100">
                {justs.length === 0 && <option value="">— carregando —</option>}
                {justs.map((j) => <option key={j.id} value={j.id}>{j.description}</option>)}
              </select>
            </div>
            <button type="button" onClick={() => void adicionarBatida()} disabled={adicionando}
              className="text-[11px] font-semibold px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
              {adicionando ? "Adicionando…" : "Adicionar"}
            </button>
          </div>
          <p className="text-[10px] text-gray-400 mt-1">A Sólides decide se é entrada ou saída e pareia com as batidas existentes.</p>
        </div>
      </div>
    </Modal>
  );
}
