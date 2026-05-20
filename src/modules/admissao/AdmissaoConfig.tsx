// ════════════════════════════════════════════════════════════════════════════
//  Sub-tab "Configurações" — prazo do link, WhatsApp do DP e (próxima
//  iteração) editor do schema do formulário.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import {
  getEmailContabilidade,
  getPrazoDias,
  getWhatsappDP,
  salvarConfigAdmissao,
} from "../../core/admissao/admissaoHelpers";
import { EditorKanbanColunas } from "./EditorKanbanColunas";
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
  const [emailContabilidade, setEmailContabilidade] = useState<string>(getEmailContabilidade(activeRestaurant) || "");
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
          placeholder="contato@contabilidade.com.br"
          type="email"
        />
        {!getEmailContabilidade(activeRestaurant) && !emailContabilidade && (
          <p className="text-[11px] text-amber-700 dark:text-amber-400">
            ⚠ Sem e-mail cadastrado, o sistema baixa a ficha mas o Gmail compose abre sem destinatário.
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={salvar} disabled={salvando}>
          {salvando ? "Salvando…" : "💾 Salvar configurações"}
        </Button>
        {msg && <span className="text-xs">{msg}</span>}
      </div>

      {/* Editor de colunas Kanban — tem seu próprio botão de salvar */}
      <EditorKanbanColunas rid={rid} activeRestaurant={activeRestaurant} />

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
