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
  collection, getDocs, query, where,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes } from "firebase/storage";
import { db, storage } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import {
  buscarUltimaAdmissaoAprovadaDaPessoa,
  linkWhatsAppDP,
  statusEstaExpirada,
} from "../../core/admissao/admissaoHelpers";
import { DOCUMENTOS_ADMISSAO_DEFAULT } from "../../core/admissao/formTemplate";
import type {
  Admissao, DocumentoAdmissaoArquivo, DocumentoAdmissaoDef,
  DocumentoAdmissaoEnvio, FormField,
} from "../../core/types";

// Texto da declaração de veracidade — salvo junto da admissão como snapshot
// pra histórico jurídico (se mudar o texto futuramente, admissões antigas
// mantêm o texto que o candidato realmente leu).
const TEXTO_DECLARACAO =
  "Declaro que todas as informações preenchidas neste formulário são verdadeiras e corretas. " +
  "Estou ciente de que sou totalmente responsável pelos dados informados e que informações falsas " +
  "podem acarretar em consequências legais, incluindo o cancelamento do processo de admissão " +
  "e demais providências cabíveis.";

// Redimensiona uma imagem File pro tamanho máximo + qualidade JPEG e devolve
// como data URL base64. Mantém aspect ratio. Default: 800px lado maior, qty 0.7.
async function comprimirImagem(file: File, maxLado = 800, quality = 0.7): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    let w = img.width;
    let h = img.height;
    if (w > h && w > maxLado) { h = Math.round((h * maxLado) / w); w = maxLado; }
    else if (h > maxLado)     { w = Math.round((w * maxLado) / h); h = maxLado; }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponível");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// IDs do schema cujos valores vêm do cadastro inicial do RH e NÃO podem ser
// editados pelo candidato. Se a admissão usa um schema customizado que não
// inclui esses ids, simplesmente não há lock (campos só do candidato).
export const IDS_CONFIRMADOS = ["nome_completo", "cpf", "email_recibo", "whatsapp"] as const;

