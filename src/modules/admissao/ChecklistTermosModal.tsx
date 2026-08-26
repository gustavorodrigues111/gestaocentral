// ════════════════════════════════════════════════════════════════════════════
//  Modal — Checklist de termos a assinar
//
//  Aberto pelo botão "📋 Abrir checklist de kit de documentos para
//  assinatura" da subtarefa st_termos_assinatura
//  ("Kit de documentos para assinatura").
//  Mostra cada termo com checkbox + campo de link opcional (URL do PDF
//  assinado, Drive ou Clicksign).
//
//  Os termos vivem em `admissao.termosAssinados`. Quando o array tá vazio
//  (admissão nova ou criada antes desta feature), instancia com o default
//  global de `getTermosAssinaturaDefault()`.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { collection, doc, getDoc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import type {
  Admissao, Cargo, ClicksignEnvioRef, EntregaUniforme, ItemUniforme, KitAreaUniforme,
  Pessoa, Restaurant, TermoAssinado,
} from "../../core/types";
import {
  atualizarTermoAssinado,
  instanciarTermosAssinados,
  salvarDriveFolder,
  salvarClicksignEnvelope,
  salvarClicksignStatus,
} from "../../core/admissao/admissaoHelpers";
import { NovaEntregaModal } from "../uniformes/NovaEntregaModal";
import { GeradorModal, DOCS, type DocModelo } from "../documentos/DocumentosPage";
import { isDriveConfigured, driveFolderUrl } from "../../core/google/driveConfig";
import {
  createEmployeeFolderTree, uploadFileToFolder, listFolderFiles,
  downloadDriveFileBase64, type DriveFile,
} from "../../core/google/driveShared";
import {
  criarEnvelopeClicksign, statusEnvelopeClicksign, baixarAssinadoClicksign,
  CLICKSIGN_SANDBOX,
} from "../../core/clicksign/clicksignClient";

// Traduz o status do envelope Clicksign pra PT-BR amigável.
function traduzStatusClicksign(s: string): string {
  switch (s) {
    case "draft": return "rascunho";
    case "running": return "aguardando assinatura";
    case "closed": return "assinado ✓";
    case "canceled": return "cancelado";
    default: return s || "—";
  }
}

// Formata "YYYY-MM-DDTHH:mm:ss.sssZ" → "DD/MM/YYYY HH:mm" pt-BR.
function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

// CPF (dígitos) → formatado "000.000.000-00" (Clicksign documentation).
function formatCpf(cpf?: string): string {
  const d = (cpf || "").replace(/\D/g, "");
  if (d.length !== 11) return "";
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

// base64 → File (pra subir o PDF assinado de volta pro Drive).
function base64ToFile(base64: string, filename: string): File {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], filename, { type: "application/pdf" });
}

type Props = {
  admissao: Admissao;
  pessoa: Pessoa;
  activeRestaurant: Restaurant;
  onClose: () => void;
};

