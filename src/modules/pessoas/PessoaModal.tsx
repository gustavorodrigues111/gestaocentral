import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, getDoc, getDocs, limit, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canExcluirPessoa } from "../../core/auth/permissions";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { EmpregadoModal } from "./EmpregadoModal";
import { InativarModal } from "./InativarModal";
import { ReativarModal } from "./ReativarModal";
import { ExcluirModal } from "./ExcluirModal";
import { getModule } from "../../config/modules";
import { logAudit } from "../../core/audit/versionedChange";
import type { Cargo, Empregado, ModuleId, ModulePermission, PermissionTemplate, Pessoa, Restaurant } from "../../core/types";
import { TIPO_VINCULO_LABEL } from "../../core/types";
import { useAccessProfiles } from "../../core/auth/useAccessProfiles";
import { Link, useNavigate } from "react-router-dom";

type Tab = "identidade" | "vinculos" | "permissoes";

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
    { id: "permissoes", label: "🔐 Permissões", disabled: isNew },
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
      {tab === "permissoes" && pessoa && <TabPermissoes pessoa={pessoa} restaurantId={restaurantId} />}
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════
// TAB 1: IDENTIDADE
// ════════════════════════════════════════════════════════════════

// Monta o link wa.me com mensagem de convite. Retorna null se faltar
// whatsapp ou email (precisa dos 2 pra fazer sentido).
function buildConviteWhatsLink(pessoa: Pessoa, subdomain: string | null): string | null {
  const digits = (pessoa.whatsapp || "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  if (!pessoa.email) return null;
  // Adiciona 55 se for número BR sem código do país
  const phone = digits.startsWith("55") ? digits : `55${digits}`;
  const baseUrl = subdomain ? `https://${subdomain}.planejamento.app` : "https://planejamento.app";
  const signupUrl = `${baseUrl}/signup`;
  const nomePrimeiro = (pessoa.nome || "").split(/\s+/)[0] || "";
  const msg =
    `Oi ${nomePrimeiro}! 👋\n\n` +
    `Te cadastrei no nosso sistema de gestão. Pra criar sua senha de acesso:\n\n` +
    `1️⃣ Abre o link: ${signupUrl}\n` +
    `2️⃣ Coloca o email: ${pessoa.email}\n` +
    `3️⃣ Cria a senha que quiser (mínimo 6 caracteres)\n\n` +
    `Pronto, é só usar email + senha pra entrar.\n` +
    `Qualquer dúvida me chama!`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
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
  const conviteUrl = pessoa && !isInativa ? buildConviteWhatsLink(pessoa, subdomainAtivo) : null;

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
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [showInativar, setShowInativar] = useState(false);
  const [showReativar, setShowReativar] = useState(false);
  const [showExcluir, setShowExcluir] = useState(false);

  const podeExcluir = canExcluirPessoa(me, restaurantId);

  // Detecção de pessoa duplicada por CPF — quando user tenta criar nova com
  // CPF que já existe (em qualquer restaurante). Oferece vincular em vez de
  // criar duplicada.
  const [duplicada, setDuplicada] = useState<Pessoa | null>(null);

  function cpfLimpo(s: string): string {
    return s.replace(/\D/g, "");
  }

  async function salvar() {
    if (!form.nome.trim()) { setErr("Nome obrigatório"); return; }
    const cpfDigits = cpfLimpo(form.cpf);
    if (!cpfDigits) { setErr("CPF obrigatório"); return; }
    if (cpfDigits.length !== 11) { setErr("CPF inválido — precisa de 11 dígitos"); return; }
    if (!me) return;
    setErr("");
    setDuplicada(null);
    setSaving(true);
    try {
      const now = new Date().toISOString();
      if (isNew) {
        // Verifica se já existe Pessoa com esse CPF
        const dupQ = query(
          collection(db, "pessoas"),
          where("cpf", "==", cpfDigits),
          limit(1),
        );
        const dupSnap = await getDocs(dupQ);
        if (!dupSnap.empty) {
          const existente = { id: dupSnap.docs[0].id, ...dupSnap.docs[0].data() } as Pessoa;
          setDuplicada(existente);
          setSaving(false);
          return;
        }
        const ref = await addDoc(collection(db, "pessoas"), {
          email: form.email.trim().toLowerCase(),
          nome: form.nome.trim(),
          cpf: cpfDigits,
          whatsapp: form.whatsapp.trim() || null,
          isMaster: false,
          restaurantIds: [restaurantId],
          permissions: { [restaurantId]: {} },
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
        // Editando — checa se outro doc tem o mesmo CPF (não o próprio)
        const dupQ = query(
          collection(db, "pessoas"),
          where("cpf", "==", cpfDigits),
          limit(2),
        );
        const dupSnap = await getDocs(dupQ);
        const conflito = dupSnap.docs.find(d => d.id !== pessoa.id);
        if (conflito) {
          setErr(`CPF já está cadastrado em outra pessoa (${(conflito.data() as Pessoa).nome}).`);
          setSaving(false);
          return;
        }
        const update: Record<string, unknown> = {
          email: form.email.trim().toLowerCase(),
          nome: form.nome.trim(),
          cpf: cpfDigits,
          whatsapp: form.whatsapp.trim() || null,
          cadastroIncompleto: false,  // CPF preenchido manualmente → completo
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
        <div className="rounded-lg bg-gray-100 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm">
          <span className="text-gray-700 dark:text-gray-300">○ Pessoa inativa</span>
          {pessoa?.motivoInativacao && (
            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
              · {pessoa.motivoInativacao}
            </span>
          )}
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
      </div>

      {!isNew && (
        <div className="border-t border-gray-200 dark:border-gray-800 pt-3 flex flex-wrap gap-2">
          {!isInativa ? (
            <>
              {conviteUrl && (
                <Button
                  size="sm"
                  onClick={() => window.open(conviteUrl, "_blank", "noopener")}
                  title="Abre o WhatsApp com uma mensagem pronta pra essa pessoa criar a conta"
                  className="!bg-emerald-600 hover:!bg-emerald-700 !border-emerald-600"
                >
                  💬 Convidar via WhatsApp
                </Button>
              )}
              {podeVisualizarComo && pessoa && (
                <Button
                  size="sm"
                  onClick={() => {
                    startImpersonate(pessoa.id);
                    onClose();
                    navigate("/");
                  }}
                  title="Entra na tela como essa pessoa pra ver o que ela vê (master vê tudo, esse modo simula a visão limitada)"
                  className="!bg-amber-600 hover:!bg-amber-700 !border-amber-600"
                >
                  👁️ Visualizar como
                </Button>
              )}
              <Button variant="danger" size="sm" onClick={() => setShowInativar(true)}>
                🚫 Inativar pessoa
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={() => setShowReativar(true)}>
                ✓ Reativar pessoa
              </Button>
              {podeExcluir && (
                <Button variant="danger" size="sm" onClick={() => setShowExcluir(true)}>
                  🗑 Excluir definitivamente
                </Button>
              )}
            </>
          )}
          {!isInativa && !conviteUrl && (pessoa && (!pessoa.whatsapp || !pessoa.email)) && (
            <span className="text-xs text-gray-400 dark:text-gray-500 self-center">
              💬 Convite via WhatsApp: preencha {!pessoa.whatsapp && !pessoa.email ? "email e WhatsApp" : !pessoa.email ? "email" : "WhatsApp"} pra habilitar
            </span>
          )}
        </div>
      )}

      {isNew && (
        <p className="text-xs text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-2">
          📩 Após criar com email, peça pra pessoa acessar e clicar em <strong>"Criar conta"</strong> com a mesma senha.
          O sistema vincula automaticamente.
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
          onClose={() => { setShowInativar(false); onClose(); }}
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
                  Admissão: {empregado.admissaoAtual || "—"}
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
// TAB 3: PERMISSÕES
// ════════════════════════════════════════════════════════════════

function TabPermissoes({ pessoa, restaurantId }: { pessoa: Pessoa; restaurantId: string }) {
  const { restaurants } = useRestaurant();
  const activeRestaurant = restaurants.find(r => r.id === restaurantId);
  // Filtra módulos: só os IDs que existem no registry (ignora resíduos como "equipe" antigo)
  const modulosAtivos = useMemo(
    () => (activeRestaurant?.modulosAtivos || []).filter(id => getModule(id)),
    [activeRestaurant?.modulosAtivos],
  );
  const unidadesAtivas = (activeRestaurant?.unidades || []).filter(u => u.ativa);
  const usaMultiUnidades = unidadesAtivas.length > 1;

  const [perms, setPerms] = useState<Record<string, ModulePermission>>(
    (pessoa.permissions?.[restaurantId] as Record<string, ModulePermission>) || {}
  );
  const [pessoasExcluir, setPessoasExcluir] = useState<boolean>(
    pessoa.specialPermissions?.[restaurantId]?.pessoasExcluir === true
  );
  const [gorjetasConfigurarRegra, setGorjetasConfigurarRegra] = useState<boolean>(
    pessoa.specialPermissions?.[restaurantId]?.gorjetasConfigurarRegra === true
  );
  const [escalaReabrir, setEscalaReabrir] = useState<boolean>(
    pessoa.specialPermissions?.[restaurantId]?.escalaReabrir === true
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [erro, setErro] = useState("");

  // Estado "dirty" — true se o user mexeu em algo desde o último save / abertura.
  // Usado pra evitar resync com snapshot apagando edições locais não salvas.
  const [dirty, setDirty] = useState(false);

  // Resync com snapshot quando pessoa muda OU quando troca de restaurante,
  // MAS só se não tem edições locais pendentes (pra não estragar UX do user).
  useEffect(() => {
    if (dirty) return;
    setPerms((pessoa.permissions?.[restaurantId] as Record<string, ModulePermission>) || {});
    setPessoasExcluir(pessoa.specialPermissions?.[restaurantId]?.pessoasExcluir === true);
    setGorjetasConfigurarRegra(pessoa.specialPermissions?.[restaurantId]?.gorjetasConfigurarRegra === true);
    setEscalaReabrir(pessoa.specialPermissions?.[restaurantId]?.escalaReabrir === true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pessoa.id, restaurantId, pessoa.permissions, pessoa.specialPermissions]);

  // Templates do restaurante (pra o seletor "Aplicar template")
  const [templates, setTemplates] = useState<PermissionTemplate[]>([]);
  useEffect(() => {
    if (!restaurantId) return;
    const q = query(
      collection(db, "permissionTemplates"),
      where("restaurantId", "==", restaurantId),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as PermissionTemplate);
      setTemplates(list.filter(t => t.ativo).sort((a, b) =>
        (a.ordem ?? 999) - (b.ordem ?? 999) || a.nome.localeCompare(b.nome)
      ));
    });
    return () => unsub();
  }, [restaurantId]);

  function togglePerm(moduleId: string, kind: "ver" | "configurar") {
    setDirty(true);
    setPerms(p => {
      const cur = p[moduleId] || { ver: false, configurar: false };
      const next = { ...cur, [kind]: !cur[kind] };
      if (kind === "configurar" && next.configurar && !next.ver) next.ver = true;
      if (kind === "ver" && !next.ver) {
        next.configurar = false;
        // Sem acesso → limpa escopo de unidade também
        delete next.unidades;
      }
      return { ...p, [moduleId]: next };
    });
  }

  function toggleUnidadePerm(moduleId: string, unidadeId: string) {
    setDirty(true);
    setPerms(p => {
      const cur = p[moduleId] || { ver: false, configurar: false };
      const atual = cur.unidades || [];
      const next = { ...cur };
      if (atual.includes(unidadeId)) {
        const filtrado = atual.filter(u => u !== unidadeId);
        if (filtrado.length === 0) delete next.unidades;
        else next.unidades = filtrado;
      } else {
        next.unidades = [...atual, unidadeId];
      }
      return { ...p, [moduleId]: next };
    });
  }

  function limparEscopoUnidade(moduleId: string) {
    setDirty(true);
    setPerms(p => {
      const cur = p[moduleId];
      if (!cur) return p;
      const next = { ...cur };
      delete next.unidades;
      return { ...p, [moduleId]: next };
    });
  }

  function aplicarTemplate(templateId: string) {
    const t = templates.find(x => x.id === templateId);
    if (!t) return;
    if (!confirm(`Aplicar template "${t.nome}"? Isso SOBRESCREVE as permissões atuais.`)) return;
    setDirty(true);
    setPerms(t.permissions || {});
    setPessoasExcluir(!!t.specialPermissions?.pessoasExcluir);
    setGorjetasConfigurarRegra(!!t.specialPermissions?.gorjetasConfigurarRegra);
    setEscalaReabrir(!!t.specialPermissions?.escalaReabrir);
  }

  async function salvar() {
    setSaving(true);
    setErro("");
    try {
      const limpo: Record<string, ModulePermission> = {};
      Object.entries(perms).forEach(([k, v]) => {
        if (v.ver || v.configurar) limpo[k] = v;
      });
      // BUG histórico: setDoc com merge: true faz DEEP MERGE nos sub-mapas, então
      // chaves omitidas no novo `limpo` ficavam intactas no Firestore (impossível
      // "desmarcar" uma permissão). Usar dot-notation `permissions.<rid>` faz o
      // Firestore SUBSTITUIR o sub-mapa inteiro, mantendo outros restaurantes
      // intactos (merge ainda funciona no top-level pros outros campos do doc).
      const especiais = { pessoasExcluir, gorjetasConfigurarRegra, escalaReabrir };
      await updateDoc(doc(db, "pessoas", pessoa.id), {
        [`permissions.${restaurantId}`]: limpo,
        [`specialPermissions.${restaurantId}`]: especiais,
      });
      setSavedAt(new Date().toLocaleTimeString("pt-BR"));
      setDirty(false);
    } catch (e) {
      console.error("Erro ao salvar permissões:", e);
      const msg = e instanceof Error ? e.message : String(e);
      // Mensagem amigável pros casos mais comuns
      if (msg.includes("permission") || msg.includes("Missing or insufficient")) {
        setErro("Sem permissão pra editar permissões dessa pessoa. Só o master pode mexer aqui.");
      } else if (msg.includes("not-found") || msg.includes("No document to update")) {
        setErro("Pessoa não encontrada no banco. Feche e abra de novo.");
      } else {
        setErro("Erro ao salvar: " + msg);
      }
    } finally {
      setSaving(false);
    }
  }

  if (modulosAtivos.length === 0) {
    return (
      <p className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-3 py-2 rounded-lg">
        Nenhum módulo ativo neste restaurante. Ative módulos em Configurações antes de definir permissões.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Sistema NOVO de Perfis de Acesso — opcional por enquanto. Se a
          pessoa tem perfil atribuído, ele governa as ações granularmente.
          Sem perfil, cai no sistema antigo (ver/configurar abaixo). */}
      <PerfilAcessoSection pessoa={pessoa} restaurantId={restaurantId} />

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Marca o que essa pessoa pode neste restaurante. <strong>Configurar</strong> implica <strong>Ver</strong>.
        Sem nenhum check em todos = sem acesso a esse módulo.
      </p>

      {templates.length > 0 && (
        <div className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg px-3 py-2">
          <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">🎯 Aplicar template:</span>
          <select
            onChange={(e) => { if (e.target.value) { aplicarTemplate(e.target.value); e.target.value = ""; } }}
            value=""
            className="text-xs px-2 py-1 rounded border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-gray-900"
          >
            <option value="">— escolher —</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>{t.nome}</option>
            ))}
          </select>
          <span className="text-[10px] text-indigo-600 dark:text-indigo-400">sobrescreve o que tá marcado</span>
        </div>
      )}

      {/* Permissões agrupadas por etapa de maturidade: Estável, Beta, Em desenvolvimento.
          O agrupamento é só visual — não muda o que é salvo. */}
      {(["estavel", "beta", "em_desenvolvimento"] as const).map(grupo => {
        const modulosDoGrupo = modulosAtivos.filter(m => {
          const mod = getModule(m as ModuleId);
          if (!mod) return false;
          if (grupo === "estavel") return !mod.etapa;
          return mod.etapa === grupo;
        });
        if (modulosDoGrupo.length === 0) return null;

        const grupoLabel = grupo === "estavel"
          ? "Estável"
          : grupo === "beta"
          ? "🧪 Beta"
          : "🚧 Em desenvolvimento";
        const grupoDesc = grupo === "estavel"
          ? "Funcionalidades consolidadas — comportamento previsível"
          : grupo === "beta"
          ? "Funcionando, mas ainda recebendo ajustes — feedback bem-vindo"
          : "Em construção — comportamento pode mudar, bugs esperados";

        return (
          <div key={grupo} className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden bg-white dark:bg-gray-900">
            <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-800">
              <div className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                {grupoLabel}
              </div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{grupoDesc}</div>
            </div>
            <div className="grid grid-cols-[1fr_60px_80px] gap-2 px-3 py-2 bg-gray-50/50 dark:bg-gray-800/30 text-xs font-semibold text-gray-600 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
              <div>Módulo</div>
              <div className="text-center">Ver</div>
              <div className="text-center">Configurar</div>
            </div>
            {modulosDoGrupo.map(m => {
              const mod = getModule(m as ModuleId);
              if (!mod) return null;
              const p = perms[m] || { ver: false, configurar: false };
              const temAcessoNoModulo = p.ver || p.configurar;
              const mostrarEscopo = usaMultiUnidades && temAcessoNoModulo && unidadesAtivas.length > 0;
              const unidadesEscopoCount = p.unidades?.length || 0;
              return (
                <div key={m} className="border-t border-gray-100 dark:border-gray-800">
                  <div className="grid grid-cols-[1fr_60px_80px] gap-2 px-3 py-2 items-center text-sm">
                    <div className="text-gray-800 dark:text-gray-200 flex items-center gap-2">
                      <span className="text-base">{mod.icon}</span>
                      <span>{mod.label}</span>
                    </div>
                    <div className="text-center">
                      <input type="checkbox" checked={p.ver} onChange={() => togglePerm(m, "ver")} />
                    </div>
                    <div className="text-center">
                      <input type="checkbox" checked={p.configurar} onChange={() => togglePerm(m, "configurar")} />
                    </div>
                  </div>
                  {mostrarEscopo && (
                    <div className="px-3 pb-2 -mt-1 flex items-center gap-2 flex-wrap text-xs">
                      <span className="text-gray-500 dark:text-gray-400">🏢 Em:</span>
                      <button
                        type="button"
                        onClick={() => limparEscopoUnidade(m)}
                        className={`px-2 py-0.5 rounded-full transition-colors ${
                          unidadesEscopoCount === 0
                            ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 font-medium"
                            : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200"
                        }`}
                        title="Permite acessar dados de todas as unidades"
                      >
                        Todas
                      </button>
                      {unidadesAtivas.map(u => {
                        const selecionada = (p.unidades || []).includes(u.id);
                        return (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => toggleUnidadePerm(m, u.id)}
                            className={`px-2 py-0.5 rounded-full transition-colors ${
                              selecionada
                                ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 font-medium"
                                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200"
                            }`}
                          >
                            {selecionada ? "✓ " : ""}{u.nome}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-3 bg-rose-50/30 dark:bg-rose-900/10">
        <div className="text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400 mb-2">
          Permissões especiais
        </div>
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={pessoasExcluir}
              onChange={(e) => { setDirty(true); setPessoasExcluir(e.target.checked); }}
              className="mt-0.5"
            />
            <span className="flex-1">
              🗑️ Pode <strong>excluir definitivamente</strong> pessoas
              <span className="block text-xs text-gray-500">Perigoso — só pra usuários muito confiáveis (DP master).</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={gorjetasConfigurarRegra}
              onChange={(e) => { setDirty(true); setGorjetasConfigurarRegra(e.target.checked); }}
              className="mt-0.5"
            />
            <span className="flex-1">
              💸 Pode <strong>alterar regra de divisão de gorjeta</strong> (assembleia)
              <span className="block text-xs text-gray-500">Mesmo se tiver "Configurar" no módulo de Gorjetas, mexer na regra exige essa permissão extra.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={escalaReabrir}
              onChange={(e) => { setDirty(true); setEscalaReabrir(e.target.checked); }}
              className="mt-0.5"
            />
            <span className="flex-1">
              🔓 Pode <strong>reabrir mês de escala fechado</strong>
              <span className="block text-xs text-gray-500">Reabrir afeta gorjetas/VT já calculados — operação rara.</span>
            </span>
          </label>
        </div>
      </div>

      {erro && (
        <div className="rounded-lg bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
          ⚠️ {erro}
        </div>
      )}
      {dirty && !erro && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          Você tem alterações não salvas. Clique em <strong>Salvar permissões</strong> abaixo.
        </div>
      )}

      <div className="flex justify-end gap-3 items-center pt-3 border-t border-gray-200 dark:border-gray-800">
        <span className="text-xs text-emerald-600">{savedAt && !dirty && `✓ Salvo às ${savedAt}`}</span>
        <Button onClick={salvar} disabled={saving || !dirty}>{saving ? "..." : "Salvar permissões"}</Button>
      </div>
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
