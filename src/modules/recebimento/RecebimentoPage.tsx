// ════════════════════════════════════════════════════════════════════════════
//  Recebimento de produtos — conferência de notas fiscais.
//
//  Fluxo: o usuário anexa a nota (foto via câmera/galeria ou PDF), marca se
//  recebeu tudo nos conformes ou se houve divergência (descreve + foto opcional),
//  confere os dados da nota (emissor, valor, data de emissão) e salva. O arquivo
//  da nota sobe pro Drive, na subpasta da SEMANA do recebimento (seg→dom,
//  "dd.mm.aa a dd.mm.aa"), dentro da pasta configurada nas Configurações.
//
//  Os lançamentos ficam organizados aqui na tabela (por data/hora de recebimento),
//  com export PDF/XLSX. OCR (pré-preenche os campos) entra como Fase 2.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { addDoc, collection, deleteDoc, deleteField, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import { Modal } from "../../core/ui/Modal";
import type { BoletoNota, DuplicataNota, FormaPagamento, ItemNota, RecebimentoNota, TipoDocumento } from "../../core/types";
import { FORMA_PAGAMENTO_LABEL, TIPO_DOCUMENTO_LABEL, CONTA_FIXA_CATEGORIAS } from "../../core/types";
import { pickDriveFolder } from "../../core/google/drivePicker";
import { requestAccessToken, findOrCreateSubfolder, uploadFileToFolder } from "../../core/google/driveClient";
import { centralConfigured, centralEnsureRoot, centralEnsureFolder, centralEnsureWeek, centralUpload, centralMoveFolder, parseDriveFolderId } from "../../core/google/driveCentral";
import { authHeader } from "../../core/firebase/idToken";

// Dispatch: conta central (backend) × OAuth do navegador (fallback). `central`
// é resolvido uma vez por salvamento.
async function ensureSemanaFolder(central: boolean, parentId: string, label: string): Promise<string> {
  return central ? centralEnsureWeek(parentId, label) : findOrCreateSubfolder(parentId, label);
}
async function subirArquivo(central: boolean, parentId: string, file: File): Promise<{ id: string; webViewLink?: string; name: string }> {
  if (central) return centralUpload(parentId, file);
  const s = await uploadFileToFolder(parentId, file);
  return { id: s.id, name: s.name, ...(s.webViewLink ? { webViewLink: s.webViewLink } : {}) };
}
import { exportarRecebimentosPDF, exportarRecebimentosXLSX } from "./exportRecebimentos";

// Arquivo → base64 (sem o prefixo data:...;base64,).
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || "").split(",")[1] || "");
    r.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    r.readAsDataURL(file);
  });
}

// Bloco pro OCR: imagens são redimensionadas/comprimidas (canvas) pra não
// estourar o limite de payload da função serverless (Vercel ~4,5 MB) quando há
// várias páginas. PDFs vão sem alteração. O arquivo ORIGINAL é o que sobe pro Drive.
async function paraOcrBlock(file: File): Promise<{ data: string; mediaType: string }> {
  if (!file.type.startsWith("image/")) {
    return { data: await fileToBase64(file), mediaType: file.type || "application/pdf" };
  }
  try {
    const bitmap = await createImageBitmap(file);
    const maxLado = 1600; // suficiente pra OCR; reduz bastante o tamanho
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * escala));
    const h = Math.max(1, Math.round(bitmap.height * escala));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("sem contexto 2d");
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    const b64 = dataUrl.split(",")[1] || "";
    if (b64) return { data: b64, mediaType: "image/jpeg" };
  } catch { /* fallback abaixo: manda o original */ }
  return { data: await fileToBase64(file), mediaType: file.type || "image/jpeg" };
}

