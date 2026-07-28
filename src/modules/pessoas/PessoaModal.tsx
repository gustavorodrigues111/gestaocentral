import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db, auth } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { gerarSenhaInicial, provisionarAcesso } from "../../core/auth/provisionar";
import { enviarEmailAcesso } from "../../core/auth/emailAcesso";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canExcluirPessoa } from "../../core/auth/permissions";
import { fmtBR } from "../../core/utils/date";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { EmpregadoModal } from "./EmpregadoModal";
import { InativarModal } from "./InativarModal";
import { ReativarModal } from "./ReativarModal";
import { DemitirSolidesModal } from "./DemitirSolidesModal";
import { ExcluirModal } from "./ExcluirModal";
import { LiberarEmailModal } from "./LiberarEmailModal";
import { logAudit } from "../../core/audit/versionedChange";
import type { Cargo, Empregado, Pessoa, Restaurant } from "../../core/types";
import { TIPO_VINCULO_LABEL } from "../../core/types";
import { useAccessProfiles } from "../../core/auth/useAccessProfiles";
import {
  VINCULOS_LOGICOS,
  VINCULO_LOGICO_LABEL,
  VINCULO_LOGICO_ICONE,
  resolverVinculo,
  type VinculoLogico,
} from "../../core/vinculos/comportamento";
import { pessoaTemLogin } from "./accessStatus";
import { Link, useNavigate } from "react-router-dom";

type Tab = "identidade" | "vinculos";

type Props = {
  pessoa: Pessoa | null;          // null = criar nova
  restaurantId: string;
  onClose: () => void;
};

export function PessoaModal({ pessoa, restaurantId, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const isNew = !pessoa;
  const [tab, setTab] = useState<Tab>("identidade");

  if (!me) return null;

  const tabs: { id: Tab; label: string; disabled?: boolean }[] = [
    { id: "identidade", label: "📇 Identidade" },
    { id: "vinculos",   label: "🤝 Vínculos",   disabled: isNew },
    // Tab "🔐 Permissões" removida — atribuição de perfil agora fica no
    // tab Identidade, e checkboxes ver/configurar legados saíram.
  ];

  return (
    <Modal
      title={isNew ? "+ Nova pessoa" : `Editar — ${pessoa.nome}`}
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      <div className="flex border-b border-gray-200 dark:border-gray-800 -mx-6 -mt-2 px-6 mb-4">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => !t.disabled && setTab(t.id)}
            disabled={t.disabled}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                : t.disabled
                ? "border-transparent text-gray-300 dark:text-gray-600 cursor-not-allowed"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isNew && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Crie a pessoa primeiro. Depois você vai poder adicionar vínculos de equipe e permissões.
        </p>
      )}

      {tab === "identidade" && <TabIdentidade pessoa={pessoa} restaurantId={restaurantId} onCreated={onClose} onClose={onClose} />}
      {tab === "vinculos"   && pessoa && <TabVinculos pessoa={pessoa} restaurantId={restaurantId} />}
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════
// TAB 1: IDENTIDADE
// ════════════════════════════════════════════════════════════════

// Mensagem do convite de acesso (com a senha inicial). Fallback wa.me pra
// mandar manual quando a Cloud API ainda não está configurada.
function buildConviteMsg(nomePrimeiro: string, email: string, senha: string, baseUrl: string): string {
  return `Oi ${nomePrimeiro}! 👋\n\n` +
    `Seu acesso ao nosso sistema de gestão está pronto:\n\n` +
    `🔗 ${baseUrl}\n` +
    `📧 Email: ${email}\n` +
    `🔑 Senha inicial: ${senha}\n\n` +
    `No primeiro acesso o sistema vai pedir seu CPF e pra você criar uma nova senha. Qualquer dúvida me chama!`;
}

