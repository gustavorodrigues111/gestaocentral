// Modal pra liberar o email de uma pessoa INATIVA — útil quando o email
// corporativo da empregada demitida vai ser reutilizado pra contratar
// alguém novo no mesmo cargo (ex: pessoas@quibebe.com.br).
//
// O que acontece:
//   1. pessoa.email é limpo (vira string vazia)
//   2. pessoa.uidVinculado é limpo (desconecta do Firebase Auth antigo)
//   3. Audit log captura o email original + quem liberou + quando
//   4. Histórico de escala/gorjeta/VT/tudo da pessoa antiga FICA INTACTO
//      (todas as referências usam pessoa.id, não o email).
//
// O que NÃO faz (precisa ser manual no Firebase Console):
//   - Não apaga o user do Firebase Auth (precisa de Admin SDK, bloqueado
//     pela org policy do Workspace). Master apaga manualmente seguindo
//     instrução exibida pós-ação.

import { useState } from "react";
import { doc, updateDoc, deleteField } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { logAudit } from "../../core/audit/versionedChange";
import type { Pessoa } from "../../core/types";

type Props = {
  pessoa: Pessoa;
  masterId: string;
  masterNome: string;
  onClose: () => void;
  onFeito: () => void;
};

export function LiberarEmailModal({ pessoa, masterId, masterNome, onClose, onFeito }: Props) {
  const [executando, setExecutando] = useState(false);
  const [erro, setErro] = useState("");
  const [passo, setPasso] = useState<"confirmar" | "feito">("confirmar");

  const emailOriginal = pessoa.email;

  async function executar() {
    if (executando) return;
    setExecutando(true);
    setErro("");
    try {
      // 1. Limpa email + uidVinculado do doc da Pessoa
      // deleteField pra remover o campo (vs string vazia) — Firestore
      // permite que outras queries `where("email", "==", X)` não
      // encontrem essa pessoa, mantendo email como "ausente" e não
      // "vazio que ainda match".
      await updateDoc(doc(db, "pessoas", pessoa.id), {
        email: deleteField(),
        uidVinculado: deleteField(),
        emailLiberadoEm: new Date().toISOString(),
        emailLiberadoPor: masterId,
        emailLiberadoAnterior: emailOriginal,
      });
      // 2. Audit log — registra qual email foi liberado, mantém o histórico
      // de que o uidVinculado foi removido. Usa acao "alterado" (categoria
      // genérica) + motivo descritivo pra ficar evidente no log.
      // uidVinculado é campo extra não-tipado da Pessoa (escrito pelo
      // AuthContext quando resolve uid via email).
      const uidAntes = (pessoa as Pessoa & { uidVinculado?: string }).uidVinculado || null;
      await logAudit({
        entityType: "pessoa",
        entityId: pessoa.id,
        acao: "alterado",
        registradoPor: masterId,
        motivo: `Email liberado pra reuso (master ${masterNome})`,
        diff: {
          email: { antes: emailOriginal, depois: null },
          uidVinculado: { antes: uidAntes, depois: null },
        },
      });
      setPasso("feito");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao liberar email");
    } finally {
      setExecutando(false);
    }
  }

  if (passo === "feito") {
    return (
      <Modal title="✅ Email liberado" onClose={() => { onFeito(); }} maxWidth="max-w-lg">
        <div className="space-y-4">
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-3 text-sm space-y-1">
            <p className="font-semibold text-emerald-900 dark:text-emerald-200">
              ✓ Email <code className="px-1 bg-emerald-100 dark:bg-emerald-900/40 rounded">{emailOriginal}</code> liberado de {pessoa.nome}
            </p>
            <p className="text-emerald-800 dark:text-emerald-300 text-[13px]">
              Histórico inteiro de {pessoa.nome} fica preservado — escala, gorjeta, VT, tudo que tinha continua atrelado ao registro dela.
            </p>
          </div>

          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-sm space-y-2">
            <p className="font-semibold text-amber-900 dark:text-amber-200">
              ⚠️ Falta 1 passo manual no Firebase
            </p>
            <p className="text-amber-800 dark:text-amber-300 text-[13px]">
              O Firebase Auth ainda tem o usuário antigo com esse email. Pra liberar de verdade pra nova pessoa criar conta:
            </p>
            <ol className="text-[13px] text-amber-900 dark:text-amber-200 list-decimal pl-5 space-y-1">
              <li>
                Abre{" "}
                <a
                  href="https://console.firebase.google.com/project/gestaocentral-85b13/authentication/users"
                  target="_blank"
                  rel="noreferrer"
                  className="underline font-medium"
                >
                  Firebase Auth → Users
                </a>
              </li>
              <li>Procura <code className="px-1 bg-amber-100 dark:bg-amber-900/40 rounded">{emailOriginal}</code></li>
              <li>Clica em ⋮ → <strong>Excluir conta</strong></li>
              <li>Depois cadastra a nova pessoa usando esse mesmo email</li>
            </ol>
          </div>

          <div className="flex justify-end pt-3 border-t border-gray-200 dark:border-gray-800">
            <Button onClick={onFeito}>Entendi, fechar</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="🔓 Liberar email" onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-4">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          Vai liberar o email <strong>{emailOriginal}</strong> de <strong>{pessoa.nome}</strong>.
        </p>
        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-3 text-sm">
          <p className="font-semibold text-emerald-900 dark:text-emerald-200 mb-1">
            ✓ Histórico PRESERVADO
          </p>
          <p className="text-emerald-800 dark:text-emerald-300 text-[13px]">
            Escala, gorjeta, VT, freelas, tudo que essa pessoa tinha continua
            registrado no nome dela. Só o email (login) é liberado.
          </p>
        </div>
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-sm">
          <p className="font-semibold text-amber-900 dark:text-amber-200 mb-1">
            ⚠️ 1 passo manual depois
          </p>
          <p className="text-amber-800 dark:text-amber-300 text-[13px]">
            Você também precisa apagar o usuário do Firebase Auth (eu te
            dou o link direto na próxima tela).
          </p>
        </div>

        {erro && (
          <div className="rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3 text-sm text-rose-800 dark:text-rose-300">
            ⚠ {erro}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose} disabled={executando}>
            Cancelar
          </Button>
          <Button onClick={executar} disabled={executando}>
            {executando ? "Liberando..." : "🔓 Liberar email agora"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
