// ════════════════════════════════════════════════════════════════════════════
//  Sub-tab "Configurações" — prazo do link, WhatsApp do DP e (próxima
//  iteração) editor do schema do formulário.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { useAuth } from "../../core/auth/AuthContext";
import {
  getContatoClinica,
  getContatoContabilidade,
  getContatoFinanceiro,
  getPrazoDias,
  getTemplate,
  getWhatsappDP,
  PLACEHOLDERS_DISPONIVEIS,
  resetarLayoutKanban,
  salvarConfigAdmissao,
  TEMPLATES_DEFAULT,
  type TemplateKey,
} from "../../core/admissao/admissaoHelpers";
import type { CanalContato, ContatoExterno, Restaurant } from "../../core/types";
import { isDriveConfigured } from "../../core/google/driveConfig";
import { pickDriveFolder } from "../../core/google/drivePicker";

type Props = {
  rid: string;
  activeRestaurant: Restaurant;
};

function onlyDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

export function AdmissaoConfig({ rid, activeRestaurant }: Props) {
  const { pessoa: me } = useAuth();
  const [prazoDias, setPrazoDias] = useState<number>(getPrazoDias(activeRestaurant));
  const [whatsappDP, setWhatsappDP] = useState<string>(getWhatsappDP(activeRestaurant) || "");
  // Contatos externos com canal preferido. Inicializa com o que tem (ou
  // migra do legacy) — fonte é getContatoXxx que faz a resolução.
  const [contatoClinica, setContatoClinica] = useState<ContatoExterno>(() => getContatoClinica(activeRestaurant));
  const [contatoContabilidade, setContatoContabilidade] = useState<ContatoExterno>(() => getContatoContabilidade(activeRestaurant));
  const [contatoFinanceiro, setContatoFinanceiro] = useState<ContatoExterno>(() => getContatoFinanceiro(activeRestaurant));
  // Templates de mensagem editáveis. Inicializa com o salvo OU com o default.
  const [templates, setTemplates] = useState<Record<TemplateKey, string>>(() => ({
    envioLink: getTemplate(activeRestaurant, "envioLink"),
    instrucoesCandidato: getTemplate(activeRestaurant, "instrucoesCandidato"),
    agendamentoClinica: getTemplate(activeRestaurant, "agendamentoClinica"),
    envioContabilidade: getTemplate(activeRestaurant, "envioContabilidade"),
    solicitacaoBanco: getTemplate(activeRestaurant, "solicitacaoBanco"),
  }));
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState("");
  const [resetando, setResetando] = useState(false);
  // Google Drive: pasta "Empregados Ativos" desta empresa
  const [driveFolder, setDriveFolder] = useState<{ id: string; nome: string } | null>(
    activeRestaurant.driveEmpregadosAtivosFolderId
      ? {
          id: activeRestaurant.driveEmpregadosAtivosFolderId,
          nome: activeRestaurant.driveEmpregadosAtivosFolderNome || "(pasta selecionada)",
        }
      : null,
  );
  const [drivePicking, setDrivePicking] = useState(false);
  const [driveMsg, setDriveMsg] = useState("");

  async function selecionarPastaDrive() {
    setDriveMsg("");
    setDrivePicking(true);
    try {
      const escolha = await pickDriveFolder(
        "Selecione a pasta 'Empregados Ativos' desta empresa",
      );
      if (!escolha) return; // cancelado
      await salvarConfigAdmissao(rid, {
        driveEmpregadosAtivosFolderId: escolha.id,
        driveEmpregadosAtivosFolderNome: escolha.name,
      });
      setDriveFolder({ id: escolha.id, nome: escolha.name });
      setDriveMsg("✓ Pasta vinculada.");
    } catch (e) {
      setDriveMsg("❌ " + (e instanceof Error ? e.message : "Erro ao selecionar pasta."));
    } finally {
      setDrivePicking(false);
    }
  }

  async function resetarLayout() {
    if (!me?.isMaster) return;
    const ok = confirm(
      "Resetar layout do Kanban?\n\n" +
      "Apaga as colunas e o template de subtarefas salvos no restaurante e " +
      "faz a UI usar os defaults globais (5 colunas + 26 subtarefas). Útil " +
      "quando o template global mudou e o restaurante tinha uma versão antiga " +
      "salva.\n\n" +
      "Nenhuma admissão é afetada — só o layout do Kanban. Continuar?",
    );
    if (!ok) return;
    setResetando(true);
    try {
      await resetarLayoutKanban(rid);
      setMsg("✓ Layout resetado. Recarregue a página pra ver as colunas novas.");
    } catch (e) {
      setMsg("❌ " + (e instanceof Error ? e.message : "Erro"));
    } finally {
      setResetando(false);
    }
  }

  async function salvar() {
    setMsg("");
    setSalvando(true);
    try {
      // Só grava templates que foram efetivamente editados (diferentes do
      // default global) — pra restaurante "limpo" não poluir com dados
      // iguais ao default. Restaura é só deletar (set undefined / vazio).
      const templatesPraSalvar: Partial<Record<TemplateKey, string>> = {};
      (Object.keys(templates) as TemplateKey[]).forEach((k) => {
        const v = templates[k]?.trim();
        if (v && v !== TEMPLATES_DEFAULT[k].trim()) {
          templatesPraSalvar[k] = v;
        }
      });
      await salvarConfigAdmissao(rid, {
        admissaoPrazoDias: prazoDias,
        whatsappDP: onlyDigits(whatsappDP) || undefined,
        contatosAdmissao: {
          clinicaExames: contatoClinica,
          contabilidade: contatoContabilidade,
          financeiroBanco: contatoFinanceiro,
        },
        templatesAdmissao: Object.keys(templatesPraSalvar).length > 0 ? templatesPraSalvar : undefined,
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

      {/* Google Drive — pasta "Empregados Ativos" desta empresa (Picker) */}
      {isDriveConfigured() && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
          <h2 className="font-bold text-sm text-gray-900 dark:text-gray-100">
            📁 Pasta no Google Drive (admissão)
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Aponte a pasta <strong>"Empregados Ativos"</strong> desta empresa no
            seu Drive. A cada admissão, o app cria a pasta do empregado aqui dentro
            (com subpastas <em>1- CONTRATOS</em>, <em>2 - DOCUMENTOS</em> e{" "}
            <em>docs assinados</em>) e sobe os termos assinados na "docs assinados".
          </p>
          {driveFolder ? (
            <div className="text-xs text-emerald-700 dark:text-emerald-400">
              ✓ Pasta atual: <strong>{driveFolder.nome}</strong>
            </div>
          ) : (
            <div className="text-[11px] text-amber-700 dark:text-amber-400">
              ⚠ Nenhuma pasta vinculada — sem isso, não dá pra criar a pasta do
              empregado no Drive durante a admissão.
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="secondary" onClick={selecionarPastaDrive} disabled={drivePicking}>
              {drivePicking
                ? "Abrindo seletor…"
                : driveFolder
                  ? "🔄 Trocar pasta"
                  : "📁 Selecionar pasta"}
            </Button>
            {driveMsg && <span className="text-xs">{driveMsg}</span>}
          </div>
          <p className="text-[10px] text-gray-400 dark:text-gray-500">
            Na 1ª vez o Google pede pra autorizar o acesso — escolha a conta do
            Drive onde ficam as pastas das empresas.
          </p>
        </div>
      )}

      {/* Contatos externos — 3 cards: Clínica de exames, Contabilidade,
          Financeiro. Cada um tem dados de contato (nome/email/whatsapp/telefone)
          e o canal preferido. O atalho da subtarefa correspondente lê o canal
          pra escolher Gmail compose / WhatsApp / modal de telefone. */}
      <EditorContato
        titulo="🩺 Clínica de exames admissionais"
        sub="Usado pra agendar exames clínico + manipulador. Triagem só agenda por telefone — se sua clínica é diferente, ajusta o canal."
        contato={contatoClinica}
        onChange={setContatoClinica}
        mostrarEndereco
      />
      <EditorContato
        titulo="📊 Contabilidade"
        sub="Quem recebe a ficha de admissão XLSX da etapa 'Enviado pra contabilidade'."
        contato={contatoContabilidade}
        onChange={setContatoContabilidade}
      />
      <EditorContato
        titulo="🏦 Financeiro do escritório (cadastro no banco)"
        sub="Quem recebe a solicitação de cadastrar o empregado no banco interno (com os dados Itaú)."
        contato={contatoFinanceiro}
        onChange={setContatoFinanceiro}
      />

      {/* Templates de mensagem — colapsável pra não ocupar tela toda */}
      <details className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
        <summary className="cursor-pointer px-4 py-3 font-bold text-sm text-gray-900 dark:text-gray-100 select-none">
          ✉️ Templates de mensagens
          <span className="ml-2 text-[11px] font-normal text-gray-500 dark:text-gray-400">
            (toque pra expandir — 5 mensagens editáveis)
          </span>
        </summary>
        <div className="p-4 pt-0 space-y-4">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Cada mensagem usa placeholders <code className="text-indigo-600 dark:text-indigo-400">{`{{nome}}`}</code>
            {" "}que o sistema substitui na hora de gerar a mensagem real.
            Defaults vêm pré-configurados — restaure se errar.
          </p>
          <EditorTemplate
            chave="envioLink"
            titulo="📨 Envio do link inicial"
            sub="WhatsApp pro candidato logo após o RH iniciar a admissão"
            valor={templates.envioLink}
            onChange={(v) => setTemplates((t) => ({ ...t, envioLink: v }))}
          />
          <EditorTemplate
            chave="instrucoesCandidato"
            titulo="📣 Instruções únicas (3 blocos)"
            sub="Mensagem pro candidato sobre exames, conta Itaú e docs"
            valor={templates.instrucoesCandidato}
            onChange={(v) => setTemplates((t) => ({ ...t, instrucoesCandidato: v }))}
          />
          <EditorTemplate
            chave="agendamentoClinica"
            titulo="🩺 Agendamento com a clínica"
            sub="Email/WhatsApp/script telefone pra agendar exames com a clínica"
            valor={templates.agendamentoClinica}
            onChange={(v) => setTemplates((t) => ({ ...t, agendamentoClinica: v }))}
          />
          <EditorTemplate
            chave="envioContabilidade"
            titulo="📊 Envio pra contabilidade"
            sub="Email com a ficha pra contabilidade processar a admissão"
            valor={templates.envioContabilidade}
            onChange={(v) => setTemplates((t) => ({ ...t, envioContabilidade: v }))}
          />
          <EditorTemplate
            chave="solicitacaoBanco"
            titulo="🏦 Solicitação ao financeiro"
            sub="WhatsApp/email pra cadastrar o empregado no banco interno"
            valor={templates.solicitacaoBanco}
            onChange={(v) => setTemplates((t) => ({ ...t, solicitacaoBanco: v }))}
          />
        </div>
      </details>

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

      {me?.isMaster && (
        <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/50 rounded-xl p-4 space-y-2">
          <h2 className="font-bold text-sm text-amber-900 dark:text-amber-300">
            🛠 Manutenção (master)
          </h2>
          <p className="text-xs text-amber-900/80 dark:text-amber-300/80">
            Apaga o layout customizado do Kanban + template de subtarefas salvos
            neste restaurante e faz a UI usar os defaults globais. Use quando o
            template global mudar e a tela continuar mostrando a estrutura
            antiga. Nenhuma admissão é afetada.
          </p>
          <Button onClick={resetarLayout} disabled={resetando} variant="secondary">
            {resetando ? "Resetando…" : "🔄 Resetar layout do Kanban pros defaults"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── EditorContato: card com nome/email/whatsapp/telefone + canal preferido ──

function EditorContato({
  titulo,
  sub,
  contato,
  onChange,
  mostrarEndereco = false,
}: {
  titulo: string;
  sub: string;
  contato: ContatoExterno;
  onChange: (c: ContatoExterno) => void;
  mostrarEndereco?: boolean;
}) {
  function patch(p: Partial<ContatoExterno>) {
    onChange({ ...contato, ...p });
  }
  const canais: { id: CanalContato; label: string; disponivel: boolean }[] = [
    { id: "email", label: "📧 Email", disponivel: !!contato.email?.trim() },
    { id: "whatsapp", label: "📱 WhatsApp", disponivel: !!contato.whatsapp?.trim() },
    { id: "telefone", label: "📞 Telefone", disponivel: !!contato.telefone?.trim() },
  ];
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
      <h2 className="font-bold text-sm text-gray-900 dark:text-gray-100">{titulo}</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400">{sub}</p>

      <Input
        label="Nome / razão social"
        value={contato.nome}
        onChange={(e) => patch({ nome: e.target.value })}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Input
          label="E-mail"
          type="email"
          value={contato.email || ""}
          onChange={(e) => patch({ email: e.target.value })}
          placeholder="contato@empresa.com"
        />
        <Input
          label="WhatsApp"
          value={contato.whatsapp || ""}
          onChange={(e) => patch({ whatsapp: (e.target.value || "").replace(/\D/g, "") })}
          placeholder="11912345678"
          inputMode="tel"
        />
      </div>
      <Input
        label="Telefone"
        value={contato.telefone || ""}
        onChange={(e) => patch({ telefone: e.target.value })}
        placeholder="(11) 0000-0000"
        inputMode="tel"
      />
      {mostrarEndereco && (
        <Input
          label="Endereço"
          value={contato.endereco || ""}
          onChange={(e) => patch({ endereco: e.target.value })}
          placeholder="Rua, número — bairro, cidade/UF"
        />
      )}

      <div>
        <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5">
          Canal preferido (define o que o atalho da subtarefa abre)
        </label>
        <div className="flex flex-wrap gap-2">
          {canais.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => patch({ canalPreferido: c.id })}
              disabled={!c.disponivel}
              title={c.disponivel ? "" : "Preencha esse campo primeiro pra habilitar"}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                contato.canalPreferido === c.id
                  ? "border-indigo-500 bg-indigo-50 text-indigo-900 dark:bg-indigo-900/30 dark:text-indigo-200 font-semibold"
                  : !c.disponivel
                  ? "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed dark:border-gray-800 dark:bg-gray-900/40"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── EditorTemplate: textarea + chips de placeholders + botão restaurar ──

function EditorTemplate({
  chave,
  titulo,
  sub,
  valor,
  onChange,
}: {
  chave: TemplateKey;
  titulo: string;
  sub: string;
  valor: string;
  onChange: (v: string) => void;
}) {
  const placeholders = PLACEHOLDERS_DISPONIVEIS[chave];
  const ehDefault = valor.trim() === TEMPLATES_DEFAULT[chave].trim();
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="font-semibold text-xs text-gray-900 dark:text-gray-100">{titulo}</div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400">{sub}</div>
        </div>
        <button
          type="button"
          onClick={() => onChange(TEMPLATES_DEFAULT[chave])}
          disabled={ehDefault}
          className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed"
        >
          {ehDefault ? "✓ usando default" : "🔄 restaurar default"}
        </button>
      </div>
      <div className="text-[10px] text-gray-500 dark:text-gray-400">
        Placeholders disponíveis:{" "}
        {placeholders.map((p) => (
          <code
            key={p}
            className="inline-block mr-1 px-1 py-0.5 rounded bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 text-[10px]"
          >
            {`{{${p}}}`}
          </code>
        ))}
      </div>
      <textarea
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.min(14, Math.max(4, valor.split("\n").length + 1))}
        className="w-full text-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono resize-y"
      />
    </div>
  );
}