function TabIdentidade({
  pessoa, restaurantId, onCreated, onClose,
}: {
  pessoa: Pessoa | null;
  restaurantId: string;
  onCreated: () => void;
  onClose: () => void;
}) {
  const { pessoa: me, pessoaReal, startImpersonate } = useAuth();
  const { restaurants } = useRestaurant();
  const navigate = useNavigate();
  const isNew = !pessoa;
  const isInativa = !!pessoa && pessoa.ativa === false;
  const subdomainAtivo = restaurants.find((r) => r.id === restaurantId)?.subdomain || null;
  // Convite de acesso: precisa de email + WhatsApp e pessoa salva/ativa.
  const podeConvidar = !!pessoa && !isInativa && !!pessoa.email && (pessoa.whatsapp || "").replace(/\D/g, "").length >= 10;

  // "Visualizar como" — só master, não na própria pessoa, não em nova,
  // não em inativada. Inicia impersonação + redireciona pro home.
  const podeVisualizarComo = !!pessoaReal?.isMaster
    && !!pessoa
    && pessoa.id !== pessoaReal.id
    && !isInativa
    && !isNew;

  const [form, setForm] = useState({
    nome: pessoa?.nome || "",
    email: pessoa?.email || "",
    cpf: pessoa?.cpf || "",
    whatsapp: pessoa?.whatsapp || "",
    pix: pessoa?.pix || "",
  });
  const [vinculoNovo, setVinculoNovo] = useState<VinculoLogico | "">("");
  // Terá login? Decisão explícita por pessoa (padrão Não). Independe do vínculo.
  const [temLogin, setTemLogin] = useState<boolean>(() => (pessoa ? pessoaTemLogin(pessoa) : false));
  async function setTemLoginPersist(v: boolean) {
    setTemLogin(v);
    if (pessoa) { try { await updateDoc(doc(db, "pessoas", pessoa.id), { temLogin: v }); } catch { /* salva junto no Salvar */ } }
  }
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [savedAt, setSavedAt] = useState("");
  // Convite de acesso (provisionamento)
  const [convidando, setConvidando] = useState(false);
  const [conviteErro, setConviteErro] = useState("");
  const [convite, setConvite] = useState<{ senha: string; waLink: string; enviadoEmail: boolean; emailDest: string } | null>(null);
  const [showInativar, setShowInativar] = useState(false);
  // Redefinir senha de acesso (via Cloud Function processarResetSenha)
  const [resetLoading, setResetLoading] = useState(false);
  const [resetResult, setResetResult] = useState<{ ok: true; senha: string; email: string } | { ok: false; erro: string } | null>(null);
  const [showReativar, setShowReativar] = useState(false);
  const [showExcluir, setShowExcluir] = useState(false);
  const [showLiberarEmail, setShowLiberarEmail] = useState(false);

  const podeExcluir = canExcluirPessoa(me, restaurantId);
  const { can } = useCanAcao(restaurantId);
  const podeDemitir = !!me?.isMaster || can("pessoas", "demitir");
  const podeDemitirSolides = !!me?.isMaster || can("demissao", "demitirSolides");
  const shortCode = restaurants.find((r) => r.id === restaurantId)?.shortCode || "";
  const [showDemitirSolides, setShowDemitirSolides] = useState(false);
  const [ultimoDiaDemissao, setUltimoDiaDemissao] = useState("");
  // Vínculo CLT/Estagiário → "Demitir" (desligamento). Demais → "Inativar".
  const vincPessoa = pessoa?.vinculos?.[restaurantId];
  const ehDesligavel = vincPessoa === "clt" || vincPessoa === "estagiario";

  // Estado do acesso (pro painel guiado por status). Usa o email do form (ao vivo).
  const uidVinc = (pessoa as unknown as { uidVinculado?: string } | null)?.uidVinculado;
  const estadoAcesso: "master" | "sem_login" | "falta_email" | "sem_acesso" | "aguardando" | "pronto" =
    pessoa?.isMaster ? "master"
      : !temLogin ? "sem_login"
      : !form.email.trim() ? "falta_email"
      : !pessoa?.acessoProvisionadoEm ? "sem_acesso"
      : (uidVinc && !pessoa?.mustTrocarSenha) ? "pronto"
      : "aguardando";
  const ACESSO_INFO: Record<typeof estadoAcesso, { label: string; cls: string; expl: string }> = {
    master:      { label: "Master", cls: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300", expl: "Acesso total ao sistema." },
    sem_login:   { label: "Sem login", cls: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400", expl: "Não usa o sistema. Pra dar acesso, marque “vai ter login: Sim” acima." },
    falta_email: { label: "Falta email", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", expl: "Preencha o email no cadastro acima (e salve) — sem ele não dá pra criar acesso." },
    sem_acesso:  { label: "Sem acesso ainda", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300", expl: "Falta criar o acesso e enviar pra pessoa." },
    aguardando:  { label: "Aguardando 1º acesso", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", expl: "Convite enviado — a pessoa ainda não concluiu (CPF + nova senha)." },
    pronto:      { label: "Pronto", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", expl: "Tem login, perfil e já acessou. Tudo certo." },
  };

  // Detecção de pessoa duplicada por CPF — quando user tenta criar nova com
  // CPF que já existe (em qualquer restaurante). Oferece vincular em vez de
  // criar duplicada.
  const [duplicada, setDuplicada] = useState<Pessoa | null>(null);

  function cpfLimpo(s: string): string {
    return s.replace(/\D/g, "");
  }

  // Convite express: gera senha inicial, cria a conta no Firebase Auth (app
  // secundário, sem deslogar o admin), marca mustTrocarSenha e dispara o
  // WhatsApp. Fallback: abre wa.me + mostra a senha pra mandar manual.
  async function convidarAcesso() {
    if (!pessoa || !me) return;
    const email = (pessoa.email || "").trim().toLowerCase();
    const whats = (pessoa.whatsapp || "").replace(/\D/g, "");
    if (!email) { setConviteErro("Preencha o email (e salve) antes de convidar/reenviar."); return; }
    setConvidando(true); setConviteErro(""); setConvite(null);
    const senha = gerarSenhaInicial();
    const prov = await provisionarAcesso(email, senha);
    if (!prov.ok) {
      setConvidando(false);
      setConviteErro(prov.motivo === "email_em_uso"
        ? "Essa pessoa já tem conta. Pra ela acessar de novo, use o botão 🔑 Redefinir senha — gera uma senha temporária na hora (você testa e ela troca no 1º acesso)."
        : "Não foi possível criar o acesso: " + (prov.detalhe || prov.motivo));
      return;
    }
    try {
      await updateDoc(doc(db, "pessoas", pessoa.id), sanitizeForFirestore({
        mustTrocarSenha: true, acessoProvisionadoEm: new Date().toISOString(), whatsappOptIn: true,
      }));
    } catch { /* best-effort */ }
    const baseUrl = subdomainAtivo ? `https://${subdomainAtivo}.planejamento.app` : "https://planejamento.app";
    const nomePrimeiro = (pessoa.nome || "").split(/\s+/)[0] || "";
    const waLink = whats.length >= 10
      ? `https://wa.me/${whats.startsWith("55") ? whats : `55${whats}`}?text=${encodeURIComponent(buildConviteMsg(nomePrimeiro, email, senha, baseUrl))}`
      : "";
    // Convite por EMAIL (canal certo pra credencial — sem as travas de template
    // da Meta). O WhatsApp fica como alternativa manual (wa.me).
    const enviadoEmail = await enviarEmailAcesso(email, pessoa.nome, email, senha, baseUrl);
    setConvite({ senha, waLink, enviadoEmail, emailDest: email });
    setConvidando(false);
  }

  // Redefinir a senha de uma conta que JÁ existe (a pessoa travou no 1º acesso,
  // esqueceu a senha, etc.). Grava um pedido em resetSenhaRequests; a Cloud
  // Function `processarResetSenha` (roda com Auth admin) gera uma senha
  // temporária, seta na conta e devolve aqui. Você testa o login e a pessoa é
  // obrigada a trocar no próximo acesso.
  async function redefinirSenha() {
    if (!pessoa) return;
    const u = auth.currentUser;
    if (!u) { setResetResult({ ok: false, erro: "Sessão expirada — recarregue e tente de novo." }); return; }
    setResetLoading(true); setResetResult(null);
    let unsub: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const finish = (r: { ok: true; senha: string; email: string } | { ok: false; erro: string }, ref?: ReturnType<typeof doc>) => {
      if (done) return; done = true;
      if (unsub) unsub();
      if (timer) clearTimeout(timer);
      setResetLoading(false);
      setResetResult(r);
      if (ref) void deleteDoc(ref).catch(() => {});
    };
    try {
      const ref = await addDoc(collection(db, "resetSenhaRequests"), {
        pessoaId: pessoa.id, solicitadoPorUid: u.uid, solicitadoPorEmail: u.email || "",
        status: "pendente", criadoEm: new Date().toISOString(),
      });
      unsub = onSnapshot(ref, (snap) => {
        const d = snap.data() as { status?: string; senhaTemporaria?: string; emailAlvo?: string; erro?: string } | undefined;
        if (!d) return;
        if (d.status === "ok") finish({ ok: true, senha: d.senhaTemporaria || "", email: d.emailAlvo || pessoa.email || "" }, ref);
        else if (d.status === "erro") finish({ ok: false, erro: d.erro || "Falha ao redefinir." }, ref);
      }, () => finish({ ok: false, erro: "Erro ao acompanhar o pedido." }, ref));
      timer = setTimeout(() => finish({ ok: false, erro: "Demorou demais — tente de novo em instantes." }, ref), 30000);
    } catch (e) {
      finish({ ok: false, erro: e instanceof Error ? e.message : "Erro ao criar o pedido." });
    }
  }

  async function salvar() {
    if (!form.nome.trim()) { setErr("Nome obrigatório"); return; }
    const cpfDigits = cpfLimpo(form.cpf);
    // CPF é opcional na criação — a pessoa preenche no 1º acesso. Se informado,
    // valida os 11 dígitos.
    if (cpfDigits && cpfDigits.length !== 11) { setErr("CPF inválido — precisa de 11 dígitos"); return; }
    if (isNew && !vinculoNovo) { setErr("Escolha o vínculo da pessoa neste restaurante"); return; }
    if (!me) return;
    setErr("");
    setDuplicada(null);
    setSaving(true);
    try {
      const now = new Date().toISOString();
      if (isNew) {
        // Verifica se já existe Pessoa com esse CPF (só quando o CPF foi informado)
        if (cpfDigits) {
          const dupSnap = await getDocs(query(collection(db, "pessoas"), where("cpf", "==", cpfDigits), limit(1)));
          if (!dupSnap.empty) {
            const existente = { id: dupSnap.docs[0].id, ...dupSnap.docs[0].data() } as Pessoa;
            setDuplicada(existente);
            setSaving(false);
            return;
          }
        }
        const ref = await addDoc(collection(db, "pessoas"), {
          email: form.email.trim().toLowerCase(),
          nome: form.nome.trim(),
          cpf: cpfDigits || null,
          cadastroIncompleto: !cpfDigits,
          whatsapp: form.whatsapp.trim() || null,
          pix: form.pix.trim() || null,
          isMaster: false,
          temLogin,
          restaurantIds: [restaurantId],
          permissions: { [restaurantId]: {} },
          vinculos: { [restaurantId]: vinculoNovo },
          ativa: true,
          createdAt: now,
        });
        await logAudit({
          entityType: "pessoa",
          entityId: ref.id,
          restaurantId,
          acao: "criado",
          registradoPor: me.id,
        });
        onCreated();
      } else {
        // Editando — checa se outro doc tem o mesmo CPF (só quando informado)
        if (cpfDigits) {
          const dupSnap = await getDocs(query(collection(db, "pessoas"), where("cpf", "==", cpfDigits), limit(2)));
          const conflito = dupSnap.docs.find(d => d.id !== pessoa.id);
          if (conflito) {
            setErr(`CPF já está cadastrado em outra pessoa (${(conflito.data() as Pessoa).nome}).`);
            setSaving(false);
            return;
          }
        }
        const update: Record<string, unknown> = {
          email: form.email.trim().toLowerCase(),
          nome: form.nome.trim(),
          cpf: cpfDigits || null,
          whatsapp: form.whatsapp.trim() || null,
          pix: form.pix.trim() || null,
          cadastroIncompleto: !cpfDigits,
          temLogin,
        };
        await updateDoc(doc(db, "pessoas", pessoa.id), update);
        await logAudit({
          entityType: "pessoa",
          entityId: pessoa.id,
          restaurantId,
          acao: "alterado",
          registradoPor: me.id,
        });
        setSavedAt(new Date().toLocaleTimeString("pt-BR"));
      }
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  async function vincularDuplicada() {
    if (!duplicada || !me) return;
    setSaving(true);
    try {
      const atualizadas = Array.from(new Set([...(duplicada.restaurantIds || []), restaurantId]));
      const novosRest = Array.from(new Set([...(duplicada.novosRestaurantes || []), restaurantId]));
      await updateDoc(doc(db, "pessoas", duplicada.id), {
        restaurantIds: atualizadas,
        novosRestaurantes: novosRest,
      });
      await logAudit({
        entityType: "pessoa",
        entityId: duplicada.id,
        restaurantId,
        acao: "alterado",
        motivo: "Vinculada a novo restaurante (CPF já existente)",
        registradoPor: me.id,
      });
      setDuplicada(null);
      onCreated();
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {isInativa && (
        <div className="rounded-lg bg-gray-100 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm flex flex-wrap items-center gap-2">
          <span className="text-gray-700 dark:text-gray-300">○ Pessoa inativa</span>
          {pessoa?.motivoInativacao && (
            <span className="text-xs text-gray-500 dark:text-gray-400">· {pessoa.motivoInativacao}</span>
          )}
          {pessoa?.solidesDemissao ? (
            <span className="ml-auto text-[11px] font-semibold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
              title={`Por ${pessoa.solidesDemissao.por || "?"}${pessoa.solidesDemissao.motivo ? ` · ${pessoa.solidesDemissao.motivo}` : ""}`}>
              ✓ Demitido na Sólides em {(pessoa.solidesDemissao.data || "").split("-").reverse().join("/")}
            </span>
          ) : podeDemitirSolides && pessoa?.cpf ? (
            <button type="button" onClick={() => setShowDemitirSolides(true)}
              className="ml-auto text-[11px] font-semibold px-2.5 py-1 rounded-md border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20">
              Demitir na Sólides
            </button>
          ) : null}
        </div>
      )}

      {pessoa?.cadastroIncompleto && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          ⚠ <strong>Cadastro incompleto</strong> — preencha o CPF pra ativar o vínculo desta pessoa.
        </div>
      )}

      {duplicada && (
        <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-300 dark:border-blue-800 px-3 py-2 text-sm">
          <div className="font-medium text-blue-900 dark:text-blue-200 mb-1">
            👤 Essa pessoa já está cadastrada
          </div>
          <div className="text-blue-800 dark:text-blue-300 text-xs mb-2">
            <strong>{duplicada.nome}</strong> (CPF {duplicada.cpf}) já existe em{" "}
            {duplicada.restaurantIds?.length || 0} restaurante(s).
            {" "}Quer vincular ela a este também?
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={vincularDuplicada} disabled={saving}>
              ✓ Sim, vincular
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setDuplicada(null)} disabled={saving}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Nome completo *"
          value={form.nome}
          onChange={(e) => setForm({ ...form, nome: e.target.value })}
          autoFocus
        />
        <Input
          label="Email (login)"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="pessoa@exemplo.com"
        />
        <Input
          label="CPF *"
          value={form.cpf}
          onChange={(e) => setForm({ ...form, cpf: e.target.value })}
          placeholder="000.000.000-00"
        />
        <Input
          label="WhatsApp"
          value={form.whatsapp}
          onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
          placeholder="(11) 99999-9999"
        />
        <Input
          label="Chave PIX (p/ freela)"
          value={form.pix}
          onChange={(e) => setForm({ ...form, pix: e.target.value })}
          placeholder="CPF, e-mail, telefone ou chave aleatória"
        />
      </div>

      {isNew && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Vínculo neste restaurante *</label>
          <select
            value={vinculoNovo}
            onChange={(e) => setVinculoNovo(e.target.value as VinculoLogico | "")}
            className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">— escolha o vínculo —</option>
            {VINCULOS_LOGICOS.map(v => (
              <option key={v} value={v}>{VINCULO_LOGICO_ICONE[v]} {VINCULO_LOGICO_LABEL[v]}</option>
            ))}
          </select>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">Define o comportamento da pessoa (escala, ponto, gorjeta, VT). Pode ajustar depois na aba Vínculos.</p>
        </div>
      )}

      {/* Terá login? — decisão explícita por pessoa (padrão Não). Só quando Sim o
          sistema oferece criar acesso. Independe do vínculo/perfil. */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Essa pessoa vai ter login no sistema?</label>
        <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 w-full max-w-xs">
          {([["nao", "Não"], ["sim", "Sim"]] as const).map(([v, label]) => {
            const on = (v === "sim") === temLogin;
            return (
              <button key={v} type="button" onClick={() => void setTemLoginPersist(v === "sim")}
                className={`flex-1 px-3 py-1.5 text-[13px] font-medium rounded-md text-center transition-colors ${on ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"}`}>
                {label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Padrão <b>Não</b> — ex.: freela não acessa (e nem gera acesso). Marque <b>Sim</b> só pra quem vai usar o sistema. Independe do perfil/vínculo.
        </p>
      </div>

      {/* Atribuição de perfil de acesso — substitui a tab "🔐 Permissões"
          antiga (checkboxes ver/configurar) que foi removida. */}
      {!isNew && pessoa && (
        <PerfilAcessoSection pessoa={pessoa} restaurantId={restaurantId} />
      )}

      {/* Vínculo lógico por restaurante + toggles "depende da pessoa".
          Define comportamento da pessoa: escala, gorjeta, ponto, benefícios. */}
      {!isNew && pessoa && !pessoa.isMaster && (
        <VinculoSection pessoa={pessoa} restaurantId={restaurantId} />
      )}

      {!isNew && (
        <div className="border-t border-gray-200 dark:border-gray-800 pt-3 flex flex-wrap gap-2">
          {!isInativa ? (
            <div className="w-full space-y-3">
              {/* ── Painel de Acesso (guiado por status) ── */}
              <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">🔐 Acesso</span>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${ACESSO_INFO[estadoAcesso].cls}`}>{ACESSO_INFO[estadoAcesso].label}</span>
                </div>
                <p className="text-[12.5px] text-gray-500 dark:text-gray-400 mb-2.5">{ACESSO_INFO[estadoAcesso].expl}</p>

                <div className="flex flex-wrap gap-2 items-center">
                  {estadoAcesso === "sem_acesso" && podeConvidar && (
                    <Button size="sm" disabled={convidando} onClick={() => void convidarAcesso()} title="Cria o acesso com uma senha inicial e convida a pessoa pelo WhatsApp" className="!bg-emerald-600 hover:!bg-emerald-700 !border-emerald-600">
                      {convidando ? "Criando acesso…" : "🔑 Convidar pra acessar"}
                    </Button>
                  )}
                  {estadoAcesso === "sem_acesso" && !podeConvidar && (
                    <span className="text-[12px] text-gray-400 dark:text-gray-500">Preencha {!pessoa?.email ? "email" : ""}{!pessoa?.email && !pessoa?.whatsapp ? " e " : ""}{!pessoa?.whatsapp ? "WhatsApp" : ""} pra habilitar o convite.</span>
                  )}
                  {estadoAcesso === "aguardando" && podeConvidar && (
                    <Button size="sm" disabled={convidando} onClick={() => void convidarAcesso()} title="Recria o acesso com uma nova senha inicial e reenvia por email (Resend)." className="!bg-indigo-600 hover:!bg-indigo-700 !border-indigo-600">
                      {convidando ? "Reenviando…" : "🔁 Reenviar convite"}
                    </Button>
                  )}
                  {pessoaReal?.isMaster && temLogin && !!pessoa?.email && (estadoAcesso === "aguardando" || estadoAcesso === "pronto") && (
                    <Button size="sm" variant="secondary" disabled={resetLoading} onClick={() => void redefinirSenha()} title="Gera uma senha temporária pra conta existente (travou no 1º acesso, esqueceu a senha). Você testa o login; ela troca no próximo acesso.">
                      {resetLoading ? "Redefinindo…" : "🔑 Redefinir senha"}
                    </Button>
                  )}
                  {podeVisualizarComo && pessoa && (
                    <Button size="sm" variant="secondary" onClick={() => { startImpersonate(pessoa.id); onClose(); navigate("/"); }} title="Simulação: entra na tela COMO essa pessoa pra ver o que o perfil dela mostra (não testa login — pra isso use 'Redefinir senha')">
                      👁️ Ver como
                    </Button>
                  )}
                </div>

                {resetResult && (
                  <div className={`mt-2.5 rounded-lg border px-3 py-2.5 text-sm ${resetResult.ok ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30" : "border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30"}`}>
                    {resetResult.ok ? (
                      <div className="space-y-1.5">
                        <div className="text-emerald-800 dark:text-emerald-300">✅ Senha temporária de <b>{resetResult.email}</b>:</div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="font-mono text-base font-bold px-2.5 py-1 rounded bg-white dark:bg-gray-900 border border-emerald-200 dark:border-emerald-800 tracking-wider">{resetResult.senha}</code>
                          <button type="button" onClick={() => { void navigator.clipboard?.writeText(resetResult.senha).catch(() => {}); }} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">📋 copiar</button>
                        </div>
                        <p className="text-[12px] text-emerald-700/90 dark:text-emerald-400/90">Teste o login numa aba anônima. A pessoa vai <b>trocar a senha no próximo acesso</b>. Anote agora — não fica salvo.</p>
                      </div>
                    ) : (
                      <div className="text-rose-700 dark:text-rose-300">⚠ {resetResult.erro}</div>
                    )}
                    <button type="button" onClick={() => setResetResult(null)} className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mt-1.5">fechar</button>
                  </div>
                )}
              </div>

              {/* ── Situação da pessoa — separado do acesso ── */}
              {podeDemitir && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Situação</span>
                  <Button variant="danger" size="sm" onClick={() => setShowInativar(true)}>
                    {ehDesligavel ? "👋 Demitir" : "🚫 Inativar pessoa"}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <>
              {podeDemitir && (
                <Button size="sm" onClick={() => setShowReativar(true)}>
                  ✓ Reativar pessoa
                </Button>
              )}
              {/* "Liberar email" — só faz sentido em pessoa inativa que ainda
                  tem email setado. Histórico preservado, mas o email vira
                  livre pra uma nova pessoa usar. */}
              {pessoa && pessoa.email && podeDemitir && (
                <Button
                  size="sm"
                  onClick={() => setShowLiberarEmail(true)}
                  title="Libera o email dessa pessoa pra outra usar (histórico fica preservado)"
                  className="!bg-amber-600 hover:!bg-amber-700 !border-amber-600"
                >
                  🔓 Liberar email
                </Button>
              )}
              {podeExcluir && (
                <Button variant="danger" size="sm" onClick={() => setShowExcluir(true)}>
                  🗑 Excluir definitivamente
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {/* Resultado do convite: senha inicial + envio/fallback */}
      {conviteErro && <div className="text-sm rounded-lg px-3 py-2 bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400">{conviteErro}</div>}
      {convite && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-3 space-y-2">
          <div className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
            {convite.enviadoEmail ? `✓ Convite enviado por email para ${convite.emailDest}` : "Acesso criado — o email não saiu, envie manualmente:"}
          </div>
          <div className="text-sm text-gray-700 dark:text-gray-200 flex items-center gap-2 flex-wrap">
            Senha inicial: <code className="px-2 py-0.5 rounded bg-white dark:bg-gray-900 border border-emerald-200 dark:border-emerald-800 font-mono">{convite.senha}</code>
            <button type="button" onClick={() => navigator.clipboard?.writeText(convite.senha)} className="text-xs text-emerald-700 dark:text-emerald-400 hover:underline">copiar</button>
          </div>
          {convite.waLink && (
            <a href={convite.waLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline">
              💬 {convite.enviadoEmail ? "Mandar também pelo WhatsApp" : "Mandar pelo WhatsApp"}
            </a>
          )}
          <p className="text-[11px] text-gray-500 dark:text-gray-400">No 1º acesso ela confirma o CPF e cria a própria senha.</p>
        </div>
      )}

      {isNew && (
        <p className="text-xs text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-2">
          📩 Basta <strong>nome, email e WhatsApp</strong>. Depois de salvar, use <strong>🔑 Convidar pra acessar</strong> — o sistema cria o acesso com uma senha inicial e você manda pelo WhatsApp. O CPF a pessoa preenche no 1º acesso.
        </p>
      )}

      {err && <div className="text-sm text-rose-600">{err}</div>}

      <div className="flex justify-between items-center pt-3 border-t border-gray-200 dark:border-gray-800">
        <div className="text-xs text-emerald-600">
          {savedAt && `✓ Salvo às ${savedAt}`}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>{isNew ? "Cancelar" : "Fechar"}</Button>
          <Button onClick={salvar} disabled={saving}>{saving ? "..." : isNew ? "Criar pessoa" : "Salvar"}</Button>
        </div>
      </div>

      {showInativar && pessoa && (
        <InativarModal
          pessoa={pessoa}
          titulo={ehDesligavel ? `Demitir — ${pessoa.nome}` : undefined}
          onClose={() => setShowInativar(false)}
          onInativada={(ultimoDia) => {
            setShowInativar(false);
            setUltimoDiaDemissao(ultimoDia);
            // CLT/estagiário: encadeia o box "Demitir na Sólides". Demais: fecha.
            if (ehDesligavel && podeDemitirSolides && pessoa.cpf && !pessoa.solidesDemissao) {
              setShowDemitirSolides(true);
            } else {
              onClose();
            }
          }}
        />
      )}
      {showDemitirSolides && pessoa && (
        <DemitirSolidesModal
          pessoa={pessoa}
          shortCode={shortCode}
          ultimoDiaTrabalhado={ultimoDiaDemissao || (pessoa.inativadaUltimoDia || "").slice(0, 10) || undefined}
          por={{ id: me?.id || "", nome: me?.nome || "?" }}
          onClose={() => setShowDemitirSolides(false)}
        />
      )}
      {showReativar && pessoa && (
        <ReativarModal
          pessoa={pessoa}
          onClose={() => { setShowReativar(false); onClose(); }}
        />
      )}
      {showExcluir && pessoa && (
        <ExcluirModal
          pessoa={pessoa}
          onClose={() => { setShowExcluir(false); onClose(); }}
        />
      )}
      {showLiberarEmail && pessoa && me && (
        <LiberarEmailModal
          pessoa={pessoa}
          masterId={me.id}
          masterNome={me.nome}
          onClose={() => setShowLiberarEmail(false)}
          onFeito={() => { setShowLiberarEmail(false); onClose(); }}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// TAB 2: VÍNCULOS (empregado em cada restaurante)
// ════════════════════════════════════════════════════════════════

function TabVinculos({ pessoa, restaurantId }: { pessoa: Pessoa; restaurantId: string }) {
  const [empregado, setEmpregado] = useState<Empregado | null>(null);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [showEmpModal, setShowEmpModal] = useState(false);

  // Empregado vinculado a essa pessoa neste restaurante
  useEffect(() => {
    if (!restaurantId || !pessoa.id) return;
    const q = query(
      collection(db, "empregados"),
      where("restaurantId", "==", restaurantId),
      where("pessoaId", "==", pessoa.id),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado);
      setEmpregado(list[0] || null);
    });
    return () => unsub();
  }, [restaurantId, pessoa.id]);

  // Cargos do restaurante (pra escolha no sub-modal)
  useEffect(() => {
    if (!restaurantId) return;
    const q = query(collection(db, "cargos"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      setCargos(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Cargo));
    });
    return () => unsub();
  }, [restaurantId]);

  const cargoMap = Object.fromEntries(cargos.map(c => [c.id, c]));
  const cargo = empregado ? cargoMap[empregado.cargoId] : null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Vínculo de equipe = essa pessoa é empregada em algum restaurante. Aparece na escala, gorjeta, VT.
      </p>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
        <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
          Restaurante atual
        </div>
        {!empregado ? (
          <div className="text-center py-4">
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
              {pessoa.nome} <strong>não é empregada</strong> deste restaurante.
            </p>
            <Button onClick={() => setShowEmpModal(true)}>+ Vincular como empregado</Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {cargo?.nome || "Cargo desconhecido"}
                  {cargo && (
                    <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-bold">
                      {TIPO_VINCULO_LABEL[cargo.tipoVinculo].split(" ")[0]}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Admissão: {empregado.admissaoAtual ? fmtBR(empregado.admissaoAtual) : "—"}
                  {empregado.vtAtivo && ` · VT R$ ${empregado.vtValorPassagem ?? 0}/passagem × ${empregado.vtPassagensPorDia ?? 0}`}
                </div>
                {empregado.periodos && empregado.periodos.length > 1 && (
                  <div className="text-[10px] text-indigo-600 dark:text-indigo-400 mt-1">
                    🔁 Trilha: {empregado.periodos.length} período(s) — readmissão preserva histórico
                  </div>
                )}
              </div>
              <Button variant="secondary" size="sm" onClick={() => setShowEmpModal(true)}>
                Editar
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Outros restaurantes vinculados a essa Pessoa — útil pra desvincular
          empresas onde a pessoa não trabalha mais (ex: demitida e foi pra
          outra empresa do grupo). Não mexe no histórico do Empregado, só
          remove o restaurantId de pessoa.restaurantIds. */}
      <OutrosRestaurantesVinculados
        pessoa={pessoa}
        restauranteAtualId={restaurantId}
      />

      {showEmpModal && (
        <EmpregadoModal
          empregado={empregado}
          pessoa={pessoa}
          restaurantId={restaurantId}
          cargos={cargos}
          onClose={() => setShowEmpModal(false)}
        />
      )}
    </div>
  );
}


// ════════════════════════════════════════════════════════════════
// Bloco da aba Vínculos: outros restaurantes que essa Pessoa tem em
// pessoa.restaurantIds (além do atual). Pra cada um mostra o status do
// Empregado (ativo/demitido) e botão "Desvincular" — remove o rid de
// pessoa.restaurantIds sem mexer no Empregado (histórico preservado).
// ════════════════════════════════════════════════════════════════

function OutrosRestaurantesVinculados({
  pessoa,
  restauranteAtualId,
}: {
  pessoa: Pessoa;
  restauranteAtualId: string;
}) {
  const [vinculos, setVinculos] = useState<Array<{
    restaurantId: string;
    nomeRest: string;
    empregadoId: string | null;
    estaAtivo: boolean;
    demitidoEm: string | null | undefined;
    admissaoAtual: string | null | undefined;
  }>>([]);
  const [salvando, setSalvando] = useState<string | null>(null);

  // Recarrega quando muda restaurantIds da Pessoa (após desvincular)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const outros = (pessoa.restaurantIds || []).filter((rid) => rid !== restauranteAtualId);
      if (outros.length === 0) {
        if (!cancelled) setVinculos([]);
        return;
      }
      // Busca nomes + empregados em paralelo
      const items = await Promise.all(outros.map(async (rid) => {
        const restSnap = await getDoc(doc(db, "restaurants", rid));
        const r = restSnap.exists() ? (restSnap.data() as Restaurant) : null;
        const empQ = query(
          collection(db, "empregados"),
          where("restaurantId", "==", rid),
          where("pessoaId", "==", pessoa.id),
        );
        const empSnap = await getDocs(empQ);
        const emp = empSnap.docs[0]?.data() as Empregado | undefined;
        return {
          restaurantId: rid,
          nomeRest: r?.nome || rid,
          empregadoId: empSnap.docs[0]?.id || null,
          estaAtivo: emp?.estaAtivo ?? false,
          demitidoEm: emp?.demitidoEm,
          admissaoAtual: emp?.admissaoAtual,
        };
      }));
      if (!cancelled) setVinculos(items);
    })();
    return () => { cancelled = true; };
  }, [pessoa.restaurantIds, restauranteAtualId, pessoa.id]);

  async function desvincular(rid: string, nomeRest: string, estaAtivo: boolean) {
    const aviso = estaAtivo
      ? `⚠ ATENÇÃO: o vínculo de empregado dessa pessoa em "${nomeRest}" ainda está ATIVO (não foi demitido).\n\n` +
        `Desvincular do restaurante sem demitir antes vai deixar o Empregado órfão na collection. ` +
        `Recomendado: demita o empregado primeiro pelo módulo Pessoas do restaurante "${nomeRest}".\n\n` +
        `Continuar mesmo assim?`
      : `Remover o vínculo dessa pessoa com "${nomeRest}"?\n\n` +
        `A Pessoa deixa de aparecer como vinculada a esse restaurante. O Empregado demitido fica ` +
        `preservado no histórico (sem ser apagado).`;
    if (!confirm(aviso)) return;
    setSalvando(rid);
    try {
      const novosRids = (pessoa.restaurantIds || []).filter((x) => x !== rid);
      await updateDoc(doc(db, "pessoas", pessoa.id), {
        restaurantIds: novosRids,
      });
    } catch (e) {
      alert("Erro ao desvincular: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setSalvando(null);
    }
  }

  if (vinculos.length === 0) {
    return (
      <p className="text-xs text-gray-400 dark:text-gray-500 italic">
        Esta pessoa está vinculada só ao restaurante atual.
      </p>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-2">
      <div className="text-xs font-bold uppercase tracking-wider text-gray-500">
        Outros restaurantes vinculados a esta pessoa
      </div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        Lista todos os restaurantes em <code>pessoa.restaurantIds</code> além
        do atual. Use <strong>Desvincular</strong> pra remover da lista quando
        a pessoa não trabalha mais lá (típico em demissão + mudança pra
        outro restaurante do grupo). O Empregado demitido fica preservado no
        histórico do restaurante antigo, só a Pessoa deixa de aparecer como vinculada.
      </p>
      {vinculos.map((v) => (
        <div
          key={v.restaurantId}
          className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border ${
            v.estaAtivo
              ? "bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800"
              : "bg-amber-50/40 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800"
          }`}
        >
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm text-gray-900 dark:text-gray-100">
              {v.nomeRest}
            </div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              {v.empregadoId == null ? (
                <span className="italic">Sem registro de Empregado neste restaurante</span>
              ) : v.estaAtivo ? (
                <>
                  ✓ Empregado <strong>ativo</strong>
                  {v.admissaoAtual && <> · admissão {v.admissaoAtual.split("-").reverse().join("/")}</>}
                </>
              ) : (
                <>
                  ✕ Demitida
                  {v.demitidoEm && <> em {v.demitidoEm.split("-").reverse().join("/")}</>}
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => desvincular(v.restaurantId, v.nomeRest, v.estaAtivo)}
            disabled={salvando === v.restaurantId}
            className="text-[10px] px-2 py-1 rounded text-rose-700 dark:text-rose-400 border border-rose-300 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-900/20"
          >
            {salvando === v.restaurantId ? "..." : "🔗 Desvincular"}
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── PerfilAcessoSection ─────────────────────────────────────────────────
// Dropdown pra atribuir um AccessProfile (sistema novo) à pessoa neste
// restaurante. Em transição: se setado, o profile rege; se vazio, sistema
// antigo (ver/configurar abaixo) rege. Master ignora isso.
//
// Salva direto no Firestore — não usa o ciclo dirty/save do tab de
// permissões antigo (que é ver/configurar). Quando o sistema antigo for
// aposentado, essa section vira o único controle de permissão.
function PerfilAcessoSection({ pessoa, restaurantId }: { pessoa: Pessoa; restaurantId: string }) {
  const { perfis, loading } = useAccessProfiles();
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const profileIdAtual = pessoa.profileIds?.[restaurantId] || "";

  // Filtra perfis disponíveis pra esse restaurante: globais + específicos desse rid
  const disponiveis = perfis.filter(p =>
    p.restaurantId === null || p.restaurantId === restaurantId
  );

  async function alterar(novoProfileId: string) {
    if (pessoa.isMaster) return;
    setSalvando(true);
    setErro("");
    try {
      const profileIds = { ...(pessoa.profileIds || {}) };
      if (novoProfileId) profileIds[restaurantId] = novoProfileId;
      else delete profileIds[restaurantId];
      await updateDoc(doc(db, "pessoas", pessoa.id), {
        profileIds,
        atualizadoEm: new Date().toISOString(),
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  if (pessoa.isMaster) {
    return (
      <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-900/10 p-3 text-sm text-emerald-800 dark:text-emerald-300">
        👑 <strong>Master</strong> — acesso total a tudo, perfil de acesso não se aplica.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-900/10 p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="text-xs font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
          🛡️ Perfil de Acesso
        </div>
        <div className="text-[11px] text-indigo-600 dark:text-indigo-400">
          Sistema novo · gerencie em <Link to="/perfis" className="underline">Perfis de Acesso</Link>
        </div>
      </div>
      {loading ? (
        <p className="text-xs text-gray-500">Carregando perfis…</p>
      ) : (
        <select
          value={profileIdAtual}
          onChange={(e) => alterar(e.target.value)}
          disabled={salvando}
          className="w-full border border-indigo-300 dark:border-indigo-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">— Sem perfil (usa sistema antigo abaixo) —</option>
          {disponiveis.map(p => (
            <option key={p.id} value={p.id}>
              {p.nome}
              {p.builtin ? " (built-in)" : ""}
              {p.restaurantId === null ? " · global" : " · exclusivo"}
            </option>
          ))}
        </select>
      )}
      {erro && <p className="text-xs text-rose-600">⚠ {erro}</p>}
      <p className="text-[11px] text-gray-600 dark:text-gray-400">
        Atribuir um perfil substitui o sistema antigo (ver/configurar) por
        ações granulares. Telas que ainda não foram migradas continuam usando
        as permissões antigas mesmo com perfil atribuído — transição gradual.
      </p>
    </div>
  );
}

// ─── VinculoSection ──────────────────────────────────────────────────────
// Dropdown pra definir o Vínculo Lógico da pessoa neste restaurante (CLT,
// Estagiário, Freela, Prestador Adm, Diretoria). Define o comportamento da
// pessoa (entra na escala? bate ponto? recebe gorjeta? VT? VR?) via matriz
// COMPORTAMENTO_POR_VINCULO em src/core/vinculos/comportamento.ts.
//
// Atributos marcados como "pess" (depende da pessoa) viram toggles aqui —
// admin marca caso a caso (ex: este freela específico recebe VT).
//
// Carrega o empregado + cargo da pessoa pra resolver vínculo de fallback
// (cargo legacy) quando ela ainda não tem vinculos[rid] explícito.
function VinculoSection({ pessoa, restaurantId }: { pessoa: Pessoa; restaurantId: string }) {
  const [empregado, setEmpregado] = useState<Empregado | null>(null);
  const [cargo, setCargo] = useState<Cargo | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  // Carrega empregado da pessoa neste restaurante (pra fallback do vínculo)
  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const q = query(
          collection(db, "empregados"),
          where("pessoaId", "==", pessoa.id),
          where("restaurantId", "==", restaurantId),
          limit(1),
        );
        const snap = await getDocs(q);
        if (cancelado) return;
        const emp = snap.docs[0]
          ? ({ id: snap.docs[0].id, ...(snap.docs[0].data() as Omit<Empregado, "id">) })
          : null;
        setEmpregado(emp);
        if (emp?.cargoId) {
          const cargoSnap = await getDoc(doc(db, "cargos", emp.cargoId));
          if (cancelado) return;
          setCargo(cargoSnap.exists()
            ? ({ id: cargoSnap.id, ...(cargoSnap.data() as Omit<Cargo, "id">) })
            : null);
        } else {
          setCargo(null);
        }
      } catch {
        // silencia — exibimos a UI mesmo sem dados de fallback
      }
    })();
    return () => { cancelado = true; };
  }, [pessoa.id, restaurantId]);

  // Estado LOCAL otimista do vínculo — a prop `pessoa` só atualiza ao reabrir.
  const [vinculoLocal, setVinculoLocal] = useState<VinculoLogico | "">(pessoa.vinculos?.[restaurantId] || "");
  useEffect(() => {
    setVinculoLocal(pessoa.vinculos?.[restaurantId] || "");
  }, [pessoa, restaurantId]);

  const vinculoExplicito = vinculoLocal || null;
  const vinculoResolvido = vinculoLocal || resolverVinculo(pessoa, restaurantId, empregado, cargo);

  async function alterarVinculo(novo: VinculoLogico | "") {
    setVinculoLocal(novo);   // otimista — reflete na hora
    setSalvando(true);
    setErro("");
    try {
      const vinculos = { ...(pessoa.vinculos || {}) };
      if (novo) vinculos[restaurantId] = novo;
      else delete vinculos[restaurantId];
      await updateDoc(doc(db, "pessoas", pessoa.id), {
        vinculos,
        atualizadoEm: new Date().toISOString(),
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="rounded-lg border border-fuchsia-200 dark:border-fuchsia-800 bg-fuchsia-50/40 dark:bg-fuchsia-900/10 p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="text-xs font-bold uppercase tracking-wider text-fuchsia-700 dark:text-fuchsia-300">
          🤝 Vínculo neste restaurante
        </div>
        {!vinculoExplicito && vinculoResolvido && (
          <button type="button" onClick={() => void alterarVinculo(vinculoResolvido)} disabled={salvando}
            title="Inferido do cargo — clique pra gravar explícito e travar"
            className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-fuchsia-600 text-white hover:bg-fuchsia-700 disabled:opacity-50">
            Gravar como {VINCULO_LOGICO_LABEL[vinculoResolvido]} (inferido)
          </button>
        )}
        {!vinculoExplicito && !vinculoResolvido && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            ⚠ Sem vínculo — defina
          </span>
        )}
      </div>
      <select
        value={vinculoExplicito || ""}
        onChange={(e) => alterarVinculo(e.target.value as VinculoLogico | "")}
        disabled={salvando}
        className="w-full border border-fuchsia-300 dark:border-fuchsia-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-fuchsia-500"
      >
        <option value="">— Sem vínculo definido —</option>
        {VINCULOS_LOGICOS.map(v => (
          <option key={v} value={v}>
            {VINCULO_LOGICO_ICONE[v]} {VINCULO_LOGICO_LABEL[v]}
          </option>
        ))}
      </select>
      {erro && <p className="text-xs text-rose-600">⚠ {erro}</p>}
      <p className="text-[11px] text-gray-600 dark:text-gray-400">
        O vínculo define como a pessoa se comporta neste restaurante — escala, gorjeta, ponto,
        benefícios. Pode variar entre restaurantes (Freela aqui, CLT em outro).
      </p>
    </div>
  );
}
