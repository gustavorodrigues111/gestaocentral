import { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { Ideia, PautaItem, Reuniao } from "../../core/types";

type Props = {
  ideia: Ideia;
  reunioes: Reuniao[];     // só planejadas
  restaurantId: string;
  onClose: () => void;
};

export function LevarParaReuniaoModal({ ideia, reunioes, onClose }: Props) {
  const [reuniaoId, setReuniaoId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function confirmar() {
    if (!reuniaoId) { setErr("Escolha uma reunião"); return; }
    setSaving(true);
    setErr("");
    try {
      const reuniao = reunioes.find(r => r.id === reuniaoId);
      if (!reuniao) { setErr("Reunião não encontrada"); return; }

      // Adiciona como tópico de pauta
      const novoTopico: PautaItem = {
        id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        titulo: ideia.titulo,
        descricao: ideia.descricao,
        ideiaId: ideia.id,
        ordem: (reuniao.pauta?.length || 0) + 1,
        discutido: false,
      };
      const novaPauta: PautaItem[] = [...(reuniao.pauta || []), novoTopico];
      await updateDoc(doc(db, "reunioes", reuniao.id), sanitizeForFirestore({
        pauta: novaPauta,
        atualizadoEm: new Date().toISOString(),
      }));

      // Marca ideia como em_pauta
      await updateDoc(doc(db, "ideias", ideia.id), {
        status: "em_pauta",
        reuniaoId: reuniao.id,
        atualizadoEm: new Date().toISOString(),
      });

      onClose();
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  const ordenadas = [...reunioes].sort((a, b) => (a.data || "").localeCompare(b.data || ""));

  return (
    <Modal title={`🗓️ Levar pra reunião — ${ideia.titulo}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Escolha uma reunião planejada. A ideia vira tópico da pauta e fica linkada.
        </p>

        {ordenadas.length === 0 ? (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-800 dark:text-amber-300">
            Nenhuma reunião planejada. Crie uma no módulo Reuniões primeiro.
          </div>
        ) : (
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {ordenadas.map(r => (
              <label
                key={r.id}
                className={`flex items-start gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                  reuniaoId === r.id
                    ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30"
                    : "border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                }`}
              >
                <input
                  type="radio"
                  checked={reuniaoId === r.id}
                  onChange={() => setReuniaoId(r.id)}
                  className="mt-1"
                />
                <div className="flex-1 text-sm">
                  <div className="font-medium text-gray-900 dark:text-gray-100">{r.titulo}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    📅 {new Date(r.data + "T12:00:00").toLocaleDateString("pt-BR")}
                    {r.horario && <> · {r.horario}</>}
                    <> · {r.pauta?.length || 0} tópico(s) na pauta</>
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirmar} disabled={saving || !reuniaoId}>
            {saving ? "Adicionando..." : "Confirmar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
