// ════════════════════════════════════════════════════════════════════════════
//  Modal de iniciar admissão — RH preenche dados básicos do candidato +
//  cargo. Schema do form é congelado na admissão (snapshot).
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import type { Admissao, Cargo, FormField } from "../../core/types";
import type { IniciarAdmissaoInput } from "../../core/admissao/admissaoHelpers";

function onlyDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

type Props = {
  rid: string;
  cargos: Cargo[];
  schemaUsado: FormField[];
  onClose: () => void;
  // O caller adiciona o restaurantSnapshot — modal só lida com os dados do candidato.
  onConfirm: (input: Omit<IniciarAdmissaoInput, "restaurantSnapshot">) => Promise<Admissao | undefined>;
};

export function IniciarAdmissaoModal({ rid, cargos, schemaUsado, onClose, onConfirm }: Props) {
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [cargoId, setCargoId] = useState("");
  const [salario, setSalario] = useState("");
  const [dataAdmissao, setDataAdmissao] = useState("");
  const [cargoConfianca, setCargoConfianca] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const cargosAtivos = cargos.filter((c) => c.ativo).sort((a, b) => a.nome.localeCompare(b.nome));

  async function salvar() {
    setErro("");
    const nomeT = nome.trim();
    const cpfD = onlyDigits(cpf);
    const emailT = email.trim().toLowerCase();
    const whatsD = onlyDigits(whatsapp);
    if (!nomeT) { setErro("Nome completo é obrigatório."); return; }
    if (cpfD.length !== 11) { setErro("CPF inválido — precisa de 11 dígitos."); return; }
    if (!emailT || !emailT.includes("@")) { setErro("E-mail inválido."); return; }
    if (whatsD.length < 10) { setErro("WhatsApp inválido — informe DDD + número."); return; }
    if (!cargoId) { setErro("Selecione o cargo."); return; }

    const salarioNum = salario ? parseFloat(salario.replace(",", ".")) : undefined;
    if (salario && (!salarioNum || Number.isNaN(salarioNum))) {
      setErro("Salário inválido."); return;
    }

    setSalvando(true);
    try {
      await onConfirm({
        restaurantId: rid,
        candidato: { nome: nomeT, cpf: cpfD, email: emailT, whatsapp: whatsD },
        cargoId,
        salario: salarioNum,
        dataAdmissao: dataAdmissao || undefined,
        cargoConfianca: cargoConfianca || undefined,
        schemaUsado,
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao iniciar admissão.");
      setSalvando(false);
    }
  }

  return (
    <Modal title="🪪 Iniciar admissão" onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Preencha os dados básicos do candidato. O resto da ficha será preenchido por ele via link.
        </p>

        <Input label="Nome completo *" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome e sobrenome" />
        <Input label="CPF *" value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" inputMode="numeric" />
        <Input label="E-mail *" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@dominio.com" type="email" />
        <Input label="WhatsApp *" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="(11) 99999-9999" inputMode="tel" />

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Cargo *</label>
          <select
            value={cargoId}
            onChange={(e) => setCargoId(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            <option value="">— selecione —</option>
            {cargosAtivos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome} ({c.area})
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Salário (opcional)" value={salario} onChange={(e) => setSalario(e.target.value)} placeholder="2500,00" inputMode="decimal" />
          <Input label="Data de admissão" value={dataAdmissao} onChange={(e) => setDataAdmissao(e.target.value)} type="date" />
        </div>

        <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 select-none">
          <input
            type="checkbox"
            checked={cargoConfianca}
            onChange={(e) => setCargoConfianca(e.target.checked)}
            className="accent-indigo-600"
          />
          Cargo de confiança
        </label>

        {erro && <div className="text-xs text-red-600 dark:text-red-400">{erro}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Iniciando…" : "Iniciar admissão"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
