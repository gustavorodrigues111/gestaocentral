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
import type { BoletoNota, DuplicataNota, FormaPagamento, ItemNota, RecebimentoNota } from "../../core/types";
import { FORMA_PAGAMENTO_LABEL } from "../../core/types";
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

  const [tab, setTab] = useState<"receber" | "notas" | "config">("receber");
  const [notas, setNotas] = useState<RecebimentoNota[]>([]);
  const [novo, setNovo] = useState(false);
  const [escolhendoFonte, setEscolhendoFonte] = useState(false);
  const [arquivoInicial, setArquivoInicial] = useState<File | null>(null);
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

  const ordenadas = useMemo(
    () => [...notas].sort((a, b) => (b.recebidoEm || "").localeCompare(a.recebidoEm || "")),
    [notas],
  );

  async function exportar(tipo: "pdf" | "xlsx") {
    if (!ordenadas.length) return;
    setErro(""); setExportando(tipo);
    try {
      if (tipo === "pdf") await exportarRecebimentosPDF(ordenadas, restaurant?.nome || "");
      else await exportarRecebimentosXLSX(ordenadas, restaurant?.nome || "");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao exportar.");
    } finally { setExportando(""); }
  }

  async function excluir(n: RecebimentoNota) {
    if (!window.confirm(`Excluir o recebimento de ${n.emissor || "nota sem emissor"} (${fmtDataHora(n.recebidoEm)})?\n\nO arquivo no Drive NÃO é apagado.`)) return;
    try { await deleteDoc(doc(db, "recebimentos", n.id)); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falha ao excluir."); }
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
  const abas: Array<"receber" | "notas" | "config"> = [];
  if (podeReceber) abas.push("receber");
  if (podeVer) abas.push("notas");
  if (podeConfig) abas.push("config");
  const abaEfetiva = abas.includes(tab) ? tab : (abas[0] || "receber");

  const abrirNovo = (arquivo: File | null) => { setErro(""); setArquivoInicial(arquivo); setEscolhendoFonte(false); setNovo(true); };

  const TabBtn = ({ k, label }: { k: "receber" | "notas" | "config"; label: string }) => (
    <button type="button" onClick={() => setTab(k)}
      className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${abaEfetiva === k ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-gray-500"}`}>
      {label}
    </button>
  );

  return (
    <div className="max-w-5xl space-y-4">
      {/* Abas */}
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800 overflow-x-auto whitespace-nowrap">
        {podeReceber && <TabBtn k="receber" label="🧾 Recebimento" />}
        {podeVer && <TabBtn k="notas" label="📋 Notas recebidas" />}
        {podeConfig && <TabBtn k="config" label="⚙️ Configurações" />}
      </div>

      {erro && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}

      {/* Aba Recebimento — botão grande "Nova nota" */}
      {abaEfetiva === "receber" && podeReceber && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <button type="button" onClick={() => { setErro(""); setEscolhendoFonte(true); }}
            className="flex flex-col items-center justify-center gap-3 w-full max-w-sm py-10 rounded-2xl border-2 border-dashed border-indigo-300 dark:border-indigo-700 bg-indigo-50/50 dark:bg-indigo-950/20 hover:bg-indigo-100/60 dark:hover:bg-indigo-950/40 transition">
            <span className="text-5xl">🧾</span>
            <span className="text-lg font-semibold text-indigo-700 dark:text-indigo-300">Nova nota</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">Toque pra dar entrada numa nota</span>
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
          <RecebimentoTabela notas={ordenadas} podeEditar={podeEditar} podeConfig={podeConfig} onExcluir={excluir} />
        </div>
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
          onClose={() => { setNovo(false); setArquivoInicial(null); }}
          onSalvo={() => { setNovo(false); setArquivoInicial(null); }}
        />
      )}
    </div>
  );
}

// ─── Modal: escolher fonte da nota (câmera / galeria / arquivo / manual) ─────
function EscolhaFonteModal({ onClose, onArquivo, onManual }: {
  onClose: () => void;
  onArquivo: (f: File) => void;
  onManual: () => void;
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
    <Modal title="Como você quer dar entrada?" onClose={onClose} maxWidth="max-w-sm">
      <div className="grid grid-cols-2 gap-3">
        <Opcao icon="📷" label="Câmera" onClick={() => camRef.current?.click()} />
        <Opcao icon="🖼️" label="Galeria" onClick={() => galRef.current?.click()} />
        <Opcao icon="📄" label="Arquivo (PDF)" onClick={() => pdfRef.current?.click()} />
        <Opcao icon="✍️" label="Manual" onClick={onManual} />
      </div>
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) onArquivo(f); }} />
      <input ref={galRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) onArquivo(f); }} />
      <input ref={pdfRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) onArquivo(f); }} />
      <p className="text-[11px] text-gray-400 mt-3 text-center">Câmera, galeria e PDF fazem a leitura automática. "Manual" abre o formulário em branco.</p>
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
type SortKey = "recebido" | "emissao" | "nf" | "emissor" | "valor" | "recebeu" | "conforme" | "pgto" | `venc:${number}`;
function RecebimentoTabela({ notas, podeEditar, podeConfig, onExcluir }: {
  notas: RecebimentoNota[];
  podeEditar: boolean;
  podeConfig: boolean;
  onExcluir: (n: RecebimentoNota) => void;
}) {
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

  const maxVenc = useMemo(() => notas.reduce((m, n) => Math.max(m, vencimentosDe(n).length), 0), [notas]);

  if (notas.length === 0) {
    return <div className="text-center text-sm text-gray-400 py-12">Nenhum recebimento ainda. Clique em <strong>+ Novo recebimento</strong>.</div>;
  }

  const seta = (k: SortKey) => sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "";
  const Th = ({ k, label, alinhar }: { k: SortKey; label: string; alinhar?: "right" }) => (
    <th className={`px-3 py-2 ${alinhar === "right" ? "text-right" : ""}`}>
      <button type="button" onClick={() => ordenarPor(k)}
        className={`uppercase tracking-wide hover:text-gray-700 dark:hover:text-gray-200 ${sortKey === k ? "text-gray-800 dark:text-gray-100 font-semibold" : ""}`}>
        {label}{seta(k)}
      </button>
    </th>
  );

  return (
    <>
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] text-gray-500 border-b border-gray-200 dark:border-gray-800">
            <Th k="recebido" label="Recebido em" />
            <Th k="emissao" label="Emissão" />
            <Th k="nf" label="Nº NF" />
            <Th k="emissor" label="Emissor" />
            <Th k="valor" label="Valor" alinhar="right" />
            <Th k="recebeu" label="Recebeu" />
            <Th k="conforme" label="Conforme?" />
            <Th k="pgto" label="Pgto" />
            <th className="px-3 py-2 uppercase tracking-wide">Divergência</th>
            {Array.from({ length: maxVenc }, (_, i) => (
              <Th key={i} k={`venc:${i}`} label={i === 0 ? "Vencimento" : `${i + 1}º venc.`} />
            ))}
            <th className="px-3 py-2 uppercase tracking-wide">Nota</th>
            <th className="px-3 py-2" />
            {podeConfig && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {ordenadas.map((n) => (
            <tr key={n.id} className={`whitespace-nowrap ${n.conforme ? "" : "bg-rose-50/50 dark:bg-rose-950/10"}`}>
              <td className="px-3 py-2 tabular-nums">{fmtDataHora(n.recebidoEm)}</td>
              <td className="px-3 py-2 tabular-nums text-gray-500">{fmtDataBR(n.dataEmissao)}</td>
              <td className="px-3 py-2 tabular-nums text-gray-500">{n.numeroNota || "—"}{n.serieNota ? `/${n.serieNota}` : ""}</td>
              <td className="px-3 py-2 max-w-[260px] truncate" title={n.emissor || ""}>{n.emissor || "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtBRL(n.valorTotal)}</td>
              <td className="px-3 py-2 text-gray-500 max-w-[160px] truncate" title={n.recebidoPor?.nome || ""}>{n.recebidoPor?.nome || "—"}</td>
              <td className="px-3 py-2">
                {n.conforme
                  ? <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">✓ Sim</span>
                  : <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">⚠ Não</span>}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-300">{n.formaPagamento ? `${FORMA_PAGAMENTO_ICONE[n.formaPagamento]} ${FORMA_PAGAMENTO_LABEL[n.formaPagamento]}` : "—"}</td>
              <td className="px-3 py-2 max-w-[220px] truncate text-gray-600 dark:text-gray-300" title={n.divergencia || ""}>{n.conforme ? "—" : (n.divergencia || "—")}</td>
              {maxVenc > 0 && (() => { const vs = vencimentosDe(n); return Array.from({ length: maxVenc }, (_, i) => (
                <td key={i} className="px-3 py-2 tabular-nums text-gray-500">{vs[i] ? fmtDataBR(vs[i]) : "—"}</td>
              )); })()}
              <td className="px-3 py-2">
                {n.notaDriveUrl
                  ? <a href={n.notaDriveUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">abrir ↗</a>
                  : "—"}
                {n.notaPaginas && n.notaPaginas.length > 1 && <span className="ml-1.5 text-[10px] text-gray-500" title={`${n.notaPaginas.length} páginas`}>📄{n.notaPaginas.length}</span>}
                {n.boletos && n.boletos.length > 0 && <span className="ml-1.5 text-[10px] text-gray-500" title={`${n.boletos.length} boleto(s) anexado(s)`}>🧾{n.boletos.length}</span>}
              </td>
              <td className="px-3 py-2">
                <button type="button" onClick={() => setDetalhe(n)} className="text-[11px] text-indigo-600 hover:underline">detalhes</button>
              </td>
              {podeConfig && (
                <td className="px-3 py-2 text-right">
                  <button type="button" onClick={() => onExcluir(n)} className="text-[11px] text-rose-600 hover:underline">excluir</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {detalhe && <DetalheModal nota={detalhe} podeEditar={podeEditar} onClose={() => setDetalhe(null)} onEditar={(n) => { setDetalhe(null); setEditar(n); }} />}
    {editar && <EditarRecebimentoModal nota={editar} onClose={() => setEditar(null)} onSaved={() => setEditar(null)} />}
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
    <Modal title="🧾 Detalhes do recebimento" onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-1">
        {linha("Recebido em", fmtDataHora(nota.recebidoEm))}
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
function EditarRecebimentoModal({ nota, onClose, onSaved }: {
  nota: RecebimentoNota;
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
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  function setDup(i: number, campo: keyof DuplicataNota, valor: string) {
    setDups((prev) => prev.map((d, j) => j !== i ? d : { ...d, [campo]: campo === "valor" ? (parseBRL(valor) ?? undefined) : (valor || undefined) }));
  }

  const somaDuplicatas = dups.reduce((s, d) => s + (d.valor || 0), 0);
  const totalNum = parseBRL(valor);
  const faturasNaoBatem = totalNum != null && dups.length > 0 && Math.abs(somaDuplicatas - totalNum) > 0.01;

  async function salvar() {
    setErro("");
    if (!conforme && !divergencia.trim()) { setErro("Descreva a divergência."); return; }
    setSalvando(true);
    try {
      const dupsLimpas = dups
        .filter((d) => d.valor != null || d.vencimento || d.numero)
        .map((d) => ({
          ...(d.numero ? { numero: d.numero } : {}),
          ...(d.valor != null ? { valor: d.valor } : {}),
          ...(d.vencimento ? { vencimento: d.vencimento } : {}),
        }));
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
          <Button size="sm" disabled={salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar alterações"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal: novo recebimento ────────────────────────────────────────────────
function NovoRecebimentoModal({ rid, restaurant, por, arquivoInicial, onClose, onSalvo }: {
  rid: string;
  restaurant: { recebimentoDriveFolderId?: string };
  por: { id: string; nome: string };
  arquivoInicial?: File | null;
  onClose: () => void;
  onSalvo: () => void;
}) {
  const [notaFiles, setNotaFiles] = useState<File[]>([]);
  const [boletoFiles, setBoletoFiles] = useState<File[]>([]);
  const [lendoBoleto, setLendoBoleto] = useState(false);
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento | undefined>(undefined);
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

  // Ao anexar a nota: arquiva no state e dispara o OCR pra pré-preencher os campos.
  // Lê TODAS as páginas juntas (uma nota pode ter várias). Confere antes de salvar.
  async function lerNota(files: File[]) {
    if (!files.length) return;
    setLendo(true); setLeuOcr(false); setOcrErro("");
    try {
      const blocos = await Promise.all(files.map(paraOcrBlock));
      const resp = await fetch("/api/ocr-nota", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ files: blocos }),
      });
      const j = await resp.json().catch(() => ({}));
      if (resp.ok) {
        if (j.emissor) setEmissor(j.emissor);
        if (j.cnpjEmissor) setCnpjEmissor(j.cnpjEmissor);
        if (j.numeroNota) setNumeroNota(j.numeroNota);
        if (j.serieNota) setSerieNota(j.serieNota);
        if (j.chaveAcesso) setChaveAcesso(j.chaveAcesso);
        if (j.valorProdutos != null) setValorProdutos(String(j.valorProdutos).replace(".", ","));
        if (j.valorImpostos != null) setValorImpostos(String(j.valorImpostos).replace(".", ","));
        if (j.valorTotal != null) setValor(String(j.valorTotal).replace(".", ","));
        if (j.dataEmissao) setDataEmissao(j.dataEmissao);
        if (Array.isArray(j.itens)) setItens(j.itens as ItemNota[]);
        if (Array.isArray(j.duplicatas)) setDuplicatas(j.duplicatas as DuplicataNota[]);
        setLeuOcr(true);
      } else {
        setOcrErro((j as { error?: string }).error || `Leitura indisponível (HTTP ${resp.status}).`);
      }
    } catch (e) {
      setOcrErro(e instanceof Error ? e.message : "Falha ao chamar o leitor de nota.");
    } finally { setLendo(false); }
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

  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const bolCamRef = useRef<HTMLInputElement>(null);
  const bolGalRef = useRef<HTMLInputElement>(null);
  const bolPdfRef = useRef<HTMLInputElement>(null);

  async function salvar() {
    setErro("");
    const temNota = notaFiles.length > 0;
    const temArquivos = temNota || boletoFiles.length > 0 || (!conforme && !!fotoDivFile);
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
      // Páginas da nota: "<base> nota" se 1 só; "<base> nota1/2/3…" se mais de uma.
      const notaPaginas: BoletoNota[] = [];
      for (let i = 0; i < notaFiles.length; i++) {
        const nf = notaFiles[i];
        const sufixo = notaFiles.length > 1 ? `nota${i + 1}` : "nota";
        const nome = `${baseNome} ${sufixo}${ext(nf, ".jpg")}`;
        const s = await subirArquivo(central, semanaId, new File([nf], nome, { type: nf.type }));
        notaPaginas.push({ driveFileId: s.id, nome, ...(s.webViewLink ? { driveUrl: s.webViewLink } : {}) });
      }
      const subidaNota = notaPaginas[0];
      // Boletos: "<base> boleto" se 1 só; "<base> boleto1/2/3…" se mais de um.
      const boletos: BoletoNota[] = [];
      for (let i = 0; i < boletoFiles.length; i++) {
        const bf = boletoFiles[i];
        const sufixo = boletoFiles.length > 1 ? `boleto${i + 1}` : "boleto";
        const nome = `${baseNome} ${sufixo}${ext(bf, ".jpg")}`;
        const s = await subirArquivo(central, semanaId, new File([bf], nome, { type: bf.type }));
        boletos.push({ driveFileId: s.id, nome, ...(s.webViewLink ? { driveUrl: s.webViewLink } : {}) });
      }
      let fotoDiv: { id: string; url?: string } | null = null;
      if (!conforme && fotoDivFile) {
        const extFoto = (fotoDivFile.name.match(/\.[a-z0-9]+$/i) || [".jpg"])[0];
        const s = await subirArquivo(central, semanaId, new File([fotoDivFile], `${baseNome} - divergencia${extFoto}`, { type: fotoDivFile.type }));
        fotoDiv = { id: s.id, url: s.webViewLink };
      }
      const nota: Omit<RecebimentoNota, "id"> = {
        restaurantId: rid,
        recebidoEm,
        recebidoPor: por,
        conforme,
        semanaLabel: label,
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

  const stepNum = { paginas: 1, dados: 2, boleto: 3, final: 4 }[etapa];
  const podeAvancar = !lendo && !lendoBoleto;
  const voltar = () => setEtapa(etapa === "dados" ? "paginas" : etapa === "boleto" ? "dados" : "boleto");
  const avancar = () => setEtapa(etapa === "paginas" ? "dados" : etapa === "dados" ? "boleto" : "final");
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
        <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Passo {stepNum} de 4 · {["Folhas da nota", "Conferir dados", "Boleto", "Conferência"][stepNum - 1]}</div>

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
          <div className="flex gap-2">
            <button type="button" onClick={() => camRef.current?.click()} className="flex-1 text-xs font-medium px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">📷 Câmera</button>
            <button type="button" onClick={() => galRef.current?.click()} className="flex-1 text-xs font-medium px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">🖼️ Galeria</button>
            <button type="button" onClick={() => pdfRef.current?.click()} className="flex-1 text-xs font-medium px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">📄 PDF</button>
          </div>
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) aoAnexar(f); }} />
          <input ref={galRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const fs = Array.from(e.target.files || []); e.currentTarget.value = ""; aoAnexar(...fs); }} />
          <input ref={pdfRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) aoAnexar(f); }} />
          {notaFiles.length > 0 && <p className="text-[10px] text-gray-400 mt-0.5">Notas com várias páginas (ex: Heineken): anexe todas — a leitura junta os itens de todas.</p>}
          {lendo && <p className="text-[11px] text-indigo-600 dark:text-indigo-300 mt-1">🔍 Lendo a nota… os campos abaixo vão ser pré-preenchidos (confira antes de salvar).</p>}
          {leuOcr && !lendo && <p className="text-[11px] text-emerald-600 dark:text-emerald-300 mt-1">✓ Li a nota e pré-preenchi os campos — <strong>confira/corrija</strong> antes de salvar.</p>}
          {ocrErro && !lendo && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">⚠ Não consegui ler a nota automaticamente ({ocrErro}). Preencha os campos manualmente.</p>}
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">Tem mais de uma folha? Adicione todas antes de continuar.</p>
        </div>
        )}

        {/* Passo 2 — conferir dados */}
        {etapa === "dados" && (<>
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Forma de pagamento <span className="font-normal text-gray-400">— opcional</span></label>
          <FormaPagamentoSelector value={formaPagamento} onChange={setFormaPagamento} />
        </div>

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

        {/* Passo 3 — boleto */}
        {etapa === "boleto" && (
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Recebeu boleto? <span className="font-normal text-gray-400">— opcional</span></label>
          {boletoFiles.length > 0 && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 mb-2">
              {boletoFiles.map((b, i) => (
                <div key={i} className="px-2 py-1.5 text-sm flex items-center gap-2">
                  <span className="truncate flex-1">🧾 {boletoFiles.length > 1 ? `Boleto ${i + 1}` : "Boleto"} · {b.name}</span>
                  <button type="button" className="text-[11px] text-gray-500 hover:underline" onClick={() => setBoletoFiles((prev) => prev.filter((_, j) => j !== i))}>remover</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => bolCamRef.current?.click()} className="flex-1 text-xs font-medium px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">📷 Câmera</button>
            <button type="button" onClick={() => bolGalRef.current?.click()} className="flex-1 text-xs font-medium px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">🖼️ Galeria</button>
            <button type="button" onClick={() => bolPdfRef.current?.click()} className="flex-1 text-xs font-medium px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">📄 PDF</button>
          </div>
          <input ref={bolCamRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) aoAnexarBoleto(f); }} />
          <input ref={bolGalRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) aoAnexarBoleto(f); }} />
          <input ref={bolPdfRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) aoAnexarBoleto(f); }} />
          {lendoBoleto && <p className="text-[11px] text-indigo-600 dark:text-indigo-300 mt-1">🔍 Lendo o boleto… valor e vencimento entram nas faturas.</p>}
          <p className="text-[10px] text-gray-400 mt-0.5">Se não veio boleto, é só continuar.</p>
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
          {(lendo || lendoBoleto) && <span className="text-[11px] text-indigo-600 dark:text-indigo-300">🔍 Lendo…</span>}
          {etapa === "final" ? (
            <Button size="sm" disabled={salvando || !podeAvancar} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar recebimento"}</Button>
          ) : (
            <Button size="sm" disabled={!podeAvancar} onClick={avancar}>Continuar →</Button>
          )}
        </div>
      </div>
      )}
    </Modal>
  );
}
