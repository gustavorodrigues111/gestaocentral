// ════════════════════════════════════════════════════════════════════════════
//  Sub-tab "Configurações" — prazo do link, WhatsApp do DP e (próxima
//  iteração) editor do schema do formulário.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import {
  EMAIL_CONTABILIDADE_DEFAULT,
  getPrazoDias,
  getWhatsappDP,
  salvarConfigAdmissao,
} from "../../core/admissao/admissaoHelpers";
import {
  EMAIL_CLINICA_EXAMES_DEFAULT,
  CLINICA_EXAMES_NOME_DEFAULT,
  CLINICA_EXAMES_ENDERECO_DEFAULT,
  CLINICA_EXAMES_TELEFONE_DEFAULT,
} from "../../core/admissao/formTemplate";
import type { Restaurant } from "../../core/types";

type Props = {
  rid: string;
  activeRestaurant: Restaurant;
};

function onlyDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

export function AdmissaoConfig({ rid, activeRestaurant }: Props) {
  const [prazoDias, setPrazoDias] = useState<number>(getPrazoDias(activeRestaurant));
  const [whatsappDP, setWhatsappDP] = useState<string>(getWhatsappDP(activeRestaurant) || "");
  // Mostra o valor "real" do restaurante (sem fallback) pra ficar claro quando
  // está usando o default e quando o restaurante tem seu próprio cadastrado.
  const [emailContabilidade, setEmailContabilidade] = useState<string>(activeRestaurant?.emailContabilidade?.trim() || "");
  const [emailClinicaExames, setEmailClinicaExames] = useState<string>(activeRestaurant?.emailClinicaExames?.trim() || "");
  const [clinicaNome, setClinicaNome] = useState<string>(activeRestaurant?.clinicaExamesNome?.trim() || "");
  const [clinicaEndereco, setClinicaEndereco] = useState<string>(activeRestaurant?.clinicaExamesEndereco?.trim() || "");
  const [clinicaTelefone, setClinicaTelefone] = useState<string>(activeRestaurant?.clinicaExamesTelefone?.trim() || "");
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState("");

  async function salvar() {
    setMsg("");
    setSalvando(true);
    try {
      await salvarConfigAdmissao(rid, {
        admissaoPrazoDias: prazoDias,
        whatsappDP: onlyDigits(whatsappDP) || undefined,
        emailContabilidade: emailContabilidade.trim() || undefined,
        emailClinicaExames: emailClinicaExames.trim() || undefined,
        clinicaExamesNome: clinicaNome.trim() || undefined,
        clinicaExamesEndereco: clinicaEndereco.trim() || undefined,
        clinicaExamesTelefone: clinicaTelefone.trim() || undefined,
      });
      setMsg("✓ Salvo.");
    } catch (e) {
      setMsg("❌ " + (e instanceof Error ? e.message : "Erro"));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
        <h2 className="font-bold text-sm text-gray-900 dark:text-gray-100">
          ⏳ Prazo do link
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Quanto tempo o candidato tem pra preencher o formulário depois que você clica em
          "Enviar via WhatsApp". O timer começa nesse momento.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={1}
            max={7}
            step={1}
            value={prazoDias}
            onChange={(e) => setPrazoDias(parseInt(e.target.value, 10))}
            className="flex-1 accent-indigo-600"
          />
          <div className="text-lg font-bold text-indigo-600 dark:text-indigo-400 min-w-[60px] text-center tabular-nums">
            {prazoDias === 1 ? "1 dia" : `${prazoDias} dias`}
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
        <h2 className="font-bold text-sm text-gray-900 dark:text-gray-100">
          📱 WhatsApp do DP
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Número que o candidato vê na tela do formulário pra enviar fotos dos documentos
          (RG, CPF, comprovante de residência, foto 3x4, CTPS). Botão "Enviar documentos" no
          form vai abrir o WhatsApp direto pra esse número, já com mensagem pronta.
        </p>
        <Input
          label="WhatsApp do DP"
          value={whatsappDP}
          onChange={(e) => setWhatsappDP(e.target.value)}
          placeholder="(11) 91090-7232"
          inputMode="tel"
        />
        {!getWhatsappDP(activeRestaurant) && !whatsappDP && (
          <p className="text-[11px] text-amber-700 dark:text-amber-400">
            ⚠ Sem WhatsApp cadastrado o candidato não consegue enviar documentos pelo botão do form.
          </p>
        )}
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
        <h2 className="font-bold text-sm text-gray-900 dark:text-gray-100">
          📧 E-mail da contabilidade
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Quando a admissão for movida pra <strong>"Solicitação Enviada para Contabilidade"</strong>,
          o sistema baixa a ficha em XLSX e abre o Gmail compose pré-preenchido com este
          destinatário. Você só anexa o arquivo baixado e envia.
        </p>
        <Input
          label="E-mail da contabilidade"
          value={emailContabilidade}
          onChange={(e) => setEmailContabilidade(e.target.value)}
          placeholder={EMAIL_CONTABILIDADE_DEFAULT}
          type="email"
        />
        {!emailContabilidade && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Sem cadastro, o sistema usa o padrão{" "}
            <strong className="text-gray-700 dark:text-gray-300">{EMAIL_CONTABILIDADE_DEFAULT}</strong>.
            Coloque outro aqui se quiser sobrescrever só pra esse restaurante.
          </p>
        )}
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
        <h2 className="font-bold text-sm text-gray-900 dark:text-gray-100">
          🩺 Clínica de exames admissionais
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Dados da clínica usados no <strong>e-mail de agendamento</strong> e
          na <strong>mensagem de instruções pro candidato</strong>. Defaults
          são da Triagem — sobrescreva se trocar de fornecedor.
        </p>
        <Input
          label="E-mail (Gmail compose pra agendamento)"
          value={emailClinicaExames}
          onChange={(e) => setEmailClinicaExames(e.target.value)}
          placeholder={EMAIL_CLINICA_EXAMES_DEFAULT}
          type="email"
        />
        <Input
          label="Nome da clínica"
          value={clinicaNome}
          onChange={(e) => setClinicaNome(e.target.value)}
          placeholder={CLINICA_EXAMES_NOME_DEFAULT}
        />
        <Input
          label="Endereço completo"
          value={clinicaEndereco}
          onChange={(e) => setClinicaEndereco(e.target.value)}
          placeholder={CLINICA_EXAMES_ENDERECO_DEFAULT}
        />
        <Input
          label="Telefone"
          value={clinicaTelefone}
          onChange={(e) => setClinicaTelefone(e.target.value)}
          placeholder={CLINICA_EXAMES_TELEFONE_DEFAULT}
        />
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Campos em branco usam os defaults da Triagem.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={salvar} disabled={salvando}>
          {salvando ? "Salvando…" : "💾 Salvar configurações"}
        </Button>
        {msg && <span className="text-xs">{msg}</span>}
      </div>

      {/* Colunas e checklists do Kanban ficam fixos no template global por
          enquanto — editor visual foi desabilitado nesta fase pra evitar
          inconsistências entre colunas e os checklists internos. */}

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-2">
        <h2 className="font-bold text-sm text-gray-900 dark:text-gray-100">
          📝 Schema do formulário
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          O formulário do candidato usa o template padrão (baseado na ficha Senador Contábil).
          A edição do schema (adicionar/remover/reordenar campos, marcar obrigatório) virá na
          próxima atualização do módulo.
        </p>
        <div className="text-[11px] text-gray-500 dark:text-gray-400 italic">
          📌 Em desenvolvimento — editor de schema chega na próxima iteração.
        </div>
      </div>
    </div>
  );
}
