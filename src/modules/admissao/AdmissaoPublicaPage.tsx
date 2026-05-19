// ════════════════════════════════════════════════════════════════════════════
//  Página pública /admissao/:token — formulário que o candidato preenche.
//  Sem auth do Firebase. Acesso via token na URL + confirmação de email
//  cadastrado pelo RH. Timer visível, auto-save debounced.
//
//  Esta versão inicial busca/atualiza o doc direto via Firestore (regras
//  permissivas pra esse path enquanto auth não é obrigatória — vide
//  firestore.rules). Próxima iteração: endpoints Vercel pra validação
//  server-side.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  collection, doc, getDocs, query, setDoc, where,
} from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import {
  linkWhatsAppDP,
  statusEstaExpirada,
} from "../../core/admissao/admissaoHelpers";
import type { Admissao, FormField } from "../../core/types";

// IDs do schema cujos valores vêm do cadastro inicial do RH e NÃO podem ser
// editados pelo candidato. Se a admissão usa um schema customizado que não
// inclui esses ids, simplesmente não há lock (campos só do candidato).
const IDS_CONFIRMADOS = ["nome_completo", "cpf", "email_recibo", "whatsapp"] as const;

function mapaConfirmados(adm: Admissao): Record<string, string> {
  // CPF formatado pra leitura. Mantém só dígitos quando submeter — Firestore
  // recebe o que estiver em dados[id], então preserva como string fmt aqui.
  const cpfFmt = adm.candidato.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  const whatsFmt = (() => {
    const d = adm.candidato.whatsapp.replace(/\D/g, "");
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return d;
  })();
  return {
    nome_completo: adm.candidato.nome,
    cpf: cpfFmt,
    email_recibo: adm.candidato.email,
    whatsapp: whatsFmt,
  };
}

function isConfirmado(fieldId: string): boolean {
  return (IDS_CONFIRMADOS as readonly string[]).includes(fieldId);
}

function fmtDataBr(ymd: string): string {
  const [a, m, d] = ymd.split("-");
  if (!a || !m || !d) return ymd;
  return `${d}/${m}/${a}`;
}

function onlyDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