export function mapaConfirmados(adm: Admissao): Record<string, string> {
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

export function isConfirmado(fieldId: string): boolean {
  return (IDS_CONFIRMADOS as readonly string[]).includes(fieldId);
}

// Verifica se um valor está "vazio" pra fim de validação obrigatória.
// Considera tipo do campo: naturalidade exige uf + cidade preenchidos.
export function vazio(v: unknown, tipo: string): boolean {
  if (v == null || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (tipo === "naturalidade" && typeof v === "object") {
    const o = v as { uf?: string; cidade?: string };
    return !o.uf || !o.cidade;
  }
  return false;
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

  // Declaração final + selfie de validação (não fazem parte do schema —
  // sempre obrigatórios)
  const [selfieDataUrl, setSelfieDataUrl] = useState<string | null>(null);
  const [declaracaoAceita, setDeclaracaoAceita] = useState(false);
  // Ciência obrigatória sobre conta Itaú (bloqueia submit se não marcada).
  const [cienteContaItau, setCienteContaItau] = useState(false);

  // Documentos: lista congelada no snapshot da admissão (ou default). Cada
  // item é resolvido pelo candidato (anexa arquivo OU "não se aplica" +
  // justificativa). Estado keyed por docId.
  const docDefs: DocumentoAdmissaoDef[] = useMemo(
    () =>
      (admissao?.restaurantSnapshot?.documentosAdmissao || DOCUMENTOS_ADMISSAO_DEFAULT)
        .filter((d) => d.ativo),
    [admissao?.restaurantSnapshot?.documentosAdmissao],
  );
  const [docResol, setDocResol] = useState<Record<string, DocumentoAdmissaoEnvio>>({});

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

        // Pré-preenche em camadas (do mais antigo pro mais novo — o último
        // sobrescreve):
        //   1. Admissão anterior aprovada dessa Pessoa (se houver) — reusa
        //      dados que ela já preencheu numa admissão passada (mudança de
        //      restaurante, freela virou fixo, etc). Candidato pode editar.
        //   2. dadosPreenchidos da admissão atual — auto-save local
        //   3. Campos confirmados pelo RH no IniciarAdmissaoModal (cadastro
        //      básico nome/CPF/email/whatsapp) — fonte de verdade, bloqueia.
        const inicial: Record<string, unknown> = {};
        if (adm.pessoaIdVinculada && !adm.preenchidoEm) {
          // Só busca o histórico quando candidato ainda não submeteu —
          // depois disso, dados atuais são o que importa.
          const antiga = await buscarUltimaAdmissaoAprovadaDaPessoa(adm.pessoaIdVinculada, adm.id);
          if (antiga?.dadosPreenchidos) {
            Object.assign(inicial, antiga.dadosPreenchidos);
          }
        }
        Object.assign(inicial, (adm.dadosPreenchidos as Record<string, unknown>) || {});
        Object.assign(inicial, mapaConfirmados(adm));
        setDados(inicial);
      } catch (e) {
        if (!cancelled) setErro(e instanceof Error ? e.message : "Erro ao carregar.");
      } finally {
        if (!cancelled) setCarregando(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Hidrata resoluções de documentos já submetidas (resume após reload).
  useEffect(() => {
    const itens = admissao?.documentos?.itens;
    if (itens && itens.length > 0) {
      const map: Record<string, DocumentoAdmissaoEnvio> = {};
      for (const it of itens) map[it.docId] = it;
      setDocResol(map);
    }
  }, [admissao?.id, admissao?.documentos?.itens]);

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
      const r = await fetch("/api/admissao-submit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ admissaoId: admissao.id, token, dadosPreenchidos: d }),
      });
      if (!r.ok) { const j = await r.json().catch(() => null); throw new Error(j?.error || `HTTP ${r.status}`); }
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
      if (vazio(v, f.tipo)) faltando.push(f.label);
    }
    if (faltando.length > 0) {
      alert(`Preencha os campos obrigatórios:\n• ${faltando.slice(0, 8).join("\n• ")}${faltando.length > 8 ? `\n… +${faltando.length - 8}` : ""}`);
      return;
    }
    // Cross-field: se marcou que tem dependentes legais, exige pelo menos
    // 1 dependente COM nome+nascimento+parentesco preenchidos. Nem todo
    // filho é dependente — depende da situação fiscal/jurídica.
    if (dados.tem_dependentes_legais === true) {
      const deps = (Array.isArray(dados.dependentes) ? dados.dependentes : []) as Dependente[];
      const validos = deps.filter((d) => d?.nome?.trim() && d?.nascimento && d?.parentesco?.trim());
      if (validos.length === 0) {
        alert(
          `Você marcou que tem dependentes legais — adicione os dados de pelo menos 1 dependente no bloco "Dependentes" (nome, data de nascimento e parentesco).`,
        );
        return;
      }
    }
    // Bloco final: declaração + selfie + ciências (Itaú + docs WhatsApp)
    if (!declaracaoAceita) {
      alert("Você precisa aceitar a declaração de veracidade pra enviar a ficha.");
      return;
    }
    if (!selfieDataUrl) {
      alert("Tire a foto pra ficha cadastral pra concluir o envio.");
      return;
    }
    if (!cienteContaItau) {
      alert("Confirme a situação da sua conta bancária no bloco 🏦 (abrir conta Itaú ou confirmar os dados Itaú).");
      return;
    }
    // Documentos: cada item precisa estar resolvido (anexado OU justificado).
    const erroDoc = validarDocumentos(docDefs, docResol);
    if (erroDoc) {
      alert(erroDoc);
      return;
    }
    setEnviando(true);
    try {
      const now = new Date().toISOString();
      // selfie vai pro Storage pelo endpoint (não embutida no doc) — só metadados aqui.
      const validacao = {
        declaracaoEm: now,
        declaracaoTexto: TEXTO_DECLARACAO,
        ciencias: {
          contaItau: { aceita: true, em: now },
        },
      };
      // Monta os itens de documentos resolvidos pelo candidato, na ordem da
      // lista configurada (snapshot do nome pra histórico). Sem chaves
      // undefined — Firestore rejeita (justificativa só quando existe).
      const documentos = {
        itens: docDefs.map((d) => {
          const r = docResol[d.id];
          const just = r?.justificativa?.trim();
          const item: DocumentoAdmissaoEnvio = {
            docId: d.id,
            nome: d.nome,
            resolucao: r?.resolucao || "nao_se_aplica",
            arquivos: r?.arquivos || [],
          };
          if (just && item.resolucao !== "anexado") item.justificativa = just;
          return item;
        }),
        enviadoEm: now,
      };
      // Se candidato já tem conta Itaú, popula dadosBancariosItau no doc
      // da admissão — depois usado pela mensagem de instruções (pula o
      // bloco 2 de abertura de conta) e pela subtarefa de cadastrar no
      // banco. Default tipo = corrente; RH pode mudar pra salário no drawer.
      const jaTemItau = dados.banco_tipo === "Já tenho conta no Itaú";
      const dadosBancariosItau = jaTemItau ? {
        tipo: "corrente" as const,
        agencia: typeof dados.banco_agencia === "string" ? dados.banco_agencia : "",
        conta:   typeof dados.banco_conta   === "string" ? dados.banco_conta   : "",
      } : undefined;

      // Aplica auto-triggers nas subtarefas: form_preenchido (sempre) e
      // dados_bancarios_itau_recebidos (se candidato preencheu conta Itaú).
      const triggersAtivos = new Set<string>(["form_preenchido"]);
      if (jaTemItau && dadosBancariosItau?.agencia && dadosBancariosItau?.conta) {
        triggersAtivos.add("dados_bancarios_itau_recebidos");
      }
      const subtarefas = (admissao.subtarefas || []).map((s) =>
        s.autoTrigger && triggersAtivos.has(s.autoTrigger) && !s.feita
          ? {
              ...s,
              feita: true,
              feitaEm: now,
              feitaPor: { id: "candidato", nome: admissao.candidato.nome },
            }
          : s,
      );
      const r = await fetch("/api/admissao-submit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          admissaoId: admissao.id, token, final: true,
          dadosPreenchidos: dados,
          documentos,
          validacao,
          selfieBase64: selfieDataUrl,
          ...(subtarefas.length > 0 ? { subtarefas } : {}),
          ...(dadosBancariosItau ? { dadosBancariosItau } : {}),
        }),
      });
      const jr = await r.json().catch(() => null);
      if (!r.ok) throw new Error(jr?.error || `HTTP ${r.status}`);
      const validacaoFinal = jr?.selfieUrl ? { ...validacao, selfieUrl: jr.selfieUrl } : validacao;
      setAdmissao({
        ...admissao,
        dadosPreenchidos: dados,
        status: "formulario_preenchido",
        preenchidoEm: now,
        validacao: validacaoFinal,
        documentos,
        subtarefas,
        ...(dadosBancariosItau ? { dadosBancariosItau } : {}),
      });
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

  // Cross-field context: se candidato marcou que tem dependentes legais,
  // o bloco "Dependentes" vira obrigatório (pelo menos 1 cadastrado).
  const exigeDependentes = dados.tem_dependentes_legais === true;
  // Candidato pode marcar que não usa transporte público — esconde a lista
  // de transportes e ignora obrigatoriedade.
  const vtNaoUtiliza = dados.vt_nao_utiliza === true;

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
                ctx={{ exigeDependentes, vtNaoUtiliza }}
              />
            ))}
          </section>
        ))}

        {/* Box: ciência conta Itaú */}
        <CienciaContaItauBox
          bancoTipo={dados.banco_tipo}
          aceita={cienteContaItau}
          onChange={setCienteContaItau}
        />

        {/* Último bloco: upload dos documentos (anexar ou justificar) */}
        <DocumentosUploadSection
          rid={admissao.restaurantId}
          admissaoId={admissao.id}
          docDefs={docDefs}
          valor={docResol}
          onChange={setDocResol}
        />

        {/* Bloco final: selfie + declaração de veracidade */}
        <DeclaracaoFinalBlock
          selfieDataUrl={selfieDataUrl}
          onSelfieChange={setSelfieDataUrl}
          declaracaoAceita={declaracaoAceita}
          onDeclaracaoChange={setDeclaracaoAceita}
          candidatoNome={admissao.candidato.nome}
        />

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          {(() => {
            const pend: string[] = [];
            if (!cienteContaItau) pend.push("Confirme a situação da sua conta bancária (bloco 🏦).");
            const docsPendentes = docDefs.filter((d) => {
              const r = docResol[d.id];
              if (!r || !r.resolucao) return true;
              if (r.resolucao === "anexado") return (r.arquivos?.length || 0) === 0;
              return !r.justificativa?.trim();
            }).length;
            if (docsPendentes > 0) {
              pend.push(`Responda os ${docsPendentes} documento(s) pendente(s) no bloco 📎 — anexe o arquivo ou marque "não tenho / não se aplica" e explique o motivo.`);
            }
            if (!selfieDataUrl) pend.push("Tire a foto pra ficha cadastral.");
            if (!declaracaoAceita) pend.push("Aceite a declaração de veracidade.");
            if (pend.length === 0) {
              return (
                <div className="mb-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-2 text-center font-medium">
                  ✓ Tudo certo — pode enviar a ficha.
                </div>
              );
            }
            return (
              <div className="mb-3 text-xs bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div className="font-semibold text-amber-800 mb-1">Falta pra liberar o envio:</div>
                <ul className="list-disc pl-4 space-y-1 text-amber-800">
                  {pend.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            );
          })()}
          <Button onClick={submeter} disabled={enviando} className="w-full">
            {enviando ? "Enviando…" : "✅ Enviar ficha"}
          </Button>
          <p className="text-[11px] text-gray-500 text-center mt-2">
            Os dados são salvos automaticamente — pode fechar e voltar depois dentro do prazo.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function agruparPorGrupo(schema: FormField[]): { grupo: string; campos: FormField[] }[] {
  const ativos = schema.filter((f) => f.ativo).sort((a, b) => a.ordem - b.ordem);
  const map = new Map<string, FormField[]>();
  for (const f of ativos) {
    const arr = map.get(f.grupo) || [];
    arr.push(f);
    map.set(f.grupo, arr);
  }
  return Array.from(map.entries()).map(([grupo, campos]) => ({ grupo, campos }));
}

export type RenderCtx = {
  exigeDependentes?: boolean;
  vtNaoUtiliza?: boolean;
};

export function CampoRender({
  field,
  value,
  onChange,
  bloqueado = false,
  ctx,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  bloqueado?: boolean;
  ctx?: RenderCtx;
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
  if (field.tipo === "naturalidade") {
    return <NaturalidadeField field={field} value={value} onChange={onChange} />;
  }
  if (field.tipo === "lista_dependentes") {
    return (
      <ListaDependentesField
        field={field}
        value={value}
        onChange={onChange}
        exigeDependentes={ctx?.exigeDependentes || false}
      />
    );
  }
  if (field.tipo === "lista_transporte") {
    if (ctx?.vtNaoUtiliza) {
      return (
        <div className="text-xs text-gray-500 italic bg-gray-50 border border-gray-200 rounded-lg p-2">
          ✓ Você marcou que não utiliza transporte público — bloco do
          vale-transporte não precisa ser preenchido.
        </div>
      );
    }
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

// ─── Naturalidade (UF + cidade via IBGE) ─────────────────────────────────

const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT",
  "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
];

// Cache local de cidades por UF — IBGE retorna a mesma lista, evita ir 2x na API
const cidadesCache = new Map<string, string[]>();

async function fetchCidades(uf: string): Promise<string[]> {
  const cached = cidadesCache.get(uf);
  if (cached) return cached;
  try {
    const r = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`);
    if (!r.ok) return [];
    const data = await r.json() as { nome: string }[];
    const nomes = data.map((d) => d.nome).sort((a, b) => a.localeCompare(b, "pt-BR"));
    cidadesCache.set(uf, nomes);
    return nomes;
  } catch {
    return [];
  }
}

type Naturalidade = { uf: string; cidade: string };

function NaturalidadeField({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const v = (value || {}) as Partial<Naturalidade>;
  const [cidades, setCidades] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (!v.uf) {
      setCidades([]);
      return;
    }
    let cancelled = false;
    setCarregando(true);
    fetchCidades(v.uf).then((lista) => {
      if (!cancelled) {
        setCidades(lista);
        setCarregando(false);
      }
    });
    return () => { cancelled = true; };
  }, [v.uf]);

  function setUf(uf: string) {
    onChange({ uf, cidade: "" });
  }
  function setCidade(cidade: string) {
    onChange({ uf: v.uf || "", cidade });
  }

  const labelComObr = field.obrigatorio ? `${field.label} *` : field.label;

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-gray-600">{labelComObr}</label>
      {field.ajuda && <span className="text-[11px] text-gray-500">{field.ajuda}</span>}
      <div className="grid grid-cols-2 gap-2">
        <select
          value={v.uf || ""}
          onChange={(e) => setUf(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white"
        >
          <option value="">— UF —</option>
          {UFS.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
        <select
          value={v.cidade || ""}
          onChange={(e) => setCidade(e.target.value)}
          disabled={!v.uf || carregando}
          className="px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white disabled:bg-gray-100"
        >
          <option value="">
            {!v.uf ? "— escolha a UF primeiro —" : carregando ? "carregando cidades…" : "— cidade —"}
          </option>
          {cidades.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

type Dependente = { nome: string; nascimento: string; cpf: string; parentesco: string; depIR: boolean };

function ListaDependentesField({
  field,
  value,
  onChange,
  exigeDependentes,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  exigeDependentes: boolean;
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
      <label className="text-xs font-semibold text-gray-600">
        {field.label}{exigeDependentes ? " *" : ""}
      </label>
      {field.ajuda && <span className="text-[11px] text-gray-500">{field.ajuda}</span>}
      {exigeDependentes && (
        <div className={`rounded-lg p-2 text-[11px] ${
          lista.length === 0
            ? "bg-amber-50 border border-amber-200 text-amber-800"
            : "bg-emerald-50 border border-emerald-200 text-emerald-800"
        }`}>
          {lista.length === 0 ? (
            <>
              ⚠ Você marcou que tem dependentes legais — adicione pelo menos um abaixo (nome, data de nascimento e parentesco).
            </>
          ) : (
            <>✓ {lista.length} dependente(s) informado(s). Confirme os dados.</>
          )}
        </div>
      )}
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

// ─── Upload de documentos (último bloco do form) ─────────────────────────
const MAX_DOC_BYTES = 10 * 1024 * 1024;
const TIPOS_DOC_OK = ["application/pdf", "image/jpeg", "image/png"];

// Valida que todos os documentos da lista foram resolvidos pelo candidato.
// Retorna a 1ª pendência (string) ou null se tudo OK.
function validarDocumentos(
  defs: DocumentoAdmissaoDef[],
  resol: Record<string, DocumentoAdmissaoEnvio>,
): string | null {
  for (const d of defs) {
    const r = resol[d.id];
    if (!r || !r.resolucao) {
      return `Resolva "${d.nome}": anexe o arquivo ou marque "não tenho / não se aplica".`;
    }
    if (r.resolucao === "anexado") {
      if (!r.arquivos || r.arquivos.length === 0) {
        return `Anexe o arquivo de "${d.nome}" (ou marque "não tenho / não se aplica").`;
      }
    } else if (!r.justificativa || !r.justificativa.trim()) {
      return `Explique por que não tem "${d.nome}" (justificativa obrigatória).`;
    }
  }
  return null;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function DocumentosUploadSection({
  rid,
  admissaoId,
  docDefs,
  valor,
  onChange,
}: {
  rid: string;
  admissaoId: string;
  docDefs: DocumentoAdmissaoDef[];
  valor: Record<string, DocumentoAdmissaoEnvio>;
  onChange: React.Dispatch<React.SetStateAction<Record<string, DocumentoAdmissaoEnvio>>>;
}) {
  const [subindo, setSubindo] = useState<string | null>(null); // docId em upload
  const [erro, setErro] = useState("");

  if (docDefs.length === 0) return null;

  function patch(docId: string, nome: string, p: Partial<DocumentoAdmissaoEnvio>) {
    onChange((cur) => {
      const prev = cur[docId] || { docId, nome, resolucao: "anexado" as const, arquivos: [] };
      return { ...cur, [docId]: { ...prev, docId, nome, ...p } };
    });
  }

  async function anexar(d: DocumentoAdmissaoDef, files: FileList | null) {
    if (!files || files.length === 0) return;
    setErro("");
    setSubindo(d.id);
    try {
      const novos: DocumentoAdmissaoArquivo[] = [];
      for (const file of Array.from(files)) {
        if (!TIPOS_DOC_OK.includes(file.type)) {
          setErro(`"${file.name}": formato inválido. Aceita PDF, JPG ou PNG.`);
          continue;
        }
        if (file.size > MAX_DOC_BYTES) {
          setErro(`"${file.name}": ${fmtBytes(file.size)} — máximo 10 MB.`);
          continue;
        }
        const safe = file.name.replace(/[^\w.\-]+/g, "_");
        const path = `admissoes/${rid}/${admissaoId}/${d.id}/${Date.now()}_${safe}`;
        // NÃO chamamos getDownloadURL aqui: o candidato é anônimo (sem login) e
        // a leitura do Storage exige auth (docs de identidade são privados). O DP
        // resolve a URL a partir do `path` quando for conferir/baixar.
        await uploadBytes(storageRef(storage, path), file, { contentType: file.type });
        novos.push({ nome: file.name, url: "", path, tipo: file.type, tamanho: file.size });
      }
      if (novos.length > 0) {
        onChange((cur) => {
          const prev = cur[d.id] || { docId: d.id, nome: d.nome, resolucao: "anexado" as const, arquivos: [] };
          const next: DocumentoAdmissaoEnvio = {
            ...prev,
            docId: d.id,
            nome: d.nome,
            resolucao: "anexado",
            arquivos: [...(prev.arquivos || []), ...novos],
          };
          delete next.justificativa;
          return { ...cur, [d.id]: next };
        });
      }
    } catch (e) {
      setErro("Erro ao subir arquivo: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setSubindo(null);
    }
  }

  function removerArquivo(d: DocumentoAdmissaoDef, idx: number) {
    onChange((cur) => {
      const prev = cur[d.id];
      if (!prev) return cur;
      const arquivos = (prev.arquivos || []).filter((_, i) => i !== idx);
      return { ...cur, [d.id]: { ...prev, arquivos } };
    });
  }

  // Um documento está "resolvido" quando tem arquivo anexado OU foi marcado
  // como não-tem/não-se-aplica COM justificativa.
  const docResolvido = (d: DocumentoAdmissaoDef) => {
    const r = valor[d.id];
    if (!r || !r.resolucao) return false;
    if (r.resolucao === "anexado") return (r.arquivos?.length || 0) > 0;
    return !!r.justificativa?.trim();
  };
  const resolvidos = docDefs.filter(docResolvido).length;
  const tudoResolvido = resolvidos === docDefs.length;

  return (
    <section className="bg-white border-2 border-indigo-200 rounded-xl p-4 space-y-3">
      <div>
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold text-sm text-indigo-900">📎 Documentos</h2>
          <span className={`text-[11px] font-bold ${tudoResolvido ? "text-emerald-600" : "text-amber-600"}`}>
            {resolvidos}/{docDefs.length} resolvidos
          </span>
        </div>
        <p className="text-xs text-gray-600 mt-1">
          Em <strong>cada</strong> documento, escolha uma opção: <strong>anexar</strong> o
          arquivo (PDF, JPG ou PNG, até 10 MB), ou marcar <strong>"não tenho / não se
          aplica"</strong> e explicar o motivo. É obrigatório <strong>responder todos</strong>{" "}
          — inclusive os que você não vai anexar — pra liberar o envio da ficha.
        </p>
      </div>

      {erro && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {erro}
        </div>
      )}

      <div className="space-y-3">
        {docDefs.map((d) => {
          const r = valor[d.id];
          const resol = r?.resolucao;
          const arquivos = r?.arquivos || [];
          const naoTem = resol === "nao_se_aplica" || resol === "nao_tenho";
          const resolvido = docResolvido(d);
          return (
            <div key={d.id} className={`border rounded-lg p-3 ${resolvido ? "border-gray-200" : "border-amber-300 bg-amber-50/40"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-sm font-semibold text-gray-900">{d.nome}</span>
                  {d.obrigatorio && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-red-600 font-bold">
                      obrigatório
                    </span>
                  )}
                  {d.descricao && (
                    <p className="text-[11px] text-gray-500 mt-0.5">{d.descricao}</p>
                  )}
                </div>
                {resolvido ? (
                  <span className="text-emerald-600 text-sm shrink-0">✓</span>
                ) : (
                  <span className="text-[10px] font-bold text-amber-600 shrink-0 whitespace-nowrap">⚠ responda</span>
                )}
              </div>

              {/* Opções de resolução */}
              <div className="flex flex-wrap gap-3 mt-2">
                <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                  <input
                    type="radio"
                    name={`doc_${d.id}`}
                    checked={resol === "anexado"}
                    onChange={() => patch(d.id, d.nome, { resolucao: "anexado" })}
                    className="accent-indigo-600"
                  />
                  📎 Vou anexar
                </label>
                {d.permiteNaoSeAplica && (
                  <>
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                      <input
                        type="radio"
                        name={`doc_${d.id}`}
                        checked={resol === "nao_tenho"}
                        onChange={() => patch(d.id, d.nome, { resolucao: "nao_tenho", arquivos: [] })}
                        className="accent-indigo-600"
                      />
                      Não tenho
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                      <input
                        type="radio"
                        name={`doc_${d.id}`}
                        checked={resol === "nao_se_aplica"}
                        onChange={() => patch(d.id, d.nome, { resolucao: "nao_se_aplica", arquivos: [] })}
                        className="accent-indigo-600"
                      />
                      Não se aplica
                    </label>
                  </>
                )}
              </div>

              {/* Anexar arquivo */}
              {resol === "anexado" && (
                <div className="mt-2 space-y-1.5">
                  {arquivos.map((a, i) => (
                    <div
                      key={`${a.path}_${i}`}
                      className="flex items-center justify-between gap-2 text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1"
                    >
                      <span className="truncate">
                        📄 {a.nome} <span className="text-gray-400">({fmtBytes(a.tamanho)})</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removerArquivo(d, i)}
                        className="text-red-500 hover:text-red-700 shrink-0"
                      >
                        remover
                      </button>
                    </div>
                  ))}
                  <label className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-indigo-300 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 cursor-pointer">
                    {subindo === d.id ? "Enviando…" : arquivos.length > 0 ? "+ Adicionar outro arquivo" : "Escolher arquivo"}
                    <input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png"
                      multiple
                      disabled={subindo === d.id}
                      onChange={(e) => { void anexar(d, e.target.files); e.target.value = ""; }}
                      className="hidden"
                    />
                  </label>
                </div>
              )}

              {/* Justificativa (não tenho / não se aplica) */}
              {naoTem && (
                <div className="mt-2">
                  <textarea
                    value={r?.justificativa || ""}
                    onChange={(e) => patch(d.id, d.nome, { justificativa: e.target.value })}
                    placeholder="Explique por que não tem esse documento (obrigatório)…"
                    rows={2}
                    className="w-full text-xs border border-gray-300 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-indigo-400 focus:outline-none"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Helper pra silenciar warning de import (fmtDataBr reservado pra evoluções)
void fmtDataBr;
void onlyDigits;

// ─── Boxes de ciência (Itaú + Docs WhatsApp) ─────────────────────────────

function CienciaContaItauBox({
  aceita,
  onChange,
  bancoTipo,
}: {
  aceita: boolean;
  onChange: (v: boolean) => void;
  bancoTipo: unknown;
}) {
  const jaTemItau = bancoTipo === "Já tenho conta no Itaú";
  const selecionou = typeof bancoTipo === "string" && bancoTipo.trim() !== "";

  // Ainda não escolheu a situação bancária no bloco Banco acima → mensagem
  // neutra, sem checkbox (não dá pra avisar nem confirmar nada ainda).
  if (!selecionou) {
    return (
      <section className="rounded-xl p-4 border-2 bg-gray-50 border-gray-200">
        <h2 className="font-bold text-sm mb-1 text-gray-700">
          🏦 Conta bancária para receber seu salário
        </h2>
        <p className="text-xs text-gray-600">
          Escolha sua situação no campo <strong>"Conta bancária"</strong> do
          bloco <strong>Banco</strong> acima. Se você já tem conta no Itaú, o
          processo fica mais rápido; se for outro banco, vamos te orientar a
          abrir uma conta Itaú.
        </p>
      </section>
    );
  }

  return (
    <section className={`rounded-xl p-4 border-2 ${aceita ? "bg-emerald-50 border-emerald-300" : "bg-sky-50 border-sky-300"}`}>
      <h2 className={`font-bold text-sm mb-2 ${aceita ? "text-emerald-900" : "text-sky-900"}`}>
        🏦 Conta bancária para receber seu salário
      </h2>
      <div className="text-xs text-gray-800 space-y-2">
        {jaTemItau ? (
          <>
            <p>
              ✓ Você já informou que <strong>tem conta no Itaú</strong> no bloco
              Banco acima — isso facilita demais o processo, obrigado!
            </p>
            <p>
              Confira agência e conta antes de enviar. Se ainda não preencheu
              esses dados, volte pro bloco Banco.
            </p>
          </>
        ) : (
          <>
            <p>Você precisa abrir uma conta no <strong>Itaú</strong> pra receber o salário. Pode ser:</p>
            <ul className="list-disc pl-5 space-y-0.5">
              <li><strong>Conta salário</strong> — gratuita, vinculada à empresa</li>
              <li><strong>Conta corrente</strong> — normal, sua escolha</li>
            </ul>
            <p>
              <strong>Prazo:</strong> você tem <strong>1 semana</strong> a partir de
              hoje pra abrir e nos informar os dados (agência, conta e dígito).
            </p>
            <p className="bg-amber-100/50 border border-amber-200 rounded p-2">
              💡 <strong>Já tem Itaú?</strong> Marque "Já tenho conta no Itaú" no
              bloco Banco lá em cima e preenche os dados — você pula essa
              etapa de abertura e a gente já agiliza tudo.
            </p>
          </>
        )}
      </div>
      <label className="flex items-start gap-2 mt-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={aceita}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 accent-emerald-600 w-4 h-4"
        />
        <span className="text-xs text-gray-900">
          {jaTemItau ? (
            <>Confirmo que os dados da conta <strong>Itaú</strong> preenchidos acima estão corretos.</>
          ) : (
            <>Estou ciente que devo <strong>abrir uma conta no Itaú</strong> (salário ou corrente) e informar os dados em até <strong>1 semana</strong>.</>
          )}
        </span>
      </label>
    </section>
  );
}


// ─── Bloco final: selfie + declaração ────────────────────────────────────

function DeclaracaoFinalBlock({
  selfieDataUrl,
  onSelfieChange,
  declaracaoAceita,
  onDeclaracaoChange,
  candidatoNome,
}: {
  selfieDataUrl: string | null;
  onSelfieChange: (v: string | null) => void;
  declaracaoAceita: boolean;
  onDeclaracaoChange: (v: boolean) => void;
  candidatoNome: string;
}) {
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState("");

  async function onFile(file: File | undefined) {
    if (!file) return;
    setErro("");
    setProcessando(true);
    try {
      const dataUrl = await comprimirImagem(file, 800, 0.7);
      // Sanity check: data URL não deve passar ~500KB (já bem comprimida).
      // Se passar, comprime de novo com qty menor.
      let final = dataUrl;
      if (final.length > 500_000) {
        final = await comprimirImagem(file, 600, 0.55);
      }
      onSelfieChange(final);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao processar a imagem.");
    } finally {
      setProcessando(false);
    }
  }

  return (
    <section className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 space-y-4">
      <h2 className="font-bold text-amber-900">
        🛡️ Finalização da ficha
      </h2>

      {/* Foto da ficha (também serve como validação de que é você preenchendo) */}
      <div className="space-y-2">
        <div className="text-sm font-semibold text-amber-900">
          📷 Foto pra ficha cadastral *
        </div>
        <p className="text-xs text-amber-900/80">
          Essa foto vai pra a sua <strong>ficha oficial na empresa</strong> e também serve
          pra validar que é você preenchendo. Tire ao vivo, com o rosto centralizado e
          bem iluminado — não envie foto antiga, nem foto de outra pessoa, nem com
          óculos escuros ou boné.
        </p>
        {selfieDataUrl ? (
          <div className="flex items-start gap-3">
            <img
              src={selfieDataUrl}
              alt="Foto"
              className="w-28 h-28 rounded-lg object-cover border border-amber-300"
            />
            <div className="text-xs">
              <div className="text-emerald-700 font-semibold">✓ Foto capturada</div>
              <p className="text-amber-900/70 mt-1">
                Confira se está nítida e mostra bem o seu rosto. Se não estiver boa,
                tire outra.
              </p>
              <button
                type="button"
                onClick={() => onSelfieChange(null)}
                className="text-rose-600 hover:underline mt-1"
              >
                Tirar outra
              </button>
            </div>
          </div>
        ) : (
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold text-sm cursor-pointer">
            <input
              type="file"
              accept="image/*"
              capture="user"
              onChange={(e) => onFile(e.target.files?.[0])}
              className="hidden"
              disabled={processando}
            />
            {processando ? "Processando…" : "📷 Tirar foto"}
          </label>
        )}
        {erro && <div className="text-xs text-rose-600">{erro}</div>}
      </div>

      {/* Declaração */}
      <div className="space-y-2 pt-3 border-t border-amber-200">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={declaracaoAceita}
            onChange={(e) => onDeclaracaoChange(e.target.checked)}
            className="mt-1 accent-amber-700"
          />
          <span className="text-xs text-amber-900 leading-relaxed">
            <strong>Eu, {candidatoNome}, {TEXTO_DECLARACAO.charAt(0).toLowerCase() + TEXTO_DECLARACAO.slice(1)}</strong>
          </span>
        </label>
      </div>
    </section>
  );
}