export function ChecklistTermosModal({ admissao, pessoa, activeRestaurant, onClose }: Props) {
  // Inicializa com o existente OU com o default global
  const [termos, setTermos] = useState<TermoAssinado[]>(
    () => instanciarTermosAssinados(admissao.termosAssinados, activeRestaurant.documentosPorCargo?.[admissao.cargoId]),
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  // ─── Fonte de documentos: módulo Documentos ───
  // Mapa termo→modelo + dados cadastrais da empresa (documentosEmpresas/{rid}).
  const [empresaCfg, setEmpresaCfg] = useState<{ campos: Record<string, string>; habilitados: string[] | null; termoMap: Record<string, string> }>({ campos: {}, habilitados: null, termoMap: {} });
  const [gerarDoc, setGerarDoc] = useState<{ termoId: string; doc: DocModelo } | null>(null);
  // Cargo da admissão — alimenta função/remuneração/atividades dos contratos.
  const [cargo, setCargo] = useState<Cargo | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "documentosEmpresas", admissao.restaurantId));
        const data = snap.data() as { campos?: Record<string, string>; habilitados?: string[] | null; termoMap?: Record<string, string> } | undefined;
        setEmpresaCfg({ campos: data?.campos || {}, habilitados: data?.habilitados ?? null, termoMap: data?.termoMap || {} });
      } catch { /* sem config ainda — segue manual */ }
    })();
    (async () => {
      if (!admissao.cargoId) return;
      try {
        const cs = await getDoc(doc(db, "cargos", admissao.cargoId));
        if (cs.exists()) setCargo({ id: cs.id, ...cs.data() } as Cargo);
      } catch { /* sem cargo — segue */ }
    })();
  }, [admissao.restaurantId, admissao.cargoId]);
  // Prefill dos documentos com dados do candidato + cargo (função/remuneração/atividades).
  const prefillDoc = useMemo(() => {
    const p: Record<string, string> = {
      NOME_EMPREGADO: admissao.candidato?.nome || "",
      CPF_EMPREGADO: admissao.candidato?.cpf || "",
    };
    if (cargo?.nome) p.FUNCAO = cargo.nome;
    if (cargo?.salarioBase != null) p.REMUNERACAO = `R$ ${cargo.salarioBase.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} mensais`;
    if (cargo?.descricao) p.DESCRICAO_ATIVIDADES = cargo.descricao;
    return p;
  }, [admissao.candidato, cargo]);

  // ─── Google Drive (kit de documentos para assinatura) ───
  // Pasta no Drive da conta conectada. Seed do que já tá salvo na admissão.
  const [folder, setFolder] = useState<{ id: string; url: string } | null>(
    admissao.driveFolderId
      ? {
          id: admissao.driveFolderId,
          url: admissao.driveFolderUrl || driveFolderUrl(admissao.driveFolderId),
        }
      : null,
  );
  // Subpastas: "docs a assinar" (termos gerados → Clicksign) e "docs
  // assinados" (PDFs que voltam assinados do Clicksign).
  const [docsAAssinarId, setDocsAAssinarId] = useState<string | null>(
    admissao.driveDocsAAssinarFolderId || null,
  );
  const [docsAssinadosId, setDocsAssinadosId] = useState<string | null>(
    admissao.driveDocsAssinadosFolderId || null,
  );
  // "" | "criando" | "conferindo" | "up_<termoId>"
  const [driveBusy, setDriveBusy] = useState("");
  const [driveErro, setDriveErro] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [arquivosPasta, setArquivosPasta] = useState<DriveFile[] | null>(null);
  // Preview do termo gerado (uniforme/EPI) antes de subir pro Drive
  const [previewUpload, setPreviewUpload] = useState<{
    pdfUrl: string;
    pdf: { blob: Blob; filename: string };
    termoId: string | null;
  } | null>(null);

  // ─── Clicksign (envelope de assinatura) ───
  const [clicksignEnvelopeId, setClicksignEnvelopeId] = useState<string | null>(
    admissao.clicksignEnvelopeId || null,
  );
  const [clicksignStatus, setClicksignStatus] = useState<string>(admissao.clicksignStatus || "");
  // Histórico completo de envios pro Clicksign (vários envelopes ao longo
  // do tempo). Usado pelo modal pra mostrar quando cada arquivo foi enviado.
  const [clicksignHistorico, setClicksignHistorico] = useState<ClicksignEnvioRef[]>(
    admissao.clicksignHistorico || [],
  );
  const [clicksignBusy, setClicksignBusy] = useState("");   // "enviando" | "verificando"
  const [clicksignErro, setClicksignErro] = useState("");
  const [clicksignMsg, setClicksignMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTermoId, setUploadTermoId] = useState<string | null>(null);
  // Alvo do upload: "a_assinar" (doc que VAI pro Clicksign) ou "assinados"
  // (PDF que já voltou assinado — upload manual de garantia).
  const [uploadTarget, setUploadTarget] = useState<"a_assinar" | "assinados">("a_assinar");

  // Modal de entrega (uniforme/EPI) — aberto pelo botão "Gerar termo"
  const [gerarTermoTipo, setGerarTermoTipo] = useState<"uniforme" | "epi" | null>(null);
  // Carrega lazy itens + kits quando o NovaEntregaModal precisa
  const [itensUniforme, setItensUniforme] = useState<ItemUniforme[]>([]);
  const [kitsAreaUniforme, setKitsAreaUniforme] = useState<KitAreaUniforme[]>([]);
  const [carregandoUniformes, setCarregandoUniformes] = useState(false);
  // Entregas já criadas pra esta admissão, indexadas por tipo. Quando o usuário
  // clica em "Gerar termo" de novo, o NovaEntregaModal abre em modo edição
  // (hidrata itens + chama atualizarEntrega no save). Evita duplicar entrega
  // + estoque + PDF.
  const [entregasExistentes, setEntregasExistentes] = useState<{
    uniforme?: EntregaUniforme;
    epi?: EntregaUniforme;
  }>({});
  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const snap = await getDocs(query(
          collection(db, "entregasUniforme"),
          where("admissaoId", "==", admissao.id),
        ));
        if (cancelado) return;
        const porTipo: { uniforme?: EntregaUniforme; epi?: EntregaUniforme } = {};
        for (const d of snap.docs) {
          const ent = { ...d.data(), id: d.id } as EntregaUniforme;
          // Ignora entregas canceladas/com devolução — não conta como "ativa"
          if (ent.cancelamento || ent.devolucao) continue;
          // Mantém a mais recente por tipo
          const atual = porTipo[ent.tipo];
          if (!atual || (ent.entregueEm || "") > (atual.entregueEm || "")) {
            porTipo[ent.tipo] = ent;
          }
        }
        setEntregasExistentes(porTipo);
      } catch (e) {
        console.warn("[checklist] falha ao carregar entregas existentes:", e);
      }
    })();
    return () => { cancelado = true; };
  }, [admissao.id]);
  async function abrirGerarTermo(tipo: "uniforme" | "epi") {
    if (itensUniforme.length === 0 && !carregandoUniformes) {
      setCarregandoUniformes(true);
      try {
        const [iSnap, kSnap] = await Promise.all([
          getDocs(query(collection(db, "itensUniforme"), where("restaurantId", "==", admissao.restaurantId))),
          getDocs(query(collection(db, "kitsAreaUniforme"), where("restaurantId", "==", admissao.restaurantId))),
        ]);
        setItensUniforme(iSnap.docs.map(d => ({ ...d.data(), id: d.id }) as ItemUniforme));
        setKitsAreaUniforme(kSnap.docs.map(d => ({ ...d.data(), id: d.id }) as KitAreaUniforme));
      } finally {
        setCarregandoUniformes(false);
      }
    }
    setGerarTermoTipo(tipo);
  }
  // Chamado quando o NovaEntregaModal gera o termo (uniforme/EPI). Marca como
  // assinado e — se o Drive tá configurado — abre preview pra subir o PDF
  // gerado pra "docs a assinar" (o termo ainda vai pro Clicksign assinar).
  // A entrega já gera o TERMO DO ADVOGADO (DOCX, via fábrica) com os itens
  // preenchidos. Aqui só subimos esse arquivo pra "docs a assinar" no Drive
  // (segue pro Clicksign) e amarramos ao termo. Sem preview (é DOCX).
  async function aoGerarTermoEspecial(arquivo?: { blob: Blob; filename: string }) {
    const tipo = gerarTermoTipo;
    if (!tipo || !arquivo) return;
    const termo = termos.find(t => t.tipoEspecial === tipo);
    if (!termo || !isDriveConfigured()) return;
    setDriveErro(""); setDriveBusy(`up_${termo.id}`);
    try {
      const { aAssinar } = await ensureTree();
      const isDocx = /\.docx$/i.test(arquivo.filename);
      const f = new File([arquivo.blob], arquivo.filename, {
        type: isDocx ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf",
      });
      const up = await uploadFileToFolder(aAssinar, f);
      if (up.webViewLink) {
        const novos = termos.map(t => t.id === termo.id ? { ...t, link: up.webViewLink as string, linkFileId: up.id } : t);
        setTermos(novos);
        await persistirTermos(novos);
      }
    } catch (e) {
      setDriveErro(e instanceof Error ? e.message : "Falha ao subir o termo pro Drive.");
    } finally { setDriveBusy(""); }
  }

  // Sobe o termo gerado do preview pra "docs a assinar" (vai pro Clicksign).
  // IMPORTANTE: persiste o link no Firestore — antes só atualizava state
  // local via atualizarLink(), então fechar/reabrir o checklist perdia o link.
  async function confirmarUploadPreview() {
    if (!previewUpload) return;
    const { pdf, termoId } = previewUpload;
    setDriveErro("");
    setDriveBusy(termoId ? `up_${termoId}` : "criando");
    try {
      const { aAssinar } = await ensureTree();
      const file = new File([pdf.blob], pdf.filename, { type: "application/pdf" });
      const uploaded = await uploadFileToFolder(aAssinar, file);
      if (uploaded.webViewLink && termoId) {
        // Salva o link + linkFileId no termo. O `linkFileId` marca que o
        // PDF está NA pasta "docs a assinar" do Drive — usado pelo envio
        // do Clicksign pra distinguir de links externos colados manuais.
        const link = uploaded.webViewLink;
        const fileId = uploaded.id;
        const novos = termos.map(t => t.id === termoId ? { ...t, link, linkFileId: fileId } : t);
        await persistirTermos(novos);
      }
      fecharPreview();
    } catch (e) {
      setDriveErro(e instanceof Error ? e.message : "Falha ao subir o termo gerado pro Drive.");
    } finally {
      setDriveBusy("");
    }
  }

  function fecharPreview() {
    setPreviewUpload((prev) => {
      if (prev) URL.revokeObjectURL(prev.pdfUrl);
      return null;
    });
  }

  // ─── Clicksign ───
  // Item enviável no modal de seleção pré-envio. Vem de 2 origens:
  //  - "pasta": PDF já está na pasta "docs a assinar" do Drive
  //  - "externo": termo tem link Drive em outra pasta — vamos tentar
  //    baixar via API quando o usuário confirmar.
  type ItemEnvio = {
    id: string;          // fileId no Drive (chave única)
    name: string;        // filename pro Clicksign
    source: "pasta" | "externo";
    webViewLink?: string;
    termoNome?: string;  // se source === "externo", nome do termo
    // Histórico de envios deste arquivo (de TODOS os envelopes que essa
    // admissão já criou) — calculado a partir de admissao.clicksignHistorico
    // cruzando por fileId/filename. Vazio = nunca enviado.
    envios?: { envelopeId: string; enviadoEm: string }[];
    // Quando setado, o checkbox aparece DISABLED + motivo visível. Usado
    // pelo Termo de Prorrogação (tipoEspecial="prorrogacao"), que só pode
    // ser enviado pelo botão "Prorrogar contrato" na tarefa de Decisão.
    bloqueado?: { motivo: string };
  };
  // Modal de seleção pré-envio. Inclui um cache do status dos docs do
  // envelope ativo (consultado uma vez na abertura via API) pra mostrar
  // qual está assinado / pendente individualmente.
  const [selecaoEnvio, setSelecaoEnvio] = useState<{
    arquivos: ItemEnvio[];
    selecionados: Set<string>;
    // filename → status (running, signed, etc) do envelope ATIVO
    statusDocsAtivo: Map<string, string>;
  } | null>(null);

  // Extrai o fileId de uma URL do Drive. Funciona com os formatos
  // comuns: /file/d/<id>/view, /open?id=<id>, /uc?id=<id>.
  function extractDriveFileId(url: string): string | null {
    const m1 = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (m1) return m1[1];
    const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (m2) return m2[1];
    return null;
  }

  // Passo 1: valida pré-condições, lista arquivos da pasta e abre o modal.
  async function abrirSelecaoClicksign() {
    setClicksignErro("");
    setClicksignMsg("");
    const cand = admissao.candidato;
    if (!cand.email) {
      setClicksignErro("Candidato sem e-mail cadastrado — necessário pra assinatura.");
      return;
    }
    const empresaNome = activeRestaurant.clicksignEmpresaNome?.trim();
    const empresaEmail = activeRestaurant.clicksignEmpresaEmail?.trim();
    if (!empresaNome || !empresaEmail) {
      setClicksignErro("Configure o signatário da empresa em Admissão → Configurações antes de enviar.");
      return;
    }
    setClicksignBusy("enviando");
    try {
      const { aAssinar } = await ensureTree();
      const arquivos = await listFolderFiles(aAssinar);
      if (arquivos.length === 0) {
        throw new Error("Nenhum documento em 'docs a assinar'. Gere/suba os termos primeiro.");
      }

      // ─── Reconciliação retroativa de linkFileId ───
      // Termos criados ANTES do schema linkFileId não têm o campo, mesmo
      // que o PDF esteja na pasta. Aqui cruzamos cada termo com link
      // mas SEM linkFileId contra os arquivos: se o fileId da URL bate
      // com algum arquivo da pasta, preenchemos retroativamente. Persiste
      // pra próximas vezes não precisar reconciliar.
      const idsNaPasta = new Set(arquivos.map(a => a.id));
      let mudou = false;
      const termosReconciliados = termos.map(t => {
        if (t.linkFileId) return t;
        if (!t.link) return t;
        const fileId = extractDriveFileId(t.link);
        if (fileId && idsNaPasta.has(fileId)) {
          mudou = true;
          return { ...t, linkFileId: fileId };
        }
        return t;
      });
      if (mudou) {
        await persistirTermos(termosReconciliados);
      }

      // Monta a lista pro modal:
      //  1) Cada arquivo da pasta → source "pasta"
      //  2) Cada termo obrigatório+assinado com link Drive que NÃO está
      //     na pasta → source "externo" (vai tentar baixar via Drive API
      //     na hora do envio; se não tiver permissão, falha graciosamente)
      // Termo de Prorrogação tem bloqueio: não pode ser enviado no envelope
      // inicial (senão a prorrogação ficaria automática). Detecto pelo
      // linkFileId do termo cujo tipoEspecial === "prorrogacao".
      const idsBloqueados = new Map<string, string>();
      for (const t of termosReconciliados) {
        if (t.tipoEspecial === "prorrogacao" && t.linkFileId) {
          idsBloqueados.set(
            t.linkFileId,
            "🔒 Termo de Prorrogação — só vai pro Clicksign pelo botão 'Prorrogar contrato' na tarefa de Decisão de Experiência.",
          );
        }
      }
      const itensPasta: ItemEnvio[] = arquivos.map(a => ({
        id: a.id,
        name: a.name,
        source: "pasta" as const,
        webViewLink: a.webViewLink,
        bloqueado: idsBloqueados.has(a.id)
          ? { motivo: idsBloqueados.get(a.id)! }
          : undefined,
      }));
      const idsJaIncluidos = new Set(itensPasta.map(i => i.id));
      const itensExternos: ItemEnvio[] = [];
      for (const t of termosReconciliados) {
        if (t.naoSeAplica || !t.assinado || !t.link || t.linkFileId) continue;
        const fileId = extractDriveFileId(t.link);
        if (!fileId || idsJaIncluidos.has(fileId)) continue;
        // Nome amigável pra Clicksign: usa o nome do termo, com extensão
        const nomeArquivo = `${t.nome.replace(/[/\\?%*:|"<>]/g, "-")}.pdf`;
        itensExternos.push({
          id: fileId,
          name: nomeArquivo,
          source: "externo" as const,
          webViewLink: t.link,
          termoNome: t.nome,
        });
        idsJaIncluidos.add(fileId);
      }
      const arquivosTotais = [...itensPasta, ...itensExternos];

      if (arquivosTotais.length === 0) {
        setClicksignErro("Nenhum documento pra enviar. Gere/suba os termos primeiro.");
        return;
      }

      // Cruza cada arquivo com o histórico DE TODOS os envios desta
      // admissão (não só o envelope ativo) — preserva o log mesmo quando
      // mais de um envelope foi criado. Match por fileId (preferencial)
      // ou filename (fallback pra envios antigos sem fileId).
      // (Aplicação do enriquecimento usa o histórico DEPOIS da reconciliação
      // retroativa que pode ter sintetizado a entry do envelope ativo — ver
      // bloco abaixo.)
      const enriquecer = (lista: ItemEnvio[], hist: ClicksignEnvioRef[]): ItemEnvio[] =>
        lista.map(a => {
          const envios: { envelopeId: string; enviadoEm: string }[] = [];
          for (const envio of hist) {
            const bate = envio.arquivos.some(
              arq => (arq.fileId && arq.fileId === a.id) || arq.filename === a.name,
            );
            if (bate) envios.push({ envelopeId: envio.envelopeId, enviadoEm: envio.enviadoEm });
          }
          envios.sort((x, y) => x.enviadoEm.localeCompare(y.enviadoEm));
          return { ...a, envios };
        });
      // Enriquecimento inicial com histórico atual (pode ser substituído após
      // a reconciliação abaixo).
      let enriquecidos: ItemEnvio[] = enriquecer(arquivosTotais, clicksignHistorico);
      // Consulta o envelope ativo (último) pra obter status de cada doc —
      // mostra individualmente no modal (assinado / pendente / etc).
      const statusDocsAtivo = new Map<string, string>();
      let documentsAtivos: { id: string; filename?: string; status?: string }[] = [];
      if (clicksignEnvelopeId && clicksignStatus !== "closed") {
        try {
          const { documents } = await statusEnvelopeClicksign(clicksignEnvelopeId);
          documentsAtivos = documents;
          for (const d of documents) {
            if (d.filename && d.status) statusDocsAtivo.set(d.filename, d.status);
          }
        } catch (e) {
          console.warn("[clicksign] falha ao buscar status do envelope ativo:", e);
        }
      }

      // Reconciliação retroativa do histórico: se o histórico local NÃO
      // tem entry pro envelope ativo (envelope criado antes do schema novo),
      // sintetizamos uma a partir do que veio da API + clicksignEnviadoEm.
      // Cobre só o envelope ATUAL; envelopes anteriores ao último ficaram
      // sem rastro (clicksignEnvelopeId só guardava 1).
      let historicoEfetivo = clicksignHistorico;
      if (
        clicksignEnvelopeId &&
        documentsAtivos.length > 0 &&
        !historicoEfetivo.some(h => h.envelopeId === clicksignEnvelopeId)
      ) {
        const enviadoEm = admissao.clicksignEnviadoEm || new Date().toISOString();
        const sintetico: ClicksignEnvioRef = {
          envelopeId: clicksignEnvelopeId,
          enviadoEm,
          sandbox: CLICKSIGN_SANDBOX,
          statusInicial: clicksignStatus,
          arquivos: documentsAtivos
            .filter((d): d is { id: string; filename: string; status?: string } =>
              typeof d.filename === "string" && d.filename.length > 0)
            .map(d => ({ filename: d.filename })),
        };
        const novoHistorico = [...historicoEfetivo, sintetico];
        historicoEfetivo = novoHistorico;
        setClicksignHistorico(novoHistorico);
        try {
          await updateDoc(doc(db, "admissoes", admissao.id), {
            clicksignHistorico: novoHistorico,
            updatedAt: new Date().toISOString(),
          });
        } catch (e) {
          console.warn("[clicksign] falha ao persistir histórico retroativo:", e);
        }
      }
      // Se o histórico foi sintetizado retroativamente, re-enriquece os
      // items com o histórico novo.
      if (historicoEfetivo !== clicksignHistorico) {
        enriquecidos = enriquecer(arquivosTotais, historicoEfetivo);
      }
      // Default: marca SÓ os arquivos que NUNCA foram enviados antes.
      // Bloqueados (Termo de Prorrogação) nunca entram no default.
      const naoBloqueados = enriquecidos.filter(a => !a.bloqueado);
      const naoEnviados = naoBloqueados.filter(a => !a.envios || a.envios.length === 0);
      const haAlgumEnviado = naoBloqueados.some(a => a.envios && a.envios.length > 0);
      const selecionadosInit = haAlgumEnviado
        ? new Set(naoEnviados.map(a => a.id))
        : new Set(naoBloqueados.map(a => a.id));
      setSelecaoEnvio({ arquivos: enriquecidos, selecionados: selecionadosInit, statusDocsAtivo });
    } catch (e) {
      setClicksignErro(e instanceof Error ? e.message : "Falha ao listar documentos.");
    } finally {
      setClicksignBusy("");
    }
  }

  // Passo 2: usuário confirmou a seleção — envia os PDFs selecionados pro
  // Clicksign, cria envelope, dispara e-mail pro candidato.
  async function confirmarEnvioClicksign() {
    if (!selecaoEnvio) return;
    const cand = admissao.candidato;
    const empresaNome = activeRestaurant.clicksignEmpresaNome?.trim() || "";
    const empresaEmail = activeRestaurant.clicksignEmpresaEmail?.trim() || "";
    const escolhidos = selecaoEnvio.arquivos.filter(a => selecaoEnvio.selecionados.has(a.id));
    if (escolhidos.length === 0) {
      setClicksignErro("Selecione pelo menos 1 documento pra enviar.");
      return;
    }
    setClicksignErro("");
    setClicksignBusy("enviando");
    try {
      // Baixa cada PDF por fileId. Pra itens "pasta" o download é
      // garantido. Pra itens "externo" o arquivo pode estar em pasta sem
      // permissão da conta conectada — coleta falhas e reporta no fim.
      const docs: { filename: string; base64: string }[] = [];
      const falhas: { item: ItemEnvio; erro: string }[] = [];
      for (const a of escolhidos) {
        try {
          docs.push({ filename: a.name, base64: await downloadDriveFileBase64(a.id) });
        } catch (e) {
          falhas.push({ item: a, erro: e instanceof Error ? e.message : "Falha no download" });
        }
      }
      if (falhas.length > 0) {
        const lista = falhas
          .map(f => `• ${f.item.termoNome || f.item.name}${f.item.source === "externo" ? " (link externo)" : ""}`)
          .join("\n");
        throw new Error(
          `Não consegui baixar ${falhas.length} arquivo(s) do Drive:\n\n${lista}\n\n` +
          `Provavelmente o link aponta pra uma pasta sem permissão da conta conectada. ` +
          `Suba esses PDFs pela pasta "docs a assinar" usando "⬆️ Subir pra assinatura" e tente de novo.`,
        );
      }
      if (docs.length === 0) {
        throw new Error("Nenhum documento pôde ser baixado.");
      }
      // Data de nascimento vem da ficha preenchida pelo candidato.
      const dn = admissao.dadosPreenchidos?.data_nascimento;
      const birthday = typeof dn === "string" ? dn : undefined;
      const { envelopeId, status } = await criarEnvelopeClicksign({
        envelopeName: `Admissão - ${cand.nome}`,
        signers: [
          // Empresa (fixo, configurado por restaurante). Se assinatura
          // automática estiver ligada, vai com CPF + nascimento + auto.
          {
            name: empresaNome,
            email: empresaEmail,
            autoSignature: activeRestaurant.clicksignEmpresaAssinaturaAuto || undefined,
            documentation: activeRestaurant.clicksignEmpresaAssinaturaAuto
              ? formatCpf(activeRestaurant.clicksignEmpresaCpf) || undefined
              : undefined,
            birthday: activeRestaurant.clicksignEmpresaAssinaturaAuto
              ? activeRestaurant.clicksignEmpresaNascimento || undefined
              : undefined,
          },
          // Empregado (dados da ficha cadastral)
          {
            name: cand.nome,
            email: cand.email!,
            phone: cand.whatsapp || undefined,
            documentation: formatCpf(cand.cpf) || undefined,
            birthday,
          },
        ],
        docs,
        externalId: admissao.id,
      });
      // Monta o registro do envio pra gravar no histórico — preserva log
      // mesmo após múltiplos envelopes serem criados.
      const novoEnvio: ClicksignEnvioRef = {
        envelopeId,
        enviadoEm: new Date().toISOString(),
        enviadoPor: { id: pessoa.id, nome: pessoa.nome },
        sandbox: CLICKSIGN_SANDBOX,
        statusInicial: status,
        arquivos: docs.map((d, i) => ({ fileId: escolhidos[i].id, filename: d.filename })),
      };
      await salvarClicksignEnvelope(
        admissao.id, envelopeId, status, CLICKSIGN_SANDBOX,
        novoEnvio, clicksignHistorico,
      );
      setClicksignEnvelopeId(envelopeId);
      setClicksignStatus(status);
      setClicksignHistorico([...clicksignHistorico, novoEnvio]);
      setClicksignMsg(`✓ Enviado pro Clicksign (${docs.length} doc). O candidato recebe por e-mail.`);
      setSelecaoEnvio(null);
    } catch (e) {
      setClicksignErro(e instanceof Error ? e.message : "Falha ao enviar pro Clicksign.");
    } finally {
      setClicksignBusy("");
    }
  }

  // Consulta o status do envelope. Se finalizado ("closed"), baixa os PDFs
  // assinados e sobe pra "docs assinados" no Drive.
  async function verificarAssinatura() {
    if (!clicksignEnvelopeId) return;
    setClicksignErro("");
    setClicksignMsg("");
    setClicksignBusy("verificando");
    try {
      const { status, documents } = await statusEnvelopeClicksign(clicksignEnvelopeId);
      setClicksignStatus(status);
      await salvarClicksignStatus(admissao.id, status);
      if (status === "closed") {
        const { assinados } = await ensureTree();
        let n = 0;
        for (const d of documents) {
          try {
            const { filename, base64 } = await baixarAssinadoClicksign(clicksignEnvelopeId, d.id);
            const nome = filename.replace(/\.pdf$/i, "") + " (assinado).pdf";
            await uploadFileToFolder(assinados, base64ToFile(base64, nome));
            n++;
          } catch {
            /* documento sem assinado disponível ainda — ignora */
          }
        }
        setClicksignMsg(
          n > 0
            ? `✓ Assinado! ${n} PDF(s) salvos em "docs assinados".`
            : "✓ Envelope finalizado (sem PDFs pra baixar).",
        );
      } else {
        setClicksignMsg(`Status atual: ${traduzStatusClicksign(status)}.`);
      }
    } catch (e) {
      setClicksignErro(e instanceof Error ? e.message : "Falha ao verificar a assinatura.");
    } finally {
      setClicksignBusy("");
    }
  }

  // Sincroniza com mudanças externas (admissão atualizada em outro lugar)
  useEffect(() => {
    setTermos(instanciarTermosAssinados(admissao.termosAssinados));
  }, [admissao.termosAssinados]);

  // Pré-popula termos PADRÃO do restaurante (Regulamento Interno, futuramente
  // outros). Roda 1x quando o componente monta: se o termo está vazio e o
  // restaurante tem o link configurado, herda o link/fileId + marca como
  // assinado (já que o conteúdo é o mesmo). Persiste no Firestore na hora.
  useEffect(() => {
    const url = activeRestaurant.regulamentoInternoUrl?.trim();
    const fileId = activeRestaurant.regulamentoInternoFileId?.trim();
    if (!url) return;
    setTermos(prev => {
      const tRegul = prev.find(t => t.id === "tm_regulamento_interno");
      if (!tRegul || tRegul.naoSeAplica) return prev;
      if (tRegul.link) return prev;  // já tem link específico — não sobrescreve
      const novos = prev.map(t => {
        if (t.id !== "tm_regulamento_interno") return t;
        const now = new Date().toISOString();
        return {
          ...t,
          link: url,
          linkFileId: fileId || undefined,
          assinado: true,
          assinadoEm: now,
          assinadoPor: { id: pessoa.id, nome: pessoa.nome },
        };
      });
      void atualizarTermoAssinado(admissao.id, novos).catch(e =>
        console.warn("[checklist] persistir prefill regulamento falhou:", e),
      );
      return novos;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRestaurant.regulamentoInternoUrl, activeRestaurant.regulamentoInternoFileId]);

  // Ao abrir o kit, se há um envelope Clicksign em andamento, checa o status
  // automaticamente (atalho do "Verificar assinatura"). Se fechou, baixa os
  // assinados pra "docs assinados". Roda 1x na montagem.
  useEffect(() => {
    if (clicksignEnvelopeId && clicksignStatus !== "closed") {
      void verificarAssinatura();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Obrigatórios = obrigatório E não marcado como "não se aplica".
  const obrigatorios = useMemo(
    () => termos.filter(t => t.obrigatorio && !t.naoSeAplica),
    [termos],
  );
  const obrigPendentes = obrigatorios.filter(t => !t.assinado).length;
  const totalAssinados = termos.filter(t => t.assinado).length;
  // Conferência: quantos obrigatórios já têm um PDF/link anexado.
  const obrigComAnexo = obrigatorios.filter(t => !!t.link).length;

  // Aplica os termos no estado E grava no Firestore na hora — assim fechar e
  // reabrir o checklist NÃO perde o que foi feito (upload, tick, N/A).
  async function persistirTermos(novos: TermoAssinado[]) {
    setTermos(novos);
    try {
      await atualizarTermoAssinado(admissao.id, novos);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar.");
    }
  }

  // Marca/desmarca "não se aplica" — desobriga o termo. Ao marcar, limpa o
  // estado de assinado (não faz sentido um termo N/A estar "assinado").
  function togglarNaoSeAplica(id: string) {
    const novos = termos.map(t => {
      if (t.id !== id) return t;
      const merged: TermoAssinado = { ...t };
      if (t.naoSeAplica) {
        delete merged.naoSeAplica;
      } else {
        merged.naoSeAplica = true;
        merged.assinado = false;
        delete merged.assinadoEm;
        delete merged.assinadoPor;
        delete merged.link;
      }
      return merged;
    });
    void persistirTermos(novos);
  }

  function togglarAssinatura(id: string) {
    const now = new Date().toISOString();
    const novos = termos.map(t => {
      if (t.id !== id) return t;
      const assinado = !t.assinado;
      const merged: TermoAssinado = { ...t, assinado };
      if (assinado) {
        merged.assinadoEm = now;
        merged.assinadoPor = { id: pessoa.id, nome: pessoa.nome };
      } else {
        delete merged.assinadoEm;
        delete merged.assinadoPor;
      }
      return merged;
    });
    void persistirTermos(novos);
  }

  // Edição manual do link (digitação) — só atualiza o estado; a persistência
  // acontece no onBlur do campo (pra não gravar a cada tecla). Link colado
  // manualmente NUNCA tem linkFileId (não é arquivo NA pasta) — limpa pra
  // não enganar o gate do envio do Clicksign.
  function atualizarLink(id: string, link: string) {
    setTermos(prev => prev.map(t => {
      if (t.id !== id) return t;
      const merged: TermoAssinado = { ...t };
      if (link.trim()) merged.link = link.trim();
      else delete merged.link;
      delete merged.linkFileId;
      return merged;
    }));
  }

  // Garante a árvore de pastas do empregado (pasta [Nome] + subpastas:
  // 1- CONTRATOS, 2 - DOCUMENTOS, docs a assinar, docs assinados) dentro da
  // pasta "Empregados Ativos" da empresa. Retorna os ids de "a assinar" e
  // "assinados". Abre o popup do Google na 1ª vez.
  async function ensureTree(): Promise<{ aAssinar: string; assinados: string }> {
    if (folder?.id && docsAAssinarId && docsAssinadosId) {
      return { aAssinar: docsAAssinarId, assinados: docsAssinadosId };
    }
    const parentId = activeRestaurant.driveEmpregadosAtivosFolderId;
    if (!parentId) {
      throw new Error(
        "Configure a pasta 'Empregados Ativos' desta empresa em Admissão → Configurações antes de criar a pasta do empregado.",
      );
    }
    const tree = await createEmployeeFolderTree(parentId, admissao.candidato.nome);
    await salvarDriveFolder(
      admissao.id, tree.folderId, tree.folderUrl,
      tree.docsAAssinarFolderId, tree.docsAssinadosFolderId,
    );
    setFolder({ id: tree.folderId, url: tree.folderUrl });
    setDocsAAssinarId(tree.docsAAssinarFolderId);
    setDocsAssinadosId(tree.docsAssinadosFolderId);
    return { aAssinar: tree.docsAAssinarFolderId, assinados: tree.docsAssinadosFolderId };
  }

  async function criarPasta() {
    setDriveErro("");
    setDriveBusy("criando");
    try {
      await ensureTree();
    } catch (e) {
      setDriveErro(e instanceof Error ? e.message : "Falha ao criar a pasta no Drive.");
    } finally {
      setDriveBusy("");
    }
  }

  async function copiarLink() {
    if (!folder) return;
    try {
      await navigator.clipboard.writeText(folder.url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setDriveErro("Não consegui copiar — abra a pasta e copie o link manualmente.");
    }
  }

  async function conferirKit() {
    // Confere o que está pronto pra mandar pro Clicksign → "docs a assinar".
    const alvo = docsAAssinarId || folder?.id;
    if (!alvo) return;
    setDriveErro("");
    setDriveBusy("conferindo");
    try {
      setArquivosPasta(await listFolderFiles(alvo));
    } catch (e) {
      setDriveErro(e instanceof Error ? e.message : "Falha ao listar a pasta.");
    } finally {
      setDriveBusy("");
    }
  }

  function pedirArquivo(termoId: string, target: "a_assinar" | "assinados") {
    setUploadTermoId(termoId);
    setUploadTarget(target);
    fileInputRef.current?.click();
  }

  async function onArquivoEscolhido(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";   // permite re-subir o mesmo arquivo
    const termoId = uploadTermoId;
    const target = uploadTarget;
    setUploadTermoId(null);
    if (!file || !termoId) return;
    setDriveErro("");
    setDriveBusy(`up_${termoId}`);
    try {
      const { aAssinar, assinados } = await ensureTree();
      // "a_assinar" = doc que vai pro Clicksign · "assinados" = PDF que já
      // voltou assinado (upload manual de garantia).
      const alvo = target === "assinados" ? assinados : aAssinar;
      const uploaded = await uploadFileToFolder(alvo, file);
      // Subiu com sucesso → fixa o link, marca o termo (tica) e PERSISTE na
      // hora. Assim, fechar e reabrir o checklist mantém tudo. linkFileId
      // só é marcado quando o upload foi pra pasta "docs a assinar" — é
      // esse marcador que o envio pro Clicksign usa pra saber que o doc
      // está acessível na pasta vigiada. Upload em "docs assinados" (manual
      // de garantia) NÃO marca: aqueles ficam só como link.
      const now = new Date().toISOString();
      const novos = termos.map(t => {
        if (t.id !== termoId) return t;
        const merged: TermoAssinado = {
          ...t,
          assinado: true,
          assinadoEm: now,
          assinadoPor: { id: pessoa.id, nome: pessoa.nome },
        };
        if (uploaded.webViewLink) merged.link = uploaded.webViewLink;
        if (uploaded.id && target === "a_assinar") merged.linkFileId = uploaded.id;
        return merged;
      });
      await persistirTermos(novos);
    } catch (err) {
      setDriveErro(err instanceof Error ? err.message : "Falha no upload do arquivo.");
    } finally {
      setDriveBusy("");
    }
  }

  async function salvar() {
    setErro("");
    setSalvando(true);
    try {
      await atualizarTermoAssinado(admissao.id, termos);
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar.");
      setSalvando(false);
    }
  }

  return (
    <Modal title="📋 Termos a assinar" onClose={onClose} maxWidth="max-w-xl">
      <div className="p-4 space-y-3">
        <div className="text-xs text-gray-600 dark:text-gray-400">
          Monte o kit: gere ou suba cada documento <strong>pra assinatura</strong>,
          marque "não se aplica" no que não usar, e envie tudo pro Clicksign. Os
          assinados voltam sozinhos pra "docs assinados". O upload manual de
          assinado é só garantia (fora do Clicksign).
        </div>

        {/* Input de arquivo escondido — acionado pelo "⬆️ Subir PDF" de cada termo */}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={onArquivoEscolhido}
        />

        {/* ─── Painel Google Drive ─── (só aparece se a integração tá configurada) */}
        {isDriveConfigured() && (
          <div className="rounded-lg border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-900/10 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-indigo-900 dark:text-indigo-200">
                📁 Google Drive
              </span>
              {folder && (
                <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold">
                  pasta criada ✓
                </span>
              )}
            </div>
            {!folder ? (
              <>
                {activeRestaurant.driveEmpregadosAtivosFolderId ? (
                  <p className="text-[11px] text-gray-600 dark:text-gray-400">
                    Cria a pasta <strong>{admissao.candidato.nome}</strong> dentro de
                    "Empregados Ativos" (com subpastas) pra subir os PDFs assinados.
                    Na 1ª vez o Google pede pra autorizar o acesso.
                  </p>
                ) : (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    ⚠ Antes, configure a pasta "Empregados Ativos" desta empresa em{" "}
                    <strong>Admissão → Configurações</strong>.
                  </p>
                )}
                <Button
                  size="sm"
                  onClick={criarPasta}
                  disabled={driveBusy !== "" || !activeRestaurant.driveEmpregadosAtivosFolderId}
                >
                  {driveBusy === "criando" ? "Criando…" : "📁 Criar pasta do empregado no Drive"}
                </Button>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" onClick={copiarLink}>
                  {copiado ? "✓ link copiado" : "📋 Copiar link da pasta"}
                </Button>
                <a
                  href={folder.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  ↗ abrir pasta
                </a>
                <Button size="sm" variant="secondary" onClick={conferirKit} disabled={driveBusy !== ""}>
                  {driveBusy === "conferindo" ? "Conferindo…" : "🔄 Conferir kit"}
                </Button>
              </div>
            )}
            {obrigatorios.length > 0 && (
              <div className="text-[11px] border-t border-indigo-200/60 dark:border-indigo-900/40 pt-1.5">
                Anexos:{" "}
                <span
                  className={
                    obrigComAnexo >= obrigatorios.length
                      ? "text-emerald-700 dark:text-emerald-400 font-semibold"
                      : "text-gray-600 dark:text-gray-400"
                  }
                >
                  {obrigComAnexo} de {obrigatorios.length} termos obrigatórios com PDF/link
                </span>
                {obrigComAnexo < obrigatorios.length && (
                  <span className="text-amber-700 dark:text-amber-400">
                    {" "}· faltam {obrigatorios.length - obrigComAnexo}
                  </span>
                )}
              </div>
            )}
            {arquivosPasta && (
              <div className="text-[11px] text-gray-600 dark:text-gray-400 border-t border-indigo-200/60 dark:border-indigo-900/40 pt-1.5">
                {arquivosPasta.length === 0 ? (
                  <span className="text-amber-700 dark:text-amber-400">
                    Nenhum arquivo na pasta ainda.
                  </span>
                ) : (
                  <>
                    <div className="mb-1">{arquivosPasta.length} arquivo(s) na pasta:</div>
                    <ul className="space-y-0.5">
                      {arquivosPasta.map((a) => (
                        <li key={a.id} className="truncate">
                          📄{" "}
                          {a.webViewLink ? (
                            <a
                              href={a.webViewLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-600 dark:text-indigo-400 hover:underline"
                            >
                              {a.name}
                            </a>
                          ) : (
                            a.name
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
            {driveErro && (
              <div className="text-[11px] text-rose-600 dark:text-rose-400">{driveErro}</div>
            )}
          </div>
        )}

        {/* ─── Painel Clicksign ─── (usa os PDFs de "docs a assinar" do Drive) */}
        {isDriveConfigured() && (
          <div className="rounded-lg border border-orange-200 dark:border-orange-900/60 bg-orange-50/50 dark:bg-orange-900/10 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-orange-900 dark:text-orange-200">
                ✍️ Clicksign{CLICKSIGN_SANDBOX ? " (sandbox)" : ""}
              </span>
              {clicksignEnvelopeId && (
                <span className="text-[10px] font-semibold text-orange-700 dark:text-orange-400">
                  {traduzStatusClicksign(clicksignStatus)}
                </span>
              )}
            </div>
            {!clicksignEnvelopeId ? (
              <>
                <p className="text-[11px] text-gray-600 dark:text-gray-400">
                  Envia os PDFs de "docs a assinar" pro Clicksign e dispara a
                  assinatura por e-mail pro candidato.
                  {CLICKSIGN_SANDBOX && " ⚠ Ambiente SANDBOX — sem validade jurídica."}
                </p>
                <Button size="sm" onClick={abrirSelecaoClicksign} disabled={clicksignBusy !== ""}>
                  {clicksignBusy === "enviando" ? "Carregando…" : "✍️ Enviar pro Clicksign"}
                </Button>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {/* Único botão: abre modal que mostra status de cada doc
                    enviado + permite enviar novos no mesmo lugar. Verificação
                    de status (que baixa PDFs assinados) acontece dentro. */}
                <Button size="sm" onClick={abrirSelecaoClicksign} disabled={clicksignBusy !== ""}>
                  {clicksignBusy === "enviando" ? "Carregando…" : "📋 Ver/enviar documentos"}
                </Button>
              </div>
            )}
            {clicksignMsg && (
              <div className="text-[11px] text-emerald-700 dark:text-emerald-400">{clicksignMsg}</div>
            )}
            {clicksignErro && (
              <div className="text-[11px] text-rose-600 dark:text-rose-400">{clicksignErro}</div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500 dark:text-gray-400">
            {totalAssinados} de {termos.length} assinados
          </span>
          {obrigPendentes > 0 && (
            <span className="text-amber-700 dark:text-amber-400 font-semibold">
              ⚠ {obrigPendentes} obrigatório(s) pendente(s)
            </span>
          )}
          {obrigPendentes === 0 && (
            <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
              ✓ Todos obrigatórios assinados
            </span>
          )}
        </div>

        <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
          {termos.map((t) => (
            <div
              key={t.id}
              className={`rounded-lg border p-3 ${
                t.naoSeAplica
                  ? "bg-gray-50 dark:bg-gray-900/30 border-gray-200 dark:border-gray-800 opacity-60"
                  : t.assinado
                    ? "bg-emerald-50/40 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-900/60"
                    : t.obrigatorio
                      ? "bg-white dark:bg-gray-900/40 border-gray-200 dark:border-gray-800"
                      : "bg-gray-50 dark:bg-gray-900/40 border-gray-200 dark:border-gray-800"
              }`}
            >
              <div className="flex items-start gap-2">
                <label className="flex items-start gap-2 cursor-pointer min-w-0 flex-1">
                  <input
                    type="checkbox"
                    checked={t.assinado}
                    disabled={t.naoSeAplica}
                    onChange={() => togglarAssinatura(t.id)}
                    className="mt-0.5 w-4 h-4 accent-emerald-600 flex-shrink-0 disabled:opacity-40"
                  />
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm ${
                      t.naoSeAplica
                        ? "line-through text-gray-500 dark:text-gray-500"
                        : t.assinado
                          ? "line-through text-gray-600 dark:text-gray-400"
                          : "text-gray-900 dark:text-gray-100 font-medium"
                    }`}>
                      {t.nome}
                      {!t.obrigatorio && !t.naoSeAplica && (
                        <span className="ml-2 text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500">opcional</span>
                      )}
                    </div>
                    {t.assinado && t.assinadoEm && !t.naoSeAplica && (
                      <div className="text-[10px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                        ✓ {new Date(t.assinadoEm).toLocaleString("pt-BR", {
                          day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
                        })}
                        {t.assinadoPor?.nome ? ` · por ${t.assinadoPor.nome}` : ""}
                      </div>
                    )}
                  </div>
                </label>
                {/* Toggle "não se aplica" — desobriga o termo */}
                <button
                  type="button"
                  onClick={() => togglarNaoSeAplica(t.id)}
                  title="Marcar/desmarcar que este termo não se aplica a esta admissão"
                  className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border flex-shrink-0 self-start ${
                    t.naoSeAplica
                      ? "border-gray-400 bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200 font-semibold"
                      : "border-gray-200 text-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  }`}
                >
                  {t.naoSeAplica ? "✓ N/A" : "N/A"}
                </button>
              </div>
              {!t.naoSeAplica && (
              <div className="mt-2 pl-6 space-y-1.5">
                {/* Gerar pelo módulo Documentos (termo mapeado, não-especial):
                    abre o gerador com empregado/empresa da admissão pré-preenchidos
                    e sobe o DOCX direto pra "docs a assinar". */}
                {!t.tipoEspecial && empresaCfg.termoMap[t.id] && (() => {
                  const d = DOCS.find(x => x.id === empresaCfg.termoMap[t.id]);
                  if (!d) return null;
                  return (
                    <button type="button" onClick={() => setGerarDoc({ termoId: t.id, doc: d })}
                      className="text-[11px] px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-medium">
                      📄 Gerar pelo Documentos
                    </button>
                  );
                })()}
                {/* Botão "Gerar termo" pra termos com tipo especial (uniforme/EPI).
                    Abre o modal de entrega — gera PDF + baixa estoque + cria
                    registro de entrega. Quando já existe uma entrega criada
                    pra esta admissão, o modal abre em modo EDIÇÃO (hidrata
                    itens, chama atualizarEntrega no save — não duplica). */}
                {(t.tipoEspecial === "uniforme" || t.tipoEspecial === "epi") && (() => {
                  const tipo: "uniforme" | "epi" = t.tipoEspecial;
                  const entExistente = entregasExistentes[tipo];
                  const label = carregandoUniformes
                    ? "Carregando catálogo…"
                    : entExistente
                      ? (tipo === "uniforme"
                          ? `📦 Ver/editar termo de uniformes (${entExistente.itens.length} item(ns))`
                          : `🦺 Ver/editar termo de EPIs (${entExistente.itens.length} item(ns))`)
                      : (tipo === "uniforme"
                          ? "📦 Gerar termo de uniformes"
                          : "🦺 Gerar termo de EPIs");
                  return (
                    <button
                      type="button"
                      onClick={() => abrirGerarTermo(tipo)}
                      disabled={carregandoUniformes}
                      className="text-[11px] px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-medium"
                    >
                      {label}
                    </button>
                  );
                })()}
                {isDriveConfigured() && (
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Primário: sobe o doc que VAI pro Clicksign (docs a assinar) */}
                    <button
                      type="button"
                      onClick={() => pedirArquivo(t.id, "a_assinar")}
                      disabled={driveBusy !== ""}
                      className="text-[11px] px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-medium"
                    >
                      {driveBusy === `up_${t.id}` ? "Subindo…" : "⬆️ Subir pra assinatura"}
                    </button>
                    {/* Garantia: upload manual de um PDF JÁ assinado (fora do Clicksign) */}
                    <button
                      type="button"
                      onClick={() => pedirArquivo(t.id, "assinados")}
                      disabled={driveBusy !== ""}
                      title="Função de garantia: subir manualmente um PDF que já voltou assinado (fora do Clicksign)"
                      className="text-[10px] px-2 py-1 rounded border border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      subir assinado (manual)
                    </button>
                  </div>
                )}
                <input
                  type="url"
                  value={t.link || ""}
                  onChange={(e) => atualizarLink(t.id, e.target.value)}
                  onBlur={() => persistirTermos(termos)}
                  placeholder="https://… (link do PDF — manual)"
                  className="w-full text-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                />
                {t.link && (
                  <div className="flex items-center gap-2 mt-0.5">
                    <a
                      href={t.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      ↗ abrir link
                    </a>
                    {/* Sinal de fonte do PDF — pra DP saber se vai pro
                        Clicksign automático ou se precisa anexar manual. */}
                    {t.linkFileId ? (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                        title="PDF está na pasta 'docs a assinar' do Drive — vai pro Clicksign automaticamente."
                      >
                        ✓ na pasta
                      </span>
                    ) : (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                        title="Link externo: NÃO está na pasta 'docs a assinar'. Pra ir pro Clicksign, suba o PDF clicando em '⬆️ Subir pra assinatura'."
                      >
                        ⚠ link externo
                      </span>
                    )}
                  </div>
                )}
              </div>
              )}
            </div>
          ))}
        </div>

        {erro && <div className="text-xs text-rose-600 dark:text-rose-400">{erro}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>

      {gerarDoc && (
        <GeradorModal
          doc={gerarDoc.doc}
          rid={admissao.restaurantId}
          restaurants={[{ id: admissao.restaurantId, nome: activeRestaurant.nome }]}
          pessoas={[]}
          empregados={[]}
          empresas={{ [admissao.restaurantId]: empresaCfg }}
          prefill={prefillDoc}
          lockEmpresa
          hideEmpregado
          subtitulo={`Termo da admissão de ${admissao.candidato?.nome || ""}`}
          onGerado={async (blob, nome) => {
            const { aAssinar } = await ensureTree();
            const file = new File([blob], nome, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
            const uploaded = await uploadFileToFolder(aAssinar, file);
            if (uploaded.webViewLink) {
              const novos = termos.map(t => t.id === gerarDoc.termoId ? { ...t, link: uploaded.webViewLink as string, linkFileId: uploaded.id } : t);
              setTermos(novos);
              await persistirTermos(novos);
            }
          }}
          onClose={() => setGerarDoc(null)}
        />
      )}
      {gerarTermoTipo && (
        <NovaEntregaModal
          tipo={gerarTermoTipo}
          itens={itensUniforme}
          kits={kitsAreaUniforme}
          restaurantId={admissao.restaurantId}
          activeRestaurant={activeRestaurant}
          pessoa={pessoa}
          admissaoContexto={admissao}
          entregaExistente={entregasExistentes[gerarTermoTipo]}
          onEntregaCriada={(pdf) => {
            // Após criar/editar, refetch das entregas pra a próxima abertura
            // já abrir com o estado atualizado (mais itens, ou itens removidos).
            void (async () => {
              try {
                const snap = await getDocs(query(
                  collection(db, "entregasUniforme"),
                  where("admissaoId", "==", admissao.id),
                ));
                const porTipo: { uniforme?: EntregaUniforme; epi?: EntregaUniforme } = {};
                for (const d of snap.docs) {
                  const ent = { ...d.data(), id: d.id } as EntregaUniforme;
                  if (ent.cancelamento || ent.devolucao) continue;
                  const atual = porTipo[ent.tipo];
                  if (!atual || (ent.entregueEm || "") > (atual.entregueEm || "")) {
                    porTipo[ent.tipo] = ent;
                  }
                }
                setEntregasExistentes(porTipo);
              } catch (e) {
                console.warn("[checklist] refetch entregas falhou:", e);
              }
            })();
            aoGerarTermoEspecial(pdf);
          }}
          onClose={() => setGerarTermoTipo(null)}
        />
      )}

      {/* Preview do termo gerado — confere antes de subir pro Drive */}
      {previewUpload && (
        <Modal
          title="📄 Conferir termo antes de subir"
          onClose={fecharPreview}
          maxWidth="max-w-3xl"
        >
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Confira o termo gerado. Se estiver certo, suba pra pasta
                "docs a assinar" (é o que vai pro Clicksign assinar).
              </p>
              <a
                href={previewUpload.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
              >
                ↗ abrir em nova aba
              </a>
            </div>
            <iframe
              src={previewUpload.pdfUrl}
              title="Preview do termo"
              className="w-full h-[60vh] rounded border border-gray-300 dark:border-gray-700 bg-white"
            />
            {driveErro && (
              <div className="text-xs text-rose-600 dark:text-rose-400">{driveErro}</div>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
              <Button variant="secondary" onClick={fecharPreview} disabled={driveBusy !== ""}>
                Cancelar
              </Button>
              <Button onClick={confirmarUploadPreview} disabled={driveBusy !== ""}>
                {driveBusy !== "" ? "Subindo…" : "⬆️ Subir pra docs a assinar"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal de seleção pré-envio: usuário escolhe quais PDFs vão pro
          envelope. Importante quando: (a) algum doc da pasta não precisa
          ser assinado pelo candidato (já assinado, só pra arquivo);
          (b) reenvio — alguns já foram assinados em envelope anterior e
          não devem voltar. Default: todos marcados. */}
      {selecaoEnvio && (
        <Modal
          title="📋 Documentos & assinaturas"
          onClose={() => setSelecaoEnvio(null)}
          maxWidth="max-w-xl"
        >
          <div className="p-4 space-y-3">
            {/* ─── Status do envelope ativo (se houver) ─── */}
            {clicksignEnvelopeId && clicksignHistorico.length > 0 && (
              <div className="rounded-lg border border-orange-200 dark:border-orange-900/60 bg-orange-50/50 dark:bg-orange-900/10 p-2.5">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-semibold text-orange-900 dark:text-orange-200">
                    Envelope ativo · {traduzStatusClicksign(clicksignStatus)}
                  </span>
                  <button
                    type="button"
                    onClick={verificarAssinatura}
                    disabled={clicksignBusy !== ""}
                    className="text-[10px] text-orange-700 dark:text-orange-300 hover:underline disabled:opacity-50"
                  >
                    {clicksignBusy === "verificando" ? "Atualizando…" : "🔄 Atualizar status"}
                  </button>
                </div>
                {selecaoEnvio.statusDocsAtivo.size > 0 ? (
                  <ul className="space-y-0.5 text-[11px] text-gray-700 dark:text-gray-300">
                    {Array.from(selecaoEnvio.statusDocsAtivo.entries()).map(([filename, status]) => (
                      <li key={filename} className="flex items-center gap-1.5 truncate">
                        <span className="flex-1 truncate" title={filename}>{filename}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${
                          status === "signed" || status === "closed"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                        }`}>
                          {status}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-[10px] text-gray-500 dark:text-gray-400 italic">
                    Status individual indisponível.
                  </div>
                )}
                {clicksignHistorico.length > 1 && (
                  <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1.5 pt-1.5 border-t border-orange-200/60 dark:border-orange-900/40">
                    📚 {clicksignHistorico.length} envelopes criados pra esta admissão
                  </div>
                )}
              </div>
            )}

            <p className="text-sm text-gray-600 dark:text-gray-400 pt-1 border-t border-gray-200 dark:border-gray-800">
              <strong>Enviar mais documentos:</strong> selecione os PDFs e
              confirme. Cada envio cria um novo envelope no Clicksign — docs
              já enviados antes vêm desmarcados.
            </p>
            {(() => {
              const novos = selecaoEnvio.arquivos.filter(a => !a.envios || a.envios.length === 0);
              const enviados = selecaoEnvio.arquivos.length - novos.length;
              return (
                <div className="flex items-center gap-3 text-[11px] text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800 pb-2 flex-wrap">
                  <span>
                    {selecaoEnvio.selecionados.size} selecionado(s) de {selecaoEnvio.arquivos.length}
                    {enviados > 0 && <> · {novos.length} novo(s), {enviados} já enviado(s)</>}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelecaoEnvio(prev => prev && {
                      ...prev,
                      selecionados: new Set(prev.arquivos.filter(a => !a.bloqueado).map(a => a.id)),
                    })}
                    className="text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    Marcar todos
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelecaoEnvio(prev => prev && {
                      ...prev,
                      selecionados: new Set(novos.map(a => a.id)),
                    })}
                    className="text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    Só os novos
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelecaoEnvio(prev => prev && {
                      ...prev,
                      selecionados: new Set(),
                    })}
                    className="text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    Desmarcar todos
                  </button>
                </div>
              );
            })()}
            <div className="space-y-1 max-h-[50vh] overflow-y-auto">
              {selecaoEnvio.arquivos.map(a => {
                const checked = selecaoEnvio.selecionados.has(a.id);
                const envios = a.envios || [];
                const jaEnviado = envios.length > 0;
                const bloqueado = !!a.bloqueado;
                return (
                  <label
                    key={a.id}
                    className={`flex items-start gap-2 p-2 rounded border transition-colors ${
                      bloqueado
                        ? "bg-gray-50 dark:bg-gray-900/40 border-gray-200 dark:border-gray-800 opacity-70 cursor-not-allowed"
                        : checked
                          ? "bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 cursor-pointer"
                          : jaEnviado
                            ? "bg-amber-50/40 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/60 cursor-pointer"
                            : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={bloqueado}
                      onChange={() => {
                        if (bloqueado) return;
                        setSelecaoEnvio(prev => {
                          if (!prev) return prev;
                          const next = new Set(prev.selecionados);
                          if (next.has(a.id)) next.delete(a.id);
                          else next.add(a.id);
                          return { ...prev, selecionados: next };
                        });
                      }}
                      className="w-4 h-4 mt-0.5 accent-indigo-600 flex-shrink-0 disabled:opacity-40"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-900 dark:text-gray-100 flex-1 truncate" title={a.name}>
                          {a.name}
                        </span>
                        {a.source === "externo" && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 whitespace-nowrap"
                            title="Este PDF está em outra pasta do Drive. Vou tentar baixar via API — se a conta conectada tiver permissão de leitura, vai."
                          >
                            📎 link externo
                          </span>
                        )}
                        {a.webViewLink && (
                          <a
                            href={a.webViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
                          >
                            ↗ ver
                          </a>
                        )}
                      </div>
                      {bloqueado && a.bloqueado && (
                        <div className="text-[10px] text-gray-700 dark:text-gray-300 mt-0.5">
                          {a.bloqueado.motivo}
                        </div>
                      )}
                      {jaEnviado && (
                        <div className="text-[10px] text-amber-800 dark:text-amber-300 mt-0.5 space-y-0.5 font-mono">
                          {envios.map((envio, idx) => (
                            <div key={envio.envelopeId + envio.enviadoEm} className="truncate" title={`Envelope ${envio.envelopeId}`}>
                              📨 {envios.length > 1 ? `#${idx + 1} ` : ""}
                              enviado em {fmtDateTime(envio.enviadoEm)}
                              {" · "}
                              <span className="text-amber-700/80 dark:text-amber-400/80">
                                env: {envio.envelopeId.slice(0, 8)}…{envio.envelopeId.slice(-4)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
            {clicksignErro && (
              <div className="text-xs text-rose-600 dark:text-rose-400 whitespace-pre-wrap">{clicksignErro}</div>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
              <Button
                variant="secondary"
                onClick={() => setSelecaoEnvio(null)}
                disabled={clicksignBusy !== ""}
              >
                Cancelar
              </Button>
              <Button
                onClick={confirmarEnvioClicksign}
                disabled={clicksignBusy !== "" || selecaoEnvio.selecionados.size === 0}
              >
                {clicksignBusy === "enviando"
                  ? "Enviando…"
                  : `Enviar ${selecaoEnvio.selecionados.size} documento(s)`}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