// Tempo restante até a expiração, formatado como HH:MM:SS ou Xd HH:MM:SS.
function fmtCountdown(ms: number): string {
  if (ms <= 0) return "expirado";
  const seg = Math.floor(ms / 1000) % 60;
  const min = Math.floor(ms / 60_000) % 60;
  const hor = Math.floor(ms / 3_600_000) % 24;
  const dias = Math.floor(ms / 86_400_000);
  const hh = String(hor).padStart(2, "0");
  const mm = String(min).padStart(2, "0");
  const ss = String(seg).padStart(2, "0");
  return dias > 0 ? `${dias}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

export function AdmissaoPublicaPage() {
  const { token } = useParams<{ token: string }>();
  const [admissao, setAdmissao] = useState<Admissao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  // Dados do restaurante vêm do snapshot dentro da admissão (não busca
  // /restaurants pra não exigir regra pública nessa coleção).
  const restSnapshot = admissao?.restaurantSnapshot;
  const restNome = restSnapshot?.nome || "";
  const whatsappDP = restSnapshot?.whatsappDP;

  // Etapa 1: confirmação de email
  const [emailInput, setEmailInput] = useState("");
  const [authed, setAuthed] = useState(false);

  // Etapa 2: preenchimento
  const [dados, setDados] = useState<Record<string, unknown>>({});
  const [enviando, setEnviando] = useState(false);
  const [salvandoAuto, setSalvandoAuto] = useState(false);

  // ─── Carrega admissão pelo token + restaurante ───────────────────────────
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const q = query(collection(db, "admissoes"), where("token", "==", token));
        const snap = await getDocs(q);
        if (snap.empty) {
          if (!cancelled) {
            setErro("Link inválido ou expirado.");
            setCarregando(false);
          }
          return;
        }
        const adm = { id: snap.docs[0].id, ...snap.docs[0].data() } as Admissao;
        if (cancelled) return;
        setAdmissao(adm);
        // Pré-preenche os campos confirmados pelo RH. Se já tinha valor antigo
        // no dadosPreenchidos, o do RH sobrescreve — fonte de verdade do
        // cadastro inicial é a admissão.candidato.
        const inicial: Record<string, unknown> = {
          ...((adm.dadosPreenchidos as Record<string, unknown>) || {}),
          ...mapaConfirmados(adm),
        };
        setDados(inicial);
      } catch (e) {
        if (!cancelled) setErro(e instanceof Error ? e.message : "Erro ao carregar.");
      } finally {
        if (!cancelled) setCarregando(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // ─── Timer ────────────────────────────────────────────────────────────────
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const expirado = admissao ? statusEstaExpirada(admissao, now) : false;
  const msRestantes = useMemo(() => {
    if (!admissao?.expiraEm) return 0;
    return new Date(admissao.expiraEm).getTime() - now;
  }, [admissao?.expiraEm, now]);

  // ─── Auto-save (debounced 1.5s) ──────────────────────────────────────────
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!authed || !admissao) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void salvarParcial(dados);
    }, 1500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados, authed]);

  async function salvarParcial(d: Record<string, unknown>) {
    if (!admissao) return;
    setSalvandoAuto(true);
    try {
      await setDoc(
        doc(db, "admissoes", admissao.id),
        { dadosPreenchidos: d, updatedAt: new Date().toISOString() },
        { merge: true },
      );
    } catch (e) {
      console.warn("Erro auto-save:", e);
    } finally {
      setSalvandoAuto(false);
    }
  }

  // ─── Confirmação de email ────────────────────────────────────────────────
  function tentarDestrancar() {
    if (!admissao) return;
    const inputD = emailInput.trim().toLowerCase();
    if (inputD === admissao.candidato.email.toLowerCase()) {
      setAuthed(true);
      setErro("");
    } else {
      setErro("E-mail não confere com o cadastrado pela empresa.");
    }
  }

  // ─── Submit final ────────────────────────────────────────────────────────
  async function submeter() {
    if (!admissao) return;
    // Validação dos campos obrigatórios
    const faltando: string[] = [];
    for (const f of admissao.schemaUsado) {
      if (!f.obrigatorio || !f.ativo) continue;
      const v = dados[f.id];
      if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) {
        faltando.push(f.label);
      }
    }
    if (faltando.length > 0) {
      alert(`Preencha os campos obrigatórios:\n• ${faltando.slice(0, 8).join("\n• ")}${faltando.length > 8 ? `\n… +${faltando.length - 8}` : ""}`);
      return;
    }
    setEnviando(true);
    try {
      const now = new Date().toISOString();
      await setDoc(
        doc(db, "admissoes", admissao.id),
        {
          dadosPreenchidos: dados,
          status: "formulario_preenchido",
          preenchidoEm: now,
          updatedAt: now,
        },
        { merge: true },
      );
      setAdmissao({ ...admissao, dadosPreenchidos: dados, status: "formulario_preenchido", preenchidoEm: now });
    } catch (e) {
      alert("Erro ao enviar: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setEnviando(false);
    }
  }

  function updateCampo(id: string, value: unknown) {
    setDados((cur) => ({ ...cur, [id]: value }));
    // Ao terminar de digitar um CEP (8 dígitos), busca ViaCEP e auto-preenche
    // rua/bairro/cidade/estado. Sem bloqueio nem aviso pesado se falhar.
    if (id === "endereco_cep" && typeof value === "string") {
      const d = value.replace(/\D/g, "");
      if (d.length === 8) void buscarCep(d);
    }
  }

  async function buscarCep(cep: string) {
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      if (!r.ok) return;
      const data = await r.json() as {
        erro?: boolean;
        logradouro?: string;
        bairro?: string;
        localidade?: string;
        uf?: string;
      };
      if (data.erro) return;
      setDados((cur) => ({
        ...cur,
        endereco_logradouro: data.logradouro || cur.endereco_logradouro || "",
        endereco_bairro:     data.bairro     || cur.endereco_bairro     || "",
        endereco_cidade:     data.localidade || cur.endereco_cidade     || "",
        endereco_estado:     data.uf         || cur.endereco_estado     || "",
      }));
    } catch {
      // Sem internet ou ViaCEP fora do ar — candidato preenche manualmente
    }
  }

  // ─── Render: estados especiais ───────────────────────────────────────────
  if (carregando) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">
        Carregando…
      </div>
    );
  }
  if (erro && !admissao) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md text-center bg-white border border-rose-200 rounded-2xl p-8 shadow-sm">
          <div className="text-5xl mb-3">🚫</div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">{erro}</h2>
          <p className="text-sm text-gray-600">Peça um novo link à equipe que está cuidando da sua admissão.</p>
        </div>
      </div>
    );
  }
  if (!admissao) return null;

  if (admissao.status === "cancelada") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md text-center bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
          <div className="text-5xl mb-3">⛔</div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">Admissão cancelada</h2>
          <p className="text-sm text-gray-600">Essa admissão foi cancelada. Em caso de dúvida, fale com o time da empresa.</p>
        </div>
      </div>
    );
  }
  if (expirado || admissao.status === "expirada") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md text-center bg-white border border-rose-200 rounded-2xl p-8 shadow-sm">
          <div className="text-5xl mb-3">⏱️</div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">Link expirado</h2>
          <p className="text-sm text-gray-600">O prazo de preenchimento acabou. Peça um novo link à equipe.</p>
        </div>
      </div>
    );
  }
  if (admissao.status !== "formulario_enviado" && admissao.status !== "formulario_preenchido") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md text-center bg-white border border-emerald-200 rounded-2xl p-8 shadow-sm">
          <div className="text-5xl mb-3">✅</div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">Admissão em andamento</h2>
          <p className="text-sm text-gray-600">Seus dados já foram recebidos. Aguarde contato da equipe.</p>
        </div>
      </div>
    );
  }

  // Etapa de autenticação
  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50">
        <div className="max-w-md w-full bg-white border border-gray-200 rounded-2xl p-8 shadow-sm space-y-4">
          <div className="text-center">
            <div className="text-5xl mb-3">🪪</div>
            <h1 className="text-xl font-bold text-gray-900">Ficha de admissão</h1>
            <p className="text-sm text-gray-600 mt-1">
              {restNome ? `${restNome} ·` : ""} Confirme seu e-mail pra começar a preencher.
            </p>
          </div>
          <Input
            label="Seu e-mail (o mesmo que você forneceu pra empresa)"
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="email@dominio.com"
            autoFocus
          />
          {erro && <div className="text-xs text-rose-600">{erro}</div>}
          <Button onClick={tentarDestrancar} className="w-full">
            Continuar
          </Button>
          {admissao.expiraEm && (
            <div className="text-center text-[11px] text-gray-500">
              Tempo restante: <strong className="font-mono">{fmtCountdown(msRestantes)}</strong>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Já foi submetido — mostra confirmação
  if (admissao.status === "formulario_preenchido") {
    return <FormSubmitido admissao={admissao} restNome={restNome} whatsappDP={whatsappDP} />;
  }

  // ─── Form completo (já authenticated) ────────────────────────────────────
  const gruposOrdenados = agruparPorGrupo(admissao.schemaUsado);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header com timer */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 shadow-sm">
        <div className="max-w-2xl mx-auto flex items-center justify-between flex-wrap gap-2">
          <div className="min-w-0">
            <h1 className="font-bold text-gray-900 truncate">
              🪪 Ficha de admissão · {restNome}
            </h1>
            <div className="text-[11px] text-gray-500">
              Olá, {admissao.candidato.nome.split(" ")[0]}!
              {salvandoAuto && <span className="ml-2 text-indigo-600">💾 salvando…</span>}
            </div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-center">
            <div className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold">
              Tempo pra preencher
            </div>
            <div className="text-lg font-bold text-amber-700 font-mono tabular-nums">
              {fmtCountdown(msRestantes)}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* Aviso geral sobre os dados pré-confirmados */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-900">
          🔒 Os campos com cadeado já foram preenchidos pela empresa
          (<strong>nome, CPF, e-mail, WhatsApp</strong>). Se algum estiver errado,
          {whatsappDP ? <> avise pelo WhatsApp no botão "Enviar documentos" abaixo</> : <> avise a equipe que está cuidando da sua admissão</>}
          {" "}— eles corrigem aqui e o seu link continua válido.
        </div>

        {gruposOrdenados.map(({ grupo, campos }) => (
          <section key={grupo} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h2 className="font-bold text-sm text-gray-900 border-b border-gray-100 pb-2">
              {grupo}
            </h2>
            {campos.map((f) => (
              <CampoRender
                key={f.id}
                field={f}
                bloqueado={isConfirmado(f.id)}
                value={dados[f.id]}
                onChange={(v) => updateCampo(f.id, v)}
              />
            ))}
          </section>
        ))}

        {/* Bloco de envio de documentos via WhatsApp */}
        {whatsappDP && (
          <DocumentosWhatsBlock
            admissao={admissao}
            whatsappDP={whatsappDP}
            restNome={restNome}
          />
        )}

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <Button onClick={submeter} disabled={enviando} className="w-full">
            {enviando ? "Enviando…" : "✅ Enviar ficha"}
          </Button>
          <p className="text-[11px] text-gray-500 text-center mt-2">
            Os dados que você preencheu são salvos automaticamente. Pode fechar e voltar depois
            dentro do prazo.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function agruparPorGrupo(schema: FormField[]): { grupo: string; campos: FormField[] }[] {
  const ativos = schema.filter((f) => f.ativo).sort((a, b) => a.ordem - b.ordem);
  const map = new Map<string, FormField[]>();
  for (const f of ativos) {
    const arr = map.get(f.grupo) || [];
    arr.push(f);
    map.set(f.grupo, arr);
  }
  return Array.from(map.entries()).map(([grupo, campos]) => ({ grupo, campos }));
}

function CampoRender({
  field,
  value,
  onChange,
  bloqueado = false,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  bloqueado?: boolean;
}) {
  // Campos bloqueados sempre mostram cadeado. Label com asterisco se obrigatório.
  const labelBase = field.obrigatorio ? `${field.label} *` : field.label;
  const labelComObr = bloqueado ? `🔒 ${labelBase}` : labelBase;
  const v = value == null ? "" : value;

  if (field.tipo === "textarea") {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-gray-600">{labelComObr}</label>
        <textarea
          value={v as string}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={3}
          readOnly={bloqueado}
          className={`px-3 py-2 text-sm rounded-lg border border-gray-300 ${bloqueado ? "bg-gray-100 text-gray-600 cursor-not-allowed" : "bg-white"}`}
        />
        {field.ajuda && <span className="text-[11px] text-gray-500">{field.ajuda}</span>}
      </div>
    );
  }
  if (field.tipo === "select") {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-gray-600">{labelComObr}</label>
        <select
          value={v as string}
          onChange={(e) => onChange(e.target.value)}
          disabled={bloqueado}
          className={`px-3 py-2 text-sm rounded-lg border border-gray-300 ${bloqueado ? "bg-gray-100 text-gray-600 cursor-not-allowed" : "bg-white"}`}
        >
          <option value="">— selecione —</option>
          {(field.opcoes || []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
        {field.ajuda && <span className="text-[11px] text-gray-500">{field.ajuda}</span>}
      </div>
    );
  }
  if (field.tipo === "boolean") {
    return (
      <label className={`flex items-center gap-2 text-sm select-none ${bloqueado ? "opacity-70" : ""}`}>
        <input
          type="checkbox"
          checked={!!v}
          onChange={(e) => onChange(e.target.checked)}
          disabled={bloqueado}
          className="accent-indigo-600"
        />
        <span>{labelComObr}</span>
      </label>
    );
  }
  if (field.tipo === "lista_dependentes") {
    return <ListaDependentesField field={field} value={value} onChange={onChange} />;
  }
  if (field.tipo === "lista_transporte") {
    return <ListaTransporteField field={field} value={value} onChange={onChange} />;
  }
  // text/email/telefone/cpf/data/numero — todos input padrão
  const inputType =
    field.tipo === "email" ? "email" :
    field.tipo === "data" ? "date" :
    field.tipo === "numero" ? "number" :
    field.tipo === "telefone" || field.tipo === "cpf" ? "tel" :
    "text";
  return (
    <Input
      label={labelComObr}
      type={inputType}
      value={v as string}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      inputMode={field.tipo === "numero" ? "decimal" : field.tipo === "telefone" || field.tipo === "cpf" ? "numeric" : undefined}
      readOnly={bloqueado}
      className={bloqueado ? "bg-gray-100 text-gray-600 cursor-not-allowed" : ""}
    />
  );
}

type Dependente = { nome: string; nascimento: string; cpf: string; parentesco: string; depIR: boolean };

function ListaDependentesField({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const lista = (Array.isArray(value) ? value : []) as Dependente[];
  function add() {
    onChange([...lista, { nome: "", nascimento: "", cpf: "", parentesco: "", depIR: false }]);
  }
  function up(i: number, patch: Partial<Dependente>) {
    const next = lista.map((d, idx) => idx === i ? { ...d, ...patch } : d);
    onChange(next);
  }
  function rm(i: number) {
    onChange(lista.filter((_, idx) => idx !== i));
  }
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-gray-600">{field.label}</label>
      {field.ajuda && <span className="text-[11px] text-gray-500">{field.ajuda}</span>}
      <div className="space-y-2">
        {lista.map((d, i) => (
          <div key={i} className="border border-gray-200 rounded-lg p-2 space-y-1.5 bg-gray-50/50">
            <div className="grid grid-cols-2 gap-2">
              <Input label="Nome" value={d.nome} onChange={(e) => up(i, { nome: e.target.value })} />
              <Input label="Nascimento" type="date" value={d.nascimento} onChange={(e) => up(i, { nascimento: e.target.value })} />
              <Input label="CPF" value={d.cpf} onChange={(e) => up(i, { cpf: e.target.value })} placeholder="000.000.000-00" />
              <Input label="Parentesco" value={d.parentesco} onChange={(e) => up(i, { parentesco: e.target.value })} placeholder="Filho(a), cônjuge…" />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={d.depIR}
                onChange={(e) => up(i, { depIR: e.target.checked })}
                className="accent-indigo-600"
              />
              <span>Será dependente de Imposto de Renda</span>
            </label>
            <button
              type="button"
              onClick={() => rm(i)}
              className="text-[11px] text-rose-600 hover:underline"
            >
              Remover
            </button>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={add}>+ adicionar dependente</Button>
      </div>
    </div>
  );
}

type Transporte = { tipo: string; itinerario: string; tarifa: string; qtde: string };

function ListaTransporteField({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const lista = (Array.isArray(value) ? value : []) as Transporte[];
  function add() {
    onChange([...lista, { tipo: "", itinerario: "", tarifa: "", qtde: "" }]);
  }
  function up(i: number, patch: Partial<Transporte>) {
    const next = lista.map((t, idx) => idx === i ? { ...t, ...patch } : t);
    onChange(next);
  }
  function rm(i: number) {
    onChange(lista.filter((_, idx) => idx !== i));
  }
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-gray-600">{field.label}</label>
      {field.ajuda && <span className="text-[11px] text-gray-500">{field.ajuda}</span>}
      <div className="space-y-2">
        {lista.map((t, i) => (
          <div key={i} className="border border-gray-200 rounded-lg p-2 space-y-1.5 bg-gray-50/50">
            <div className="grid grid-cols-2 gap-2">
              <Input label="Tipo" value={t.tipo} onChange={(e) => up(i, { tipo: e.target.value })} placeholder="Ônibus, Metrô…" />
              <Input label="Itinerário" value={t.itinerario} onChange={(e) => up(i, { itinerario: e.target.value })} placeholder="Trabalho/Residência" />
              <Input label="Tarifa (R$)" value={t.tarifa} onChange={(e) => up(i, { tarifa: e.target.value })} inputMode="decimal" />
              <Input label="Quantidade/dia" value={t.qtde} onChange={(e) => up(i, { qtde: e.target.value })} inputMode="numeric" />
            </div>
            <button
              type="button"
              onClick={() => rm(i)}
              className="text-[11px] text-rose-600 hover:underline"
            >
              Remover
            </button>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={add}>+ adicionar trecho</Button>
      </div>
    </div>
  );
}

function FormSubmitido({
  admissao,
  restNome,
  whatsappDP,
}: {
  admissao: Admissao;
  restNome: string;
  whatsappDP?: string;
}) {
  const linkDocs = whatsappDP
    ? linkWhatsAppDP(whatsappDP, admissao.candidato.nome, admissao.candidato.cpf, restNome)
    : null;
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8">
      <div className="max-w-md w-full bg-white border border-emerald-200 rounded-2xl p-8 shadow-sm text-center">
        <div className="text-5xl mb-3">✅</div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Ficha enviada!</h1>
        <p className="text-sm text-gray-600">
          Recebemos seus dados, {admissao.candidato.nome.split(" ")[0]}. Agora só falta enviar
          fotos dos seus documentos pelo WhatsApp.
        </p>
        {linkDocs && (
          <a
            href={linkDocs}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-5 px-5 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm"
          >
            📱 Enviar documentos via WhatsApp
          </a>
        )}
        <p className="text-[11px] text-gray-500 mt-5">
          Documentos comuns: RG (frente/verso), CPF, comprovante de residência, foto 3x4,
          CTPS (página rosto + identificação) e certidão dos dependentes (se houver).
        </p>
      </div>
    </div>
  );
}

function DocumentosWhatsBlock({
  admissao,
  whatsappDP,
  restNome,
}: {
  admissao: Admissao;
  whatsappDP: string;
  restNome: string;
}) {
  const link = linkWhatsAppDP(whatsappDP, admissao.candidato.nome, admissao.candidato.cpf, restNome);
  if (!link) return null;
  return (
    <section className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
      <h2 className="font-bold text-sm text-emerald-900 mb-1">📱 Envio dos documentos</h2>
      <p className="text-xs text-emerald-900/80 mb-3">
        Os documentos (RG, CPF, comprovante de residência, foto 3x4, CTPS) serão enviados por
        WhatsApp pra equipe que cuida da sua admissão. Você pode mandar agora ou depois de
        terminar a ficha.
      </p>
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm"
      >
        📱 Enviar documentos via WhatsApp
      </a>
    </section>
  );
}

// Helper pra silenciar warning de import (fmtDataBr reservado pra evoluções)
void fmtDataBr;
void onlyDigits;
