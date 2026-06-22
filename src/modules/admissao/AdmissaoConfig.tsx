// ════════════════════════════════════════════════════════════════════════════
//  Sub-tab "Configurações" — prazo do link, WhatsApp do DP e (próxima
//  iteração) editor do schema do formulário.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
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
import { DOCUMENTOS_ADMISSAO_DEFAULT } from "../../core/admissao/formTemplate";
import type { CanalContato, ContatoExterno, DocumentoAdmissaoDef, Restaurant } from "../../core/types";
import { isDriveConfigured } from "../../core/google/driveConfig";
import { pickDriveFolder } from "../../core/google/drivePicker";
import { centralConfigured, centralEnsureTopFolder } from "../../core/google/driveCentral";

type Props = {
  rid: string;
  activeRestaurant: Restaurant;
};

function onlyDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

// Extrai fileId de URLs do Drive: /file/d/<id>/view ou ?id=<id>
function extractDriveFileId(url: string): string | null {
  if (!url) return null;
  const m1 = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1];
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2) return m2[1];
  return null;
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
  const [driveCentral, setDriveCentral] = useState<boolean | null>(null);
  useEffect(() => { void centralConfigured().then(setDriveCentral); }, []);
  // Clicksign: signatário fixo da empresa
  const [clicksignEmpresaNome, setClicksignEmpresaNome] = useState<string>(
    activeRestaurant.clicksignEmpresaNome || "",
  );
  const [clicksignEmpresaEmail, setClicksignEmpresaEmail] = useState<string>(
    activeRestaurant.clicksignEmpresaEmail || "",
  );
  const [clicksignEmpresaAuto, setClicksignEmpresaAuto] = useState<boolean>(
    !!activeRestaurant.clicksignEmpresaAssinaturaAuto,
  );
  const [clicksignEmpresaCpf, setClicksignEmpresaCpf] = useState<string>(
    activeRestaurant.clicksignEmpresaCpf || "",
  );
  const [clicksignEmpresaNascimento, setClicksignEmpresaNascimento] = useState<string>(
    activeRestaurant.clicksignEmpresaNascimento || "",
  );
  const [regulamentoInternoUrl, setRegulamentoInternoUrl] = useState<string>(
    activeRestaurant.regulamentoInternoUrl || "",
  );
  // Lista de documentos que o candidato envia no form (com fallback no default).
  const [docsAdmissao, setDocsAdmissao] = useState<DocumentoAdmissaoDef[]>(() =>
    activeRestaurant.documentosAdmissao && activeRestaurant.documentosAdmissao.length > 0
      ? activeRestaurant.documentosAdmissao
      : DOCUMENTOS_ADMISSAO_DEFAULT,
  );

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

  // Conta central: o backend cria/usa "Empregados Ativos — <empresa>" e salva o id.
  async function inicializarPastaCentral() {
    setDriveMsg(""); setDrivePicking(true);
    try {
      const nome = activeRestaurant.nome || "Empresa";
      const r = await centralEnsureTopFolder(`Empregados Ativos — ${nome}`);
      await salvarConfigAdmissao(rid, {
        driveEmpregadosAtivosFolderId: r.folderId,
        driveEmpregadosAtivosFolderNome: `Empregados Ativos — ${nome}`,
      });
      setDriveFolder({ id: r.folderId, nome: `Empregados Ativos — ${nome}` });
      setDriveMsg("✓ Pasta central pronta.");
    } catch (e) {
      setDriveMsg("❌ " + (e instanceof Error ? e.message : "Erro ao inicializar pasta central."));
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
        clicksignEmpresaNome: clicksignEmpresaNome.trim() || undefined,
        clicksignEmpresaEmail: clicksignEmpresaEmail.trim() || undefined,
        clicksignEmpresaAssinaturaAuto: clicksignEmpresaAuto || undefined,
        clicksignEmpresaCpf: clicksignEmpresaCpf.trim() || undefined,
        clicksignEmpresaNascimento: clicksignEmpresaNascimento.trim() || undefined,
        regulamentoInternoUrl: regulamentoInternoUrl.trim() || undefined,
        regulamentoInternoFileId: extractDriveFileId(regulamentoInternoUrl.trim()) || undefined,
        documentosAdmissao: docsAdmissao,
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
      {(isDriveConfigured() || driveCentral === true) && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
          <h2 className="font-bold text-sm text-gray-900 dark:text-gray-100">
            📁 Pasta no Google Drive (admissão)
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Aponte a pasta <strong>"Empregados Ativos"</strong> desta empresa no
            seu Drive. A cada admissão, o app cria a pasta do empregado aqui dentro
            com as subpastas <em>1- CONTRATOS</em>, <em>2 - DOCUMENTOS</em>,{" "}
            <em>docs a assinar</em> (termos gerados que vão pro Clicksign) e{" "}
            <em>docs assinados</em> (PDFs que voltam assinados).
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
          {driveCentral === true && (
            <p className="text-[11px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2">
              ✓ Conta central do Drive ativa — clique abaixo pra criar a pasta na conta central (o DP não conecta o próprio Drive).
            </p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {driveCentral === true ? (
              <Button variant="secondary" onClick={inicializarPastaCentral} disabled={drivePicking}>
                {drivePicking ? "Criando…" : driveFolder ? "🔄 Recriar pasta central" : "📁 Inicializar pasta central"}
              </Button>
            ) : (
              <Button variant="secondary" onClick={selecionarPastaDrive} disabled={drivePicking}>
                {drivePicking
                  ? "Abrindo seletor…"
                  : driveFolder
                    ? "🔄 Trocar pasta"
                    : "📁 Selecionar pasta"}
              </Button>
            )}
            {driveMsg && <span className="text-xs">{driveMsg}</span>}
          </div>
          <p className="text-[10px] text-gray-400 dark:text-gray-500">
            Na 1ª vez o Google pede pra autorizar o acesso — escolha a conta do
            Drive onde ficam as pastas das empresas.
          </p>
        </div>
      )}

      {/* Clicksign — signatário fixo da empresa (assina junto com o empregado) */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
        <h2 className="font-bold text-sm text-gray-900 dark:text-gray-100">
          ✍️ Signatário da empresa (Clicksign)
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Quem assina os contratos de admissão <strong>pela empresa</strong> (sempre o mesmo).
          O empregado é adicionado automaticamente com os dados da ficha. Sem isso,
          o envio pro Clicksign fica bloqueado.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <Input
            label="Nome do representante"
            value={clicksignEmpresaNome}
            onChange={(e) => setClicksignEmpresaNome(e.target.value)}
            placeholder="Ex: Gustavo Rodrigues"
          />
          <Input
            label="E-mail do representante"
            type="email"
            value={clicksignEmpresaEmail}
            onChange={(e) => setClicksignEmpresaEmail(e.target.value)}
            placeholder="contratos@empresa.com"
          />
        </div>

        {/* Assinatura automática da empresa */}
        <label className="flex items-start gap-2 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={clicksignEmpresaAuto}
            onChange={(e) => setClicksignEmpresaAuto(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-indigo-600 flex-shrink-0"
          />
          <span className="text-xs text-gray-700 dark:text-gray-300">
            <strong>Assinatura automática</strong> — a empresa assina sozinha ao enviar
            (só o empregado assina manual). Exige um <em>Termo de Assinatura Automática</em>
            {" "}configurado no Clicksign pra esse representante.
          </span>
        </label>
        {clicksignEmpresaAuto && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pl-6">
            <Input
              label="CPF do representante"
              value={clicksignEmpresaCpf}
              onChange={(e) => setClicksignEmpresaCpf(e.target.value)}
              placeholder="000.000.000-00"
              inputMode="numeric"
            />
            <Input
              label="Data de nascimento"
              type="date"
              value={clicksignEmpresaNascimento}
              onChange={(e) => setClicksignEmpresaNascimento(e.target.value)}
            />
            <p className="text-[10px] text-amber-700 dark:text-amber-400 md:col-span-2">
              ⚠ Nome, e-mail, CPF e nascimento precisam ser <strong>idênticos</strong> aos do
              Termo de Assinatura Automática assinado no Clicksign — senão o envio falha.
            </p>
          </div>
        )}
      </div>

      {/* Documentos padrão — mesmo PDF pra toda admissão deste restaurante.
          O checklist da admissão pré-popula o termo correspondente. */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            📄 Documentos padrão deste restaurante
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            PDFs que são iguais pra todo empregado. Suba uma vez no Drive
            (pasta que a conta conectada do app tenha acesso) e cole o link
            aqui — a admissão pré-popula esses termos automaticamente.
          </p>
        </div>
        <div>
          <Input
            label="Regulamento Interno (URL do PDF no Drive)"
            value={regulamentoInternoUrl}
            onChange={(e) => setRegulamentoInternoUrl(e.target.value)}
            placeholder="https://drive.google.com/file/d/.../view"
          />
          {regulamentoInternoUrl && !extractDriveFileId(regulamentoInternoUrl) && (
            <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-1">
              ⚠ Não reconheci o formato do link do Drive. Use o formato
              <code className="ml-1">https://drive.google.com/file/d/.../view</code>.
            </p>
          )}
        </div>
      </div>

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

      {/* Documentos que o candidato envia no form público */}
      <DocumentosEditor docs={docsAdmissao} onChange={setDocsAdmissao} />

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

// ─── Editor da lista de documentos pedidos no form público ────────────────────
function DocumentosEditor({
  docs,
  onChange,
}: {
  docs: DocumentoAdmissaoDef[];
  onChange: (d: DocumentoAdmissaoDef[]) => void;
}) {
  function patch(idx: number, p: Partial<DocumentoAdmissaoDef>) {
    onChange(docs.map((d, i) => (i === idx ? { ...d, ...p } : d)));
  }
  function remover(idx: number) {
    onChange(docs.filter((_, i) => i !== idx));
  }
  function adicionar() {
    const id = `doc_custom_${Date.now().toString(36)}`;
    onChange([
      ...docs,
      { id, nome: "Novo documento", obrigatorio: false, permiteNaoSeAplica: true, ativo: true },
    ]);
  }
  const ativos = docs.filter((d) => d.ativo).length;

  return (
    <details className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
      <summary className="cursor-pointer px-4 py-3 font-bold text-sm text-gray-900 dark:text-gray-100 select-none">
        📎 Documentos pedidos no formulário
        <span className="ml-2 text-[11px] font-normal text-gray-500 dark:text-gray-400">
          ({ativos} ativos — toque pra editar)
        </span>
      </summary>
      <div className="p-4 pt-0 space-y-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          O candidato anexa cada documento (ou marca "não tenho" + justificativa)
          no último bloco do formulário. <strong>Obrigatório</strong> = precisa
          anexar (sem opção de pular). <strong>Permite "não se aplica"</strong> =
          mostra as opções "não tenho / não se aplica".
        </p>

        {docs.map((d, i) => (
          <div key={d.id} className="border border-gray-200 dark:border-gray-800 rounded-lg p-3 space-y-2">
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-2">
                <input
                  value={d.nome}
                  onChange={(e) => patch(i, { nome: e.target.value })}
                  placeholder="Nome do documento (ex: RG ou CNH)"
                  className="w-full text-xs font-semibold px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                />
                <input
                  value={d.descricao || ""}
                  onChange={(e) => patch(i, { descricao: e.target.value || undefined })}
                  placeholder="Dica pro candidato (opcional) — ex: frente e verso, legível"
                  className="w-full text-[11px] px-2 py-1.5 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
                />
              </div>
              <button
                type="button"
                onClick={() => remover(i)}
                className="text-red-500 hover:text-red-700 text-xs shrink-0 px-1"
                title="Remover documento"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                <input type="checkbox" checked={d.obrigatorio} onChange={(e) => patch(i, { obrigatorio: e.target.checked, ...(e.target.checked ? { permiteNaoSeAplica: false } : {}) })} className="accent-indigo-600" />
                Obrigatório
              </label>
              <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                <input type="checkbox" checked={d.permiteNaoSeAplica} onChange={(e) => patch(i, { permiteNaoSeAplica: e.target.checked })} className="accent-indigo-600" />
                Permite "não se aplica"
              </label>
              <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                <input type="checkbox" checked={d.ativo} onChange={(e) => patch(i, { ativo: e.target.checked })} className="accent-indigo-600" />
                Ativo
              </label>
            </div>
          </div>
        ))}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={adicionar}
            className="text-xs px-3 py-1.5 rounded-lg border border-indigo-300 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
          >
            + Adicionar documento
          </button>
          <button
            type="button"
            onClick={() => onChange(DOCUMENTOS_ADMISSAO_DEFAULT)}
            className="text-[11px] text-gray-500 hover:underline"
          >
            🔄 restaurar lista padrão
          </button>
        </div>
      </div>
    </details>
  );
}
