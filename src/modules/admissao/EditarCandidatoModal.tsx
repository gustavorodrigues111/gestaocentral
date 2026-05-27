// ════════════════════════════════════════════════════════════════════════════
//  Modal — Editar dados básicos do candidato (nome / CPF / WhatsApp / email).
//
//  Acionado pelo botão "✏️ Editar dados básicos" nas subtarefas de col 1
//  ("Pessoas a admitir") e col 2 ("Aguardando preenchimento e Solicitação...").
//  Não mexe em cargo / salário / horários / data — isso fica em
//  PreencherDadosBasicosModal.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import type { Admissao } from "../../core/types";
import { atualizarCandidato } from "../../core/admissao/admissaoHelpers";

function onlyDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

type Props = {
  admissao: Admissao;
  onClose: () => void;
  onSaved?: () => void;
};

export function EditarCandidatoModal({ admissao, onClose, onSaved }: Props) {
  const [nome, setNome] = useState(admissao.candidato.nome);
  const [cpf, setCpf] = useState(admissao.candidato.cpf);
  const [whatsapp, setWhatsapp] = useState(admissao.candidato.whatsapp);
  const [email, setEmail] = useState(admissao.candidato.email);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar() {
    setErro("");
    if (!nome.trim()) { setErro("Nome é obrigatório."); return; }
    const cpfLimpo = onlyDigits(cpf);
    if (cpfLimpo.length !== 11) { setErro("CPF inválido."); return; }
    if (!whatsapp.trim()) { setErro("WhatsApp é obrigatório."); return; }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErro("Email inválido."); return;
    }

    setSalvando(true);
    try {
      await atualizarCandidato(admissao.id, {
        nome: nome.trim(),
        cpf: cpfLimpo,
        whatsapp: whatsapp.trim(),
        email: email.trim(),
      });
      onSaved?.();
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar.");
      setSalvando(false);
    }
  }

  return (
    <Modal title="Editar dados do candidato" onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3 p-4">
        <Input label="Nome completo *" value={nome} onChange={(e) => setNome(e.target.value)} />
        <Input label="CPF *" value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" />
        <Input label="WhatsApp *" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+55 11 99999-9999" />
        <Input label="Email *" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        {erro && <div className="text-xs text-rose-600 dark:text-rose-400">{erro}</div>}
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
