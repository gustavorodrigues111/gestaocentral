// ════════════════════════════════════════════════════════════════════════════
//  Fechamento de Caixa — fecha o caixa do turno sem precisar mandar no WhatsApp.
//
//  Fluxo: escolhe turno (almoço/jantar, pré-preenchido pelo horário) → anexa os
//  documentos (comprovante Altec [OCR pré-preenche total/dinheiro], filipetas das
//  maquininhas, comandas de sócios, foto do dinheiro) → confere total de vendas,
//  dinheiro, fundo de caixa, nº do lacre e observação → salva. Os anexos sobem
//  pro Drive (pasta do dia → subpasta do turno) e dispara email de resumo pros
//  sócios escolhidos nas Configurações.
//
//  Reaproveita a infra do Recebimento: conta Drive central (driveShared), carimbo
//  e filtro scanner (processarImagem), e o /api/send-email (Resend).
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where, deleteField } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import { Modal } from "../../core/ui/Modal";
import type { AnexoFechamento, ComandaCadastro, FechamentoCaixa, GrupoAnexoFechamento, MaquininhaFechamento, TurnoCaixa } from "../../core/types";
import { GRUPO_ANEXO_LABEL, TURNO_CAIXA_LABEL } from "../../core/types";
import { pickDriveFolder } from "../../core/google/drivePicker";
import { findOrCreateSubfolder, uploadFileToFolder } from "../../core/google/driveShared";
import { centralConfigured, centralEnsureTopFolder, centralEnsureFolder, centralMoveFolder, parseDriveFolderId } from "../../core/google/driveCentral";
import { authHeader } from "../../core/firebase/idToken";
import { paraOcrBlock, carimbarImagem } from "../../core/imagem/processarImagem";
import { exportarFechamentosPDF, exportarFechamentosXLSX } from "./exportFechamentos";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtBRL = (v?: number) => v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtData = (s?: string) => s ? s.split("-").reverse().join("/") : "—";
const fmtDataHora = (iso: string) => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const parseBRL = (s: string): number | undefined => { const t = (s || "").replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."); const n = parseFloat(t); return Number.isFinite(n) ? n : undefined; };
const diaLabel = (s: string) => s.split("-").reverse().join("."); // dd.mm.aaaa

// Sugestão de turno/data pelo horário: almoço (<17h), jantar (≥17h); madrugada
// (0-5h) = fechamento do jantar do dia anterior.
function sugerirTurnoData(now: Date): { data: string; turno: TurnoCaixa } {
  const h = now.getHours();
  if (h >= 0 && h < 5) { const o = new Date(now); o.setDate(now.getDate() - 1); return { data: ymd(o), turno: "jantar" }; }
  return { data: ymd(now), turno: h < 17 ? "almoco" : "jantar" };
}

// Dinheiro virou só valor (sem foto); filipetas entram junto do comprovante (1 grupo, IA lê tudo).
const GRUPOS: GrupoAnexoFechamento[] = ["comprovante", "comanda", "outro"];
const GRUPO_ICONE: Record<GrupoAnexoFechamento, string> = { comprovante: "🧾", filipeta: "💳", comanda: "📋", dinheiro: "💵", outro: "📎" };
const rotuloComanda = (c: ComandaCadastro) => `${c.nome} (${c.numero})`;
const digitos = (s: string) => (s || "").replace(/\D/g, "");

export function FechamentoCaixaPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurant = restaurants.find((r) => r.id === rid) || null;
  const { can, canModulo, loading: permLoading } = useCanAcao(rid);
  const podeFechar = can("fechamentoCaixa", "fechar");
  const podeVer = can("fechamentoCaixa", "ver");
  const podeEditar = can("fechamentoCaixa", "editar");
  const podeConfig = can("fechamentoCaixa", "configurar");
  const temAcesso = canModulo("fechamentoCaixa");

  const [tab, setTab] = useState<"novo" | "lista" | "config">("novo");
  const [fechamentos, setFechamentos] = useState<FechamentoCaixa[]>([]);
  const [novo, setNovo] = useState(false);
  const [erro, setErro] = useState("");
  const [exportando, setExportando] = useState<"" | "pdf" | "xlsx">("");

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "fechamentosCaixa"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => setFechamentos(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FechamentoCaixa)));
    return () => unsub();
  }, [rid]);

  const ordenados = useMemo(
    () => [...fechamentos].sort((a, b) => (b.fechadoEm || "").localeCompare(a.fechadoEm || "")),
    [fechamentos],
  );

  async function exportar(tipo: "pdf" | "xlsx") {
    if (!ordenados.length) return;
    setErro(""); setExportando(tipo);
    try {
      if (tipo === "pdf") await exportarFechamentosPDF(ordenados, restaurant?.nome || "");
      else await exportarFechamentosXLSX(ordenados, restaurant?.nome || "");
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao exportar."); }
    finally { setExportando(""); }
  }

  async function excluir(f: FechamentoCaixa) {
    if (!window.confirm(`Excluir o fechamento de ${fmtData(f.data)} (${TURNO_CAIXA_LABEL[f.turno]})?\n\nOs arquivos no Drive NÃO são apagados.`)) return;
    try { await deleteDoc(doc(db, "fechamentosCaixa", f.id)); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falha ao excluir."); }
  }

  if (!restaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (permLoading) return <div className="text-gray-400 py-12 text-center text-sm">Carregando…</div>;
  if (!temAcesso) {
    return <div className="max-w-2xl mx-auto py-12 text-center"><div className="text-4xl mb-3">🔒</div><p className="text-gray-600 dark:text-gray-400">Você não tem acesso ao Fechamento de Caixa.</p></div>;
  }

  const abas: Array<"novo" | "lista" | "config"> = [];
  if (podeFechar) abas.push("novo");
  if (podeVer) abas.push("lista");
  if (podeConfig) abas.push("config");
  const abaEfetiva = abas.includes(tab) ? tab : (abas[0] || "novo");

  const TabBtn = ({ k, label }: { k: "novo" | "lista" | "config"; label: string }) => (
    <button type="button" onClick={() => setTab(k)}
      className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${abaEfetiva === k ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-gray-500"}`}>{label}</button>
  );

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800 overflow-x-auto overflow-y-hidden whitespace-nowrap">
        {podeFechar && <TabBtn k="novo" label="💵 Novo fechamento" />}
        {podeVer && <TabBtn k="lista" label="📋 Fechamentos enviados" />}
        {podeConfig && <TabBtn k="config" label="⚙️ Configurações" />}
      </div>

      {erro && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}

      {abaEfetiva === "novo" && podeFechar && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <button type="button" onClick={() => { setErro(""); setNovo(true); }}
            className="flex flex-col items-center justify-center gap-3 w-full max-w-sm py-10 rounded-2xl border-2 border-dashed border-indigo-300 dark:border-indigo-700 bg-indigo-50/50 dark:bg-indigo-950/20 hover:bg-indigo-100/60 dark:hover:bg-indigo-950/40 transition">
            <span className="text-5xl">💵</span>
            <span className="text-lg font-semibold text-indigo-700 dark:text-indigo-300">Novo fechamento</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">Toque pra fechar o caixa do turno</span>
          </button>
        </div>
      )}

      {abaEfetiva === "config" && podeConfig && <FechamentoConfig rid={rid} restaurant={restaurant} />}

      {abaEfetiva === "lista" && podeVer && (
        <div className="space-y-3">
          {ordenados.length > 0 && (
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" disabled={!!exportando} onClick={() => void exportar("xlsx")}>{exportando === "xlsx" ? "Gerando…" : "⬇ XLSX"}</Button>
              <Button size="sm" variant="secondary" disabled={!!exportando} onClick={() => void exportar("pdf")}>{exportando === "pdf" ? "Gerando…" : "⬇ PDF"}</Button>
            </div>
          )}
          <FechamentoTabela fechamentos={ordenados} podeEditar={podeEditar} podeConfig={podeConfig} onExcluir={excluir} />
        </div>
      )}

      {novo && (
        <NovoFechamentoModal
          rid={rid}
          restaurant={restaurant}
          por={{ id: me?.id || "", nome: me?.nome || "?" }}
          onClose={() => setNovo(false)}
          onSalvo={() => setNovo(false)}
        />
      )}
    </div>
  );
}

// ─── Seletor de fonte (câmera / galeria / arquivo) ──────────────────────────
function FonteModal({ titulo, onClose, onArquivo }: { titulo: string; onClose: () => void; onArquivo: (f: File) => void }) {
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const Op = ({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) => (
    <button type="button" onClick={onClick} className="flex flex-col items-center justify-center gap-2 py-6 rounded-2xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
      <span className="text-3xl">{icon}</span><span className="text-sm font-medium text-gray-700 dark:text-gray-200">{label}</span>
    </button>
  );
  return (
    <Modal title={titulo} onClose={onClose} maxWidth="max-w-sm">
      <div className="grid grid-cols-3 gap-3">
        <Op icon="📷" label="Câmera" onClick={() => camRef.current?.click()} />
        <Op icon="🖼️" label="Galeria" onClick={() => galRef.current?.click()} />
        <Op icon="📄" label="PDF" onClick={() => pdfRef.current?.click()} />
      </div>
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) onArquivo(f); }} />
      <input ref={galRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const fs = Array.from(e.target.files || []); e.currentTarget.value = ""; fs.forEach(onArquivo); }} />
      <input ref={pdfRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) onArquivo(f); }} />
    </Modal>
  );
}

