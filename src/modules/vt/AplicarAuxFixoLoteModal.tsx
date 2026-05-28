// ════════════════════════════════════════════════════════════════════════════
//  Modal master — aplicar "Auxílio fixo mensal" em lote
//
//  Define o mesmo `vtAuxilioFixoMensal` (o campo "Auxílio fixo mensal" do
//  cadastro do empregado, na aba Vínculo) em TODOS os empregados do restaurante
//  de uma vez (ex: Puba paga R$ 250 fixo pra todo mundo). Esse auxílio entra no
//  lote de Vale Transporte (vai cheio, não proporcional). Evita editar pessoa a
//  pessoa. É um valor mensal liso — sem vigência por data.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { doc, writeBatch } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type { Empregado } from "../../core/types";

type Props = {
  restaurantNome: string;
  empregados: Empregado[];   // todos do restaurante
  onClose: () => void;
};

function parseValor(s: string): number | null {
  const n = parseFloat(s.replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function AplicarAuxFixoLoteModal({ restaurantNome, empregados, onClose }: Props) {
  const [valor, setValor] = useState("250");
  const [soAtivos, setSoAtivos] = useState(true);
  const [aplicando, setAplicando] = useState(false);
  const [msg, setMsg] = useState("");
  const [erro, setErro] = useState("");

  const alvo = soAtivos ? empregados.filter(e => e.estaAtivo) : empregados;

  async function aplicar() {
    setErro(""); setMsg("");
    const v = parseValor(valor);
    if (v == null) { setErro("Valor inválido."); return; }
    if (alvo.length === 0) { setErro("Nenhum empregado pra aplicar."); return; }
    const ok = confirm(
      `Definir auxílio fixo mensal = R$ ${v.toFixed(2).replace(".", ",")} ` +
      `em ${alvo.length} empregado(s) de ${restaurantNome}?\n\n` +
      `Isso sobrescreve o auxílio fixo mensal atual de cada um.`,
    );
    if (!ok) return;
    setAplicando(true);
    try {
      // writeBatch aguenta 500 ops; lotes de restaurante ficam bem abaixo disso.
      const batch = writeBatch(db);
      for (const e of alvo) {
        batch.update(doc(db, "empregados", e.id), { vtAuxilioFixoMensal: v });
      }
      await batch.commit();
      setMsg(`✓ Auxílio fixo mensal aplicado em ${alvo.length} empregado(s).`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao aplicar.");
    } finally {
      setAplicando(false);
    }
  }

  return (
    <Modal title="🧪 Auxílio fixo mensal em lote" onClose={onClose} maxWidth="max-w-md">
      <div className="p-4 space-y-4">
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Define o mesmo <strong>auxílio fixo mensal</strong> (o campo do cadastro
          do empregado, na aba Vínculo) em todos os empregados de{" "}
          <strong>{restaurantNome}</strong> de uma vez. Esse auxílio entra no lote
          de Vale Transporte. É um valor mensal liso — não tem vigência por data.
        </p>

        <Input
          label="Auxílio fixo mensal (R$)"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          inputMode="decimal"
          placeholder="250,00"
        />

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 select-none">
          <input
            type="checkbox"
            checked={soAtivos}
            onChange={(e) => setSoAtivos(e.target.checked)}
            className="accent-indigo-600"
          />
          Só empregados ativos ({empregados.filter(e => e.estaAtivo).length} de {empregados.length})
        </label>

        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          ⚠ Sobrescreve o auxílio fixo mensal atual de cada empregado selecionado.
          Pra zerar pra alguém depois, edite o cadastro dele.
        </p>

        {msg && <div className="text-xs text-emerald-700 dark:text-emerald-400">{msg}</div>}
        {erro && <div className="text-xs text-rose-600 dark:text-rose-400">{erro}</div>}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose} disabled={aplicando}>Fechar</Button>
          <Button onClick={aplicar} disabled={aplicando || alvo.length === 0}>
            {aplicando ? "Aplicando…" : `Aplicar em ${alvo.length}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
