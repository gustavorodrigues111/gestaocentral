// ════════════════════════════════════════════════════════════════════════════
//  DemitirSolidesModal — confirmação explícita pra espelhar a demissão na Sólides.
//  Pessoa já inativa no app; aqui o DP confirma data + motivo e demite lá também.
//  Irreversível na Sólides — por isso confirmação explícita + auditoria.
// ════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import type { Pessoa } from "../../core/types";
import { demitirNoSolides } from "../../core/ponto/solidesPontoClient";
import { Modal } from "../../core/ui/Modal";

export function DemitirSolidesModal({
  pessoa, shortCode, por, onClose,
}: {
  pessoa: Pessoa;
  shortCode: string;
  por: { id: string; nome: string };
  onClose: () => void;
}) {
  const hojeYmd = new Date().toISOString().slice(0, 10);
  const [data, setData] = useState((pessoa.inativadaEm || "").slice(0, 10) || hojeYmd);
  const [motivo, setMotivo] = useState(pessoa.motivoInativacao || "");
  const [noticeType, setNoticeType] = useState<"trabalhado" | "indenizado">("indenizado");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function confirmar() {
    if (!pessoa.cpf) { setErro("Pessoa sem CPF — não dá pra casar com a Sólides."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) { setErro("Informe a data de demissão."); return; }
    if (!shortCode) { setErro("Restaurante sem shortCode configurado."); return; }
    if (!window.confirm(`Demitir ${pessoa.nome} na SÓLIDES em ${data.split("-").reverse().join("/")}?\n\n⚠️ Isso é IRREVERSÍVEL na Sólides.`)) return;
    setErro(""); setSalvando(true);
    try {
      await demitirNoSolides(shortCode, { cpf: pessoa.cpf, dismissalDate: data, reason: motivo, noticeType });
      await updateDoc(doc(db, "pessoas", pessoa.id), {
        solidesDemissao: { em: new Date().toISOString(), data, motivo: motivo || "", por: por.nome },
      });
      alert("Demitido na Sólides ✓");
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao demitir na Sólides.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal title="Demitir na Sólides" onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <p className="text-sm text-gray-700 dark:text-gray-200">
          Espelhar a demissão de <strong>{pessoa.nome}</strong> na Sólides. Confirme a data e o motivo.
        </p>
        <p className="text-[11px] text-amber-700 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded px-2 py-1.5">
          ⚠️ Demissão na Sólides é <strong>irreversível</strong> por aqui (reativar seria manual na plataforma deles).
        </p>
        {erro && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">{erro}</div>}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Data de demissão (desligamento)</label>
            <input type="date" value={data} onChange={(e) => setData(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Aviso prévio</label>
            <select value={noticeType} onChange={(e) => setNoticeType(e.target.value as "trabalhado" | "indenizado")}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100">
              <option value="indenizado">Indenizado</option>
              <option value="trabalhado">Trabalhado</option>
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Motivo</label>
          <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex: pedido de demissão, sem justa causa…"
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          📅 A <strong>data de demissão</strong> é o <strong>fim do contrato</strong> (como na Sólides): aviso <strong>trabalhado</strong> = último dia trabalhado; <strong>indenizado</strong> = data de projeção do aviso prévio (futura).
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={salvando}
            className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300">Cancelar</button>
          <button type="button" onClick={() => void confirmar()} disabled={salvando}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-50">
            {salvando ? "Demitindo…" : "Demitir na Sólides"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