// ─── Modal: escolher/corrigir de qual comanda é o anexo ─────────────────────
function ComandaModal({ comandas, onClose, onPick }: { comandas: ComandaCadastro[]; onClose: () => void; onPick: (rotulo: string) => void }) {
  const lista = [...comandas].sort((a, b) => a.nome.localeCompare(b.nome));
  return (
    <Modal title="De qual comanda é?" onClose={onClose} maxWidth="max-w-sm">
      <div className="space-y-2">
        {lista.length > 0 ? (
          <div className="grid grid-cols-1 gap-1.5 max-h-72 overflow-auto">
            {lista.map((c) => (
              <button key={c.numero} type="button" onClick={() => onPick(rotuloComanda(c))}
                className="text-left text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                {c.nome} <span className="text-gray-400">· comanda {c.numero}</span>
              </button>
            ))}
          </div>
        ) : <p className="text-[12px] text-gray-400">Cadastre as comandas (sócios, cortesia, perdas…) na aba Configurações.</p>}
      </div>
    </Modal>
  );
}

// ─── Modal: novo fechamento ─────────────────────────────────────────────────
type AnexoLocal = { file: File; grupo: GrupoAnexoFechamento; rotulo?: string };
function NovoFechamentoModal({ rid, restaurant, por, onClose, onSalvo }: {
  rid: string;
  restaurant: { nome?: string; fechamentoDriveFolderId?: string; fechamentoSociosEmails?: string[]; fechamentoComandas?: ComandaCadastro[] };
  por: { id: string; nome: string };
  onClose: () => void;
  onSalvo: () => void;
}) {
  const sug = sugerirTurnoData(new Date());
  const [turno, setTurno] = useState<TurnoCaixa>(sug.turno);
  const [data, setData] = useState(sug.data);
  const [anexos, setAnexos] = useState<AnexoLocal[]>([]);
  const [grupoFonte, setGrupoFonte] = useState<GrupoAnexoFechamento | null>(null);
  const [comandaManual, setComandaManual] = useState<File | null>(null); // anexo de comanda em correção manual
  const comandasCad = restaurant.fechamentoComandas || [];
  const [totalVendas, setTotalVendas] = useState("");
  const [dinheiro, setDinheiro] = useState("");
  const [pix, setPix] = useState("");
  const [credito, setCredito] = useState("");
  const [debito, setDebito] = useState("");
  const [maquininhas, setMaquininhas] = useState<MaquininhaFechamento[]>([]);
  const [fundoCaixa, setFundoCaixa] = useState("");
  const [numeroLacre, setNumeroLacre] = useState("");
  const [observacao, setObservacao] = useState("");
  const [lendo, setLendo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState("");
  const leituraSeq = useRef(0);

  // OCR do(s) comprovante(s) + filipetas (todas as fotos juntas) → pré-preenche
  // total, dinheiro, PIX, crédito, débito e a quebra por maquininha.
  async function lerComprovantes(files: File[]) {
    if (!files.length) return;
    const seq = ++leituraSeq.current;
    setLendo(true);
    try {
      const blocos = await Promise.all(files.map(paraOcrBlock));
      const resp = await fetch("/api/ocr-nota", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ files: blocos, tipo: "fechamento" }) });
      const j = await resp.json().catch(() => ({}));
      if (seq !== leituraSeq.current) return;
      if (resp.ok) {
        // Data/turno: o comprovante é autoritativo — sobrescreve o palpite do horário.
        if (typeof j.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.data)) setData(j.data);
        if (j.turno === "almoco" || j.turno === "jantar") setTurno(j.turno);
        if (j.totalVendas != null) setTotalVendas((p) => p || String(j.totalVendas).replace(".", ","));
        if (j.dinheiro != null) setDinheiro((p) => p || String(j.dinheiro).replace(".", ","));
        if (j.pix != null) setPix((p) => p || String(j.pix).replace(".", ","));
        if (j.credito != null) setCredito((p) => p || String(j.credito).replace(".", ","));
        if (j.debito != null) setDebito((p) => p || String(j.debito).replace(".", ","));
        if (Array.isArray(j.maquininhas) && j.maquininhas.length) setMaquininhas(j.maquininhas as MaquininhaFechamento[]);
      }
    } catch { /* best-effort */ }
    finally { if (seq === leituraSeq.current) setLendo(false); }
  }

  function aoAnexar(grupo: GrupoAnexoFechamento, f: File, rotulo?: string) {
    setAnexos((prev) => {
      const next = [...prev, { file: f, grupo, ...(rotulo ? { rotulo } : {}) }];
      if (grupo === "comprovante") void lerComprovantes(next.filter((a) => a.grupo === "comprovante").map((a) => a.file));
      return next;
    });
    if (grupo === "comanda") void lerComanda(f);
  }

  // OCR da comanda → lê o número e associa à comanda cadastrada (se bater).
  async function lerComanda(f: File) {
    try {
      const bloco = await paraOcrBlock(f);
      const resp = await fetch("/api/ocr-nota", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ files: [bloco], tipo: "comanda" }) });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok || !j.numero) return;
      const num = digitos(String(j.numero));
      const match = comandasCad.find((c) => digitos(c.numero) === num);
      const rotulo = match ? rotuloComanda(match) : `Comanda ${num}`;
      setAnexos((prev) => prev.map((a) => a.file === f ? { ...a, rotulo } : a));
    } catch { /* best-effort — usuário identifica manualmente */ }
  }

  async function salvar() {
    setErro("");
    if (!data) { setErro("Informe a data."); return; }
    if (!anexos.length && parseBRL(totalVendas) == null) { setErro("Anexe ao menos um documento ou preencha o total de vendas."); return; }
    if (anexos.length && !restaurant.fechamentoDriveFolderId) { setErro("Configure a pasta do Drive em Configurações antes de fechar."); return; }
    setSalvando(true);
    try {
      const agora = new Date();
      const fechadoEm = agora.toISOString();
      let anexosSalvos: AnexoFechamento[] = [];
      let driveFolderUrl: string | undefined;
      if (anexos.length) {
        // <pasta config> / <dia dd.mm.aaaa> / <turno> /
        const diaId = await findOrCreateSubfolder(restaurant.fechamentoDriveFolderId as string, diaLabel(data));
        const turnoId = await findOrCreateSubfolder(diaId, TURNO_CAIXA_LABEL[turno]);
        driveFolderUrl = `https://drive.google.com/drive/folders/${turnoId}`;
        const carimbo = [`Fechado por ${por.nome}`, `${TURNO_CAIXA_LABEL[turno]} · ${fmtData(data)}`, fmtDataHora(fechadoEm)];
        const contagem: Partial<Record<GrupoAnexoFechamento, number>> = {};
        for (const a of anexos) {
          const n = (contagem[a.grupo] = (contagem[a.grupo] || 0) + 1);
          const ext = (a.file.name.match(/\.[a-z0-9]+$/i) || [""])[0] || (a.file.type.includes("pdf") ? ".pdf" : ".jpg");
          // Comanda usa o rótulo no nome (ex: "comanda Cortesia (99)"); demais "grupoN".
          const base = a.grupo === "comanda" && a.rotulo ? `comanda ${a.rotulo}`.replace(/[\\/]/g, "-") : `${a.grupo}${n}`;
          const alvo = await carimbarImagem(new File([a.file], `${base}${ext}`, { type: a.file.type }), carimbo, a.grupo !== "outro");
          const s = await uploadFileToFolder(turnoId, alvo);
          anexosSalvos.push({ driveFileId: s.id, nome: alvo.name, grupo: a.grupo, ...(a.rotulo ? { rotulo: a.rotulo } : {}), ...(s.webViewLink ? { driveUrl: s.webViewLink } : {}) });
        }
      }
      const emails = (restaurant.fechamentoSociosEmails || []).filter((e) => e.includes("@"));
      const fechamento: Omit<FechamentoCaixa, "id"> = {
        restaurantId: rid,
        data,
        turno,
        fechadoEm,
        fechadoPor: por,
        ...(parseBRL(totalVendas) != null ? { totalVendas: parseBRL(totalVendas) } : {}),
        ...(parseBRL(dinheiro) != null ? { dinheiro: parseBRL(dinheiro) } : {}),
        ...(parseBRL(pix) != null ? { pix: parseBRL(pix) } : {}),
        ...(parseBRL(credito) != null ? { credito: parseBRL(credito) } : {}),
        ...(parseBRL(debito) != null ? { debito: parseBRL(debito) } : {}),
        ...(maquininhas.length ? { maquininhas } : {}),
        ...(parseBRL(fundoCaixa) != null ? { fundoCaixa: parseBRL(fundoCaixa) } : {}),
        ...(numeroLacre.trim() ? { numeroLacre: numeroLacre.trim() } : {}),
        ...(observacao.trim() ? { observacao: observacao.trim() } : {}),
        ...(anexosSalvos.length ? { anexos: anexosSalvos } : {}),
        ...(driveFolderUrl ? { driveFolderUrl } : {}),
        ...(emails.length ? { emailEnviadoPara: emails } : {}),
      };
      await addDoc(collection(db, "fechamentosCaixa"), fechamento);
      // Email de resumo pros sócios (best-effort — não trava o save).
      if (emails.length) void enviarEmailResumo(emails, restaurant.nome || "Restaurante", fechamento);
      setSalvo(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar o fechamento.");
    } finally { setSalvando(false); }
  }

  const inputCls = "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";
  if (salvo) {
    return (
      <Modal title="💵 Novo fechamento" onClose={onSalvo} maxWidth="max-w-lg">
        <div className="py-10 flex flex-col items-center text-center gap-3">
          <div className="text-5xl">✅</div>
          <div className="text-lg font-semibold text-emerald-700 dark:text-emerald-300">Fechamento registrado!</div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {TURNO_CAIXA_LABEL[turno]} de {fmtData(data)} salvo{anexos.length ? " e arquivado no Drive" : ""}.
            {(restaurant.fechamentoSociosEmails || []).filter((e) => e.includes("@")).length ? " Email enviado aos sócios." : ""}
          </p>
          <Button onClick={onSalvo}>Concluir</Button>
        </div>
      </Modal>
    );
  }

  const porGrupo = (g: GrupoAnexoFechamento) => anexos.filter((a) => a.grupo === g);
  return (
    <Modal title="💵 Novo fechamento" onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-4">
        {erro && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}

        {/* Turno + data (pré-preenchidos pelo horário) */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Turno</label>
            <div className="flex gap-2">
              {(["almoco", "jantar"] as TurnoCaixa[]).map((t) => (
                <button key={t} type="button" onClick={() => setTurno(t)} className={`flex-1 text-sm font-medium px-3 py-2 rounded-lg border ${turno === t ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300" : "border-gray-300 dark:border-gray-700 text-gray-600"}`}>{TURNO_CAIXA_LABEL[t]}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Data</label>
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={`${inputCls} [color-scheme:light] dark:[color-scheme:dark]`} />
          </div>
        </div>

        {/* Anexos por grupo */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block">Documentos do fechamento</label>
          {GRUPOS.map((g) => {
            const itens = porGrupo(g);
            return (
              <div key={g} className="rounded-lg border border-gray-200 dark:border-gray-800 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-gray-700 dark:text-gray-200">{GRUPO_ICONE[g]} {GRUPO_ANEXO_LABEL[g]}</span>
                  <Button size="sm" variant="secondary" onClick={() => setGrupoFonte(g)}>➕ Anexar</Button>
                </div>
                {itens.length > 0 && (
                  <div className="mt-1 divide-y divide-gray-100 dark:divide-gray-800">
                    {itens.map((a) => {
                      const idx = anexos.indexOf(a);
                      return (
                        <div key={idx} className="px-1 py-1 text-[11px] flex items-center gap-2">
                          <span className="truncate flex-1">📎 {a.grupo === "comanda" ? (a.rotulo || "❓ não identificada") + " · " : a.rotulo ? `${a.rotulo} · ` : ""}{a.file.name}</span>
                          {a.grupo === "comanda" && <button type="button" className="text-[10px] text-indigo-600 hover:underline" onClick={() => setComandaManual(a.file)}>{a.rotulo ? "trocar" : "identificar"}</button>}
                          <button type="button" className="text-gray-400 hover:text-rose-600" onClick={() => setAnexos((prev) => prev.filter((_, i) => i !== idx))}>✕</button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {g === "comanda" && <p className="text-[10px] text-gray-400 mt-1">A IA tenta ler o número e associar à comanda cadastrada. Se errar, toque em "identificar/trocar".</p>}
                {g === "comprovante" && <p className="text-[10px] text-gray-400 mt-1">Anexe o comprovante Altec + as filipetas (pode ser uma foto só com tudo). A IA lê os valores, as maquininhas e a quebra por tipo.</p>}
                {g === "comprovante" && lendo && <p className="text-[11px] text-indigo-600 dark:text-indigo-300 mt-1">🔍 Lendo… total, dinheiro, PIX, crédito, débito e maquininhas vão ser pré-preenchidos.</p>}
              </div>
            );
          })}
        </div>

        {/* Dados conferidos */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Total de vendas</label>
            <input value={totalVendas} onChange={(e) => setTotalVendas(e.target.value)} inputMode="decimal" placeholder="R$ 0,00" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Dinheiro</label>
            <input value={dinheiro} onChange={(e) => setDinheiro(e.target.value)} inputMode="decimal" placeholder="R$ 0,00" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">PIX</label>
            <input value={pix} onChange={(e) => setPix(e.target.value)} inputMode="decimal" placeholder="R$ 0,00" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Crédito</label>
            <input value={credito} onChange={(e) => setCredito(e.target.value)} inputMode="decimal" placeholder="R$ 0,00" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Débito</label>
            <input value={debito} onChange={(e) => setDebito(e.target.value)} inputMode="decimal" placeholder="R$ 0,00" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Fundo de caixa</label>
            <input value={fundoCaixa} onChange={(e) => setFundoCaixa(e.target.value)} inputMode="decimal" placeholder="R$ 0,00" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Nº do lacre do malote</label>
            <input value={numeroLacre} onChange={(e) => setNumeroLacre(e.target.value)} placeholder="ex: h3141345" className={inputCls} />
          </div>
        </div>

        {/* Maquininhas lidas pela IA */}
        {maquininhas.length > 0 && (
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Maquininhas ({maquininhas.length}) <span className="font-normal text-gray-400">— lidas pela IA</span></label>
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
              {maquininhas.map((m, i) => (
                <div key={i} className="px-2 py-1 text-[11px] flex items-center gap-2">
                  <span className="flex-1 truncate">💳 {m.identificador || `Maquininha ${i + 1}`}</span>
                  {m.credito != null && <span className="shrink-0 tabular-nums text-gray-500">créd {fmtBRL(m.credito)}</span>}
                  {m.debito != null && <span className="shrink-0 tabular-nums text-gray-500">déb {fmtBRL(m.debito)}</span>}
                  {m.total != null && <span className="shrink-0 tabular-nums font-medium w-20 text-right">{fmtBRL(m.total)}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Observação / ocorrência <span className="font-normal text-gray-400">— opcional</span></label>
          <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} placeholder="Ex: dinheiro do caixa não existe no malote, foi…"
            className={inputCls} />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          {lendo && <span className="text-[11px] text-indigo-600 dark:text-indigo-300 self-center mr-auto">🔍 Lendo…</span>}
          <Button variant="secondary" size="sm" disabled={salvando} onClick={onClose}>Cancelar</Button>
          <Button size="sm" disabled={salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Fechar caixa"}</Button>
        </div>

        {grupoFonte && (
          <FonteModal titulo={`Anexar — ${GRUPO_ANEXO_LABEL[grupoFonte]}`} onClose={() => setGrupoFonte(null)}
            onArquivo={(f) => { const g = grupoFonte; setGrupoFonte(null); aoAnexar(g, f); }} />
        )}
        {comandaManual && (
          <ComandaModal comandas={comandasCad} onClose={() => setComandaManual(null)}
            onPick={(rot) => { const f = comandaManual; setComandaManual(null); setAnexos((prev) => prev.map((a) => a.file === f ? { ...a, rotulo: rot } : a)); }} />
        )}
      </div>
    </Modal>
  );
}

// Envia email de resumo pros sócios (1 por email, via Resend).
async function enviarEmailResumo(emails: string[], restaurantNome: string, f: Omit<FechamentoCaixa, "id">) {
  const linha = (k: string, v?: string) => v ? `<tr><td style="padding:4px 12px 4px 0;color:#666">${k}</td><td style="padding:4px 0;font-weight:600">${v}</td></tr>` : "";
  const html =
    `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px">` +
    `<h2 style="margin:0 0 4px">Fechamento de Caixa — ${restaurantNome}</h2>` +
    `<p style="color:#666;margin:0 0 12px">${TURNO_CAIXA_LABEL[f.turno]} · ${fmtData(f.data)}</p>` +
    `<table style="font-size:14px;border-collapse:collapse">` +
    linha("Total de vendas", f.totalVendas != null ? fmtBRL(f.totalVendas) : undefined) +
    linha("Dinheiro", f.dinheiro != null ? fmtBRL(f.dinheiro) : undefined) +
    linha("PIX", f.pix != null ? fmtBRL(f.pix) : undefined) +
    linha("Crédito", f.credito != null ? fmtBRL(f.credito) : undefined) +
    linha("Débito", f.debito != null ? fmtBRL(f.debito) : undefined) +
    linha("Fundo de caixa", f.fundoCaixa != null ? fmtBRL(f.fundoCaixa) : undefined) +
    linha("Nº do lacre", f.numeroLacre) +
    linha("Fechado por", f.fechadoPor?.nome) +
    linha("Observação", f.observacao) +
    `</table></div>`;
  const text = `Fechamento de Caixa — ${restaurantNome}\n${TURNO_CAIXA_LABEL[f.turno]} · ${fmtData(f.data)}\n`
    + `Total de vendas: ${f.totalVendas != null ? fmtBRL(f.totalVendas) : "—"}\nDinheiro: ${f.dinheiro != null ? fmtBRL(f.dinheiro) : "—"}\n`
    + `Fundo de caixa: ${f.fundoCaixa != null ? fmtBRL(f.fundoCaixa) : "—"}\nLacre: ${f.numeroLacre || "—"}\nFechado por: ${f.fechadoPor?.nome || "—"}\n`
    + (f.observacao ? `Observação: ${f.observacao}\n` : "");
  const subject = `Fechamento ${TURNO_CAIXA_LABEL[f.turno]} ${fmtData(f.data)} — ${restaurantNome}`;
  const headers = { "Content-Type": "application/json", ...(await authHeader()) };
  for (const to of emails) {
    try { await fetch("/api/send-email", { method: "POST", headers, body: JSON.stringify({ to, subject, html, text }) }); }
    catch { /* best-effort */ }
  }
}

// ─── Configurações: pasta do Drive + sócios ─────────────────────────────────
function FechamentoConfig({ rid, restaurant }: { rid: string; restaurant: { nome?: string; fechamentoDriveFolderId?: string; fechamentoDriveFolderNome?: string; fechamentoSociosEmails?: string[]; fechamentoComandas?: ComandaCadastro[] } }) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [central, setCentral] = useState<boolean | null>(null);
  const [destino, setDestino] = useState("");
  const [emails, setEmails] = useState<string[]>(restaurant.fechamentoSociosEmails || []);
  const [novoEmail, setNovoEmail] = useState("");
  const [comandas, setComandas] = useState<ComandaCadastro[]>(restaurant.fechamentoComandas || []);
  const [cmdNome, setCmdNome] = useState("");
  const [cmdNumero, setCmdNumero] = useState("");
  useEffect(() => { void centralConfigured().then(setCentral); }, []);

  async function salvarComandas(lista: ComandaCadastro[]) {
    setComandas(lista);
    try { await updateDoc(doc(db, "restaurants", rid), { fechamentoComandas: lista.length ? lista : deleteField() }); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falha ao salvar as comandas."); }
  }
  function addComanda() {
    const nome = cmdNome.trim(), numero = cmdNumero.trim();
    if (!nome || !numero) { setErro("Informe a finalidade e o número da comanda."); return; }
    if (comandas.some((s) => s.numero === numero)) { setErro(`Já existe comanda com o número ${numero}.`); return; }
    setErro(""); setCmdNome(""); setCmdNumero("");
    void salvarComandas([...comandas, { nome, numero }]);
  }

  async function escolherPasta() {
    setErro("");
    try {
      const pasta = await pickDriveFolder("Pasta dos fechamentos de caixa");
      if (!pasta) return;
      setSalvando(true);
      await updateDoc(doc(db, "restaurants", rid), { fechamentoDriveFolderId: pasta.id, fechamentoDriveFolderNome: pasta.name });
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao selecionar a pasta."); }
    finally { setSalvando(false); }
  }
  async function inicializarCentral() {
    setErro(""); setSalvando(true);
    try {
      const nome = restaurant.nome || "Restaurante";
      const parent = destino.trim() ? parseDriveFolderId(destino) : null;
      if (destino.trim() && !parent) throw new Error("Link/ID da pasta de destino inválido.");
      const folderId = parent ? await centralEnsureFolder(parent, `Fechamentos de Caixa — ${nome}`) : (await centralEnsureTopFolder(`Fechamentos de Caixa — ${nome}`)).folderId;
      await updateDoc(doc(db, "restaurants", rid), { fechamentoDriveFolderId: folderId, fechamentoDriveFolderNome: `Fechamentos de Caixa — ${nome}` });
      setDestino("");
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao inicializar a pasta central."); }
    finally { setSalvando(false); }
  }
  async function moverParaDestino() {
    setErro("");
    const parent = parseDriveFolderId(destino);
    if (!parent) { setErro("Cole um link/ID de pasta do Drive válido."); return; }
    if (!restaurant.fechamentoDriveFolderId) { setErro("Não há pasta pra mover ainda."); return; }
    setSalvando(true);
    try { await centralMoveFolder(restaurant.fechamentoDriveFolderId, parent); setDestino(""); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falha ao mover a pasta."); }
    finally { setSalvando(false); }
  }
  async function salvarEmails(lista: string[]) {
    setEmails(lista);
    try { await updateDoc(doc(db, "restaurants", rid), { fechamentoSociosEmails: lista.length ? lista : deleteField() }); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falha ao salvar os emails."); }
  }
  function addEmail() {
    const e = novoEmail.trim().toLowerCase();
    if (!e.includes("@")) { setErro("Email inválido."); return; }
    if (emails.includes(e)) { setNovoEmail(""); return; }
    setErro(""); setNovoEmail("");
    void salvarEmails([...emails, e]);
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Pasta do Drive dos fechamentos</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">Os anexos são arquivados aqui — o app cria subpastas por <strong>dia</strong> e, dentro, por <strong>turno</strong> (almoço/jantar).</p>
        {central === true && <p className="text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2">✓ Conta central do Drive ativa — quem fecha o caixa não conecta o próprio Drive.</p>}
        {erro && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}
        <div className="flex items-center gap-3">
          <div className="flex-1 text-sm">{restaurant.fechamentoDriveFolderId
            ? <span className="text-emerald-700 dark:text-emerald-300">📁 {restaurant.fechamentoDriveFolderNome || "pasta selecionada"}</span>
            : <span className="text-amber-600">Nenhuma pasta selecionada</span>}</div>
          {central !== true && <Button variant="secondary" size="sm" disabled={salvando} onClick={() => void escolherPasta()}>{salvando ? "Salvando…" : restaurant.fechamentoDriveFolderId ? "Trocar pasta" : "Selecionar pasta"}</Button>}
        </div>
        {central === true && (
          <div className="space-y-2 pt-1 border-t border-gray-100 dark:border-gray-800">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block">Onde guardar no Drive <span className="font-normal text-gray-400">— opcional</span></label>
            <input value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
            <div className="flex gap-2 flex-wrap">
              <Button variant="secondary" size="sm" disabled={salvando} onClick={() => void inicializarCentral()}>{salvando ? "Criando…" : restaurant.fechamentoDriveFolderId ? "Recriar pasta aqui" : "Inicializar pasta central"}</Button>
              {restaurant.fechamentoDriveFolderId && <Button variant="secondary" size="sm" disabled={salvando || !destino.trim()} onClick={() => void moverParaDestino()}>Mover pasta atual pra cá</Button>}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Sócios que recebem o email</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">A cada fechamento, um email de resumo é enviado pra estes endereços.</p>
        {emails.length > 0 && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {emails.map((e) => (
              <div key={e} className="px-3 py-1.5 text-sm flex items-center gap-2">
                <span className="flex-1 truncate">✉️ {e}</span>
                <button type="button" className="text-[11px] text-gray-500 hover:text-rose-600" onClick={() => void salvarEmails(emails.filter((x) => x !== e))}>remover</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input value={novoEmail} onChange={(e) => setNovoEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addEmail(); }} placeholder="socio@email.com" type="email"
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
          <Button variant="secondary" size="sm" onClick={addEmail}>+ Adicionar</Button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Comandas cadastradas</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">Cadastre as comandas com a <strong>finalidade</strong> + <strong>número fixo</strong> (sócios, cortesia, perdas, treinamento…). Ao anexar uma comanda, a IA lê o número e associa automaticamente; se errar, você corrige escolhendo daqui.</p>
        {comandas.length > 0 && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {comandas.map((s) => (
              <div key={s.numero} className="px-3 py-1.5 text-sm flex items-center gap-2">
                <span className="flex-1 truncate">📋 {s.nome} <span className="text-gray-400">· comanda {s.numero}</span></span>
                <button type="button" className="text-[11px] text-gray-500 hover:text-rose-600" onClick={() => void salvarComandas(comandas.filter((x) => x.numero !== s.numero))}>remover</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input value={cmdNome} onChange={(e) => setCmdNome(e.target.value)} placeholder="Finalidade (ex: João, Cortesia, Perdas)"
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
          <input value={cmdNumero} onChange={(e) => setCmdNumero(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addComanda(); }} placeholder="Nº" inputMode="numeric"
            className="w-24 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
          <Button variant="secondary" size="sm" onClick={addComanda}>+ Adicionar</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Tabela de fechamentos ──────────────────────────────────────────────────
function FechamentoTabela({ fechamentos, podeEditar, podeConfig, onExcluir }: {
  fechamentos: FechamentoCaixa[];
  podeEditar: boolean;
  podeConfig: boolean;
  onExcluir: (f: FechamentoCaixa) => void;
}) {
  const [detalhe, setDetalhe] = useState<FechamentoCaixa | null>(null);
  const [editar, setEditar] = useState<FechamentoCaixa | null>(null);
  if (fechamentos.length === 0) {
    return <div className="text-center text-sm text-gray-400 py-12">Nenhum fechamento ainda. Clique em <strong>💵 Novo fechamento</strong>.</div>;
  }
  return (
    <>
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-200 dark:border-gray-800">
              <th className="px-3 py-2">Fechado em</th>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Turno</th>
              <th className="px-3 py-2 text-right">Total vendas</th>
              <th className="px-3 py-2 text-right">Dinheiro</th>
              <th className="px-3 py-2">Lacre</th>
              <th className="px-3 py-2">Fechou</th>
              <th className="px-3 py-2">Obs.</th>
              <th className="px-3 py-2">Pasta</th>
              <th className="px-3 py-2" />
              {podeConfig && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {fechamentos.map((f) => (
              <tr key={f.id} className="whitespace-nowrap">
                <td className="px-3 py-2 tabular-nums">{fmtDataHora(f.fechadoEm)}</td>
                <td className="px-3 py-2 tabular-nums text-gray-500">{fmtData(f.data)}</td>
                <td className="px-3 py-2">{TURNO_CAIXA_LABEL[f.turno]}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtBRL(f.totalVendas)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmtBRL(f.dinheiro)}</td>
                <td className="px-3 py-2 tabular-nums text-gray-500">{f.numeroLacre || "—"}</td>
                <td className="px-3 py-2 text-gray-500 max-w-[140px] truncate" title={f.fechadoPor?.nome || ""}>{f.fechadoPor?.nome || "—"}</td>
                <td className="px-3 py-2 max-w-[200px] truncate text-gray-600 dark:text-gray-300" title={f.observacao || ""}>{f.observacao || "—"}</td>
                <td className="px-3 py-2">{f.driveFolderUrl ? <a href={f.driveFolderUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">abrir ↗</a> : "—"}</td>
                <td className="px-3 py-2"><button type="button" onClick={() => setDetalhe(f)} className="text-[11px] text-indigo-600 hover:underline">detalhes</button></td>
                {podeConfig && <td className="px-3 py-2 text-right"><button type="button" onClick={() => onExcluir(f)} className="text-[11px] text-rose-600 hover:underline">excluir</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detalhe && <DetalheFechamentoModal f={detalhe} podeEditar={podeEditar} onClose={() => setDetalhe(null)} onEditar={(x) => { setDetalhe(null); setEditar(x); }} />}
      {editar && <EditarFechamentoModal f={editar} onClose={() => setEditar(null)} onSaved={() => setEditar(null)} />}
    </>
  );
}

function DetalheFechamentoModal({ f, podeEditar, onClose, onEditar }: { f: FechamentoCaixa; podeEditar: boolean; onClose: () => void; onEditar: (f: FechamentoCaixa) => void }) {
  const linha = (k: string, v?: string | null) => (v != null && v !== "") ? (
    <div className="flex justify-between gap-3 py-1 border-b border-gray-100 dark:border-gray-800 text-sm"><span className="text-gray-500 dark:text-gray-400">{k}</span><span className="text-right text-gray-800 dark:text-gray-200 break-all">{v}</span></div>
  ) : null;
  return (
    <Modal title="💵 Detalhes do fechamento" onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-1">
        {linha("Fechado em", fmtDataHora(f.fechadoEm))}
        {linha("Data / turno", `${fmtData(f.data)} · ${TURNO_CAIXA_LABEL[f.turno]}`)}
        {linha("Fechado por", f.fechadoPor?.nome)}
        {linha("Total de vendas", f.totalVendas != null ? fmtBRL(f.totalVendas) : null)}
        {linha("Dinheiro", f.dinheiro != null ? fmtBRL(f.dinheiro) : null)}
        {linha("PIX", f.pix != null ? fmtBRL(f.pix) : null)}
        {linha("Crédito", f.credito != null ? fmtBRL(f.credito) : null)}
        {linha("Débito", f.debito != null ? fmtBRL(f.debito) : null)}
        {linha("Fundo de caixa", f.fundoCaixa != null ? fmtBRL(f.fundoCaixa) : null)}
        {linha("Nº do lacre", f.numeroLacre)}
        {linha("Observação", f.observacao)}
        {linha("Email enviado a", f.emailEnviadoPara?.join(", "))}
      </div>
      {f.maquininhas && f.maquininhas.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Maquininhas ({f.maquininhas.length})</div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {f.maquininhas.map((m, i) => (
              <div key={i} className="px-2 py-1 text-[11px] flex items-center gap-2">
                <span className="flex-1 truncate">💳 {m.identificador || `Maquininha ${i + 1}`}</span>
                {m.credito != null && <span className="shrink-0 tabular-nums text-gray-500">créd {fmtBRL(m.credito)}</span>}
                {m.debito != null && <span className="shrink-0 tabular-nums text-gray-500">déb {fmtBRL(m.debito)}</span>}
                {m.total != null && <span className="shrink-0 tabular-nums font-medium w-20 text-right">{fmtBRL(m.total)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      {f.anexos && f.anexos.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Anexos ({f.anexos.length})</div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 max-h-60 overflow-auto">
            {f.anexos.map((a, i) => (
              <div key={i} className="px-2 py-1.5 text-[11px] flex items-center gap-2">
                <span className="truncate flex-1">{GRUPO_ICONE[a.grupo]} {a.rotulo ? a.rotulo : GRUPO_ANEXO_LABEL[a.grupo]} · {a.nome}</span>
                {a.driveUrl && <a href={a.driveUrl} target="_blank" rel="noreferrer" className="shrink-0 text-indigo-600 hover:underline">abrir ↗</a>}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-3">
        {f.driveFolderUrl && <a href={f.driveFolderUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300">↗ Abrir pasta no Drive</a>}
        {podeEditar && <Button size="sm" variant="secondary" onClick={() => onEditar(f)}>✏️ Editar</Button>}
        <Button size="sm" variant="secondary" onClick={onClose}>Fechar</Button>
      </div>
    </Modal>
  );
}

function EditarFechamentoModal({ f, onClose, onSaved }: { f: FechamentoCaixa; onClose: () => void; onSaved: () => void }) {
  const toBR = (v?: number) => v == null ? "" : String(v).replace(".", ",");
  const [totalVendas, setTotalVendas] = useState(toBR(f.totalVendas));
  const [dinheiro, setDinheiro] = useState(toBR(f.dinheiro));
  const [fundoCaixa, setFundoCaixa] = useState(toBR(f.fundoCaixa));
  const [numeroLacre, setNumeroLacre] = useState(f.numeroLacre || "");
  const [observacao, setObservacao] = useState(f.observacao || "");
  const [data, setData] = useState(f.data);
  const [turno, setTurno] = useState<TurnoCaixa>(f.turno);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const inputCls = "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";
  async function salvar() {
    setErro(""); setSalvando(true);
    try {
      await updateDoc(doc(db, "fechamentosCaixa", f.id), {
        data, turno,
        totalVendas: parseBRL(totalVendas) ?? deleteField(),
        dinheiro: parseBRL(dinheiro) ?? deleteField(),
        fundoCaixa: parseBRL(fundoCaixa) ?? deleteField(),
        numeroLacre: numeroLacre.trim() || deleteField(),
        observacao: observacao.trim() || deleteField(),
      });
      onSaved();
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao salvar."); }
    finally { setSalvando(false); }
  }
  return (
    <Modal title="✏️ Editar fechamento" onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        {erro && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}
        <p className="text-[11px] text-gray-400">Os anexos no Drive não mudam — aqui você corrige só os dados.</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Turno</label>
            <div className="flex gap-2">
              {(["almoco", "jantar"] as TurnoCaixa[]).map((t) => (
                <button key={t} type="button" onClick={() => setTurno(t)} className={`flex-1 text-sm font-medium px-2 py-2 rounded-lg border ${turno === t ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300" : "border-gray-300 dark:border-gray-700 text-gray-600"}`}>{TURNO_CAIXA_LABEL[t]}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Data</label>
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={`${inputCls} [color-scheme:light] dark:[color-scheme:dark]`} />
          </div>
          <div><label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Total de vendas</label><input value={totalVendas} onChange={(e) => setTotalVendas(e.target.value)} inputMode="decimal" className={inputCls} /></div>
          <div><label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Dinheiro</label><input value={dinheiro} onChange={(e) => setDinheiro(e.target.value)} inputMode="decimal" className={inputCls} /></div>
          <div><label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Fundo de caixa</label><input value={fundoCaixa} onChange={(e) => setFundoCaixa(e.target.value)} inputMode="decimal" className={inputCls} /></div>
          <div><label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Nº do lacre</label><input value={numeroLacre} onChange={(e) => setNumeroLacre(e.target.value)} className={inputCls} /></div>
        </div>
        <div><label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Observação</label><textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} className={inputCls} /></div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" disabled={salvando} onClick={onClose}>Cancelar</Button>
          <Button size="sm" disabled={salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar alterações"}</Button>
        </div>
      </div>
    </Modal>
  );
}
