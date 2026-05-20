// ════════════════════════════════════════════════════════════════════════════
//  Modal "Preencher formulário manualmente" — usado quando o RH precisa
//  digitar a ficha pelo candidato (ex: candidato mandou os dados por outro
//  canal — papel, e-mail, WhatsApp). Reusa exatamente o mesmo render do
//  formulário público.
//
//  NÃO é o caminho ideal — a ideia é o candidato preencher sozinho — mas
//  cobre casos excepcionais. Ao salvar, marca o doc com
//  `preenchimentoManual: { por, em }` pra distinguir no histórico.
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { useAuth } from "../../core/auth/AuthContext";
import type { Admissao } from "../../core/types";
import {
  CampoRender,
  agruparPorGrupo,
  isConfirmado,
  mapaConfirmados,
  vazio,
} from "./AdmissaoPublicaPage";

type Props = {
  admissao: Admissao;
  onClose: () => void;
  onSaved: () => void;
};

export function PreencherFormManualModal({ admissao, onClose, onSaved }: Props) {
  const { pessoa: me } = useAuth();
  const [dados, setDados] = useState<Record<string, unknown>>(() => ({
    ...((admissao.dadosPreenchidos as Record<string, unknown>) || {}),
    ...mapaConfirmados(admissao),
  }));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const gruposOrdenados = useMemo(() => agruparPorGrupo(admissao.schemaUsado), [admissao.schemaUsado]);
  const numFilhosDeclarados = (() => {
    const v = dados.num_filhos;
    const n = typeof v === "number" ? v : parseInt(String(v || ""), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  })();
  const vtNaoUtiliza = dados.vt_nao_utiliza === true;

  function updateCampo(id: string, value: unknown) {
    setDados((cur) => ({ ...cur, [id]: value }));
  }

  async function salvar() {
    setErro("");
    // Validação dos campos obrigatórios — mesma da tela pública
    const faltando: string[] = [];
    for (const f of admissao.schemaUsado) {
      if (!f.obrigatorio || !f.ativo) continue;
      if (vazio(dados[f.id], f.tipo)) faltando.push(f.label);
    }
    if (faltando.length > 0) {
      setErro(
        `Faltam ${faltando.length} campo(s) obrigatório(s):\n• ` +
        faltando.slice(0, 8).join("\n• ") +
        (faltando.length > 8 ? `\n… +${faltando.length - 8}` : ""),
      );
      return;
    }
    setSalvando(true);
    try {
      const now = new Date().toISOString();
      await setDoc(
        doc(db, "admissoes", admissao.id),
        {
          dadosPreenchidos: dados,
          status: "formulario_preenchido",
          preenchidoEm: now,
          preenchimentoManual: {
            por: me ? { id: me.id, nome: me.nome } : null,
            em: now,
          },
          updatedAt: now,
        },
        { merge: true },
      );
      onSaved();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar.");
      setSalvando(false);
    }
  }

  return (
    <Modal
      title={`Preencher formulário manualmente — ${admissao.candidato.nome}`}
      onClose={onClose}
      maxWidth="max-w-3xl"
    >
      <div className="space-y-3">
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-900 dark:text-amber-300">
          ⚠ Use só em casos excepcionais — o caminho normal é o candidato
          preencher sozinho pelo link. Ao salvar, o doc fica marcado como
          "preenchimento manual por {me?.nome || "—"}" pra distinguir no histórico.
        </div>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {gruposOrdenados.map(({ grupo, campos }) => (
            <section
              key={grupo}
              className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3"
            >
              <h3 className="font-bold text-sm text-gray-900 dark:text-gray-100 border-b border-gray-100 dark:border-gray-800 pb-2">
                {grupo}
              </h3>
              {campos.map((f) => (
                <CampoRender
                  key={f.id}
                  field={f}
                  bloqueado={isConfirmado(f.id)}
                  value={dados[f.id]}
                  onChange={(v) => updateCampo(f.id, v)}
                  ctx={{ numFilhosDeclarados, vtNaoUtiliza }}
                />
              ))}
            </section>
          ))}
        </div>

        {erro && (
          <div className="text-xs text-rose-600 dark:text-rose-400 whitespace-pre-wrap">
            {erro}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : "💾 Salvar e marcar preenchido"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
