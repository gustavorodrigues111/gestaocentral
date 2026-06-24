import { useEffect, useState } from "react";
import { addDoc, collection } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Modal } from "../../core/ui/Modal";
import { fetchMotivosAfastamento, lancarAfastamento, type MotivoAfastamento } from "../../core/ponto/solidesPontoClient";
import type { PontoColaborador } from "../../core/ponto/analise";

// Converte qualquer YYYY-MM-DD (inclusive dentro de "X a Y") → DD/MM/YYYY.
const fmtBR = (s: string) => s.replace(/(\d{4})-(\d{2})-(\d{2})/g, "$3/$2/$1");

// ─── Modal "Lançar afastamento / férias" ────────────────────────────────────
export function AfastamentoModal({
  prefill, roster, shortCode, restaurantId, por, onClose, onDone,
}: {
  prefill: { employeeId?: number; colaborador?: string; data?: string };
  roster: PontoColaborador[];
  shortCode: string;
  restaurantId: string;
  por: { id: string; nome: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [motivos, setMotivos] = useState<MotivoAfastamento[]>([]);
  const [empId, setEmpId] = useState<number | "">(prefill.employeeId ?? "");
  const [motivoId, setMotivoId] = useState<number | "">("");
  const [inicio, setInicio] = useState(prefill.data || "");
  const [fim, setFim] = useState(prefill.data || "");
  const [diaInteiro, setDiaInteiro] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    fetchMotivosAfastamento(shortCode)
      .then((ms) => { if (vivo) setMotivos(ms); })
      .catch((e) => { if (vivo) setErro(e instanceof Error ? e.message : "Falha ao carregar motivos."); });
    return () => { vivo = false; };
  }, [shortCode]);

  // Ao escolher o motivo, se ele for "dia inteiro" obrigatório, marca o checkbox.
  function escolherMotivo(id: number) {
    setMotivoId(id);
    const m = motivos.find((x) => x.id === id);
    if (m?.fullDay) setDiaInteiro(true);
  }

  const empNome = (id: number) => roster.find((r) => r.id === id)?.name || prefill.colaborador || "?";

  // Atestados médicos e licenças mudaram de rotina na Sólides: agora só pelo
  // "módulo de Afastamentos" (timeoffwork) — o /adjustment/register recusa (400).
  // Detecta pelo nome do motivo e bloqueia com orientação (integração nova é projeto à parte).
  const motivoSel = motivos.find((m) => m.id === motivoId);
  const motivoNovoFluxo = !!motivoSel && /atestad|licen|m[eé]dic|[oó]bito|matern|patern|afastament|inss|acidente/i.test(motivoSel.description || "");

  async function confirmar() {
    if (!empId) { setErro("Escolha o colaborador."); return; }
    if (!motivoId) { setErro("Escolha o motivo."); return; }
    if (motivoNovoFluxo) { setErro("Atestados e licenças agora são lançados no módulo de Afastamentos da Sólides — lance por lá. A integração automática aqui está em desenvolvimento."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) { setErro("Informe o período (início e fim)."); return; }
    if (inicio > fim) { setErro("O início não pode ser depois do fim."); return; }
    const motivo = motivos.find((m) => m.id === motivoId);
    if (!window.confirm(`Lançar ${motivo?.description || "afastamento"} para ${empNome(Number(empId))}\nde ${fmtBR(inicio)} a ${fmtBR(fim)}?\n\nGrava na Sólides como APROVADO.`)) return;
    setErro(""); setSalvando(true);
    try {
      await lancarAfastamento(shortCode, {
        employeeId: Number(empId), adjustmentReasonId: Number(motivoId),
        startDate: inicio, endDate: fim, fullDay: diaInteiro,
      });
      try {
        await addDoc(collection(db, "pontoAuditoria"), {
          restaurantId, tipo: "afastamento",
          por: { id: por.id, nome: por.nome },
          employeeId: Number(empId), colaborador: empNome(Number(empId)),
          motivoId: Number(motivoId), motivo: motivo?.description || "",
          inicio, fim, diaInteiro, em: new Date().toISOString(),
        });
      } catch { /* auditoria não bloqueia */ }
      alert(`Afastamento lançado na Sólides ✓ (${motivo?.description || ""}, ${fmtBR(inicio)}–${fmtBR(fim)}). Reanalisando…`);
      onDone();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao lançar o afastamento.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal title="🏖️ Lançar afastamento / férias" onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          O período inteiro é lançado de uma vez (a justificativa vale pra todos os dias). Entra como <strong>aprovado</strong> na Sólides.
        </p>
        {erro && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">{erro}</div>}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Colaborador</label>
          {prefill.employeeId ? (
            <div className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200">{prefill.colaborador}</div>
          ) : (
            <select value={empId} onChange={(e) => setEmpId(e.target.value ? Number(e.target.value) : "")}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100">
              <option value="">— escolha —</option>
              {[...roster].filter((r) => typeof r.id === "number" && !r.fired).sort((a, b) => (a.name || "").localeCompare(b.name || "")).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Motivo</label>
          <select value={motivoId} onChange={(e) => escolherMotivo(Number(e.target.value))}
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100">
            <option value="">{motivos.length ? "— escolha —" : "— carregando —"}</option>
            {motivos.map((m) => <option key={m.id} value={m.id}>{m.description}</option>)}
          </select>
          {motivoNovoFluxo && (
            <div className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded px-2 py-1.5">
              ⚠ Atestados médicos e licenças mudaram na Sólides — agora só pelo <strong>módulo de Afastamentos</strong> dela. Lance por lá; a integração automática aqui está em desenvolvimento. Os demais motivos (inversão de folga, etc.) funcionam normal por aqui.
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Início</label>
            <input type="date" value={inicio} max={fim || undefined} onChange={(e) => setInicio(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Fim</label>
            <input type="date" value={fim} min={inicio || undefined} onChange={(e) => setFim(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]" />
          </div>
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
          <input type="checkbox" checked={diaInteiro} onChange={(e) => setDiaInteiro(e.target.checked)} className="w-4 h-4 accent-indigo-600" />
          Dia inteiro
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={salvando}
            className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300">Cancelar</button>
          <button type="button" onClick={() => void confirmar()} disabled={salvando || motivoNovoFluxo}
            title={motivoNovoFluxo ? "Atestado/licença: lance pelo módulo de Afastamentos da Sólides" : undefined}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50">
            {salvando ? "Lançando…" : "Lançar afastamento"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
