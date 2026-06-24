import { useEffect, useState } from "react";
import { addDoc, collection } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Modal } from "../../core/ui/Modal";
import { fetchMotivosAfastamento, lancarAfastamento, criarAfastamentoNovo, type MotivoAfastamento } from "../../core/ponto/solidesPontoClient";
import { fetchPunches } from "../../core/excecoes/solidesClient";
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

  // Atestados/licenças mudaram de rotina na Sólides: vão pelo módulo novo
  // (timeoffwork) — o /adjustment/register antigo recusa (400).
  //  - `mapNovo`: motivo JÁ integrado aqui (lança via /api/solides-afastamento-criar).
  //  - `motivoBloqueado`: motivo do fluxo novo ainda NÃO integrado → orienta usar a Sólides.
  // timeOffWork/esocialReason vêm das listas capturadas (POST real da Sólides).
  const motivoSel = motivos.find((m) => m.id === motivoId);
  const mapNovo = motivoSel && /atestad|doen[çc]a n[ãa]o relacionada/i.test(motivoSel.description || "")
    ? { timeOffWork: 4, esocialReason: "COD_02", rotulo: "Acidente/Doença não relacionada ao trabalho (atestado médico) · eSocial COD_02" }
    : null;
  const motivoBloqueado = !!motivoSel && !mapNovo && /licen[çc]a|matern|patern|[oó]bito|afastament|inss|acidente|doen[çc]a do trabalho/i.test(motivoSel.description || "");

  // Checa se o colaborador TEM batida em algum dia do período [inicio, fim].
  // Não costuma fazer sentido lançar afastamento em dia trabalhado — avisa.
  // Retorna false se o usuário cancelar diante do aviso; true pra seguir.
  async function passouChecagemBatidas(): Promise<boolean> {
    try {
      const r = await fetchPunches(inicio, fim, shortCode, true);
      const dias = [...new Set(
        r.punches
          .filter((p) => p.employeeId === Number(empId) && !p.excluded && !!p.dateIn && p.date >= inicio && p.date <= fim)
          .map((p) => p.date),
      )].sort();
      if (dias.length) {
        return window.confirm(`⚠ ${empNome(Number(empId))} TEM BATIDA em ${dias.map(fmtBR).join(", ")} dentro do período.\n\nNão costuma fazer sentido lançar afastamento em dia trabalhado. Lançar mesmo assim?`);
      }
    } catch { /* checagem best-effort — não trava se a Sólides falhar */ }
    return true;
  }

  async function confirmar() {
    if (!empId) { setErro("Escolha o colaborador."); return; }
    if (!motivoId) { setErro("Escolha o motivo."); return; }
    if (motivoBloqueado) { setErro("Esse tipo (licença/afastamento) ainda não está integrado aqui — lance no módulo de Afastamentos da Sólides. Atestado médico já funciona por aqui."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) { setErro("Informe o período (início e fim)."); return; }
    if (inicio > fim) { setErro("O início não pode ser depois do fim."); return; }
    if (mapNovo) {
      if (!(await passouChecagemBatidas())) return;
      if (!window.confirm(`Lançar ATESTADO MÉDICO para ${empNome(Number(empId))}\nde ${fmtBR(inicio)} a ${fmtBR(fim)}?\n\nVai pro módulo de Afastamentos da Sólides (eSocial: ${mapNovo.esocialReason}). Sem anexo.`)) return;
      setErro(""); setSalvando(true);
      try {
        await criarAfastamentoNovo(shortCode, { employee: Number(empId), timeOffWork: mapNovo.timeOffWork, esocialReason: mapNovo.esocialReason, startDate: inicio, endDate: fim });
        try {
          await addDoc(collection(db, "pontoAuditoria"), {
            restaurantId, tipo: "afastamento_novo",
            por: { id: por.id, nome: por.nome },
            employeeId: Number(empId), colaborador: empNome(Number(empId)),
            motivoId: Number(motivoId), motivo: motivoSel?.description || "Atestado médico",
            timeOffWork: mapNovo.timeOffWork, esocialReason: mapNovo.esocialReason,
            inicio, fim, diaInteiro: true, em: new Date().toISOString(),
          });
        } catch { /* auditoria não bloqueia */ }
        alert(`Atestado lançado no módulo de Afastamentos da Sólides ✓ (${fmtBR(inicio)}–${fmtBR(fim)}). Reanalisando…`);
        onDone();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao lançar o atestado.");
      } finally { setSalvando(false); }
      return;
    }
    const motivo = motivos.find((m) => m.id === motivoId);
    if (!(await passouChecagemBatidas())) return;
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
          {mapNovo && (
            <div className="text-[11px] text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded px-2 py-1.5">
              ✓ Vai pelo <strong>módulo de Afastamentos</strong> da Sólides — {mapNovo.rotulo}. Sem anexo.
            </div>
          )}
          {motivoBloqueado && (
            <div className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded px-2 py-1.5">
              ⚠ Licenças/afastamentos (maternidade, paternidade, etc.) ainda não estão integrados aqui — lance no <strong>módulo de Afastamentos</strong> da Sólides. <strong>Atestado médico</strong> já funciona por aqui.
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
          <button type="button" onClick={() => void confirmar()} disabled={salvando || motivoBloqueado}
            title={motivoBloqueado ? "Licença/afastamento: lance pelo módulo de Afastamentos da Sólides" : undefined}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50">
            {salvando ? "Lançando…" : mapNovo ? "Lançar atestado" : "Lançar afastamento"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