// Processa a imagem antes de subir: opcionalmente aplica filtro "scanner"
// (cinza + contraste, pra ficar legível como documento) e carimba um selo no
// rodapé (quem recebeu + data/hora). Devolve um novo File JPEG. PDFs voltam
// sem alteração.
async function carimbarImagem(file: File, linhas: string[], scan = false): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (!linhas.length && !scan) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const maxLado = 2400; // resolução maior pra leitura humana do documento
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * escala));
    const h = Math.max(1, Math.round(bitmap.height * escala));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    // Filtro "scanner": cinza de alto contraste — fundo branco, texto preto.
    if (scan) {
      try {
        const img = ctx.getImageData(0, 0, w, h);
        const px = img.data;
        const contraste = 1.7, brilho = 10;
        for (let i = 0; i < px.length; i += 4) {
          let g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          g = (g - 128) * contraste + 128 + brilho;
          g = g < 0 ? 0 : g > 255 ? 255 : g;
          px[i] = px[i + 1] = px[i + 2] = g;
        }
        ctx.putImageData(img, 0, 0);
      } catch { /* getImageData pode falhar; segue sem o filtro */ }
    }
    if (!linhas.length) {
      const blob0: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.82));
      if (blob0) return new File([blob0], file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", { type: "image/jpeg" });
      return file;
    }
    const fonte = Math.max(13, Math.round(w / 48));
    const pad = Math.round(fonte * 0.45);
    const alturaBox = (fonte + pad) * linhas.length + pad;
    ctx.fillStyle = "rgba(0,0,0,0.58)";
    ctx.fillRect(0, h - alturaBox, w, alturaBox);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${fonte}px -apple-system, Helvetica, Arial, sans-serif`;
    ctx.textBaseline = "top";
    linhas.forEach((linha, i) => ctx.fillText(linha, pad, h - alturaBox + pad + i * (fonte + pad)));
    const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.85));
    if (!blob) return file;
    const nome = file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg";
    return new File([blob], nome, { type: "image/jpeg" });
  } catch { return file; }
}

const pad = (n: number) => String(n).padStart(2, "0");
const fmtBRL = (v?: number) => v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDataHora = (iso: string) => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtDataBR = (ymd?: string) => ymd ? ymd.split("-").reverse().join("/") : "—";

// Vencimentos das faturas (mais cedo primeiro), só as datas YYYY-MM-DD.
function vencimentosDe(n: RecebimentoNota): string[] {
  return [...(n.duplicatas || [])]
    .filter((d) => d.vencimento)
    .sort((a, b) => (a.vencimento || "").localeCompare(b.vencimento || ""))
    .map((d) => d.vencimento as string);
}

// Semana de segunda a domingo que contém a data, com rótulo "dd.mm.aa a dd.mm.aa".
function semanaDe(d: Date): { label: string } {
  const day = d.getDay();                 // 0=dom … 6=sáb
  const diffSeg = day === 0 ? -6 : 1 - day;
  const seg = new Date(d); seg.setDate(d.getDate() + diffSeg); seg.setHours(0, 0, 0, 0);
  const dom = new Date(seg); dom.setDate(seg.getDate() + 6);
  const f = (x: Date) => `${pad(x.getDate())}.${pad(x.getMonth() + 1)}.${String(x.getFullYear()).slice(2)}`;
  return { label: `${f(seg)} a ${f(dom)}` };
}

const FORMAS_PAGAMENTO: FormaPagamento[] = ["boleto", "cartao", "dinheiro", "pix"];
const FORMA_PAGAMENTO_ICONE: Record<FormaPagamento, string> = { boleto: "🧾", cartao: "💳", dinheiro: "💵", pix: "⚡" };

// Seletor de forma de pagamento (chips). Clicar no selecionado limpa (volta a opcional).
function FormaPagamentoSelector({ value, onChange }: { value?: FormaPagamento; onChange: (v?: FormaPagamento) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {FORMAS_PAGAMENTO.map((f) => {
        const ativo = value === f;
        return (
          <button key={f} type="button" onClick={() => onChange(ativo ? undefined : f)}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg border ${ativo ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>
            {FORMA_PAGAMENTO_ICONE[f]} {FORMA_PAGAMENTO_LABEL[f]}
          </button>
        );
      })}
    </div>
  );
}

// "R$ 1.234,56" / "1234,56" / "1234.56" → 1234.56
function parseBRL(s: string): number | undefined {
  const t = (s || "").replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : undefined;
}

export function RecebimentoPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurant = restaurants.find((r) => r.id === rid) || null;
  const { can, canModulo, loading: permLoading } = useCanAcao(rid);
  const podeReceber = can("recebimento", "receber");
  const podeVer = can("recebimento", "ver");
  const podeEditar = can("recebimento", "editar");
  const podeConfig = can("recebimento", "configurar");
  const temAcesso = canModulo("recebimento");

  const [tab, setTab] = useState<"receber" | "notas" | "conferidos" | "excluidos" | "config">("receber");
  const [notas, setNotas] = useState<RecebimentoNota[]>([]);
  const [novo, setNovo] = useState(false);
  const [escolhendoTipo, setEscolhendoTipo] = useState(false);
  const [escolhendoFonte, setEscolhendoFonte] = useState(false);
  const [arquivoInicial, setArquivoInicial] = useState<File | null>(null);
  const [tipoSel, setTipoSel] = useState<TipoDocumento>("nota_fiscal");
  const [categoriaSel, setCategoriaSel] = useState<string>("");
  const [erro, setErro] = useState("");
  const [exportando, setExportando] = useState<"" | "pdf" | "xlsx">("");

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "recebimentos"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setNotas(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as RecebimentoNota));
    });
    return () => unsub();
  }, [rid]);

  const ordenadasTodas = useMemo(
    () => [...notas].sort((a, b) => (b.recebidoEm || "").localeCompare(a.recebidoEm || "")),
    [notas],
  );
  const ordenadas = useMemo(() => ordenadasTodas.filter((n) => !n.excluidoEm), [ordenadasTodas]);      // não-excluídas (export)
  const pendentes = useMemo(() => ordenadas.filter((n) => !n.conferidoEm), [ordenadas]);               // a conferir (lista principal)
  const conferidas = useMemo(() => ordenadas.filter((n) => n.conferidoEm).sort((a, b) => (b.conferidoEm || "").localeCompare(a.conferidoEm || "")), [ordenadas]);
  const excluidas = useMemo(() => ordenadasTodas.filter((n) => n.excluidoEm).sort((a, b) => (b.excluidoEm || "").localeCompare(a.excluidoEm || "")), [ordenadasTodas]);
  const purgandoRef = useRef<Set<string>>(new Set());

  // Purga automática: excluídas há mais de 60 dias somem de vez (registro apagado; arquivos no Drive permanecem).
  useEffect(() => {
    const limite = Date.now() - 60 * 24 * 60 * 60 * 1000;
    for (const n of excluidas) {
      if (!n.excluidoEm || new Date(n.excluidoEm).getTime() > limite) continue;
      if (purgandoRef.current.has(n.id)) continue;
      purgandoRef.current.add(n.id);
      deleteDoc(doc(db, "recebimentos", n.id)).catch(() => purgandoRef.current.delete(n.id));
    }
  }, [excluidas]);

  async function exportar(tipo: "pdf" | "xlsx") {
    if (!ordenadas.length) return;
    setErro(""); setExportando(tipo);
    try {
      if (tipo === "pdf") await exportarRecebimentosPDF(ordenadas, restaurant?.nome || "");   // inclui pendentes + conferidas
      else await exportarRecebimentosXLSX(ordenadas, restaurant?.nome || "");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao exportar.");
    } finally { setExportando(""); }
  }

  // Conferido pelo escritório → vai pro histórico de Conferidos (nunca apaga). Reversível.
  async function conferir(n: RecebimentoNota) {
    try { await updateDoc(doc(db, "recebimentos", n.id), { conferidoEm: new Date().toISOString(), conferidoPor: { id: me?.id || "", nome: me?.nome || "?" } }); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falha ao conferir."); }
  }
  // Desfaz a conferência → volta pra lista de pendentes.
  async function desconferir(n: RecebimentoNota) {
    try { await updateDoc(doc(db, "recebimentos", n.id), { conferidoEm: deleteField(), conferidoPor: deleteField() }); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falha ao desfazer conferência."); }
  }

  // Soft delete: vai pra "Excluídos" (restaurável). Os arquivos no Drive ficam onde estão.
  async function excluir(n: RecebimentoNota) {
    if (!window.confirm(`Mover o recebimento de ${n.emissor || "nota sem emissor"} (${fmtDataHora(n.recebidoEm)}) para Excluídos?\n\nDá pra restaurar depois na aba "Excluídos". Nada é apagado de verdade.`)) return;
    try { await updateDoc(doc(db, "recebimentos", n.id), { excluidoEm: new Date().toISOString(), excluidoPor: { id: me?.id || "", nome: me?.nome || "?" } }); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falha ao excluir."); }
  }

  // Restaura uma nota excluída.
  async function restaurar(n: RecebimentoNota) {
    try { await updateDoc(doc(db, "recebimentos", n.id), { excluidoEm: deleteField(), excluidoPor: deleteField() }); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falha ao restaurar."); }
  }

  // Exclusão definitiva (só config): move os arquivos pra "excluídos" no Drive + apaga o doc.
  async function excluirDefinitivo(n: RecebimentoNota) {
    if (!window.confirm(`Excluir DEFINITIVAMENTE o recebimento de ${n.emissor || "nota sem emissor"} (${fmtDataHora(n.recebidoEm)})?\n\nO registro é apagado e os arquivos (nota, páginas, boletos) vão pra "excluídos" no Drive. Não dá pra desfazer.`)) return;
    try {
      const fileIds = [
        n.notaDriveFileId,
        n.fotoDivergenciaDriveFileId,
        ...(n.notaPaginas || []).map((p) => p.driveFileId),
        ...(n.boletos || []).map((b) => b.driveFileId),
        ...(n.comprovantes || []).map((c) => c.driveFileId),
      ].filter((x): x is string => !!x);
      if (fileIds.length && restaurant?.recebimentoDriveFolderId && (await centralConfigured())) {
        const excluidosId = await centralEnsureFolder(restaurant.recebimentoDriveFolderId, "excluídos");
        for (const fid of fileIds) { try { await centralMoveFolder(fid, excluidosId); } catch { /* segue — best-effort */ } }
      }
      await deleteDoc(doc(db, "recebimentos", n.id));
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao excluir definitivamente."); }
  }

  if (!restaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (permLoading) return <div className="text-gray-400 py-12 text-center text-sm">Carregando…</div>;
  if (!temAcesso) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-600 dark:text-gray-400">Você não tem acesso ao Recebimento.</p>
      </div>
    );
  }

  // Abas disponíveis conforme permissão; a efetiva é a 1ª válida.
  const abas: Array<"receber" | "notas" | "conferidos" | "excluidos" | "config"> = [];
  if (podeReceber) abas.push("receber");
  if (podeVer) abas.push("notas");
  if (podeVer && conferidas.length > 0) abas.push("conferidos");
  if (podeConfig && excluidas.length > 0) abas.push("excluidos");
  if (podeConfig) abas.push("config");
  const abaEfetiva = abas.includes(tab) ? tab : (abas[0] || "receber");

  const abrirNovo = (arquivo: File | null) => { setErro(""); setArquivoInicial(arquivo); setEscolhendoFonte(false); setNovo(true); };

  const TabBtn = ({ k, label }: { k: "receber" | "notas" | "conferidos" | "excluidos" | "config"; label: string }) => (
    <button type="button" onClick={() => setTab(k)}
      className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${abaEfetiva === k ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-gray-500"}`}>
      {label}
    </button>
  );

  return (
    <div className="max-w-7xl space-y-4">
      {/* Abas */}
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800 overflow-x-auto overflow-y-hidden whitespace-nowrap">
        {podeReceber && <TabBtn k="receber" label="🧾 Recebimento" />}
        {podeVer && <TabBtn k="notas" label="📋 Notas recebidas" />}
        {podeVer && conferidas.length > 0 && <TabBtn k="conferidos" label={`✅ Conferidas (${conferidas.length})`} />}
        {podeConfig && excluidas.length > 0 && <TabBtn k="excluidos" label={`🗑 Excluídos (${excluidas.length})`} />}
        {podeConfig && <TabBtn k="config" label="⚙️ Configurações" />}
      </div>

      {erro && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}

      {/* Aba Recebimento — botão grande "Novo recebimento" */}
      {abaEfetiva === "receber" && podeReceber && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <button type="button" onClick={() => { setErro(""); setEscolhendoTipo(true); }}
            className="flex flex-col items-center justify-center gap-3 w-full max-w-sm py-10 rounded-2xl border-2 border-dashed border-indigo-300 dark:border-indigo-700 bg-indigo-50/50 dark:bg-indigo-950/20 hover:bg-indigo-100/60 dark:hover:bg-indigo-950/40 transition">
            <span className="text-5xl">🧾</span>
            <span className="text-lg font-semibold text-indigo-700 dark:text-indigo-300">Novo recebimento</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">Toque pra dar entrada</span>
          </button>
        </div>
      )}

      {abaEfetiva === "config" && podeConfig && <RecebimentoConfig rid={rid} restaurant={restaurant} />}

      {abaEfetiva === "notas" && podeVer && (
        <div className="space-y-3">
          {ordenadas.length > 0 && (
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" disabled={!!exportando} onClick={() => void exportar("xlsx")}>
                {exportando === "xlsx" ? "Gerando…" : "⬇ XLSX"}
              </Button>
              <Button size="sm" variant="secondary" disabled={!!exportando} onClick={() => void exportar("pdf")}>
                {exportando === "pdf" ? "Gerando…" : "⬇ PDF"}
              </Button>
            </div>
          )}
          <RecebimentoTabela notas={pendentes} restaurant={restaurant} podeEditar={podeEditar} podeConfig={podeConfig} onExcluir={excluir} onConferir={podeEditar ? conferir : undefined} />
        </div>
      )}

      {abaEfetiva === "conferidos" && podeVer && (
        <div className="space-y-2">
          <p className="text-[12px] text-gray-500">Notas <strong>conferidas pelo escritório</strong>. Este histórico nunca é apagado. Dá pra desfazer a conferência se precisar revisar.</p>
          {conferidas.map((n) => (
            <div key={n.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-800 dark:text-gray-100 truncate max-w-[260px]" title={n.emissor || ""}>{n.emissor || "— sem emissor —"}</span>
                  <span className="tabular-nums font-semibold text-gray-700 dark:text-gray-200">{fmtBRL(n.valorTotal)}</span>
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5">{tipoLabelDe(n)}{n.numeroNota ? ` · NF ${n.numeroNota}` : ""} · ✓ conferido {n.conferidoEm ? fmtDataHora(n.conferidoEm) : ""}{n.conferidoPor?.nome ? ` · ${n.conferidoPor.nome}` : ""}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {n.notaDriveUrl && (
                  <a href={n.notaDriveUrl} target="_blank" rel="noreferrer" title="Abrir nota no Drive"
                    className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-gray-500 bg-gray-50 dark:bg-gray-800 hover:text-indigo-600 transition-colors">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></svg>
                  </a>
                )}
                {podeEditar && <Button size="sm" variant="secondary" onClick={() => void desconferir(n)}>↩ Desfazer</Button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {abaEfetiva === "excluidos" && podeConfig && (
        <div className="space-y-2">
          <p className="text-[12px] text-gray-500">Recebimentos movidos pra cá podem ser <strong>restaurados</strong>. Somem sozinhos depois de <strong>60 dias</strong> (o registro é apagado; os arquivos no Drive permanecem). A exclusão definitiva apaga o registro na hora e move os arquivos do Drive pra "excluídos".</p>
          {excluidas.map((n) => (
            <div key={n.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-800 dark:text-gray-100 truncate max-w-[260px]" title={n.emissor || ""}>{n.emissor || "— sem emissor —"}</span>
                  <span className="tabular-nums font-semibold text-gray-700 dark:text-gray-200">{fmtBRL(n.valorTotal)}</span>
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5">{tipoLabelDe(n)}{n.numeroNota ? ` · NF ${n.numeroNota}` : ""} · excluído {n.excluidoEm ? fmtDataHora(n.excluidoEm) : ""}{n.excluidoPor?.nome ? ` · ${n.excluidoPor.nome}` : ""}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button size="sm" variant="secondary" onClick={() => void restaurar(n)}>↩ Restaurar</Button>
                <button type="button" onClick={() => void excluirDefinitivo(n)} title="Excluir definitivamente"
                  className="text-[12px] text-rose-600 hover:text-rose-700 hover:underline px-1">Excluir definitivo</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {escolhendoTipo && (
        <EscolhaTipoModal
          onClose={() => setEscolhendoTipo(false)}
          onConfirm={(tipo, categoria) => { setTipoSel(tipo); setCategoriaSel(categoria); setEscolhendoTipo(false); setEscolhendoFonte(true); }}
        />
      )}

      {escolhendoFonte && (
        <EscolhaFonteModal
          onClose={() => setEscolhendoFonte(false)}
          onArquivo={(f) => abrirNovo(f)}
          onManual={() => abrirNovo(null)}
        />
      )}

      {novo && (
        <NovoRecebimentoModal
          rid={rid}
          restaurant={restaurant}
          por={{ id: me?.id || "", nome: me?.nome || "?" }}
          arquivoInicial={arquivoInicial}
          tipoDocumento={tipoSel}
          contaCategoria={categoriaSel}
          onClose={() => { setNovo(false); setArquivoInicial(null); }}
          onSalvo={() => { setNovo(false); setArquivoInicial(null); }}
        />
      )}
    </div>
  );
}

// ─── Modal: escolher o tipo do documento (1º passo) ─────────────────────────
function EscolhaTipoModal({ onClose, onConfirm }: {
  onClose: () => void;
  onConfirm: (tipo: TipoDocumento, categoria: string) => void;
}) {
  const [tipo, setTipo] = useState<TipoDocumento | null>(null);
  const [categoria, setCategoria] = useState("");
  const Opcao = ({ icon, label, t }: { icon: string; label: string; t: TipoDocumento }) => (
    <button type="button" onClick={() => { if (t === "conta_fixa") setTipo("conta_fixa"); else onConfirm(t, ""); }}
      className={`flex flex-col items-center justify-center gap-2 py-6 rounded-2xl border transition ${tipo === t ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950/30" : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
      <span className="text-3xl">{icon}</span>
      <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{label}</span>
    </button>
  );
  return (
    <Modal title="O que você vai dar entrada?" onClose={onClose} maxWidth="max-w-sm">
      <div className="grid grid-cols-2 gap-3">
        <Opcao icon="🧾" label="DANFE" t="nota_fiscal" />
        <Opcao icon="🧮" label="Cupom fiscal" t="cupom_fiscal" />
        <Opcao icon="📦" label="Romaneio" t="romaneio" />
        <Opcao icon="💡" label="Conta fixa" t="conta_fixa" />
      </div>
      {tipo === "conta_fixa" && (
        <div className="mt-4 space-y-2">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block">Qual conta?</label>
          <div className="flex flex-wrap gap-2">
            {CONTA_FIXA_CATEGORIAS.map((c) => (
              <button key={c} type="button" onClick={() => setCategoria(c)}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg border ${categoria === c ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>
                {c}
              </button>
            ))}
          </div>
          <div className="flex justify-end pt-1">
            <Button size="sm" disabled={!categoria} onClick={() => onConfirm("conta_fixa", categoria)}>Continuar →</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── Modal: escolher fonte (câmera / galeria / arquivo / manual) ─────────────
// `semManual` esconde a opção Manual — usado ao adicionar páginas extras.
function EscolhaFonteModal({ titulo, semManual, onClose, onArquivo, onManual }: {
  titulo?: string;
  semManual?: boolean;
  onClose: () => void;
  onArquivo: (f: File) => void;
  onManual?: () => void;
}) {
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const Opcao = ({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) => (
    <button type="button" onClick={onClick}
      className="flex flex-col items-center justify-center gap-2 py-6 rounded-2xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
      <span className="text-3xl">{icon}</span>
      <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{label}</span>
    </button>
  );
  return (
    <Modal title={titulo || "Como você quer dar entrada?"} onClose={onClose} maxWidth="max-w-sm">
      <div className={`grid ${semManual ? "grid-cols-3" : "grid-cols-2"} gap-3`}>
        <Opcao icon="📷" label="Câmera" onClick={() => camRef.current?.click()} />
        <Opcao icon="🖼️" label="Galeria" onClick={() => galRef.current?.click()} />
        <Opcao icon="📄" label="Arquivo (PDF)" onClick={() => pdfRef.current?.click()} />
        {!semManual && <Opcao icon="✍️" label="Manual" onClick={() => onManual?.()} />}
      </div>
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) onArquivo(f); }} />
      <input ref={galRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) onArquivo(f); }} />
      <input ref={pdfRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) onArquivo(f); }} />
      {!semManual && <p className="text-[11px] text-gray-400 mt-3 text-center">Câmera, galeria e PDF fazem a leitura automática. "Manual" abre o formulário em branco.</p>}
    </Modal>
  );
}

// ─── Configurações: pasta do Drive ──────────────────────────────────────────
function RecebimentoConfig({ rid, restaurant }: { rid: string; restaurant: { nome?: string; recebimentoDriveFolderId?: string; recebimentoDriveFolderNome?: string } }) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [central, setCentral] = useState<boolean | null>(null);
  const [destino, setDestino] = useState("");

  useEffect(() => { void centralConfigured().then(setCentral); }, []);

  // Navegador (fallback): escolhe a pasta no Drive do próprio usuário.
  async function escolherPasta() {
    setErro("");
    try {
      const pasta = await pickDriveFolder("Pasta das notas de recebimento");
      if (!pasta) return;
      setSalvando(true);
      await updateDoc(doc(db, "restaurants", rid), {
        recebimentoDriveFolderId: pasta.id,
        recebimentoDriveFolderNome: pasta.name,
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao selecionar a pasta.");
    } finally { setSalvando(false); }
  }

  // Conta central: cria "Recebimentos — <restaurante>" dentro do destino colado
  // (link do Drive) ou no raiz da conta central se o campo estiver vazio.
  async function inicializarCentral() {
    setErro(""); setSalvando(true);
    try {
      const nome = restaurant.nome || "Restaurante";
      let folderId: string;
      const parent = destino.trim() ? parseDriveFolderId(destino) : null;
      if (destino.trim() && !parent) throw new Error("Link/ID da pasta de destino inválido.");
      if (parent) folderId = await centralEnsureFolder(parent, `Recebimentos — ${nome}`);
      else folderId = (await centralEnsureRoot(nome)).folderId;
      await updateDoc(doc(db, "restaurants", rid), {
        recebimentoDriveFolderId: folderId,
        recebimentoDriveFolderNome: `Recebimentos — ${nome}`,
      });
      setDestino("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao inicializar a pasta central.");
    } finally { setSalvando(false); }
  }

  // Move a pasta já criada pra dentro do destino colado (id não muda).
  async function moverParaDestino() {
    setErro("");
    const parent = parseDriveFolderId(destino);
    if (!parent) { setErro("Cole um link/ID de pasta do Drive válido."); return; }
    if (!restaurant.recebimentoDriveFolderId) { setErro("Não há pasta pra mover ainda."); return; }
    setSalvando(true);
    try {
      await centralMoveFolder(restaurant.recebimentoDriveFolderId, parent);
      setDestino("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao mover a pasta.");
    } finally { setSalvando(false); }
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3 max-w-2xl">
      <h3 className="font-semibold text-gray-900 dark:text-gray-100">Pasta do Drive pras notas</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        As notas recebidas são arquivadas aqui. O sistema cria automaticamente subpastas por semana (segunda→domingo), nomeadas <code>dd.mm.aa a dd.mm.aa</code>.
      </p>
      {central === true && (
        <p className="text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2">
          ✓ Conta central do Drive ativa — os operadores não precisam conectar o próprio Drive. Os arquivos ficam na conta central.
        </p>
      )}
      {erro && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}
      <div className="flex items-center gap-3">
        <div className="flex-1 text-sm">
          {restaurant.recebimentoDriveFolderId
            ? <span className="text-emerald-700 dark:text-emerald-300">📁 {restaurant.recebimentoDriveFolderNome || "pasta selecionada"}</span>
            : <span className="text-amber-600">Nenhuma pasta selecionada</span>}
        </div>
        {central !== true && (
          <Button variant="secondary" size="sm" disabled={salvando} onClick={() => void escolherPasta()}>
            {salvando ? "Salvando…" : restaurant.recebimentoDriveFolderId ? "Trocar pasta" : "Selecionar pasta"}
          </Button>
        )}
      </div>
      {central === true && (
        <div className="space-y-2 pt-1 border-t border-gray-100 dark:border-gray-800">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block">Onde guardar no Drive <span className="font-normal text-gray-400">— opcional</span></label>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">Cole o link de uma pasta do Drive (ex: de um Shared Drive) pra criar/mover lá dentro. Vazio = raiz da conta central.</p>
          <input value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="https://drive.google.com/drive/folders/…"
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
          <div className="flex gap-2 flex-wrap">
            <Button variant="secondary" size="sm" disabled={salvando} onClick={() => void inicializarCentral()}>
              {salvando ? "Criando…" : restaurant.recebimentoDriveFolderId ? "Recriar pasta aqui" : "Inicializar pasta central"}
            </Button>
            {restaurant.recebimentoDriveFolderId && (
              <Button variant="secondary" size="sm" disabled={salvando || !destino.trim()} onClick={() => void moverParaDestino()}>
                Mover pasta atual pra cá
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tabela de recebimentos ─────────────────────────────────────────────────
// Chaves de ordenação: as fixas + "venc:<i>" (coluna de vencimento dinâmica).
type SortKey = "recebido" | "tipo" | "emissao" | "nf" | "emissor" | "valor" | "recebeu" | "conforme" | "pgto" | `venc:${number}`;
const tipoLabelDe = (n: RecebimentoNota): string => n.tipoDocumento
  ? TIPO_DOCUMENTO_LABEL[n.tipoDocumento] + (n.tipoDocumento === "conta_fixa" && n.contaCategoria ? ` · ${n.contaCategoria}` : "")
  : "—";
function RecebimentoTabela({ notas, restaurant, podeEditar, podeConfig, onExcluir, onConferir }: {
  notas: RecebimentoNota[];
  restaurant: { recebimentoDriveFolderId?: string };
  podeEditar: boolean;
  podeConfig: boolean;
  onExcluir: (n: RecebimentoNota) => void;
  onConferir?: (n: RecebimentoNota) => void;
}) {
  const temAcoes = !!onConferir || podeConfig;
  const [detalhe, setDetalhe] = useState<RecebimentoNota | null>(null);
  const [editar, setEditar] = useState<RecebimentoNota | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("recebido");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function ordenarPor(k: SortKey) {
    if (k === sortKey) { setSortDir((d) => (d === "asc" ? "desc" : "asc")); return; }
    setSortKey(k);
    // Vencimento e datas com texto: padrão crescente p/ venc (mais próximo 1º); desc p/ recebido/emissão/valor.
    setSortDir(k === "recebido" || k === "emissao" || k === "valor" ? "desc" : "asc");
  }

  const ordenadas = useMemo(() => {
    const val = (n: RecebimentoNota): string | number => {
      if (sortKey.startsWith("venc:")) {
        const i = parseInt(sortKey.slice(5), 10);
        // Sem essa parcela → joga pro fim (sentinela alta).
        return vencimentosDe(n)[i] || "9999-12-31";
      }
      switch (sortKey) {
        case "recebido": return n.recebidoEm || "";
        case "tipo": return tipoLabelDe(n);
        case "emissao": return n.dataEmissao || "";
        case "nf": { const x = parseInt((n.numeroNota || "").replace(/\D/g, ""), 10); return Number.isFinite(x) ? x : -1; }
        case "emissor": return (n.emissor || "").toLowerCase();
        case "valor": return n.valorTotal ?? -1;
        case "recebeu": return (n.recebidoPor?.nome || "").toLowerCase();
        case "conforme": return n.conforme ? 1 : 0;
        case "pgto": return n.formaPagamento ? FORMA_PAGAMENTO_LABEL[n.formaPagamento] : "~";
        default: return "";
      }
    };
    const arr = [...notas];
    arr.sort((a, b) => {
      const va = val(a), vb = val(b);
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "pt-BR");
      return sortDir === "asc" ? c : -c;
    });
    return arr;
  }, [notas, sortKey, sortDir]);

  if (notas.length === 0) {
    return <div className="text-center text-sm text-gray-400 py-12">Tudo conferido! Nenhuma nota pendente.</div>;
  }

  const seta = (k: SortKey) => sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "";
  const Th = ({ k, label, alinhar }: { k: SortKey; label: string; alinhar?: "right" | "center" }) => (
    <th className={`px-4 py-2.5 ${alinhar === "right" ? "text-right" : alinhar === "center" ? "text-center" : ""}`}>
      <button type="button" onClick={() => ordenarPor(k)}
        className={`font-medium hover:text-gray-700 dark:hover:text-gray-200 ${sortKey === k ? "text-gray-800 dark:text-gray-100 font-semibold" : ""}`}>
        {label}{seta(k)}
      </button>
    </th>
  );

  return (
    <>
    {/* Desktop: tabela */}
    <div className="hidden sm:block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-200 dark:border-gray-800">
            <Th k="emissor" label="Emissor" />
            <Th k="emissao" label="Emissão" />
            <Th k="valor" label="Valor" alinhar="right" />
            <Th k="conforme" label="Conforme?" alinhar="center" />
            <Th k="venc:0" label="Vencimento" />
            <Th k="pgto" label="Pgto" />
            <th className="px-4 py-2.5 font-medium text-center">Nota</th>
            {temAcoes && <th className="px-4 py-2.5 font-medium text-right">Ações</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {ordenadas.map((n) => { const vs = vencimentosDe(n); return (
            <tr key={n.id} className={`group transition-colors ${n.conforme ? "hover:bg-gray-50 dark:hover:bg-gray-800/40" : "bg-rose-50/50 dark:bg-rose-950/10 hover:bg-rose-50 dark:hover:bg-rose-950/20"}`}>
              {/* Emissor — clicável abre detalhes; tipo · NF · recebido em na sublinha */}
              <td className="px-4 py-3">
                <button type="button" onClick={() => setDetalhe(n)} className="flex flex-col items-start text-left max-w-[280px] group/btn">
                  <span className="font-semibold text-gray-800 dark:text-gray-100 truncate max-w-[280px] group-hover/btn:text-indigo-600 dark:group-hover/btn:text-indigo-400" title={n.emissor || ""}>{n.emissor || "— sem emissor —"}</span>
                  <span className="text-[11px] text-gray-400 truncate max-w-[280px]">
                    {tipoLabelDe(n)}{n.numeroNota ? ` · NF ${n.numeroNota}${n.serieNota ? `/${n.serieNota}` : ""}` : ""} · {fmtDataHora(n.recebidoEm)}
                  </span>
                </button>
              </td>
              <td className="px-4 py-3 tabular-nums text-gray-500">{fmtDataBR(n.dataEmissao) || "—"}</td>
              <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-800 dark:text-gray-100">{fmtBRL(n.valorTotal)}</td>
              <td className="px-4 py-3 text-center">
                {n.conforme
                  ? <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">✓ Sim</span>
                  : <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" title={n.divergencia || ""}>⚠ Não</span>}
              </td>
              <td className="px-4 py-3 tabular-nums text-gray-500 whitespace-nowrap">
                {vs.length === 0 ? "—" : (
                  <>{fmtDataBR(vs[0])}{vs.length > 1 && <span className="ml-1.5 text-[10px] text-gray-400" title={`${vs.length} parcelas: ${vs.map(fmtDataBR).join(", ")}`}>+{vs.length - 1}</span>}</>
                )}
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-gray-600 dark:text-gray-300">{n.formaPagamento ? `${FORMA_PAGAMENTO_ICONE[n.formaPagamento]} ${FORMA_PAGAMENTO_LABEL[n.formaPagamento]}` : "—"}</td>
              <td className="px-4 py-3 text-center">
                {n.notaDriveUrl ? (
                  <span className="inline-flex items-center gap-1.5">
                    <a href={n.notaDriveUrl} target="_blank" rel="noreferrer" title="Abrir nota no Drive"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors">
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></svg>
                    </a>
                    {n.notaPaginas && n.notaPaginas.length > 1 && <span className="text-[10px] text-gray-400" title={`${n.notaPaginas.length} páginas`}>📄{n.notaPaginas.length}</span>}
                    {n.boletos && n.boletos.length > 0 && <span className="text-[10px] text-gray-400" title={`${n.boletos.length} boleto(s) anexado(s)`}>🧾{n.boletos.length}</span>}
                  </span>
                ) : <span className="text-gray-300">—</span>}
              </td>
              {temAcoes && (
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    {onConferir && (
                      <button type="button" onClick={() => onConferir(n)} title="Marcar como conferido pelo escritório"
                        className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg text-[12px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                        Conferir
                      </button>
                    )}
                    {podeConfig && (
                      <button type="button" onClick={() => onExcluir(n)} title="Excluir recebimento"
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
                      </button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ); })}
        </tbody>
      </table>
    </div>
    {/* Mobile: cards */}
    <div className="sm:hidden space-y-2">
      {ordenadas.map((n) => { const vs = vencimentosDe(n); return (
        <div key={n.id} className={`rounded-xl border p-3 ${n.conforme ? "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800" : "bg-rose-50/60 dark:bg-rose-950/15 border-rose-200 dark:border-rose-900/40"}`}>
          <button type="button" onClick={() => setDetalhe(n)} className="w-full flex items-start justify-between gap-3 text-left">
            <div className="min-w-0">
              <div className="font-semibold text-gray-800 dark:text-gray-100 truncate" title={n.emissor || ""}>{n.emissor || "— sem emissor —"}</div>
              <div className="text-[11px] text-gray-400 truncate">{tipoLabelDe(n)}{n.numeroNota ? ` · NF ${n.numeroNota}${n.serieNota ? `/${n.serieNota}` : ""}` : ""}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-bold text-gray-800 dark:text-gray-100 tabular-nums">{fmtBRL(n.valorTotal)}</div>
              {n.conforme
                ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">✓ Conforme</span>
                : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">⚠ Divergência</span>}
            </div>
          </button>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-[12px] text-gray-500">
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="tabular-nums">📅 emissão {fmtDataBR(n.dataEmissao) || "—"}</span>
              {vs.length > 0 && <span className="tabular-nums">💳 venc. {fmtDataBR(vs[0])}{vs.length > 1 ? ` +${vs.length - 1}` : ""}</span>}
              {n.formaPagamento && <span>{FORMA_PAGAMENTO_ICONE[n.formaPagamento]} {FORMA_PAGAMENTO_LABEL[n.formaPagamento]}</span>}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {onConferir && (
                <button type="button" onClick={() => onConferir(n)} title="Marcar como conferido"
                  className="inline-flex items-center gap-1 px-3 h-9 rounded-lg text-[13px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 active:bg-emerald-100 transition-colors">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  Conferir
                </button>
              )}
              {n.notaDriveUrl && (
                <a href={n.notaDriveUrl} target="_blank" rel="noreferrer" title="Abrir nota no Drive"
                  className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-gray-500 bg-gray-50 dark:bg-gray-800 hover:text-indigo-600 active:bg-indigo-50 transition-colors">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></svg>
                </a>
              )}
              {podeConfig && (
                <button type="button" onClick={() => onExcluir(n)} title="Excluir recebimento"
                  className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-gray-400 bg-gray-50 dark:bg-gray-800 hover:text-rose-600 active:bg-rose-50 transition-colors">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
                </button>
              )}
            </div>
          </div>
        </div>
      ); })}
    </div>
    <p className="text-[11px] text-gray-400 mt-2 px-1">Versão resumida. Baixe <strong>XLSX</strong> ou <strong>PDF</strong> para a tabela completa (CNPJ, quem recebeu, divergência, todas as parcelas e semana).</p>
    {detalhe && <DetalheModal nota={detalhe} podeEditar={podeEditar} onClose={() => setDetalhe(null)} onEditar={(n) => { setDetalhe(null); setEditar(n); }} />}
    {editar && <EditarRecebimentoModal nota={editar} restaurant={restaurant} onClose={() => setEditar(null)} onSaved={() => setEditar(null)} />}
    </>
  );
}

// ─── Modal: detalhes de um recebimento ──────────────────────────────────────
function DetalheModal({ nota, podeEditar, onClose, onEditar }: { nota: RecebimentoNota; podeEditar: boolean; onClose: () => void; onEditar: (n: RecebimentoNota) => void }) {
  const linha = (label: string, valor?: string | number | null) => (valor != null && valor !== "") ? (
    <div className="flex justify-between gap-3 py-1 border-b border-gray-100 dark:border-gray-800 text-sm">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-right text-gray-800 dark:text-gray-200 break-all">{valor}</span>
    </div>
  ) : null;
  return (
    <Modal title="🧾 Detalhes do recebimento" onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-1">
        {linha("Recebido em", fmtDataHora(nota.recebidoEm))}
        {nota.tipoDocumento && linha("Tipo", tipoLabelDe(nota))}
        {linha("Recebido por", nota.recebidoPor?.nome)}
        {nota.formaPagamento && linha("Forma de pagamento", FORMA_PAGAMENTO_LABEL[nota.formaPagamento])}
        {linha("Emissor", nota.emissor)}
        {linha("CNPJ", nota.cnpjEmissor)}
        {linha("Nº NF / série", nota.numeroNota ? `${nota.numeroNota}${nota.serieNota ? "/" + nota.serieNota : ""}` : null)}
        {linha("Chave de acesso", nota.chaveAcesso)}
        {linha("Data de emissão", fmtDataBR(nota.dataEmissao))}
        {linha("Valor dos produtos", nota.valorProdutos != null ? fmtBRL(nota.valorProdutos) : null)}
        {linha("Impostos", nota.valorImpostos != null ? fmtBRL(nota.valorImpostos) : null)}
        {linha("Valor total", nota.valorTotal != null ? fmtBRL(nota.valorTotal) : null)}
        {linha("Conforme?", nota.conforme ? "Sim" : "Não")}
        {!nota.conforme && linha("Divergência", nota.divergencia)}
      </div>
      {nota.itens && nota.itens.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Itens ({nota.itens.length})</div>
          <div className="max-h-60 overflow-auto rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {nota.itens.map((it, i) => (
              <div key={i} className="px-2 py-1.5 text-[11px] flex items-center gap-2">
                <span className="flex-1">{it.descricao || "—"}</span>
                <span className="shrink-0 tabular-nums text-gray-500">{it.quantidade ?? "—"}{it.unidade ? ` ${it.unidade}` : ""}</span>
                <span className="shrink-0 tabular-nums text-gray-500">{it.valorUnitario != null ? `× ${fmtBRL(it.valorUnitario)}` : ""}</span>
                <span className="shrink-0 tabular-nums w-20 text-right">{it.valorTotal != null ? fmtBRL(it.valorTotal) : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {nota.duplicatas && nota.duplicatas.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Faturas / duplicatas ({nota.duplicatas.length})</div>
          <div className="max-h-48 overflow-auto rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {nota.duplicatas.map((d, i) => (
              <div key={i} className="px-2 py-1.5 text-[11px] flex items-center gap-2">
                <span className="flex-1">{d.numero ? `Parcela ${d.numero}` : `Parcela ${i + 1}`}</span>
                <span className="shrink-0 tabular-nums text-gray-500">{d.vencimento ? `vence ${fmtDataBR(d.vencimento)}` : "—"}</span>
                <span className="shrink-0 tabular-nums w-20 text-right">{d.valor != null ? fmtBRL(d.valor) : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {nota.notaPaginas && nota.notaPaginas.length > 1 && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Páginas da nota ({nota.notaPaginas.length})</div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {nota.notaPaginas.map((p, i) => (
              <div key={i} className="px-2 py-1.5 text-[11px] flex items-center gap-2">
                <span className="truncate flex-1">📄 {p.nome}</span>
                {p.driveUrl && <a href={p.driveUrl} target="_blank" rel="noreferrer" className="shrink-0 text-indigo-600 hover:underline">abrir ↗</a>}
              </div>
            ))}
          </div>
        </div>
      )}
      {nota.comprovantes && nota.comprovantes.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Comprovantes ({nota.comprovantes.length})</div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {nota.comprovantes.map((c, i) => (
              <div key={i} className="px-2 py-1.5 text-[11px] flex items-center gap-2">
                <span className="truncate flex-1">🧾 {c.nome}</span>
                {c.driveUrl && <a href={c.driveUrl} target="_blank" rel="noreferrer" className="shrink-0 text-indigo-600 hover:underline">abrir ↗</a>}
              </div>
            ))}
          </div>
        </div>
      )}
      {nota.boletos && nota.boletos.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Boletos ({nota.boletos.length})</div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {nota.boletos.map((b, i) => (
              <div key={i} className="px-2 py-1.5 text-[11px] flex items-center gap-2">
                <span className="truncate flex-1">🧾 {b.nome}</span>
                {b.driveUrl && <a href={b.driveUrl} target="_blank" rel="noreferrer" className="shrink-0 text-indigo-600 hover:underline">abrir ↗</a>}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-3">
        {nota.notaDriveUrl && <a href={nota.notaDriveUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300">↗ Abrir nota no Drive</a>}
        {podeEditar && <Button size="sm" variant="secondary" onClick={() => onEditar(nota)}>✏️ Editar</Button>}
        <Button size="sm" variant="secondary" onClick={onClose}>Fechar</Button>
      </div>
    </Modal>
  );
}

// ─── Modal: editar um recebimento já salvo ──────────────────────────────────
// Corrige os campos da nota (emissor, valores, data, conformidade e faturas) sem
// re-anexar arquivos. Salva via updateDoc; campos esvaziados são removidos.
function EditarRecebimentoModal({ nota, restaurant, onClose, onSaved }: {
  nota: RecebimentoNota;
  restaurant: { recebimentoDriveFolderId?: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const toBR = (v?: number) => v == null ? "" : String(v).replace(".", ",");
  const [emissor, setEmissor] = useState(nota.emissor || "");
  const [cnpjEmissor, setCnpjEmissor] = useState(nota.cnpjEmissor || "");
  const [numeroNota, setNumeroNota] = useState(nota.numeroNota || "");
  const [serieNota, setSerieNota] = useState(nota.serieNota || "");
  const [chaveAcesso, setChaveAcesso] = useState(nota.chaveAcesso || "");
  const [valorProdutos, setValorProdutos] = useState(toBR(nota.valorProdutos));
  const [valorImpostos, setValorImpostos] = useState(toBR(nota.valorImpostos));
  const [valor, setValor] = useState(toBR(nota.valorTotal));
  const [dataEmissao, setDataEmissao] = useState(nota.dataEmissao || "");
  const [conforme, setConforme] = useState(nota.conforme);
  const [divergencia, setDivergencia] = useState(nota.divergencia || "");
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento | undefined>(nota.formaPagamento);
  const [dups, setDups] = useState<DuplicataNota[]>((nota.duplicatas || []).map((d) => ({ ...d })));
  const [boletosNovos, setBoletosNovos] = useState<File[]>([]); // boletos a anexar agora
  const [addBoleto, setAddBoleto] = useState(false);
  const [lendoBoleto, setLendoBoleto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  function setDup(i: number, campo: keyof DuplicataNota, valor: string) {
    setDups((prev) => prev.map((d, j) => j !== i ? d : { ...d, [campo]: campo === "valor" ? (parseBRL(valor) ?? undefined) : (valor || undefined) }));
  }

  // Anexa um boleto agora: lê valor/vencimento e mescla nas faturas (por valor).
  async function aoAnexarBoletoEdit(file: File) {
    setAddBoleto(false);
    setBoletosNovos((prev) => [...prev, file]);
    setLendoBoleto(true);
    try {
      const bloco = await paraOcrBlock(file);
      const resp = await fetch("/api/ocr-nota", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ files: [bloco], tipo: "boleto" }) });
      const j = await resp.json().catch(() => ({}));
      if (resp.ok && Array.isArray(j.duplicatas) && j.duplicatas.length) {
        const novas = j.duplicatas as DuplicataNota[];
        setDups((prev) => {
          const cents = (d: DuplicataNota) => d.valor != null ? Math.round(d.valor * 100) : null;
          const result = prev.map((d) => ({ ...d }));
          for (const nova of novas) {
            const c = cents(nova);
            const alvo = c != null ? result.find((d) => cents(d) === c) : undefined;
            if (alvo) { if (!alvo.vencimento && nova.vencimento) alvo.vencimento = nova.vencimento; if (!alvo.numero && nova.numero) alvo.numero = nova.numero; }
            else result.push(nova);
          }
          return result;
        });
      }
    } catch { /* best-effort */ }
    finally { setLendoBoleto(false); }
  }

  const somaDuplicatas = dups.reduce((s, d) => s + (d.valor || 0), 0);
  const totalNum = parseBRL(valor);
  const faturasNaoBatem = totalNum != null && dups.length > 0 && Math.abs(somaDuplicatas - totalNum) > 0.01;

  async function salvar() {
    setErro("");
    if (!conforme && !divergencia.trim()) { setErro("Descreva a divergência."); return; }
    if (boletosNovos.length && !restaurant.recebimentoDriveFolderId) { setErro("Configure a pasta do Drive em Configurações pra anexar boletos."); return; }
    setSalvando(true);
    try {
      const dupsLimpas = dups
        .filter((d) => d.valor != null || d.vencimento || d.numero)
        .map((d) => ({
          ...(d.numero ? { numero: d.numero } : {}),
          ...(d.valor != null ? { valor: d.valor } : {}),
          ...(d.vencimento ? { vencimento: d.vencimento } : {}),
        }));
      // Sobe os boletos novos pro Drive (mesma semana da nota) e junta aos existentes.
      let boletosFinais: BoletoNota[] | undefined = nota.boletos ? [...nota.boletos] : undefined;
      if (boletosNovos.length) {
        const central = await centralConfigured();
        if (!central) await requestAccessToken();
        const label = nota.semanaLabel || semanaDe(new Date()).label;
        const semanaId = await ensureSemanaFolder(central, restaurant.recebimentoDriveFolderId as string, label);
        const boletosFolderId = await ensureSemanaFolder(central, semanaId, `boletos da semana ${label}`);
        const fornecedorSlug = (emissor.trim() || "fornecedor").replace(/[\\/]/g, "-");
        const dataSlug = dataEmissao ? dataEmissao.split("-").reverse().join(".") : "";
        const baseNome = `${fornecedorSlug} ${dataSlug}`.trim();
        const jaExistentes = nota.boletos?.length || 0;
        const carimbo = [`Recebido por ${nota.recebidoPor?.nome || "?"}`, fmtDataHora(new Date().toISOString())];
        const acc: BoletoNota[] = [];
        for (let i = 0; i < boletosNovos.length; i++) {
          const bf = boletosNovos[i];
          const ext = (bf.name.match(/\.[a-z0-9]+$/i) || [""])[0] || (bf.type.includes("pdf") ? ".pdf" : ".jpg");
          const alvo = await carimbarImagem(new File([bf], `${baseNome} boleto${jaExistentes + i + 1}${ext}`, { type: bf.type }), carimbo, true);
          const s = await subirArquivo(central, boletosFolderId, alvo);
          acc.push({ driveFileId: s.id, nome: alvo.name, ...(s.webViewLink ? { driveUrl: s.webViewLink } : {}) });
        }
        boletosFinais = [...(boletosFinais || []), ...acc];
      }
      const patch: Record<string, unknown> = {
        emissor: emissor.trim() || deleteField(),
        cnpjEmissor: cnpjEmissor.replace(/\D/g, "") || deleteField(),
        numeroNota: numeroNota.trim() || deleteField(),
        serieNota: serieNota.trim() || deleteField(),
        chaveAcesso: chaveAcesso.replace(/\D/g, "") || deleteField(),
        valorProdutos: parseBRL(valorProdutos) ?? deleteField(),
        valorImpostos: parseBRL(valorImpostos) ?? deleteField(),
        valorTotal: parseBRL(valor) ?? deleteField(),
        dataEmissao: dataEmissao || deleteField(),
        conforme,
        divergencia: (!conforme && divergencia.trim()) ? divergencia.trim() : deleteField(),
        formaPagamento: formaPagamento || deleteField(),
        duplicatas: dupsLimpas.length ? dupsLimpas : deleteField(),
        ...(boletosFinais && boletosFinais.length ? { boletos: boletosFinais } : {}),
      };
      await updateDoc(doc(db, "recebimentos", nota.id), patch);
      onSaved();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar as alterações.");
    } finally { setSalvando(false); }
  }

  const inputCls = "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";
  return (
    <Modal title="✏️ Editar recebimento" onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        {erro && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}
        <p className="text-[11px] text-gray-400">Os arquivos no Drive (nota, páginas e boletos) não mudam — aqui você corrige só os dados.</p>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Emissor</label>
            <input value={emissor} onChange={(e) => setEmissor(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">CNPJ do emissor</label>
            <input value={cnpjEmissor} onChange={(e) => setCnpjEmissor(e.target.value)} className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Nº NF</label>
              <input value={numeroNota} onChange={(e) => setNumeroNota(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Série</label>
              <input value={serieNota} onChange={(e) => setSerieNota(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div className="col-span-2">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Chave de acesso</label>
            <input value={chaveAcesso} onChange={(e) => setChaveAcesso(e.target.value)} className={`${inputCls} tabular-nums`} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Valor dos produtos</label>
            <input value={valorProdutos} onChange={(e) => setValorProdutos(e.target.value)} inputMode="decimal" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Impostos / tributos</label>
            <input value={valorImpostos} onChange={(e) => setValorImpostos(e.target.value)} inputMode="decimal" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Valor total</label>
            <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Data de emissão</label>
            <input type="date" value={dataEmissao} onChange={(e) => setDataEmissao(e.target.value)} className={`${inputCls} [color-scheme:light] dark:[color-scheme:dark]`} />
          </div>
        </div>

        {/* Faturas / duplicatas — editáveis */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Faturas / duplicatas</label>
            <button type="button" className="text-[11px] text-indigo-600 hover:underline" onClick={() => setDups((prev) => [...prev, {}])}>+ adicionar</button>
          </div>
          {dups.length === 0 && <p className="text-[11px] text-gray-400">Nenhuma fatura.</p>}
          <div className="space-y-2">
            {dups.map((d, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={d.numero || ""} onChange={(e) => setDup(i, "numero", e.target.value)} placeholder={`Parcela ${i + 1}`} className={`${inputCls} flex-1`} />
                <input type="date" value={d.vencimento || ""} onChange={(e) => setDup(i, "vencimento", e.target.value)} className={`${inputCls} w-[150px] [color-scheme:light] dark:[color-scheme:dark]`} />
                <input value={d.valor != null ? String(d.valor).replace(".", ",") : ""} onChange={(e) => setDup(i, "valor", e.target.value)} inputMode="decimal" placeholder="R$" className={`${inputCls} w-24`} />
                <button type="button" className="shrink-0 text-gray-400 hover:text-rose-600" title="Remover" onClick={() => setDups((prev) => prev.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
          {dups.length > 1 && <p className="text-[11px] text-gray-500 mt-1">Soma das faturas: <strong>{fmtBRL(somaDuplicatas)}</strong></p>}
          {faturasNaoBatem && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">⚠ A soma das faturas ({fmtBRL(somaDuplicatas)}) não bate com o total da nota ({fmtBRL(totalNum ?? undefined)}).</p>
          )}
        </div>

        {/* Boletos — existentes + anexar novos */}
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Boletos</label>
          {(nota.boletos && nota.boletos.length > 0) && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 mb-2">
              {nota.boletos.map((b, i) => (
                <div key={i} className="px-2 py-1.5 text-[11px] flex items-center gap-2">
                  <span className="truncate flex-1">🧾 {b.nome}</span>
                  {b.driveUrl && <a href={b.driveUrl} target="_blank" rel="noreferrer" className="shrink-0 text-indigo-600 hover:underline">abrir ↗</a>}
                </div>
              ))}
            </div>
          )}
          {boletosNovos.length > 0 && (
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 divide-y divide-emerald-100 dark:divide-emerald-900 mb-2">
              {boletosNovos.map((b, i) => (
                <div key={i} className="px-2 py-1.5 text-[11px] flex items-center gap-2">
                  <span className="truncate flex-1">🧾 {b.name} <span className="text-emerald-600">(novo)</span></span>
                  <button type="button" className="shrink-0 text-gray-400 hover:text-rose-600" onClick={() => setBoletosNovos((prev) => prev.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>
          )}
          {lendoBoleto && <p className="text-[11px] text-indigo-600 dark:text-indigo-300 mb-1">🔍 Lendo o boleto…</p>}
          <Button variant="secondary" size="sm" disabled={lendoBoleto} onClick={() => setAddBoleto(true)}>➕ Anexar boleto</Button>
        </div>

        {/* Forma de pagamento */}
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Forma de pagamento <span className="font-normal text-gray-400">— opcional</span></label>
          <FormaPagamentoSelector value={formaPagamento} onChange={setFormaPagamento} />
        </div>

        {/* Conformidade */}
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Conferência</label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setConforme(true)} className={`flex-1 text-sm font-medium px-3 py-2 rounded-lg border ${conforme ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "border-gray-300 dark:border-gray-700 text-gray-600"}`}>✓ Tudo nos conformes</button>
            <button type="button" onClick={() => setConforme(false)} className={`flex-1 text-sm font-medium px-3 py-2 rounded-lg border ${!conforme ? "border-rose-400 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300" : "border-gray-300 dark:border-gray-700 text-gray-600"}`}>⚠ Houve divergência</button>
          </div>
        </div>
        {!conforme && (
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Qual a divergência?</label>
            <textarea value={divergencia} onChange={(e) => setDivergencia(e.target.value)} rows={2} className={inputCls} />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" disabled={salvando} onClick={onClose}>Cancelar</Button>
          <Button size="sm" disabled={salvando || lendoBoleto} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar alterações"}</Button>
        </div>

        {addBoleto && (
          <EscolhaFonteModal
            titulo="Anexar boleto"
            semManual
            onClose={() => setAddBoleto(false)}
            onArquivo={(f) => void aoAnexarBoletoEdit(f)}
          />
        )}
      </div>
    </Modal>
  );
}

// ─── Modal: novo recebimento ────────────────────────────────────────────────
function NovoRecebimentoModal({ rid, restaurant, por, arquivoInicial, tipoDocumento, contaCategoria, onClose, onSalvo }: {
  rid: string;
  restaurant: { recebimentoDriveFolderId?: string };
  por: { id: string; nome: string };
  arquivoInicial?: File | null;
  tipoDocumento?: TipoDocumento;
  contaCategoria?: string;
  onClose: () => void;
  onSalvo: () => void;
}) {
  const [notaFiles, setNotaFiles] = useState<File[]>([]);
  const [boletoFiles, setBoletoFiles] = useState<File[]>([]);
  const [lendoBoleto, setLendoBoleto] = useState(false);
  // Conta fixa já é um documento único com o boleto embutido → pagamento = boleto.
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento | undefined>(tipoDocumento === "conta_fixa" ? "boleto" : undefined);
  const [conforme, setConforme] = useState(true);
  const [divergencia, setDivergencia] = useState("");
  const [fotoDivFile, setFotoDivFile] = useState<File | null>(null);
  const [emissor, setEmissor] = useState("");
  const [cnpjEmissor, setCnpjEmissor] = useState("");
  const [numeroNota, setNumeroNota] = useState("");
  const [serieNota, setSerieNota] = useState("");
  const [chaveAcesso, setChaveAcesso] = useState("");
  const [valorProdutos, setValorProdutos] = useState("");
  const [valorImpostos, setValorImpostos] = useState("");
  const [itens, setItens] = useState<ItemNota[]>([]);
  const [duplicatas, setDuplicatas] = useState<DuplicataNota[]>([]);
  const [valor, setValor] = useState("");
  const [dataEmissao, setDataEmissao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [lendo, setLendo] = useState(false);
  const [leuOcr, setLeuOcr] = useState(false);
  const [ocrErro, setOcrErro] = useState("");
  const [erro, setErro] = useState("");
  // Wizard guiado: páginas → dados → boleto → conferência/salvar → sucesso.
  const [etapa, setEtapa] = useState<"paginas" | "dados" | "boleto" | "final">("paginas");
  const [salvo, setSalvo] = useState(false);
  const [addPagina, setAddPagina] = useState(false); // seletor de fonte p/ folha extra
  const [addBoletoWiz, setAddBoletoWiz] = useState(false); // seletor de fonte p/ boleto no wizard
  const [recebeuBoleto, setRecebeuBoleto] = useState<boolean | null>(null);
  const [comprovanteFiles, setComprovanteFiles] = useState<File[]>([]);
  const [addComprovante, setAddComprovante] = useState(false);
  const [semComprovante, setSemComprovante] = useState(false); // cartão pago online, sem comprovante
  const leituraSeq = useRef(0);

  // Ao anexar a nota: arquiva no state e dispara o OCR pra pré-preencher os campos.
  // Lê TODAS as páginas juntas (uma nota pode ter várias). Confere antes de salvar.
  async function lerNota(files: File[]) {
    if (!files.length) return;
    const seq = ++leituraSeq.current; // ignora respostas de leituras antigas
    setLendo(true); setLeuOcr(false); setOcrErro("");
    try {
      const blocos = await Promise.all(files.map(paraOcrBlock));
      const resp = await fetch("/api/ocr-nota", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ files: blocos }),
      });
      const j = await resp.json().catch(() => ({}));
      if (seq !== leituraSeq.current) return; // chegou uma leitura mais nova — descarta esta
      if (resp.ok) {
        // Preenche só campos AINDA vazios — não sobrescreve o que o usuário digitou
        // enquanto a leitura rodava em segundo plano.
        if (j.emissor) setEmissor((p) => p || j.emissor);
        if (j.cnpjEmissor) setCnpjEmissor((p) => p || j.cnpjEmissor);
        if (j.numeroNota) setNumeroNota((p) => p || j.numeroNota);
        if (j.serieNota) setSerieNota((p) => p || j.serieNota);
        if (j.chaveAcesso) setChaveAcesso((p) => p || j.chaveAcesso);
        if (j.valorProdutos != null) setValorProdutos((p) => p || String(j.valorProdutos).replace(".", ","));
        if (j.valorImpostos != null) setValorImpostos((p) => p || String(j.valorImpostos).replace(".", ","));
        if (j.valorTotal != null) setValor((p) => p || String(j.valorTotal).replace(".", ","));
        if (j.dataEmissao) setDataEmissao((p) => p || j.dataEmissao);
        // Itens/faturas são prévia (não editáveis aqui) → recebem o agregado da leitura.
        if (Array.isArray(j.itens) && j.itens.length) setItens(j.itens as ItemNota[]);
        if (Array.isArray(j.duplicatas)) {
          setDuplicatas((p) => p.length ? p : (j.duplicatas as DuplicataNota[]));
          if (j.duplicatas.length) setFormaPagamento((prev) => prev ?? "boleto");
        }
        setLeuOcr(true);
      } else {
        setOcrErro((j as { error?: string }).error || `Leitura indisponível (HTTP ${resp.status}).`);
      }
    } catch (e) {
      if (seq === leituraSeq.current) setOcrErro(e instanceof Error ? e.message : "Falha ao chamar o leitor de nota.");
    } finally { if (seq === leituraSeq.current) setLendo(false); }
  }
  // Anexa página(s) e relê a nota inteira (todas as páginas) pra agregar os itens.
  function aoAnexar(...fs: File[]) { if (!fs.length) return; setNotaFiles((prev) => { const todos = [...prev, ...fs]; void lerNota(todos); return todos; }); }

  // Arquivo vindo do seletor de fonte (câmera/galeria/PDF) → anexa + lê na abertura.
  useEffect(() => { if (arquivoInicial) aoAnexar(arquivoInicial); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ao anexar um boleto: arquiva no state e lê valor/vencimento via OCR, mesclando
  // nas faturas/duplicatas (preenche o que não veio na nota; não duplica).
  async function lerBoleto(file: File) {
    setLendoBoleto(true);
    try {
      const bloco = await paraOcrBlock(file);
      const resp = await fetch("/api/ocr-nota", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ files: [bloco], tipo: "boleto" }),
      });
      const j = await resp.json().catch(() => ({}));
      if (resp.ok && Array.isArray(j.duplicatas) && j.duplicatas.length) {
        const novas = j.duplicatas as DuplicataNota[];
        setDuplicatas((prev) => {
          // Mesmo VALOR (em centavos) = mesma parcela já lida na nota — funde os
          // campos (completa vencimento/número) em vez de criar linha duplicada.
          const cents = (d: DuplicataNota) => d.valor != null ? Math.round(d.valor * 100) : null;
          const result = prev.map((d) => ({ ...d }));
          for (const nova of novas) {
            const c = cents(nova);
            const alvo = c != null ? result.find((d) => cents(d) === c) : undefined;
            if (alvo) {
              if (!alvo.vencimento && nova.vencimento) alvo.vencimento = nova.vencimento;
              if (!alvo.numero && nova.numero) alvo.numero = nova.numero;
            } else {
              result.push(nova);
            }
          }
          return result;
        });
      }
    } catch { /* best-effort; o usuário pode lançar manualmente */ }
    finally { setLendoBoleto(false); }
  }
  function aoAnexarBoleto(f: File) {
    setBoletoFiles((prev) => [...prev, f]);
    // Anexou boleto → forma de pagamento vira "Boleto" (se ainda não escolheu outra).
    setFormaPagamento((prev) => prev ?? "boleto");
    void lerBoleto(f);
  }

  async function salvar() {
    setErro("");
    const temNota = notaFiles.length > 0;
    const temArquivos = temNota || boletoFiles.length > 0 || comprovanteFiles.length > 0 || (!conforme && !!fotoDivFile);
    if (!temNota && !emissor.trim() && parseBRL(valor) == null) { setErro("Anexe a nota ou preencha ao menos emissor/valor."); return; }
    if (!conforme && !divergencia.trim()) { setErro("Descreva a divergência."); return; }
    if (temArquivos && !restaurant.recebimentoDriveFolderId) { setErro("Configure a pasta do Drive em Configurações antes de receber."); return; }
    setSalvando(true);
    try {
      // Conta central configurada → sobe pelo backend (operador não conecta Drive).
      // Senão, fluxo antigo: OAuth no navegador (popup reabre se preciso).
      const central = temArquivos ? await centralConfigured() : false;
      if (temArquivos && !central) await requestAccessToken();
      const agora = new Date();
      const recebidoEm = agora.toISOString();
      const { label } = semanaDe(agora);
      const semanaId = temArquivos ? await ensureSemanaFolder(central, restaurant.recebimentoDriveFolderId as string, label) : "";
      // Nome dos arquivos: "<fornecedor> <data emissão> nota" (e ...boleto / boleto1, boleto2…).
      const fornecedorSlug = (emissor.trim() || "fornecedor").replace(/[\\/]/g, "-");
      const dataSlug = dataEmissao
        ? dataEmissao.split("-").reverse().join(".")
        : `${pad(agora.getDate())}.${pad(agora.getMonth() + 1)}.${String(agora.getFullYear()).slice(2)}`;
      const baseNome = `${fornecedorSlug} ${dataSlug}`;
      const ext = (f: File, fallback: string) => (f.name.match(/\.[a-z0-9]+$/i) || [""])[0] || (f.type.includes("pdf") ? ".pdf" : fallback);
      // Carimbo (selo) gravado nas imagens antes de subir: quem recebeu + data/hora.
      const carimbo = [`Recebido por ${por.nome}`, fmtDataHora(recebidoEm)];
      // Páginas da nota: "<base> nota" se 1 só; "<base> nota1/2/3…" se mais de uma.
      const notaPaginas: BoletoNota[] = [];
      for (let i = 0; i < notaFiles.length; i++) {
        const nf = notaFiles[i];
        const sufixo = notaFiles.length > 1 ? `nota${i + 1}` : "nota";
        const alvo = await carimbarImagem(new File([nf], `${baseNome} ${sufixo}${ext(nf, ".jpg")}`, { type: nf.type }), carimbo, true);
        const s = await subirArquivo(central, semanaId, alvo);
        notaPaginas.push({ driveFileId: s.id, nome: alvo.name, ...(s.webViewLink ? { driveUrl: s.webViewLink } : {}) });
      }
      const subidaNota = notaPaginas[0];
      // Boletos: subpasta "boletos da semana <label>" dentro da pasta da semana.
      const boletos: BoletoNota[] = [];
      if (boletoFiles.length) {
        const boletosFolderId = await ensureSemanaFolder(central, semanaId, `boletos da semana ${label}`);
        for (let i = 0; i < boletoFiles.length; i++) {
          const bf = boletoFiles[i];
          const sufixo = boletoFiles.length > 1 ? `boleto${i + 1}` : "boleto";
          const alvo = await carimbarImagem(new File([bf], `${baseNome} ${sufixo}${ext(bf, ".jpg")}`, { type: bf.type }), carimbo, true);
          const s = await subirArquivo(central, boletosFolderId, alvo);
          boletos.push({ driveFileId: s.id, nome: alvo.name, ...(s.webViewLink ? { driveUrl: s.webViewLink } : {}) });
        }
      }
      // Comprovantes (ex: cartão): "<base> comprovante" / comprovante1, 2…
      const comprovantes: BoletoNota[] = [];
      for (let i = 0; i < comprovanteFiles.length; i++) {
        const cf = comprovanteFiles[i];
        const sufixo = comprovanteFiles.length > 1 ? `comprovante${i + 1}` : "comprovante";
        const alvo = await carimbarImagem(new File([cf], `${baseNome} ${sufixo}${ext(cf, ".jpg")}`, { type: cf.type }), carimbo, true);
        const s = await subirArquivo(central, semanaId, alvo);
        comprovantes.push({ driveFileId: s.id, nome: alvo.name, ...(s.webViewLink ? { driveUrl: s.webViewLink } : {}) });
      }
      let fotoDiv: { id: string; url?: string } | null = null;
      if (!conforme && fotoDivFile) {
        const extFoto = (fotoDivFile.name.match(/\.[a-z0-9]+$/i) || [".jpg"])[0];
        const alvo = await carimbarImagem(new File([fotoDivFile], `${baseNome} - divergencia${extFoto}`, { type: fotoDivFile.type }), carimbo);
        const s = await subirArquivo(central, semanaId, alvo);
        fotoDiv = { id: s.id, url: s.webViewLink };
      }
      const nota: Omit<RecebimentoNota, "id"> = {
        restaurantId: rid,
        recebidoEm,
        recebidoPor: por,
        conforme,
        semanaLabel: label,
        ...(tipoDocumento ? { tipoDocumento } : {}),
        ...(tipoDocumento === "conta_fixa" && contaCategoria ? { contaCategoria } : {}),
        ...(subidaNota ? { notaDriveFileId: subidaNota.driveFileId, notaNome: subidaNota.nome, notaPaginas, ...(subidaNota.driveUrl ? { notaDriveUrl: subidaNota.driveUrl } : {}) } : {}),
        ...(emissor.trim() ? { emissor: emissor.trim() } : {}),
        ...(cnpjEmissor.trim() ? { cnpjEmissor: cnpjEmissor.replace(/\D/g, "") } : {}),
        ...(numeroNota.trim() ? { numeroNota: numeroNota.trim() } : {}),
        ...(serieNota.trim() ? { serieNota: serieNota.trim() } : {}),
        ...(chaveAcesso.trim() ? { chaveAcesso: chaveAcesso.replace(/\D/g, "") } : {}),
        ...(parseBRL(valorProdutos) != null ? { valorProdutos: parseBRL(valorProdutos) } : {}),
        ...(parseBRL(valorImpostos) != null ? { valorImpostos: parseBRL(valorImpostos) } : {}),
        ...(parseBRL(valor) != null ? { valorTotal: parseBRL(valor) } : {}),
        ...(dataEmissao ? { dataEmissao } : {}),
        ...(itens.length ? { itens } : {}),
        ...(duplicatas.length ? { duplicatas } : {}),
        ...(!conforme && divergencia.trim() ? { divergencia: divergencia.trim() } : {}),
        ...(formaPagamento ? { formaPagamento } : {}),
        ...(boletos.length ? { boletos } : {}),
        ...(comprovantes.length ? { comprovantes } : {}),
        ...(fotoDiv ? { fotoDivergenciaDriveFileId: fotoDiv.id, ...(fotoDiv.url ? { fotoDivergenciaUrl: fotoDiv.url } : {}) } : {}),
      };
      await addDoc(collection(db, "recebimentos"), nota);
      setSalvo(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar o recebimento.");
    } finally { setSalvando(false); }
  }

  // Conferência: a soma das faturas deve bater com o total da nota.
  const somaDuplicatas = duplicatas.reduce((s, d) => s + (d.valor || 0), 0);
  const totalNum = parseBRL(valor);
  const faturasNaoBatem = totalNum != null && duplicatas.length > 0 && Math.abs(somaDuplicatas - totalNum) > 0.01;

  // Conta fixa = documento único com boleto embutido → pula o passo de Pagamento.
  const passos: Array<"paginas" | "dados" | "boleto" | "final"> = tipoDocumento === "conta_fixa"
    ? ["paginas", "dados", "final"]
    : ["paginas", "dados", "boleto", "final"];
  const idxPasso = Math.max(0, passos.indexOf(etapa));
  const stepNum = idxPasso + 1;
  const totalPassos = passos.length;
  const tituloPasso = { paginas: "Documento", dados: "Conferir dados", boleto: "Pagamento", final: "Conferência" }[etapa];
  const lendoAlgo = lendo || lendoBoleto; // leitura em segundo plano (não bloqueia)
  const voltar = () => { if (idxPasso > 0) setEtapa(passos[idxPasso - 1]); };
  const avancar = () => { if (idxPasso < passos.length - 1) setEtapa(passos[idxPasso + 1]); };
  return (
    <Modal title="🧾 Novo recebimento" onClose={onClose} maxWidth="max-w-lg">
      {salvo ? (
        <div className="py-10 flex flex-col items-center text-center gap-3">
          <div className="text-5xl">✅</div>
          <div className="text-lg font-semibold text-emerald-700 dark:text-emerald-300">Recebimento salvo!</div>
          <p className="text-sm text-gray-500 dark:text-gray-400">Está tudo certo — a nota foi registrada{notaFiles.length ? " e arquivada no Drive" : ""}.</p>
          <Button onClick={onSalvo}>Concluir</Button>
        </div>
      ) : (
      <div className="space-y-3">
        {erro && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}
        <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Passo {stepNum} de {totalPassos} · {tituloPasso}</div>

        {/* Passo 1 — folha(s) da nota */}
        {etapa === "paginas" && (
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Folhas da nota <span className="font-normal text-gray-400">— anexe todas as páginas</span></label>
          {notaFiles.length > 0 && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 mb-2">
              {notaFiles.map((f, i) => (
                <div key={i} className="px-2 py-1.5 text-sm flex items-center gap-2">
                  <span className="truncate flex-1">📎 {notaFiles.length > 1 ? `Página ${i + 1}` : "Nota"} · {f.name}</span>
                  <button type="button" className="text-[11px] text-gray-500 hover:underline" onClick={() => { const restantes = notaFiles.filter((_, j) => j !== i); setNotaFiles(restantes); if (restantes.length) void lerNota(restantes); else { setLeuOcr(false); setOcrErro(""); } }}>remover</button>
                </div>
              ))}
            </div>
          )}
          {lendo && <p className="text-[11px] text-indigo-600 dark:text-indigo-300 mt-1">🔍 Lendo a nota… os campos vão ser pré-preenchidos.</p>}
          {leuOcr && !lendo && <p className="text-[11px] text-emerald-600 dark:text-emerald-300 mt-1">✓ Li a nota e pré-preenchi os campos.</p>}
          {ocrErro && !lendo && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">⚠ Não consegui ler a nota automaticamente ({ocrErro}). Preencha manualmente.</p>}
          <div className="mt-3 flex flex-col items-center gap-2 py-5 border border-dashed border-gray-200 dark:border-gray-800 rounded-xl">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{notaFiles.length ? "Tem outra folha desta nota?" : "Adicione a 1ª folha da nota"}</p>
            <Button variant="secondary" size="sm" onClick={() => setAddPagina(true)}>➕ {notaFiles.length ? "Adicionar outra folha" : "Adicionar folha"}</Button>
            {notaFiles.length > 0 && <p className="text-[11px] text-gray-400 text-center">Se não tem mais, toque em "Continuar →" abaixo.</p>}
          </div>
        </div>
        )}

        {/* Passo 2 — conferir dados */}
        {etapa === "dados" && (<>
        {/* Dados da nota (o OCR pré-preenche; confira/corrija) */}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Emissor</label>
            <input value={emissor} onChange={(e) => setEmissor(e.target.value)} placeholder="Fornecedor / emissor da nota"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">CNPJ do emissor</label>
            <input value={cnpjEmissor} onChange={(e) => setCnpjEmissor(e.target.value)} placeholder="00.000.000/0000-00"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Nº NF</label>
              <input value={numeroNota} onChange={(e) => setNumeroNota(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Série</label>
              <input value={serieNota} onChange={(e) => setSerieNota(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
            </div>
          </div>
          <div className="col-span-2">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Chave de acesso</label>
            <input value={chaveAcesso} onChange={(e) => setChaveAcesso(e.target.value)} placeholder="44 dígitos"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 tabular-nums" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Valor dos produtos</label>
            <input value={valorProdutos} onChange={(e) => setValorProdutos(e.target.value)} inputMode="decimal" placeholder="R$ 0,00"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Impostos / tributos</label>
            <input value={valorImpostos} onChange={(e) => setValorImpostos(e.target.value)} inputMode="decimal" placeholder="R$ 0,00"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Valor total</label>
            <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="R$ 0,00"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Data de emissão</label>
            <input type="date" value={dataEmissao} onChange={(e) => setDataEmissao(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]" />
          </div>
        </div>

        {/* Itens lidos da nota */}
        {itens.length > 0 && (
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Itens da nota ({itens.length})</label>
            <div className="max-h-40 overflow-auto rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
              {itens.map((it, i) => (
                <div key={i} className="px-2 py-1 text-[11px] flex items-center gap-2">
                  <span className="flex-1 truncate">{it.descricao || "—"}</span>
                  <span className="shrink-0 tabular-nums text-gray-500">{it.quantidade ?? "—"}{it.unidade ? ` ${it.unidade}` : ""}</span>
                  <span className="shrink-0 tabular-nums">{it.valorTotal != null ? it.valorTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-0.5">Lidos pelo OCR — a lista completa fica salva no recebimento.</p>
          </div>
        )}

        {/* Faturas / duplicatas (vencimentos) */}
        {duplicatas.length > 0 && (
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Faturas / duplicatas ({duplicatas.length})</label>
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
              {duplicatas.map((d, i) => (
                <div key={i} className="px-2 py-1 text-[11px] flex items-center gap-2">
                  <span className="flex-1">{d.numero ? `Parcela ${d.numero}` : `Parcela ${i + 1}`}</span>
                  <span className="shrink-0 tabular-nums text-gray-500">{d.vencimento ? `vence ${d.vencimento.split("-").reverse().join("/")}` : "—"}</span>
                  <span className="shrink-0 tabular-nums w-20 text-right">{d.valor != null ? d.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}</span>
                  <button type="button" className="shrink-0 text-gray-400 hover:text-rose-600" title="Remover fatura" onClick={() => setDuplicatas((prev) => prev.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
              {duplicatas.length > 1 && (
                <div className="px-2 py-1 text-[11px] flex items-center gap-2 font-semibold bg-gray-50 dark:bg-gray-800/40">
                  <span className="flex-1">Soma das faturas</span>
                  <span className="shrink-0 tabular-nums w-20 text-right">{fmtBRL(somaDuplicatas)}</span>
                </div>
              )}
            </div>
            {faturasNaoBatem && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                ⚠ A soma das faturas ({fmtBRL(somaDuplicatas)}) não bate com o total da nota ({fmtBRL(totalNum ?? undefined)}).
                Pode ter boleto lido em duplicidade ou parcela faltando — confira antes de salvar.
              </p>
            )}
          </div>
        )}
        </>)}

        {/* Passo 3 — pagamento (boleto sim/não → forma → comprovante) */}
        {etapa === "boleto" && (
        <div className="space-y-3">
          {/* Pergunta principal */}
          <div className="text-center">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Recebeu boleto (físico) pra anexar?</p>
            <div className="flex gap-2 justify-center">
              <button type="button" onClick={() => { setRecebeuBoleto(true); setFormaPagamento("boleto"); if (!boletoFiles.length) setAddBoletoWiz(true); }}
                className={`flex-1 max-w-[160px] text-sm font-medium px-3 py-2.5 rounded-xl border ${recebeuBoleto === true ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>✓ Sim</button>
              <button type="button" onClick={() => { setRecebeuBoleto(false); setBoletoFiles([]); }}
                className={`flex-1 max-w-[160px] text-sm font-medium px-3 py-2.5 rounded-xl border ${recebeuBoleto === false ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>Não</button>
            </div>
          </div>

          {/* Sim → anexa boleto(s) */}
          {recebeuBoleto === true && (
            <>
              {boletoFiles.length > 0 && (
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                  {boletoFiles.map((b, i) => (
                    <div key={i} className="px-2 py-1.5 text-sm flex items-center gap-2">
                      <span className="truncate flex-1">🧾 {boletoFiles.length > 1 ? `Boleto ${i + 1}` : "Boleto"} · {b.name}</span>
                      <button type="button" className="text-[11px] text-gray-500 hover:underline" onClick={() => setBoletoFiles((prev) => prev.filter((_, j) => j !== i))}>remover</button>
                    </div>
                  ))}
                </div>
              )}
              {lendoBoleto && <p className="text-[11px] text-indigo-600 dark:text-indigo-300">🔍 Lendo o boleto… valor e vencimento entram nas faturas.</p>}
              <div className="flex flex-col items-center gap-2 py-4 border border-dashed border-gray-200 dark:border-gray-800 rounded-xl">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{boletoFiles.length ? "Tem outro boleto?" : "Anexe o boleto"}</p>
                <Button variant="secondary" size="sm" onClick={() => setAddBoletoWiz(true)}>➕ {boletoFiles.length ? "Adicionar outro boleto" : "Adicionar boleto"}</Button>
              </div>
            </>
          )}

          {/* Não → escolhe forma de pagamento */}
          {recebeuBoleto === false && (
            <>
              <div>
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Selecione a forma de pagamento</label>
                <FormaPagamentoSelector value={formaPagamento} onChange={(v) => { setFormaPagamento(v); setSemComprovante(false); if (v !== "cartao") setComprovanteFiles([]); }} />
              </div>
              {formaPagamento === "cartao" && (
                <div className="space-y-2">
                  {comprovanteFiles.length > 0 && (
                    <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                      {comprovanteFiles.map((c, i) => (
                        <div key={i} className="px-2 py-1.5 text-sm flex items-center gap-2">
                          <span className="truncate flex-1">🧾 Comprovante {comprovanteFiles.length > 1 ? i + 1 : ""} · {c.name}</span>
                          <button type="button" className="text-[11px] text-gray-500 hover:underline" onClick={() => setComprovanteFiles((prev) => prev.filter((_, j) => j !== i))}>remover</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {comprovanteFiles.length > 0 ? (
                    <div className="flex flex-col items-center gap-2 py-3 border border-dashed border-gray-200 dark:border-gray-800 rounded-xl">
                      <Button variant="secondary" size="sm" onClick={() => setAddComprovante(true)}>➕ Adicionar outro comprovante</Button>
                    </div>
                  ) : semComprovante ? (
                    <p className="text-[12px] text-emerald-600 dark:text-emerald-400 text-center py-2">✓ Pago antecipado — sem comprovante. <button type="button" className="underline" onClick={() => setSemComprovante(false)}>mudar</button></p>
                  ) : (
                    <div className="flex flex-col items-center gap-2 py-4 border border-dashed border-gray-200 dark:border-gray-800 rounded-xl">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Tem comprovante do pagamento?</p>
                      <div className="flex gap-2 flex-wrap justify-center">
                        <Button size="sm" onClick={() => setAddComprovante(true)}>➕ Anexar comprovante</Button>
                        <Button variant="secondary" size="sm" onClick={() => setSemComprovante(true)}>Pago antecipado, sem comprovante</Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {formaPagamento && formaPagamento !== "cartao" && (
                <p className="text-[12px] text-gray-500 dark:text-gray-400 text-center py-2">{formaPagamento === "boleto" ? "Boleto com envio online" : FORMA_PAGAMENTO_LABEL[formaPagamento]} — sem nada pra anexar. Toque em "Continuar →".</p>
              )}
            </>
          )}
        </div>
        )}

        {/* Passo 4 — conferência final */}
        {etapa === "final" && (<>
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Conferência</label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setConforme(true)} className={`flex-1 text-sm font-medium px-3 py-2 rounded-lg border ${conforme ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "border-gray-300 dark:border-gray-700 text-gray-600"}`}>✓ Tudo nos conformes</button>
            <button type="button" onClick={() => setConforme(false)} className={`flex-1 text-sm font-medium px-3 py-2 rounded-lg border ${!conforme ? "border-rose-400 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300" : "border-gray-300 dark:border-gray-700 text-gray-600"}`}>⚠ Houve divergência</button>
          </div>
        </div>

        {!conforme && (
          <div className="space-y-2">
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Qual a divergência?</label>
              <textarea value={divergencia} onChange={(e) => setDivergencia(e.target.value)} rows={2} placeholder="Ex: faltaram 2 caixas; produto vencido; valor diferente do pedido…"
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
            </div>
            <div className="flex items-center gap-2 text-sm">
              {fotoDivFile
                ? <><span className="truncate flex-1">📎 {fotoDivFile.name}</span><button type="button" className="text-[11px] text-gray-500 hover:underline" onClick={() => setFotoDivFile(null)}>remover</button></>
                : <label className="text-xs font-medium px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">📷 Foto da divergência (opcional)
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) setFotoDivFile(f); }} />
                  </label>}
            </div>
          </div>
        )}

        {/* Resumo final */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 px-3 py-2 text-[12px] space-y-0.5">
          {tipoDocumento && <div className="flex justify-between"><span className="text-gray-500">Tipo</span><span className="font-medium">{TIPO_DOCUMENTO_LABEL[tipoDocumento]}{tipoDocumento === "conta_fixa" && contaCategoria ? ` · ${contaCategoria}` : ""}</span></div>}
          <div className="flex justify-between"><span className="text-gray-500">Emissor</span><span className="font-medium truncate ml-2">{emissor.trim() || "—"}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Valor total</span><span className="font-medium">{parseBRL(valor) != null ? fmtBRL(parseBRL(valor)) : "—"}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Folhas / boletos</span><span className="font-medium">{notaFiles.length} / {boletoFiles.length}</span></div>
          {formaPagamento && <div className="flex justify-between"><span className="text-gray-500">Pagamento</span><span className="font-medium">{FORMA_PAGAMENTO_LABEL[formaPagamento]}</span></div>}
          <div className="flex justify-between"><span className="text-gray-500">Conferência</span><span className={`font-medium ${conforme ? "text-emerald-600" : "text-rose-600"}`}>{conforme ? "Tudo nos conformes" : "Divergência"}</span></div>
        </div>
        </>)}

        {/* Navegação do wizard */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <Button variant="secondary" size="sm" disabled={salvando} onClick={etapa === "paginas" ? onClose : voltar}>
            {etapa === "paginas" ? "Cancelar" : "← Voltar"}
          </Button>
          {lendoAlgo && <span className="text-[11px] text-indigo-600 dark:text-indigo-300">🔍 Lendo em 2º plano…</span>}
          {etapa === "final" ? (
            <Button size="sm" disabled={salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar recebimento"}</Button>
          ) : (
            <Button size="sm" disabled={etapa === "boleto" && recebeuBoleto === null} onClick={avancar}>Continuar →</Button>
          )}
        </div>

        {addPagina && (
          <EscolhaFonteModal
            titulo="Adicionar folha da nota"
            semManual
            onClose={() => setAddPagina(false)}
            onArquivo={(f) => { setAddPagina(false); aoAnexar(f); }}
          />
        )}
        {addBoletoWiz && (
          <EscolhaFonteModal
            titulo="Adicionar boleto"
            semManual
            onClose={() => setAddBoletoWiz(false)}
            onArquivo={(f) => { setAddBoletoWiz(false); aoAnexarBoleto(f); }}
          />
        )}
        {addComprovante && (
          <EscolhaFonteModal
            titulo="Anexar comprovante"
            semManual
            onClose={() => setAddComprovante(false)}
            onArquivo={(f) => { setAddComprovante(false); setSemComprovante(false); setComprovanteFiles((prev) => [...prev, f]); }}
          />
        )}
      </div>
      )}
    </Modal>
  );
}
