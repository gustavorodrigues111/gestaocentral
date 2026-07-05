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
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useParams } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where, deleteField } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import { Modal } from "../../core/ui/Modal";
import { enviarWhatsapp } from "../../core/whatsapp/enviar";
import type { AnexoFechamento, ComandaCadastro, ComandaConsumo, FechamentoCaixa, GrupoAnexoFechamento, MaquininhaFechamento, TurnoCaixa } from "../../core/types";
import { GRUPO_ANEXO_LABEL, TURNO_CAIXA_LABEL } from "../../core/types";
import { pickDriveFolder } from "../../core/google/drivePicker";
import { findOrCreateSubfolder, uploadFileToFolder } from "../../core/google/driveShared";
import { centralConfigured, centralEnsureTopFolder, centralEnsureFolder, centralMoveFolder, parseDriveFolderId } from "../../core/google/driveCentral";
import { authHeader } from "../../core/firebase/idToken";
import { paraOcrBlock, carimbarImagem } from "../../core/imagem/processarImagem";
import { exportarFechamentosPDF, exportarFechamentosXLSX, exportarComandasPDF, exportarComandasXLSX } from "./exportFechamentos";
import { montarPainel, painelEmailHtml, fmtBRLp, fmtDiaCurto } from "./painelFechamento";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtBRL = (v?: number) => v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtData = (s?: string) => s ? s.split("-").reverse().join("/") : "—";
const fmtDataHora = (iso: string) => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const parseBRL = (s: string): number | undefined => { const t = (s || "").replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."); const n = parseFloat(t); return Number.isFinite(n) ? n : undefined; };
// Formata pra "XX.XXX,XX" (milhares com ponto). Vazio/ inválido volta como está.
const fmtMilhar = (raw: string): string => { const n = parseBRL(raw); return n != null ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : raw; };
const diaLabel = (s: string) => s.split("-").reverse().join("."); // dd.mm.aaaa

// Sugestão de turno/data pelo horário: almoço (<18h), jantar (≥18h); madrugada
// (0-5h) = fechamento do jantar do dia anterior. É só um palpite — a checagem
// de consistência (checarTurnoData) confirma na hora de fechar.
function sugerirTurnoData(now: Date): { data: string; turno: TurnoCaixa } {
  const h = now.getHours();
  if (h >= 0 && h < 5) { const o = new Date(now); o.setDate(now.getDate() - 1); return { data: ymd(o), turno: "jantar" }; }
  return { data: ymd(now), turno: h < 18 ? "almoco" : "jantar" };
}
function medianN(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const GRUPO_ICONE: Record<GrupoAnexoFechamento, string> = { comprovante: "🧾", filipeta: "💳", comanda: "📋", dinheiro: "💵", outro: "📎" };
const rotuloComanda = (c: ComandaCadastro) => `${c.nome} (${c.numero})`;
const digitos = (s: string) => (s || "").replace(/\D/g, "");
// Número de comanda normalizado pra casar "093" com "93" (tira zeros à esquerda).
const numComanda = (s: string) => digitos(s).replace(/^0+(?=\d)/, "");
const totalMaq = (m: MaquininhaFechamento) => m.total != null ? m.total : (m.credito || 0) + (m.debito || 0) + (m.pix || 0);

// Input de dinheiro: mostra "XX.XXX,XX" quando sem foco; ao focar vira editável
// (sem separador, pra digitar sem o cursor pular).
function MoneyInput({ value, onChange, className, placeholder }: { value?: number; onChange: (n: number | undefined) => void; className?: string; placeholder?: string }) {
  const [foco, setFoco] = useState(false);
  const [raw, setRaw] = useState("");
  const display = foco ? raw : (value != null ? value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
  return (
    <input value={display} placeholder={placeholder} inputMode="decimal" className={className}
      onFocus={() => { setRaw(value != null ? String(value).replace(".", ",") : ""); setFoco(true); }}
      onChange={(e) => { setRaw(e.target.value); onChange(parseBRL(e.target.value)); }}
      onBlur={() => setFoco(false)} />
  );
}

// Código do terminal (ex: SD182312) extraído do identificador, ignorando
// sufixos de horário que a IA às vezes acrescenta.
const codigoTerminal = (m: MaquininhaFechamento): string | null => {
  const id = m.identificador || "";
  const mt = id.match(/[A-Z]{1,3}\s?\d{4,}/i) || id.match(/\b\d{5,}\b/);
  return mt ? mt[0].toUpperCase().replace(/\s+/g, "") : null;
};
// Chave de valores (mesmos crédito/débito/pix/total = provável duplicata).
const valKeyMaq = (m: MaquininhaFechamento): string => `${m.credito || 0}|${m.debito || 0}|${m.pix || 0}|${m.total ?? ""}`;
// Índices que repetem uma maquininha anterior: mesmo terminal OU mesmos valores.
function indicesDuplicados(maquininhas: MaquininhaFechamento[]): Set<number> {
  const dup = new Set<number>(); const terms = new Set<string>(); const vals = new Set<string>();
  maquininhas.forEach((m, i) => {
    const t = codigoTerminal(m); const v = valKeyMaq(m);
    if ((t && terms.has(t)) || vals.has(v)) dup.add(i);
    if (t) terms.add(t);
    vals.add(v);
  });
  return dup;
}

// Tabela das maquininhas: colunas crédito/débito/pix/total, soma e conferência com o Altec.
// Com onRemove, fica editável (remove linha) e sinaliza duplicadas.
function MaquininhasView({ maquininhas, creditoAltec, debitoAltec, pixAltec, onRemove, onEdit }: { maquininhas: MaquininhaFechamento[]; creditoAltec?: number; debitoAltec?: number; pixAltec?: number; onRemove?: (index: number) => void; onEdit?: (index: number, patch: Partial<MaquininhaFechamento>) => void }) {
  const dup = indicesDuplicados(maquininhas);
  // Input numérico editável (R$, formatado XX.XXX,XX) pra corrigir leitura da IA.
  const numIn = (v: number | undefined, on: (n: number | undefined) => void) => (
    <MoneyInput value={v} onChange={on} placeholder="—"
      className="w-[88px] text-right tabular-nums text-[11px] px-1 py-0.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
  );
  const somaC = maquininhas.reduce((s, m) => s + (m.credito || 0), 0);
  const somaD = maquininhas.reduce((s, m) => s + (m.debito || 0), 0);
  const somaP = maquininhas.reduce((s, m) => s + (m.pix || 0), 0);
  const somaT = maquininhas.reduce((s, m) => s + totalMaq(m), 0);
  const diffC = creditoAltec != null ? somaC - creditoAltec : null;
  const diffD = debitoAltec != null ? somaD - debitoAltec : null;
  const diffP = pixAltec != null ? somaP - pixAltec : null;
  const bate = (d: number | null) => d == null || Math.abs(d) <= 0.01;
  const temPix = somaP > 0 || pixAltec != null || maquininhas.some((m) => m.pix != null);
  const cell = (v?: number) => <td className="px-2 py-1 text-right tabular-nums">{v != null ? fmtBRL(v) : "—"}</td>;
  // Soma interna de cada filipeta: crédito+débito+pix deve bater com o total lido.
  const mismatch = (m: MaquininhaFechamento) => {
    const temParte = m.credito != null || m.debito != null || m.pix != null;
    return m.total != null && temParte && Math.abs(m.total - ((m.credito || 0) + (m.debito || 0) + (m.pix || 0))) > 0.01;
  };
  const algumMismatch = maquininhas.some(mismatch);
  return (
    <div>
      <div className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40">
              <th className="px-2 py-1 font-medium">Maquininha</th>
              <th className="px-2 py-1 font-medium text-right">Crédito</th>
              <th className="px-2 py-1 font-medium text-right">Débito</th>
              {temPix && <th className="px-2 py-1 font-medium text-right">PIX</th>}
              <th className="px-2 py-1 font-medium text-right">Total</th>
              {onRemove && <th className="px-1 py-1" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {maquininhas.map((m, i) => (
              <tr key={i} className={dup.has(i) ? "bg-amber-50 dark:bg-amber-950/20" : ""}>
                <td className="px-2 py-1 max-w-[180px]">
                  {onEdit
                    ? <input value={m.identificador || ""} onChange={(e) => onEdit(i, { identificador: e.target.value || undefined })} placeholder={`Maquininha ${i + 1}`} className="w-full text-[11px] px-1 py-0.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
                    : <span className="truncate">💳 {m.identificador || `Maquininha ${i + 1}`}</span>}
                  {dup.has(i) && <span className="ml-1 text-amber-600 dark:text-amber-400 text-[10px]">⚠ dup?</span>}
                </td>
                {onEdit ? <td className="px-1 py-1 text-right">{numIn(m.credito, (n) => onEdit(i, { credito: n }))}</td> : <td className="px-2 py-1 text-right tabular-nums text-gray-500">{m.credito != null ? fmtBRL(m.credito) : "—"}</td>}
                {onEdit ? <td className="px-1 py-1 text-right">{numIn(m.debito, (n) => onEdit(i, { debito: n }))}</td> : <td className="px-2 py-1 text-right tabular-nums text-gray-500">{m.debito != null ? fmtBRL(m.debito) : "—"}</td>}
                {temPix && (onEdit ? <td className="px-1 py-1 text-right">{numIn(m.pix, (n) => onEdit(i, { pix: n }))}</td> : <td className="px-2 py-1 text-right tabular-nums text-gray-500">{m.pix != null ? fmtBRL(m.pix) : "—"}</td>)}
                {onEdit
                  ? <td className={`px-1 py-1 text-right ${mismatch(m) ? "bg-amber-50 dark:bg-amber-950/20" : ""}`} title={mismatch(m) ? "Crédito+Débito+PIX não bate com o total da filipeta" : ""}>{numIn(m.total, (n) => onEdit(i, { total: n }))}{mismatch(m) && <span className="text-amber-600 dark:text-amber-400"> ⚠</span>}</td>
                  : <td className={`px-2 py-1 text-right tabular-nums font-medium ${mismatch(m) ? "text-amber-600 dark:text-amber-400" : ""}`} title={mismatch(m) ? "Crédito+Débito+PIX não bate com o total da filipeta" : ""}>{fmtBRL(totalMaq(m))}{mismatch(m) && " ⚠"}</td>}
                {onRemove && <td className="px-1 py-1 text-center"><button type="button" className="text-gray-400 hover:text-rose-600" title="Remover" onClick={() => onRemove(i)}>✕</button></td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-200 dark:border-gray-800 font-semibold bg-gray-50 dark:bg-gray-800/40">
              <td className="px-2 py-1">Soma maquininhas</td>
              {cell(somaC)}{cell(somaD)}{temPix && cell(somaP)}{cell(somaT)}{onRemove && <td />}
            </tr>
            {(creditoAltec != null || debitoAltec != null || pixAltec != null) && (
              <tr className="text-gray-500">
                <td className="px-2 py-1">Comprovante (Altec)</td>
                {cell(creditoAltec)}{cell(debitoAltec)}{temPix && cell(pixAltec)}{cell((creditoAltec || 0) + (debitoAltec || 0) + (pixAltec || 0))}{onRemove && <td />}
              </tr>
            )}
            {(diffC != null || diffD != null || diffP != null) && !(bate(diffC) && bate(diffD) && bate(diffP)) && (
              <tr className="text-amber-600 dark:text-amber-400 font-medium">
                <td className="px-2 py-1">⚠ Diferença</td>
                {cell(diffC ?? undefined)}{cell(diffD ?? undefined)}{temPix && cell(diffP ?? undefined)}{cell((diffC || 0) + (diffD || 0) + (diffP || 0))}{onRemove && <td />}
              </tr>
            )}
          </tfoot>
        </table>
      </div>
      {dup.size > 0 && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">⚠ {dup.size} maquininha(s) possivelmente duplicada(s){onRemove ? " — remova as repetidas (✕) antes de salvar." : "."}</p>}
      {algumMismatch && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">⚠ Em alguma filipeta, crédito+débito+PIX não bate com o total impresso — confira a leitura.</p>}
      {(diffC != null || diffD != null || diffP != null) && bate(diffC) && bate(diffD) && bate(diffP) && dup.size === 0 && !algumMismatch && <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">✓ Soma das maquininhas bate com o comprovante.</p>}
    </div>
  );
}

export function FechamentoCaixaPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurant = restaurants.find((r) => r.id === rid) || null;
  const { can, canModulo, loading: permLoading } = useCanAcao(rid);
  const podeFechar = can("fechamentoCaixa", "fechar");
  const podeVer = can("fechamentoCaixa", "ver");
  const podePainel = can("fechamentoCaixa", "painel");
  const podeEditar = can("fechamentoCaixa", "editar");
  const podeConfig = can("fechamentoCaixa", "configurar");
  const temAcesso = canModulo("fechamentoCaixa");

  const [tab, setTab] = useState<"novo" | "lista" | "painel" | "comandas" | "conciliacao" | "config">("novo");
  const [fechamentos, setFechamentos] = useState<FechamentoCaixa[]>([]);
  const [novo, setNovo] = useState(false);
  const [erro, setErro] = useState("");
  const [exportando, setExportando] = useState<"" | "pdf" | "xlsx">("");
  const purgandoRef = useRef<Set<string>>(new Set());
  const [detalheHist, setDetalheHist] = useState<FechamentoCaixa | null>(null);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "fechamentosCaixa"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => setFechamentos(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FechamentoCaixa)));
    return () => unsub();
  }, [rid]);

  const ordenadosTodos = useMemo(
    () => [...fechamentos].sort((a, b) => (b.fechadoEm || "").localeCompare(a.fechadoEm || "")),
    [fechamentos],
  );
  const ativos = useMemo(() => ordenadosTodos.filter((f) => !f.excluidoEm), [ordenadosTodos]);          // não-excluídos (export + comandas)
  const pendentes = useMemo(() => ativos.filter((f) => !f.conferidoEm), [ativos]);                       // a conferir (lista principal)
  const conferidos = useMemo(() => ativos.filter((f) => f.conferidoEm).sort((a, b) => (b.conferidoEm || "").localeCompare(a.conferidoEm || "")), [ativos]);
  const excluidos = useMemo(() => ordenadosTodos.filter((f) => f.excluidoEm).sort((a, b) => (b.excluidoEm || "").localeCompare(a.excluidoEm || "")), [ordenadosTodos]);

  async function exportar(tipo: "pdf" | "xlsx") {
    if (!ativos.length) return;
    setErro(""); setExportando(tipo);
    try {
      if (tipo === "pdf") await exportarFechamentosPDF(ativos, restaurant?.nome || "");
      else await exportarFechamentosXLSX(ativos, restaurant?.nome || "");
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao exportar."); }
    finally { setExportando(""); }
  }

  // Conferido pelo escritório → vai pro histórico de Conferidos (nunca apaga). Reversível.
  async function conferir(f: FechamentoCaixa) {
    try {
      await updateDoc(doc(db, "fechamentosCaixa", f.id), { conferidoEm: new Date().toISOString(), conferidoPor: { id: me?.id || "", nome: me?.nome || "?" } });
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao conferir."); }
  }
  // Desfaz a conferência → volta pra lista de pendentes.
  async function desconferir(f: FechamentoCaixa) {
    try {
      await updateDoc(doc(db, "fechamentosCaixa", f.id), { conferidoEm: deleteField(), conferidoPor: deleteField() });
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao desfazer conferência."); }
  }

  // Soft delete: vai pra "Excluídos" (restaurável). Os arquivos no Drive ficam onde estão.
  async function excluir(f: FechamentoCaixa) {
    if (!window.confirm(`Mover o fechamento de ${fmtData(f.data)} (${TURNO_CAIXA_LABEL[f.turno]}) para Excluídos?`)) return;
    try {
      await updateDoc(doc(db, "fechamentosCaixa", f.id), { excluidoEm: new Date().toISOString(), excluidoPor: { id: me?.id || "", nome: me?.nome || "?" } });
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao excluir."); }
  }

  // Restaura um fechamento excluído.
  async function restaurar(f: FechamentoCaixa) {
    try {
      await updateDoc(doc(db, "fechamentosCaixa", f.id), { excluidoEm: deleteField(), excluidoPor: deleteField() });
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao restaurar."); }
  }

  // Exclusão definitiva (só config): move a pasta pra "excluídos" no Drive + apaga o doc.
  async function excluirDefinitivo(f: FechamentoCaixa) {
    if (!window.confirm(`Excluir DEFINITIVAMENTE o fechamento de ${fmtData(f.data)} (${TURNO_CAIXA_LABEL[f.turno]})?\n\nO registro é apagado e a pasta vai pra "excluídos" no Drive. Não dá pra desfazer.`)) return;
    try {
      const folderId = f.driveFolderUrl ? parseDriveFolderId(f.driveFolderUrl) : null;
      if (folderId && restaurant?.fechamentoDriveFolderId && (await centralConfigured())) {
        const excluidosId = await centralEnsureFolder(restaurant.fechamentoDriveFolderId, "excluídos");
        await centralMoveFolder(folderId, excluidosId, `${diaLabel(f.data)} ${TURNO_CAIXA_LABEL[f.turno]}`);
      }
      await deleteDoc(doc(db, "fechamentosCaixa", f.id));
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao excluir definitivamente."); }
  }

  // Purga automática: excluídos há mais de 60 dias somem de vez (o registro é apagado; arquivos no Drive permanecem).
  useEffect(() => {
    const limite = Date.now() - 60 * 24 * 60 * 60 * 1000;
    for (const f of excluidos) {
      if (!f.excluidoEm || new Date(f.excluidoEm).getTime() > limite) continue;
      if (purgandoRef.current.has(f.id)) continue;
      purgandoRef.current.add(f.id);
      deleteDoc(doc(db, "fechamentosCaixa", f.id)).catch(() => purgandoRef.current.delete(f.id));
    }
  }, [excluidos]);

  if (!restaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (permLoading) return <div className="text-gray-400 py-12 text-center text-sm">Carregando…</div>;
  if (!temAcesso) {
    return <div className="max-w-2xl mx-auto py-12 text-center"><div className="text-4xl mb-3">🔒</div><p className="text-gray-600 dark:text-gray-400">Você não tem acesso ao Fechamento de Caixa.</p></div>;
  }

  const abas: Array<"novo" | "lista" | "painel" | "comandas" | "conciliacao" | "config"> = [];
  if (podeFechar) abas.push("novo");
  if (podeVer) abas.push("lista");
  if (podePainel) abas.push("painel");
  if (podeVer) abas.push("comandas");
  if (podeVer) abas.push("conciliacao");
  if (podeConfig) abas.push("config");
  const abaEfetiva = abas.includes(tab) ? tab : (abas[0] || "novo");

  const TabBtn = ({ k, label }: { k: "novo" | "lista" | "painel" | "comandas" | "conciliacao" | "config"; label: string }) => (
    <button type="button" onClick={() => setTab(k)}
      className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${abaEfetiva === k ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-gray-500"}`}>{label}</button>
  );

  return (
    <div className="max-w-7xl space-y-4">
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800 overflow-x-auto overflow-y-hidden whitespace-nowrap">
        {podeFechar && <TabBtn k="novo" label="💵 Novo fechamento" />}
        {podeVer && <TabBtn k="lista" label="📋 Fechamentos enviados" />}
        {podePainel && <TabBtn k="painel" label="📊 Painel" />}
        {podeVer && <TabBtn k="comandas" label="📋 Cortesias / Comandas" />}
        {podeVer && <TabBtn k="conciliacao" label="💳 Conciliação de Cartões" />}
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

      {abaEfetiva === "painel" && podePainel && <PainelTab fechamentos={ativos} restaurantNome={restaurant?.nome || ""} />}

      {abaEfetiva === "comandas" && podeVer && <ControleComandas fechamentos={ativos} restaurantNome={restaurant?.nome || ""} />}

      {abaEfetiva === "conciliacao" && podeVer && <ConciliacaoCartoes rid={rid} temIfood={!!restaurant?.fechamentoTemIfood} me={me} podeConfig={podeConfig} />}

      {abaEfetiva === "config" && podeConfig && <FechamentoConfig rid={rid} restaurant={restaurant} />}

      {abaEfetiva === "lista" && podeVer && (
        <div className="space-y-3">
          {ativos.length > 0 && (
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" disabled={!!exportando} onClick={() => void exportar("xlsx")}>{exportando === "xlsx" ? "Gerando…" : "⬇ XLSX"}</Button>
              <Button size="sm" variant="secondary" disabled={!!exportando} onClick={() => void exportar("pdf")}>{exportando === "pdf" ? "Gerando…" : "⬇ PDF"}</Button>
            </div>
          )}
          <FechamentoTabela fechamentos={pendentes} podeEditar={podeEditar} podeConfig={podeConfig} onExcluir={excluir} onConferir={podeEditar ? conferir : undefined} />

          {/* Histórico de conferidos (abaixo da lista, colapsável) */}
          {conferidos.length > 0 && (
            <details className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 mt-4">
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">✅ Conferidos <span className="text-gray-400 font-normal">({conferidos.length})</span> <span className="text-[11px] font-normal text-gray-400">— histórico permanente</span></summary>
              <div className="px-3 pb-3 space-y-2">
                {conferidos.map((f) => (
                  <div key={f.id} className="bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 rounded-xl p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-800 dark:text-gray-100 tabular-nums">{fmtData(f.data)}</span>
                        <span className="inline-flex items-center rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-[11px] font-medium px-2 py-0.5">{TURNO_CAIXA_LABEL[f.turno]}</span>
                        <span className="tabular-nums font-semibold text-gray-700 dark:text-gray-200">{fmtBRL(f.totalVendas)}</span>
                      </div>
                      <div className="text-[11px] text-gray-400 mt-0.5">✓ conferido {f.conferidoEm ? fmtDataHora(f.conferidoEm) : ""}{f.conferidoPor?.nome ? ` · ${f.conferidoPor.nome}` : ""}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button type="button" onClick={() => setDetalheHist(f)} className="text-[12px] text-indigo-600 hover:underline px-1">detalhes</button>
                      {podeEditar && <Button size="sm" variant="secondary" onClick={() => void desconferir(f)}>↩ Desfazer</Button>}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Histórico de excluídos (abaixo, colapsável, só config) */}
          {podeConfig && excluidos.length > 0 && (
            <details className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">🗑 Excluídos <span className="text-gray-400 font-normal">({excluidos.length})</span> <span className="text-[11px] font-normal text-gray-400">— somem em 60 dias</span></summary>
              <div className="px-3 pb-3 space-y-2">
                <p className="text-[11px] text-gray-400 px-1">Podem ser <strong>restaurados</strong>. Somem sozinhos depois de <strong>60 dias</strong> (registro apagado; arquivos no Drive permanecem). "Excluir definitivo" apaga na hora e move a pasta do Drive pra "excluídos".</p>
                {excluidos.map((f) => (
                  <div key={f.id} className="bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 rounded-xl p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-800 dark:text-gray-100 tabular-nums">{fmtData(f.data)}</span>
                        <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-[11px] font-medium px-2 py-0.5">{TURNO_CAIXA_LABEL[f.turno]}</span>
                        <span className="tabular-nums font-semibold text-gray-700 dark:text-gray-200">{fmtBRL(f.totalVendas)}</span>
                      </div>
                      <div className="text-[11px] text-gray-400 mt-0.5">excluído {f.excluidoEm ? fmtDataHora(f.excluidoEm) : ""}{f.excluidoPor?.nome ? ` · ${f.excluidoPor.nome}` : ""}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button size="sm" variant="secondary" onClick={() => void restaurar(f)}>↩ Restaurar</Button>
                      <button type="button" onClick={() => void excluirDefinitivo(f)} title="Excluir definitivamente"
                        className="text-[12px] text-rose-600 hover:text-rose-700 hover:underline px-1">Excluir definitivo</button>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {detalheHist && <DetalheFechamentoModal f={detalheHist} podeEditar={podeEditar} onClose={() => setDetalheHist(null)} onEditar={() => setDetalheHist(null)} />}

      {novo && (
        <NovoFechamentoModal
          rid={rid}
          restaurant={restaurant}
          por={{ id: me?.id || "", nome: me?.nome || "?" }}
          recentes={ativos}
          onClose={() => setNovo(false)}
          onSalvo={() => setNovo(false)}
        />
      )}
    </div>
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
function NovoFechamentoModal({ rid, restaurant, por, recentes, onClose, onSalvo }: {
  rid: string;
  restaurant: { nome?: string; fechamentoDriveFolderId?: string; fechamentoSociosEmails?: string[]; fechamentoSociosWhatsapp?: string[]; fechamentoEmailRemetente?: string; fechamentoComandas?: ComandaCadastro[]; fechamentoPedirObsTurno?: boolean };
  por: { id: string; nome: string };
  recentes: FechamentoCaixa[];
  onClose: () => void;
  onSalvo: () => void;
}) {
  const sug = sugerirTurnoData(new Date());
  const [turno, setTurno] = useState<TurnoCaixa>(sug.turno);
  const [data, setData] = useState(sug.data);
  const [anexos, setAnexos] = useState<AnexoLocal[]>([]);
  const [comandaManual, setComandaManual] = useState<File | null>(null); // anexo de comanda em correção manual
  const compRef = useRef<HTMLInputElement>(null);
  const filiRef = useRef<HTMLInputElement>(null);
  const cmdRef = useRef<HTMLInputElement>(null);
  const [comandasConsumo, setComandasConsumo] = useState<ComandaConsumo[]>([]); // consumos lidos/editados
  const comandasCad = restaurant.fechamentoComandas || [];
  const nomeComanda = (numero: string) => comandasCad.find((c) => numComanda(c.numero) === numComanda(numero))?.nome;
  const [totalVendas, setTotalVendas] = useState("");
  const [numeroLacre, setNumeroLacre] = useState("");
  const [naoLacrado, setNaoLacrado] = useState(false);
  const [observacao, setObservacao] = useState("");
  const [semOcorrencia, setSemOcorrencia] = useState(false);

  // Percepção do turno: direção do movimento vs. mediana do mesmo dia-da-semana/turno.
  const pedirObs = !!restaurant.fechamentoPedirObsTurno;
  const diaSemana = DIAS_SEMANA[new Date(`${data}T12:00:00`).getDay()] || "";
  const movDir = useMemo<"abaixo" | "normal" | "acima">(() => {
    const wd = new Date(`${data}T12:00:00`).getDay();
    const vals = recentes
      .filter((f) => f.turno === turno && typeof f.totalVendas === "number" && (f.totalVendas as number) > 0 && new Date(`${f.data}T12:00:00`).getDay() === wd)
      .map((f) => f.totalVendas as number);
    const tot = parseBRL(totalVendas);
    if (vals.length < 3 || tot == null) return "normal";       // sem histórico/total → trata como normal
    const med = medianN(vals);
    return tot < med * 0.85 ? "abaixo" : tot > med * 1.15 ? "acima" : "normal";
  }, [recentes, turno, data, totalVendas]);
  const movForaDaMedia = movDir !== "normal";
  // Wizard: comprovante → filipetas → comandas → conferência.
  const [etapa, setEtapa] = useState<"comprovante" | "filipetas" | "comandas" | "conferencia">("comprovante");
  const [lendo, setLendo] = useState(false);
  const [lendoComandas, setLendoComandas] = useState(0); // comandas em leitura (OCR)
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState("");
  const leituraSeq = useRef(0);
  const [confirmarDT, setConfirmarDT] = useState<string | null>(null);  // mensagem da inconsistência dia/turno
  const dtConfirmadoRef = useRef(false);

  // Confere o dia/turno marcados contra o horário REAL de fechamento (agora).
  // Devolve a mensagem da inconsistência, ou null se está coerente.
  function checarTurnoData(agora: Date): string | null {
    const hoje = ymd(agora);
    const h = agora.getHours(), mm = String(agora.getMinutes()).padStart(2, "0");
    if (data > hoje) return `A data marcada (${fmtData(data)}) está no futuro.`;
    if (data === hoje && turno === "jantar" && h < 18) return `Agora são ${String(h).padStart(2, "0")}:${mm} e está marcado como JANTAR de hoje — o jantar só fecha à noite. Confira o turno.`;
    if (data === hoje && turno === "almoco" && h >= 23) return `Está quase meia-noite (${String(h).padStart(2, "0")}:${mm}) e marcado como ALMOÇO de hoje — não seria o jantar?`;
    const diffDias = Math.round((new Date(`${hoje}T12:00:00`).getTime() - new Date(`${data}T12:00:00`).getTime()) / 864e5);
    if (diffDias > 1) return `O fechamento está marcado para ${fmtData(data)} — ${diffDias} dias atrás. Confira a data.`;
    return null;
  }

  // OCR do comprovante Altec → lê SÓ o faturamento total (+ data/turno).
  async function lerTotal(f: File) {
    const seq = ++leituraSeq.current;
    setLendo(true);
    try {
      const bloco = await paraOcrBlock(f);
      const resp = await fetch("/api/ocr-nota", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ files: [bloco], tipo: "comprovante_total" }) });
      const j = await resp.json().catch(() => ({}));
      if (seq !== leituraSeq.current) return;
      if (resp.ok) {
        if (typeof j.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.data)) setData(j.data);
        if (j.turno === "almoco" || j.turno === "jantar") setTurno(j.turno);
        if (j.totalVendas != null) setTotalVendas(fmtMilhar(String(j.totalVendas)));
      }
    } catch { /* best-effort — usuário digita */ }
    finally { if (seq === leituraSeq.current) setLendo(false); }
  }

  function aoAnexar(grupo: GrupoAnexoFechamento, f: File) {
    setAnexos((prev) => [...prev, { file: f, grupo }]);
    if (grupo === "comprovante") void lerTotal(f);
    if (grupo === "comanda") void lerComanda(f);
  }
  function removerAnexo(file: File) { setAnexos((prev) => prev.filter((a) => a.file !== file)); }
  const anexosDe = (g: GrupoAnexoFechamento) => anexos.filter((a) => a.grupo === g);

  // OCR da comanda → lê TODOS os números da foto e associa às cadastradas.
  // Não cadastradas são sinalizadas (não bloqueiam — você cadastra/corrige depois).
  async function lerComanda(f: File) {
    setLendoComandas((c) => c + 1);
    try {
      const bloco = await paraOcrBlock(f);
      const resp = await fetch("/api/ocr-nota", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ files: [bloco], tipo: "comanda" }) });
      const j = await resp.json().catch(() => ({}));
      const lidas: ComandaConsumo[] = Array.isArray(j.comandas)
        ? (j.comandas as ComandaConsumo[]).filter((c) => c && digitos(c.numero || "")).map((c) => ({ numero: numComanda(c.numero), ...(c.valor != null ? { valor: c.valor } : {}) }))
        : [];
      if (!resp.ok || !lidas.length) return;
      // Rótulo do anexo (matched/não cadastradas)
      const matched: string[] = [];
      const naoCad: string[] = [];
      for (const c of lidas) {
        const m = comandasCad.find((x) => numComanda(x.numero) === c.numero);
        if (m) matched.push(rotuloComanda(m)); else naoCad.push(c.numero);
      }
      const partes = [...new Set(matched)];
      if (naoCad.length) partes.push(`⚠ não cadastrada${naoCad.length > 1 ? "s" : ""}: ${[...new Set(naoCad)].join(", ")}`);
      const rotulo = partes.join(" · ") || `Comanda(s) ${lidas.map((c) => c.numero).join(", ")}`;
      setAnexos((prev) => prev.map((a) => a.file === f ? { ...a, rotulo } : a));
      // Acumula consumos (dedupe por número — o último valor lido prevalece).
      setComandasConsumo((prev) => {
        const map = new Map(prev.map((c) => [c.numero, c]));
        for (const c of lidas) map.set(c.numero, { numero: c.numero, nome: nomeComanda(c.numero), ...(c.valor != null ? { valor: c.valor } : {}) });
        return [...map.values()];
      });
    } catch { /* best-effort — usuário identifica manualmente */ }
    finally { setLendoComandas((c) => Math.max(0, c - 1)); }
  }

  async function salvar() {
    setErro("");
    if (!data) { setErro("Informe a data."); return; }
    if (parseBRL(totalVendas) == null) { setErro("Informe o faturamento total."); return; }
    if (anexos.length && !restaurant.fechamentoDriveFolderId) { setErro("Configure a pasta do Drive em Configurações antes de fechar."); return; }
    if (!naoLacrado && !numeroLacre.trim()) { setErro("Informe o número do lacre ou marque \"Não foi lacrado\"."); return; }
    if (pedirObs) {
      if (movForaDaMedia && !observacao.trim()) { setErro(`O ${TURNO_CAIXA_LABEL[turno].toLowerCase()} veio fora da média — conte rapidamente o que aconteceu nesse turno.`); return; }
      if (!movForaDaMedia && !semOcorrencia && !observacao.trim()) { setErro('Marque "Foi tudo normal" ou escreva uma observação sobre o turno.'); return; }
    }
    // Confirma dia/turno se estiverem inconsistentes com o horário de fechamento.
    if (!dtConfirmadoRef.current) {
      const problema = checarTurnoData(new Date());
      if (problema) { setConfirmarDT(problema); return; }
    }
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
          // Comanda usa o rótulo no nome (limpo de símbolos); demais "grupoN".
          const base = a.grupo === "comanda" && a.rotulo
            ? `comanda ${a.rotulo.replace(/[⚠·]/g, "").replace(/[\\/:]/g, "-").replace(/\s+/g, " ").trim()}`
            : `${a.grupo}${n}`;
          const alvo = await carimbarImagem(new File([a.file], `${base}${ext}`, { type: a.file.type }), carimbo, false);
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
        ...(comandasConsumo.length ? { comandas: comandasConsumo.map((c) => ({ numero: c.numero, ...(c.nome ? { nome: c.nome } : {}), ...(c.valor != null ? { valor: c.valor } : {}) })) } : {}),
        numeroLacre: naoLacrado ? "Não lacrado" : numeroLacre.trim(),
        ...(observacao.trim() ? { observacao: observacao.trim() } : {}),
        ...(pedirObs ? { movimentoTurno: movDir } : {}),
        ...(pedirObs && semOcorrencia ? { semOcorrencia: true } : {}),
        ...(anexosSalvos.length ? { anexos: anexosSalvos } : {}),
        ...(driveFolderUrl ? { driveFolderUrl } : {}),
        ...(emails.length ? { emailEnviadoPara: emails } : {}),
      };
      await addDoc(collection(db, "fechamentosCaixa"), fechamento);
      // Email de resumo pros sócios (best-effort — não trava o save).
      if (emails.length) void enviarEmailResumo(emails, restaurant.nome || "Restaurante", fechamento, recentes, restaurant.fechamentoEmailRemetente);
      // WhatsApp pros sócios (mesma ideia do email — aditivo, best-effort). Só dispara
      // quando o template aviso_fechamento estiver aprovado; senão fica logado como erro.
      const zaps = (restaurant.fechamentoSociosWhatsapp || []).filter((n) => n.replace(/\D/g, "").length >= 10);
      if (zaps.length) {
        const totalStr = parseBRL(totalVendas) != null ? fmtBRL(parseBRL(totalVendas)!) : "—";
        const quando = `${fmtData(data)} · ${TURNO_CAIXA_LABEL[turno]}`;
        const link = `https://admin.planejamento.app/r/${rid}/fechamentoCaixa`;
        for (const num of zaps) void enviarWhatsapp({ to: num, template: "aviso_fechamento", params: ["sócio(a)", restaurant.nome || "Restaurante", quando, totalStr, link], contexto: "fechamento_socios", restaurantId: rid, criadoPor: por?.id });
      }
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

  const STEPS = [
    { id: "comprovante" as const, n: 1, label: "Comprovante" },
    { id: "filipetas" as const, n: 2, label: "Filipetas" },
    { id: "comandas" as const, n: 3, label: "Comandas" },
    { id: "conferencia" as const, n: 4, label: "Conferência" },
  ];
  const stepAtual = STEPS.find((s) => s.id === etapa)!.n;
  const totalComandas = comandasConsumo.reduce((s, c) => s + (c.valor || 0), 0);
  const temComprovante = anexosDe("comprovante").length > 0;
  const podeAvancarComprovante = temComprovante && parseBRL(totalVendas) != null && !lendo;
  return (
    <Modal title="💵 Fechamento de caixa" onClose={onClose} maxWidth="max-w-lg">
      <input ref={compRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) aoAnexar("comprovante", f); }} />
      <input ref={filiRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) aoAnexar("filipeta", f); }} />
      <input ref={cmdRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) aoAnexar("comanda", f); }} />
      <div className="space-y-4">
        {erro && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}

        {/* Stepper */}
        <div className="flex items-center gap-1 text-[11px]">
          {STEPS.map((s) => (
            <div key={s.id} className={`flex-1 text-center px-1 py-1 rounded-md ${s.n === stepAtual ? "bg-indigo-600 text-white font-semibold" : s.n < stepAtual ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-gray-100 text-gray-400 dark:bg-gray-800"}`}>
              {s.n < stepAtual ? "✓ " : `${s.n}. `}{s.label}
            </div>
          ))}
        </div>

        {/* 1 — COMPROVANTE */}
        {etapa === "comprovante" && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300"><strong>Passo 1.</strong> Tire a foto do <strong>comprovante de fechamento do Altec</strong>. A IA lê o faturamento total — você confirma.</p>
            {!temComprovante ? (
              <button type="button" onClick={() => compRef.current?.click()} className="w-full py-10 rounded-2xl border-2 border-dashed border-indigo-300 dark:border-indigo-700 bg-indigo-50/50 dark:bg-indigo-950/20 hover:bg-indigo-100/60 dark:hover:bg-indigo-950/40 flex flex-col items-center gap-2 transition">
                <span className="text-4xl">📷</span><span className="font-semibold text-indigo-700 dark:text-indigo-300">Tirar foto do comprovante</span>
              </button>
            ) : (
              <div className="space-y-3">
                {lendo ? (
                  <div className="text-center text-sm text-indigo-600 dark:text-indigo-300 py-4">🔍 Lendo o faturamento total…</div>
                ) : (
                  <div>
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Faturamento total — confira o valor</label>
                    <input value={totalVendas} onChange={(e) => setTotalVendas(e.target.value)} onBlur={() => setTotalVendas(fmtMilhar)} inputMode="decimal" placeholder="R$ 0,00" className={`${inputCls} text-lg font-bold`} />
                    <p className="text-[11px] text-gray-400 mt-1">Confira com o valor impresso no comprovante antes de continuar.</p>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <button type="button" onClick={() => { removerAnexo(anexosDe("comprovante")[0].file); setTotalVendas(""); }} className="text-[12px] text-gray-500 hover:underline">↺ Refazer foto</button>
                  <Button disabled={!podeAvancarComprovante} onClick={() => setEtapa("filipetas")}>Confirmar e continuar →</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 2 — FILIPETAS */}
        {etapa === "filipetas" && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300"><strong>Passo 2.</strong> Tire foto das <strong>filipetas das maquininhas</strong> (uma ou mais). Só são anexadas — sem digitar valor.</p>
            <button type="button" onClick={() => filiRef.current?.click()} className="w-full py-6 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 flex flex-col items-center gap-1 transition">
              <span className="text-3xl">📷</span><span className="font-medium text-gray-700 dark:text-gray-200">{anexosDe("filipeta").length ? "Adicionar outra filipeta" : "Tirar foto das filipetas"}</span>
            </button>
            {anexosDe("filipeta").length > 0 && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                {anexosDe("filipeta").map((a, i) => (
                  <div key={i} className="px-2 py-1.5 text-[12px] flex items-center gap-2"><span className="flex-1 truncate">💳 Filipeta {i + 1}</span><button type="button" className="text-gray-400 hover:text-rose-600" onClick={() => removerAnexo(a.file)}>✕</button></div>
                ))}
              </div>
            )}
            <div className="flex justify-between"><Button variant="secondary" size="sm" onClick={() => setEtapa("comprovante")}>← Voltar</Button><Button onClick={() => setEtapa("comandas")}>Continuar →</Button></div>
          </div>
        )}

        {/* 3 — COMANDAS */}
        {etapa === "comandas" && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300"><strong>Passo 3.</strong> Tire foto das <strong>comandas de cortesia</strong> (uma ou mais fotos). A IA lê o nº da mesa e o valor — confira cada uma.</p>
            <button type="button" onClick={() => cmdRef.current?.click()} className="w-full py-6 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 flex flex-col items-center gap-1 transition">
              <span className="text-3xl">📷</span><span className="font-medium text-gray-700 dark:text-gray-200">{anexosDe("comanda").length ? "Adicionar outra foto" : "Tirar foto das comandas"}</span>
            </button>
            {lendoComandas > 0 && <div className="text-center text-[12px] text-indigo-600 dark:text-indigo-300">🔍 Lendo comandas…</div>}
            {comandasConsumo.length > 0 && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                {comandasConsumo.map((c, i) => (
                  <div key={i} className="px-2 py-1.5 flex items-center gap-2 text-[12px]">
                    <span className="flex-1 truncate">📋 {c.nome ? `${c.nome} (${c.numero})` : `Mesa ${c.numero}`}</span>
                    <MoneyInput value={c.valor} onChange={(n) => setComandasConsumo((prev) => prev.map((x, j) => j === i ? { ...x, valor: n } : x))} placeholder="R$"
                      className="w-24 px-2 py-1 text-sm text-right rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
                    <button type="button" className="text-gray-400 hover:text-rose-600" onClick={() => setComandasConsumo((prev) => prev.filter((_, j) => j !== i))}>✕</button>
                  </div>
                ))}
                <div className="px-2 py-1.5 flex items-center justify-between text-[12px] font-semibold bg-gray-50 dark:bg-gray-800/40"><span>Total cortesias</span><span className="tabular-nums">{fmtBRL(totalComandas)}</span></div>
              </div>
            )}
            {anexosDe("comanda").length > 0 && (
              <div className="text-[11px] space-y-0.5">
                {anexosDe("comanda").map((a, i) => (
                  <div key={i} className="flex items-center gap-2 px-1"><span className="flex-1 truncate text-gray-500">📎 {a.rotulo || "❓ não identificada"}</span><button type="button" className="text-indigo-600 hover:underline" onClick={() => setComandaManual(a.file)}>{a.rotulo ? "trocar" : "identificar"}</button><button type="button" className="text-gray-400 hover:text-rose-600" onClick={() => removerAnexo(a.file)}>✕</button></div>
                ))}
              </div>
            )}
            <div className="flex justify-between"><Button variant="secondary" size="sm" onClick={() => setEtapa("filipetas")}>← Voltar</Button><Button onClick={() => setEtapa("conferencia")}>{(comandasConsumo.length || anexosDe("comanda").length) ? "Continuar →" : "Sem cortesias — pular →"}</Button></div>
          </div>
        )}

        {/* 4 — CONFERÊNCIA */}
        {etapa === "conferencia" && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300"><strong>Passo 4.</strong> Confira tudo e feche o caixa.</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Turno</label>
                <div className="flex gap-2">{(["almoco", "jantar"] as TurnoCaixa[]).map((t) => (
                  <button key={t} type="button" onClick={() => setTurno(t)} className={`flex-1 text-sm font-medium px-3 py-2 rounded-lg border ${turno === t ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300" : "border-gray-300 dark:border-gray-700 text-gray-600"}`}>{TURNO_CAIXA_LABEL[t]}</button>
                ))}</div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Data</label>
                <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={`${inputCls} [color-scheme:light] dark:[color-scheme:dark]`} />
              </div>
            </div>
            <div className="rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/20 p-3 flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase font-bold text-indigo-700 dark:text-indigo-300">Faturamento total</span>
              <input value={totalVendas} onChange={(e) => setTotalVendas(e.target.value)} onBlur={() => setTotalVendas(fmtMilhar)} inputMode="decimal" className="w-36 text-right text-lg font-bold bg-transparent outline-none text-indigo-900 dark:text-indigo-100" />
            </div>
            <div className="text-[12px] text-gray-500 flex justify-between"><span>💳 Filipetas anexadas</span><span className="font-semibold">{anexosDe("filipeta").length}</span></div>
            {comandasConsumo.length > 0 && <div className="text-[12px] text-gray-500 flex justify-between"><span>📋 Cortesias ({comandasConsumo.length})</span><span className="tabular-nums font-semibold">{fmtBRL(totalComandas)}</span></div>}
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Nº do lacre do malote</label>
              <input value={naoLacrado ? "" : numeroLacre} onChange={(e) => setNumeroLacre(e.target.value)} disabled={naoLacrado} placeholder={naoLacrado ? "—" : "ex: h3141345"} className={`${inputCls} disabled:opacity-50 disabled:bg-gray-100 dark:disabled:bg-gray-800`} />
              <label className="flex items-center gap-2 mt-1.5 cursor-pointer text-[12px] text-gray-600 dark:text-gray-400"><input type="checkbox" checked={naoLacrado} onChange={(e) => setNaoLacrado(e.target.checked)} className="w-4 h-4 accent-indigo-600" />Não foi lacrado</label>
            </div>
            {pedirObs ? (
              <div className="rounded-lg border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-950/20 p-3 space-y-2">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Como foi o turno?</div>
                {movForaDaMedia ? (
                  <>
                    <p className="text-[12px] text-amber-700 dark:text-amber-300">
                      O {TURNO_CAIXA_LABEL[turno].toLowerCase()} veio <strong>{movDir === "abaixo" ? "abaixo" : "acima"}</strong> do normal pra {diaSemana}. Conte rapidamente o que aconteceu.
                    </p>
                    <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} placeholder="ex: choveu forte no rush · faltou cozinheiro · grupo de 30 · evento na região…" className={inputCls} />
                    <p className="text-[11px] text-gray-400">Obrigatório quando o movimento foge da média.</p>
                  </>
                ) : (
                  <>
                    <p className="text-[12px] text-gray-500 dark:text-gray-400">{diaSemana.charAt(0).toUpperCase() + diaSemana.slice(1)} dentro do normal. Algo a destacar?</p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => { setSemOcorrencia(true); setObservacao(""); }}
                        className={`text-[12px] px-3 py-1.5 rounded-lg border ${semOcorrencia ? "bg-emerald-600 text-white border-emerald-600" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>✓ Foi tudo normal</button>
                      <button type="button" onClick={() => setSemOcorrencia(false)}
                        className={`text-[12px] px-3 py-1.5 rounded-lg border ${!semOcorrencia ? "bg-indigo-600 text-white border-indigo-600" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>Teve algo a relatar</button>
                    </div>
                    {!semOcorrencia && (
                      <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} placeholder="ex: grupo grande, promoção, evento na região…" className={inputCls} />
                    )}
                  </>
                )}
              </div>
            ) : (
              <div>
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Observação <span className="font-normal text-gray-400">— opcional</span></label>
                <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} className={inputCls} />
              </div>
            )}
            <div className="flex justify-between pt-1"><Button variant="secondary" size="sm" disabled={salvando} onClick={() => setEtapa("comandas")}>← Voltar</Button><Button disabled={salvando} onClick={() => void salvar()}>{salvando ? "Fechando…" : "✓ Fechar caixa"}</Button></div>
          </div>
        )}

        {comandaManual && (
          <ComandaModal comandas={comandasCad} onClose={() => setComandaManual(null)}
            onPick={(rot) => { const f = comandaManual; setComandaManual(null); setAnexos((prev) => prev.map((a) => a.file === f ? { ...a, rotulo: rot } : a)); }} />
        )}

        {confirmarDT && (
          <div className="fixed inset-0 bg-black/50 z-[300] flex items-center justify-center p-4" onClick={() => setConfirmarDT(null)}>
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start gap-2">
                <span className="text-2xl">⚠️</span>
                <div><h3 className="font-bold text-gray-900 dark:text-gray-100">Confirme o dia e o turno</h3><p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">{confirmarDT}</p></div>
              </div>
              <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3 space-y-3">
                <div className="text-[11px] text-gray-500">Fechando agora: <b>{fmtDataHora(new Date().toISOString())}</b></div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Data deste fechamento</label>
                  <input type="date" value={data} onChange={(e) => setData(e.target.value)} className="w-full h-11 px-3 text-base rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Turno</label>
                  <div className="flex gap-2">
                    {(["almoco", "jantar"] as TurnoCaixa[]).map((t) => (
                      <button key={t} type="button" onClick={() => setTurno(t)} className={`flex-1 py-2.5 rounded-lg border text-sm font-medium ${turno === t ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-800 text-gray-500"}`}>{TURNO_CAIXA_LABEL[t]}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="secondary" onClick={() => setConfirmarDT(null)}>Cancelar</Button>
                <Button onClick={() => { dtConfirmadoRef.current = true; setConfirmarDT(null); void salvar(); }}>Confirmar e fechar</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// Envia email de resumo pros sócios (1 por email, via Resend).
const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
async function enviarEmailResumo(emails: string[], restaurantNome: string, f: Omit<FechamentoCaixa, "id">, recentes: FechamentoCaixa[], from?: string) {
  // E-mail = painel de faturamento (mesmo da aba Painel): dia, mês e últimos 7 dias.
  const dados = montarPainel([...recentes, f as FechamentoCaixa], f.data);
  // Destaque: o turno recém fechado (dia + turno explícitos).
  const turnoLabel = TURNO_CAIXA_LABEL[f.turno];
  const diaSemana = DIAS_SEMANA[new Date(`${f.data}T12:00:00`).getDay()] || "";
  const destaque = { titulo: `Venda do ${turnoLabel.toLowerCase()} · ${diaSemana}, ${fmtData(f.data)}`, valor: f.totalVendas || 0 };
  const html = painelEmailHtml(dados, restaurantNome, destaque);
  const text = `${destaque.titulo} — ${restaurantNome}\n`
    + `Venda do ${turnoLabel.toLowerCase()}: ${fmtBRL(f.totalVendas)}\n`
    + `Total do dia: ${fmtBRL(dados.diaTotal)}\n`
    + `Últimos ${dados.ultimos7.length} dia(s): ${fmtBRL(dados.total7)}\n`
    + `Total do mês (${dados.mesLabel}): ${fmtBRL(dados.mesTotal)}\n`
    + `Últimos dias: ${dados.ultimos7.map((x) => `${fmtData(x.ymd)} ${fmtBRL(x.total)}`).join(" · ")}`;
  const subject = `${turnoLabel} ${fmtData(f.data)}: ${fmtBRL(f.totalVendas)} — ${restaurantNome}`;
  // Remetente: override da config OU "<Restaurante> <caixa@planejamento.app>".
  const nomeRem = restaurantNome.replace(/["<>]/g, "").trim() || "Fechamento";
  const remetente = (from && from.trim()) || `"${nomeRem}" <caixa@planejamento.app>`;
  const headers = { "Content-Type": "application/json", ...(await authHeader()) };
  for (const to of emails) {
    try { await fetch("/api/send-email", { method: "POST", headers, body: JSON.stringify({ to, subject, html, text, from: remetente }) }); }
    catch { /* best-effort */ }
  }
}

// ─── Aba: controle de cortesias / comandas de sócios ────────────────────────
// ─── Painel de faturamento (dashboard in-app, espelha o e-mail) ─────────────
function PainelTab({ fechamentos, restaurantNome }: { fechamentos: FechamentoCaixa[]; restaurantNome: string }) {
  const hoje = useMemo(() => ymd(new Date()), []);
  const d = useMemo(() => montarPainel(fechamentos, hoje), [fechamentos, hoje]);
  const max = Math.max(1, ...d.ultimos7.map((x) => x.total));
  const Card = ({ label, valor, cor }: { label: string; valor: string; cor: string }) => (
    <div className="rounded-2xl p-4 text-white" style={{ background: cor }}>
      <div className="text-[11px] uppercase tracking-wide opacity-85">{label}</div>
      <div className="text-2xl font-extrabold tabular-nums mt-0.5">{valor}</div>
    </div>
  );
  if (fechamentos.length === 0) {
    return <div className="text-center text-sm text-gray-400 py-12">Sem fechamentos ainda. O painel aparece quando houver faturamento registrado.</div>;
  }
  return (
    <div className="space-y-4">
      <div className="text-[12px] text-gray-500">Faturamento de <strong>{restaurantNome}</strong> · referência {fmtDiaCurto(hoje)} · {d.mesLabel}</div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card label="Faturamento do dia" valor={fmtBRLp(d.diaTotal)} cor="#4f46e5" />
        <Card label={`Últimos ${d.ultimos7.length} dia(s)`} valor={fmtBRLp(d.total7)} cor="#0ea5e9" />
        <Card label="Total do mês" valor={fmtBRLp(d.mesTotal)} cor="#10b981" />
      </div>
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
        <div className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Últimos {d.ultimos7.length} dia(s)</div>
        <div className="space-y-1.5">
          {d.ultimos7.map((x) => {
            const ehHoje = x.ymd === hoje;
            return (
              <div key={x.ymd} className="flex items-center gap-3">
                <div className={`w-12 text-[12px] tabular-nums shrink-0 ${ehHoje ? "font-bold text-indigo-600 dark:text-indigo-400" : "text-gray-500"}`}>{fmtDiaCurto(x.ymd)}</div>
                <div className="flex-1 bg-indigo-50 dark:bg-indigo-950/30 rounded-md h-5 overflow-hidden">
                  <div className="h-full rounded-md" style={{ width: `${Math.round((x.total / max) * 100)}%`, background: ehHoje ? "#4f46e5" : "#a5b4fc" }} />
                </div>
                <div className="w-28 text-right text-[13px] font-semibold tabular-nums text-gray-800 dark:text-gray-100 shrink-0">{fmtBRLp(x.total)}</div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-[11px] text-gray-400">Este mesmo painel vai no e-mail enviado aos sócios a cada fechamento.</p>
    </div>
  );
}

function ControleComandas({ fechamentos, restaurantNome }: { fechamentos: FechamentoCaixa[]; restaurantNome: string }) {
  // Pré-preenche: dia 1 do mês corrente → hoje.
  const hoje = useMemo(() => new Date(), []);
  const [dataIni, setDataIni] = useState(() => ymd(new Date(hoje.getFullYear(), hoje.getMonth(), 1)));
  const [dataFim, setDataFim] = useState(() => ymd(hoje));
  const [filtroComanda, setFiltroComanda] = useState(""); // "" = todas
  const [exportando, setExportando] = useState<"" | "xlsx" | "pdf">("");

  // Achata: cada consumo vira uma linha com data/turno.
  const linhas = useMemo(() => {
    const out: Array<{ data: string; turno: TurnoCaixa; numero: string; nome?: string; valor?: number }> = [];
    for (const f of fechamentos) for (const c of (f.comandas || [])) out.push({ data: f.data, turno: f.turno, numero: c.numero, nome: c.nome, valor: c.valor });
    return out.sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  }, [fechamentos]);

  // Opções de comanda pro filtro (distintas) — viram chips.
  const opcoes = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of linhas) map.set(l.numero, l.nome ? `${l.nome} (${l.numero})` : `Comanda ${l.numero}`);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [linhas]);

  const filtradas = linhas.filter((l) =>
    (!dataIni || l.data >= dataIni) && (!dataFim || l.data <= dataFim) && (!filtroComanda || l.numero === filtroComanda),
  );
  const total = filtradas.reduce((s, l) => s + (l.valor || 0), 0);
  // Totais por comanda (do filtro).
  const porComanda = useMemo(() => {
    const map = new Map<string, { rotulo: string; total: number; qtd: number }>();
    for (const l of filtradas) {
      const k = l.numero;
      const cur = map.get(k) || { rotulo: l.nome ? `${l.nome} (${l.numero})` : `Comanda ${l.numero}`, total: 0, qtd: 0 };
      cur.total += l.valor || 0; cur.qtd += 1; map.set(k, cur);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [filtradas]);

  async function exportar(tipo: "xlsx" | "pdf") {
    if (exportando) return;
    setExportando(tipo);
    try {
      const periodo = `${fmtData(dataIni)} a ${fmtData(dataFim)}` + (filtroComanda ? ` · ${opcoes.find(([n]) => n === filtroComanda)?.[1] || ""}` : "");
      if (tipo === "pdf") await exportarComandasPDF(filtradas, restaurantNome, periodo);
      else await exportarComandasXLSX(filtradas, restaurantNome);
    } finally { setExportando(""); }
  }

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[11px] font-semibold text-gray-500 block mb-0.5">De</label>
            <input type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} className="px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-gray-500 block mb-0.5">Até</label>
            <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]" />
          </div>
          <div className="flex-1" />
          {filtradas.length > 0 && (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={!!exportando} onClick={() => void exportar("xlsx")}>{exportando === "xlsx" ? "Gerando…" : "⬇ XLSX"}</Button>
              <Button size="sm" variant="secondary" disabled={!!exportando} onClick={() => void exportar("pdf")}>{exportando === "pdf" ? "Gerando…" : "⬇ PDF"}</Button>
            </div>
          )}
        </div>
        {/* Chips de comanda */}
        {opcoes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setFiltroComanda("")}
              className={`text-[12px] px-2.5 py-1 rounded-full border transition-colors ${filtroComanda === "" ? "bg-indigo-600 border-indigo-600 text-white" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"}`}>
              Todas
            </button>
            {opcoes.map(([num, rot]) => (
              <button key={num} type="button" onClick={() => setFiltroComanda((c) => c === num ? "" : num)}
                className={`text-[12px] px-2.5 py-1 rounded-full border transition-colors ${filtroComanda === num ? "bg-indigo-600 border-indigo-600 text-white" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"}`}>
                {rot}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Resumo por comanda */}
      {porComanda.length > 0 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">Total por comanda · geral <span className="text-emerald-700 dark:text-emerald-300">{fmtBRL(total)}</span></div>
          <div className="flex flex-wrap gap-2">
            {porComanda.map((c, i) => (
              <span key={i} className="text-[12px] px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700">{c.rotulo}: <strong>{fmtBRL(c.total)}</strong> <span className="text-gray-400">({c.qtd})</span></span>
            ))}
          </div>
        </div>
      )}

      {/* Lançamentos */}
      {filtradas.length === 0 ? (
        <div className="text-center text-sm text-gray-400 py-12">Nenhum consumo de comanda no período. As comandas lidas nos fechamentos aparecem aqui.</div>
      ) : (
        <>
          {/* Desktop: tabela */}
          <div className="hidden sm:block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-200 dark:border-gray-800">
                  <th className="px-4 py-2.5 font-medium">Data</th>
                  <th className="px-4 py-2.5 font-medium">Turno</th>
                  <th className="px-4 py-2.5 font-medium">Comanda</th>
                  <th className="px-4 py-2.5 font-medium text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filtradas.map((l, i) => (
                  <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                    <td className="px-4 py-2.5 tabular-nums text-gray-500">{fmtData(l.data)}</td>
                    <td className="px-4 py-2.5"><span className="inline-flex items-center rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-[11px] font-medium px-2 py-0.5">{TURNO_CAIXA_LABEL[l.turno]}</span></td>
                    <td className="px-4 py-2.5 text-gray-700 dark:text-gray-200">{l.nome ? `${l.nome} (${l.numero})` : `Comanda ${l.numero}`}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-800 dark:text-gray-100">{l.valor != null ? fmtBRL(l.valor) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40">
                  <td className="px-4 py-2.5" colSpan={3}>Total ({filtradas.length})</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtBRL(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {/* Mobile: cards */}
          <div className="sm:hidden space-y-2">
            {filtradas.map((l, i) => (
              <div key={i} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-gray-800 dark:text-gray-100 truncate">{l.nome ? `${l.nome} (${l.numero})` : `Comanda ${l.numero}`}</div>
                  <div className="text-[11px] text-gray-400 tabular-nums">{fmtData(l.data)} · {TURNO_CAIXA_LABEL[l.turno]}</div>
                </div>
                <div className="shrink-0 tabular-nums font-semibold text-gray-800 dark:text-gray-100">{l.valor != null ? fmtBRL(l.valor) : "—"}</div>
              </div>
            ))}
            <div className="flex items-center justify-between px-3 py-2.5 font-semibold bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 rounded-xl">
              <span>Total ({filtradas.length})</span>
              <span className="tabular-nums">{fmtBRL(total)}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Conciliação de Cartões (Rede × Altec) ──────────────────────────────────
// Lê o print do Altec (lista de fechamentos → horários de corte de cada caixa)
// e a planilha de vendas da Rede; agrupa as vendas de cartão por janela de caixa
// (do corte anterior até o corte de cada caixa) pra conferir crédito/débito por
// bandeira na Altec. PIX/dinheiro não vêm da Rede (entram por outro canal).
type CaixaCorte = { id?: string; data: string; hora: string; abertura?: string }; // hora HH:MM:SS; abertura ISO quando há (sessão com abertura+fechamento)
type TxRede = { ts: number; modalidade: "credito" | "debito" | "pix" | "voucher" | "outro"; bandeira: string; valor: number; rotulo?: string };
const DIACR = new RegExp("[\\u0300-\\u036f]", "g");
const normMod = (s: string): TxRede["modalidade"] => {
  const t = (s || "").toLowerCase().normalize("NFD").replace(DIACR, "");
  if (t.includes("cred")) return "credito";
  if (t.includes("deb")) return "debito";
  if (t.includes("pix")) return "pix";
  if (t.includes("voucher") || t.includes("refei") || t.includes("aliment")) return "voucher"; // VR/VA (Pluxee, Sodexo, Alelo…)
  return "outro";
};

async function parseRedeXlsx(file: File): Promise<TxRede[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets["vendas"] || wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false }) as unknown[][];
  const hi = aoa.findIndex((r) => Array.isArray(r) && r.some((c) => String(c).toLowerCase().trim() === "data da venda"));
  if (hi < 0) throw new Error("Planilha não parece o relatório de vendas da Rede (cabeçalho 'data da venda' não encontrado).");
  const header = (aoa[hi] as unknown[]).map((c) => String(c).toLowerCase().trim());
  const idx = (n: string) => header.indexOf(n);
  const ciData = idx("data da venda"), ciHora = idx("hora da venda"), ciStatus = idx("status da venda"),
    ciVal = idx("valor da venda original"), ciMod = idx("modalidade"), ciBand = idx("bandeira"), ciCanc = idx("cancelada pelo estabelecimento");
  const out: TxRede[] = [];
  for (const r of aoa.slice(hi + 1)) {
    if (!Array.isArray(r) || r[ciData] == null) continue;
    const status = String(r[ciStatus] ?? "").toLowerCase().trim();
    if (status !== "aprovada" && status !== "pago") continue;                 // ignora negada/expirado
    if (String(r[ciCanc] ?? "").toLowerCase().trim().startsWith("s")) continue; // ignora cancelada (sim)
    const d = r[ciData], h = r[ciHora];
    let dt: Date | null = null;
    if (d instanceof Date) {
      const hh = h instanceof Date ? h : null;
      dt = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh ? hh.getHours() : 0, hh ? hh.getMinutes() : 0, hh ? hh.getSeconds() : 0);
    } else if (typeof d === "string") {
      const md = d.match(/(\d{2})\/(\d{2})\/(\d{4})/); const mh = String(h ?? "").match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (md) dt = new Date(+md[3], +md[2] - 1, +md[1], mh ? +mh[1] : 0, mh ? +mh[2] : 0, mh && mh[3] ? +mh[3] : 0);
    }
    if (!dt || isNaN(dt.getTime())) continue;
    const valor = typeof r[ciVal] === "number" ? (r[ciVal] as number) : parseBRL(String(r[ciVal] ?? "")) ?? 0;
    const rawMod = String(r[ciMod] ?? "").trim();
    const mod = normMod(rawMod);
    const bandeira = String(r[ciBand] ?? "").trim() || "—";
    out.push({ ts: dt.getTime(), modalidade: mod, bandeira, valor, ...(mod === "outro" ? { rotulo: [rawMod, bandeira !== "—" ? bandeira : ""].filter(Boolean).join(" · ") || "—" } : {}) });
  }
  return out;
}

type TxIfood = { ts: number; valor: number };
async function parseIfoodXlsx(file: File): Promise<TxIfood[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false }) as unknown[][];
  const hi = aoa.findIndex((r) => Array.isArray(r) && r.some((c) => String(c).toLowerCase().includes("data e hora do pedido")));
  if (hi < 0) throw new Error("Planilha não parece o relatório de pedidos do iFood (coluna 'DATA E HORA DO PEDIDO' não encontrada).");
  const header = (aoa[hi] as unknown[]).map((c) => String(c).toLowerCase().trim());
  const find = (sub: string) => header.findIndex((h) => h.includes(sub));
  const ciDt = find("data e hora do pedido"), ciStatus = find("status final do pedido"), ciItens = find("valor dos itens");
  const out: TxIfood[] = [];
  for (const r of aoa.slice(hi + 1)) {
    if (!Array.isArray(r) || r[ciDt] == null) continue;
    if (String(r[ciStatus] ?? "").toUpperCase().trim() !== "CONCLUIDO") continue; // só pedidos concluídos
    const raw = r[ciDt];
    let dt: Date | null = null;
    if (raw instanceof Date) dt = raw;
    else if (typeof raw === "string") { const m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/); if (m) dt = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], m[6] ? +m[6] : 0); }
    if (!dt || isNaN(dt.getTime())) continue;
    const valor = typeof r[ciItens] === "number" ? (r[ciItens] as number) : parseBRL(String(r[ciItens] ?? "")) ?? 0;
    out.push({ ts: dt.getTime(), valor });
  }
  return out;
}

type Totais = { credito: Record<string, number>; debito: Record<string, number>; voucher?: Record<string, number>; outros?: Record<string, number>; pixRede: number; ifood: number; nIfood: number; nCard: number; total: number };
type CaixaSalvo = Totais & {
  id: string; restaurantId: string;
  caixaId?: string; corteData: string; corteHora: string;
  prevData?: string; prevHora?: string;
  conciliadoEm?: string; conciliadoPor?: { id: string; nome: string };
  criadoEm?: string;
};
const chaveSalvo = (s: { corteData: string; corteHora: string; caixaId?: string }) => `${s.corteData}T${s.corteHora}|${s.caixaId || ""}`;
const assinaturaTotais = (g: Totais) => JSON.stringify([Object.entries(g.credito).sort(), Object.entries(g.debito).sort(), Object.entries(g.voucher || {}).sort(), Object.entries(g.outros || {}).sort(), g.pixRede, g.ifood, g.total]);

function ConciliacaoCartoes({ rid, temIfood, me, podeConfig }: { rid: string; temIfood: boolean; me: { id?: string; nome?: string } | null; podeConfig: boolean }) {
  const [caixas, setCaixas] = useState<CaixaCorte[]>([]);
  const [txs, setTxs] = useState<TxRede[] | null>(null);
  const [redeNome, setRedeNome] = useState("");
  const [ifood, setIfood] = useState<TxIfood[] | null>(null);
  const [ifoodNome, setIfoodNome] = useState("");
  const [lendoPrint, setLendoPrint] = useState(false);
  const [lendoXlsx, setLendoXlsx] = useState(false);
  const [lendoIfood, setLendoIfood] = useState(false);
  const [salvos, setSalvos] = useState<CaixaSalvo[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [modal, setModal] = useState<{ titulo: string; sub?: string; g: Totais; kind: "preview" | "pendente" | "conciliado"; item?: CaixaSalvo } | null>(null);
  const [erro, setErro] = useState("");
  const printRef = useRef<HTMLInputElement>(null);
  const xlsxRef = useRef<HTMLInputElement>(null);
  const ifoodRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "conciliacoesCaixa"), where("restaurantId", "==", rid));
    return onSnapshot(q, (snap) => setSalvos(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CaixaSalvo)));
  }, [rid]);

  async function lerPrint(files: File[]) {
    if (!files.length) return;
    setErro(""); setLendoPrint(true);
    try {
      const blocos = await Promise.all(files.map(paraOcrBlock));
      const resp = await fetch("/api/ocr-nota", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ files: blocos, tipo: "altec_caixas" }) });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) { setErro(j.error || "Falha ao ler o print."); return; }
      const lidas: CaixaCorte[] = Array.isArray(j.caixas) ? j.caixas : [];
      if (!lidas.length) { setErro("Não consegui ler os caixas do print. Tente uma imagem mais nítida."); return; }
      // Acumula (vários prints) e dedup por data+hora.
      setCaixas((prev) => {
        const map = new Map<string, CaixaCorte>();
        for (const c of [...prev, ...lidas]) map.set(`${c.data}T${c.hora}`, c);
        return [...map.values()].sort((a, b) => `${a.data}T${a.hora}`.localeCompare(`${b.data}T${b.hora}`));
      });
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao ler o print."); }
    finally { setLendoPrint(false); }
  }

  async function lerXlsx(file: File) {
    setErro(""); setLendoXlsx(true);
    try { setTxs(await parseRedeXlsx(file)); setRedeNome(file.name); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falha ao ler a planilha."); setTxs(null); }
    finally { setLendoXlsx(false); }
  }

  async function lerIfood(file: File) {
    setErro(""); setLendoIfood(true);
    try { setIfood(await parseIfoodXlsx(file)); setIfoodNome(file.name); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falha ao ler a planilha do iFood."); setIfood(null); }
    finally { setLendoIfood(false); }
  }

  // Colar print direto (Cmd/Ctrl+V) — pega imagens da área de transferência.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const itens = e.clipboardData?.items ? Array.from(e.clipboardData.items) : [];
      const imgs = itens.filter((it) => it.kind === "file" && it.type.startsWith("image/")).map((it) => it.getAsFile()).filter((f): f is File => !!f);
      if (imgs.length) { e.preventDefault(); void lerPrint(imgs); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  // Janelas: cada caixa (ordenado por corte) cobre (corte anterior, corte dele].
  // Sessões longas (abertura→fechamento > 24h, ex: caixa esquecido aberto vários dias) são ignoradas:
  // elas se sobrepõem aos caixas normais e bagunçam a divisão por horário.
  const SESSAO_LONGA_MS = 24 * 60 * 60 * 1000;
  const { cortes, ignorados } = useMemo(() => {
    const parsed = caixas.map((c) => {
      const ts = new Date(`${c.data}T${c.hora}`).getTime();
      const abTs = c.abertura ? new Date(c.abertura).getTime() : NaN;
      const longa = !isNaN(abTs) && ts - abTs > SESSAO_LONGA_MS;
      return { ...c, ts, longa };
    }).filter((c) => !isNaN(c.ts));
    return {
      cortes: parsed.filter((c) => !c.longa).sort((a, b) => a.ts - b.ts),
      ignorados: parsed.filter((c) => c.longa).sort((a, b) => a.ts - b.ts),
    };
  }, [caixas]);

  const resultado = useMemo(() => {
    if (!txs || !cortes.length) return null;
    type Grupo = { credito: Record<string, number>; debito: Record<string, number>; voucher: Record<string, number>; outros: Record<string, number>; pixRede: number; ifood: number; nIfood: number; nCard: number; total: number };
    const novo = (): Grupo => ({ credito: {}, debito: {}, voucher: {}, outros: {}, pixRede: 0, ifood: 0, nIfood: 0, nCard: 0, total: 0 });
    const porCaixa = cortes.map(() => novo());
    const aberto = novo(); // vendas após o último corte (caixa ainda aberto)
    const grupoDe = (ts: number): Grupo | null => {
      const gi = cortes.findIndex((c, i) => ts <= c.ts && (i === 0 || ts > cortes[i - 1].ts));
      return gi >= 0 ? porCaixa[gi] : (ts > cortes[cortes.length - 1].ts ? aberto : null);
    };
    for (const t of txs) {
      const g = grupoDe(t.ts);
      if (!g) continue;
      if (t.modalidade === "credito") { g.credito[t.bandeira] = (g.credito[t.bandeira] || 0) + t.valor; g.nCard++; g.total += t.valor; }
      else if (t.modalidade === "debito") { g.debito[t.bandeira] = (g.debito[t.bandeira] || 0) + t.valor; g.nCard++; g.total += t.valor; }
      else if (t.modalidade === "pix") { g.pixRede += t.valor; }
      else if (t.modalidade === "voucher") { g.voucher[t.bandeira] = (g.voucher[t.bandeira] || 0) + t.valor; }
      else { const r = t.rotulo || t.bandeira || "—"; g.outros[r] = (g.outros[r] || 0) + t.valor; } // nada é descartado: vai pra "outros a classificar"
    }
    for (const o of (ifood || [])) { const g = grupoDe(o.ts); if (g) { g.ifood += o.valor; g.nIfood++; } }
    return { porCaixa, aberto };
  }, [txs, cortes, ifood]);

  // Salva os caixas FECHADOS na lista persistida (aguardando conciliação). Dedup por igualdade exata.
  async function salvar() {
    if (!resultado) return;
    setSalvando(true); setErro(""); const novos: string[] = [];
    try {
      for (let i = 0; i < cortes.length; i++) {
        const c = cortes[i];
        const g = resultado.porCaixa[i];
        const chave = `${c.data}T${c.hora}|${c.id || ""}`;
        const existente = salvos.find((s) => chaveSalvo(s) === chave);
        const rec = {
          restaurantId: rid, ...(c.id ? { caixaId: c.id } : {}), corteData: c.data, corteHora: c.hora,
          ...(i > 0 ? { prevData: cortes[i - 1].data, prevHora: cortes[i - 1].hora } : {}),
          credito: g.credito, debito: g.debito, voucher: g.voucher, outros: g.outros, pixRede: g.pixRede, ifood: g.ifood, nIfood: g.nIfood, nCard: g.nCard, total: g.total,
        };
        const rotulo = `Caixa ${c.id ? `#${c.id}` : fmtData(c.data)}`;
        if (!existente) await addDoc(collection(db, "conciliacoesCaixa"), { ...rec, criadoEm: new Date().toISOString() });
        else if (existente.conciliadoEm) novos.push(`${rotulo} já está conciliado — ignorado.`);
        else if (assinaturaTotais(existente) === assinaturaTotais(g)) novos.push(`${rotulo} já estava lançado, idêntico — ignorado.`);
        else { await updateDoc(doc(db, "conciliacoesCaixa", existente.id), rec); novos.push(`${rotulo} atualizado (valores diferentes do que já estava).`); }
      }
      setAvisos(novos);
      setCaixas([]); setTxs(null); setRedeNome(""); setIfood(null); setIfoodNome(""); // já persistido
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao salvar."); }
    finally { setSalvando(false); }
  }
  async function conciliarSalvo(s: CaixaSalvo) {
    try { await updateDoc(doc(db, "conciliacoesCaixa", s.id), { conciliadoEm: new Date().toISOString(), conciliadoPor: { id: me?.id || "", nome: me?.nome || "?" } }); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falha ao conciliar."); }
  }
  async function desconciliarSalvo(s: CaixaSalvo) {
    try { await updateDoc(doc(db, "conciliacoesCaixa", s.id), { conciliadoEm: deleteField(), conciliadoPor: deleteField() }); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falha ao desfazer."); }
  }
  async function removerSalvo(s: CaixaSalvo) {
    if (!window.confirm(`Remover ${s.caixaId ? `o caixa #${s.caixaId}` : "este caixa"} da lista de conciliação?`)) return;
    try { await deleteDoc(doc(db, "conciliacoesCaixa", s.id)); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falha ao remover."); }
  }
  const totaisDe = (s: CaixaSalvo): Totais => ({ credito: s.credito || {}, debito: s.debito || {}, voucher: s.voucher || {}, outros: s.outros || {}, pixRede: s.pixRede || 0, ifood: s.ifood || 0, nIfood: s.nIfood || 0, nCard: s.nCard || 0, total: s.total || 0 });
  const tituloSalvo = (s: CaixaSalvo) => `Caixa ${s.caixaId ? `#${s.caixaId}` : fmtData(s.corteData)} · fechou ${fmtData(s.corteData)} ${s.corteHora.slice(0, 5)}`;
  const janelaSalvo = (s: CaixaSalvo) => `de ${s.prevData ? `${fmtData(s.prevData)} ${(s.prevHora || "").slice(0, 5)}` : "início"} até ${fmtData(s.corteData)} ${s.corteHora.slice(0, 5)}`;
  const pendentesSalvos = useMemo(() => salvos.filter((s) => !s.conciliadoEm).sort((a, b) => chaveSalvo(a).localeCompare(chaveSalvo(b))), [salvos]);
  const conciliadosSalvos = useMemo(() => salvos.filter((s) => s.conciliadoEm).sort((a, b) => (b.conciliadoEm || "").localeCompare(a.conciliadoEm || "")), [salvos]);

  const filesFrom = (e: ChangeEvent<HTMLInputElement>) => { const fs = Array.from(e.target.files || []); e.target.value = ""; return fs; };
  const somaBand = (r: Record<string, number>) => Object.values(r).reduce((s, v) => s + v, 0);
  // Ordem de exibição das bandeiras: Visa, Master, Elo, Amex… (resto alfabético no fim).
  const ORDEM_BAND = ["visa", "master", "elo", "amex", "hiper", "diners"];
  const posBand = (b: string) => { const n = b.toLowerCase(); const i = ORDEM_BAND.findIndex((k) => n.includes(k)); return i === -1 ? 99 : i; };
  const ordenarBand = (r: Record<string, number>) => Object.entries(r).sort((a, b) => posBand(a[0]) - posBand(b[0]) || a[0].localeCompare(b[0]));

  // Duplicados: mesmo nº de caixa repetido, ou cortes a menos de 2min (prints sobrepostos).
  const dups = useMemo(() => {
    const byId = new Map<string, number>();
    for (const c of cortes) if (c.id) byId.set(c.id, (byId.get(c.id) || 0) + 1);
    const ids = [...byId.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    const near: string[] = [];
    for (let i = 1; i < cortes.length; i++) if (cortes[i].ts - cortes[i - 1].ts < 120000) near.push(`${fmtData(cortes[i].data)} ${cortes[i].hora.slice(0, 5)}`);
    return { ids, near };
  }, [cortes]);

  const totalDe = (g: Totais) => somaBand(g.credito) + somaBand(g.debito) + somaBand(g.voucher || {}) + somaBand(g.outros || {}) + g.pixRede + (temIfood ? g.ifood : 0);

  // Linha compacta (só cabeçalho) — clicável, abre o modal de detalhe.
  const LinhaCaixa = ({ titulo, sub, g, amber, onClick }: { titulo: string; sub?: string; g: Totais; amber?: boolean; onClick: () => void }) => (
    <button type="button" onClick={onClick}
      className={`w-full text-left border rounded-xl p-4 flex items-center justify-between gap-3 transition-colors hover:border-indigo-300 dark:hover:border-indigo-700 ${amber ? "border-amber-300 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/15" : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"}`}>
      <div className="min-w-0"><div className="font-semibold text-gray-800 dark:text-gray-100 truncate">{titulo}</div>{sub && <div className="text-[11px] text-gray-400 truncate">{sub}</div>}</div>
      <div className="text-right shrink-0"><div className="text-base font-bold tabular-nums text-gray-800 dark:text-gray-100">{fmtBRL(totalDe(g))}</div><div className="text-[10px] uppercase tracking-wide text-gray-400">total {temIfood ? "(cartão+pix+ifood)" : "(cartão+pix)"}</div></div>
    </button>
  );

  // Detalhamento (crédito/débito/pix/ifood) — usado dentro do modal.
  const Breakdown = ({ g }: { g: Totais }) => (
    <div className="space-y-2">
      <div>
        <div className="flex justify-between text-[12px] font-semibold text-violet-700 dark:text-violet-300"><span>PIX (Rede)</span><span className="tabular-nums">{fmtBRL(g.pixRede)}</span></div>
        <div className="text-[11px] text-gray-400">só maquininha — o PIX do balcão (QR/banco) não vem da Rede</div>
      </div>
      <div className="pt-1 border-t border-gray-100 dark:border-gray-800">
        <div className="flex justify-between text-[12px] font-semibold text-emerald-700 dark:text-emerald-300"><span>Crédito</span><span className="tabular-nums">{fmtBRL(somaBand(g.credito))}</span></div>
        {ordenarBand(g.credito).map(([b, v]) => (
          <div key={b} className="flex justify-between text-sm text-gray-600 dark:text-gray-300 pl-2"><span>{b}</span><span className="tabular-nums">{fmtBRL(v)}</span></div>
        ))}
      </div>
      <div className="pt-1 border-t border-gray-100 dark:border-gray-800">
        <div className="flex justify-between text-[12px] font-semibold text-sky-700 dark:text-sky-300"><span>Débito</span><span className="tabular-nums">{fmtBRL(somaBand(g.debito))}</span></div>
        {ordenarBand(g.debito).map(([b, v]) => (
          <div key={b} className="flex justify-between text-sm text-gray-600 dark:text-gray-300 pl-2"><span>{b}</span><span className="tabular-nums">{fmtBRL(v)}</span></div>
        ))}
      </div>
      {somaBand(g.voucher || {}) > 0 && (
        <div className="pt-1 border-t border-gray-100 dark:border-gray-800">
          <div className="flex justify-between text-[12px] font-semibold text-amber-700 dark:text-amber-300"><span>Voucher (VR/VA)</span><span className="tabular-nums">{fmtBRL(somaBand(g.voucher || {}))}</span></div>
          {ordenarBand(g.voucher || {}).map(([b, v]) => (
            <div key={b} className="flex justify-between text-sm text-gray-600 dark:text-gray-300 pl-2"><span>{b}</span><span className="tabular-nums">{fmtBRL(v)}</span></div>
          ))}
        </div>
      )}
      {temIfood && (
        <div className="pt-1 border-t border-gray-100 dark:border-gray-800">
          <div className="flex justify-between text-[12px] font-semibold text-rose-700 dark:text-rose-300"><span>iFood</span><span className="tabular-nums">{fmtBRL(g.ifood)}</span></div>
          <div className="text-[11px] text-gray-400">{g.nIfood} pedido(s) · valor dos itens</div>
        </div>
      )}
      {somaBand(g.outros || {}) > 0 && (
        <div className="pt-1 border-t border-gray-100 dark:border-gray-800">
          <div className="flex justify-between text-[12px] font-semibold text-gray-700 dark:text-gray-300"><span>Outros a classificar</span><span className="tabular-nums">{fmtBRL(somaBand(g.outros || {}))}</span></div>
          {ordenarBand(g.outros || {}).map(([b, v]) => (
            <div key={b} className="flex justify-between text-sm text-gray-600 dark:text-gray-300 pl-2"><span className="truncate">{b}</span><span className="tabular-nums">{fmtBRL(v)}</span></div>
          ))}
          <div className="text-[11px] text-gray-400">modalidades não mapeadas — nada é descartado, confira o que são</div>
        </div>
      )}
      <div className="flex justify-between text-sm font-bold pt-1 border-t border-gray-200 dark:border-gray-700"><span>Total</span><span className="tabular-nums">{fmtBRL(totalDe(g))}</span></div>
    </div>
  );

  return (
    <div className="space-y-4">
      <input ref={printRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => void lerPrint(filesFrom(e))} />
      <input ref={xlsxRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const fs = filesFrom(e); if (fs[0]) void lerXlsx(fs[0]); }} />
      <input ref={ifoodRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const fs = filesFrom(e); if (fs[0]) void lerIfood(fs[0]); }} />

      {/* Passos de upload */}
      <div className={`grid gap-3 ${temIfood ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <div className="font-semibold text-gray-800 dark:text-gray-100 mb-1">1 · Print dos caixas (Altec)</div>
          <p className="text-[12px] text-gray-500 mb-3">A lista de fechamentos do Altec. Os horários definem o intervalo de cada caixa. Pode <strong>colar (Cmd/Ctrl+V)</strong> o print direto.</p>
          <Button size="sm" variant="secondary" disabled={lendoPrint} onClick={() => printRef.current?.click()}>{lendoPrint ? "Lendo…" : caixas.length ? `📷 ${caixas.length} caixas · adicionar print` : "📷 Enviar ou colar print"}</Button>
        </div>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <div className="font-semibold text-gray-800 dark:text-gray-100 mb-1">2 · Planilha de vendas (Rede)</div>
          <p className="text-[12px] text-gray-500 mb-3">O relatório de vendas da Rede em Excel (.xlsx).</p>
          <Button size="sm" variant="secondary" disabled={lendoXlsx} onClick={() => xlsxRef.current?.click()}>{lendoXlsx ? "Lendo…" : txs ? `📊 ${txs.length} vendas · trocar` : "📊 Enviar planilha"}</Button>
          {redeNome && <div className="text-[11px] text-gray-400 mt-1 truncate">{redeNome}</div>}
        </div>
        {temIfood && (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
            <div className="font-semibold text-gray-800 dark:text-gray-100 mb-1">3 · Planilha de pedidos (iFood)</div>
            <p className="text-[12px] text-gray-500 mb-3">O relatório de pedidos do iFood em Excel (.xlsx). Conta só os concluídos.</p>
            <Button size="sm" variant="secondary" disabled={lendoIfood} onClick={() => ifoodRef.current?.click()}>{lendoIfood ? "Lendo…" : ifood ? `🍔 ${ifood.length} pedidos · trocar` : "🍔 Enviar planilha"}</Button>
            {ifoodNome && <div className="text-[11px] text-gray-400 mt-1 truncate">{ifoodNome}</div>}
          </div>
        )}
      </div>

      {erro && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}

      {/* Aviso de duplicado no print */}
      {(dups.ids.length > 0 || dups.near.length > 0) && (
        <div className="text-sm text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-900/40 rounded-lg px-3 py-2">
          ⚠ Possível caixa duplicado no print{dups.ids.length ? ` — nº ${dups.ids.join(", ")} aparece(m) mais de uma vez` : ""}{dups.near.length ? ` — cortes muito próximos (${dups.near.join(", ")})` : ""}. Confira se colou prints sobrepostos.
        </div>
      )}

      {/* Avisos do último salvamento */}
      {avisos.length > 0 && (
        <div className="text-[12px] text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2 space-y-0.5">
          {avisos.map((a, i) => <div key={i}>• {a}</div>)}
        </div>
      )}

      {/* Pré-visualização do que foi lido — salvar pra aguardar conciliação */}
      {resultado && (() => {
        const titulo = (c: CaixaCorte, i: number) => `Caixa ${c.id ? `#${c.id}` : i + 1} · fechou ${fmtData(c.data)} ${c.hora.slice(0, 5)}`;
        const janela = (i: number) => `de ${i > 0 ? `${fmtData(cortes[i - 1].data)} ${cortes[i - 1].hora.slice(0, 5)}` : "início"} até ${fmtData(cortes[i].data)} ${cortes[i].hora.slice(0, 5)}`;
        // Caixas que já estão conciliados aparecem no print só pelo corte — ocultados aqui.
        const conciliadoChaves = new Set(conciliadosSalvos.map((s) => chaveSalvo(s)));
        const visiveis = cortes.map((c, i) => ({ c, i })).filter(({ c }) => !conciliadoChaves.has(`${c.data}T${c.hora}|${c.id || ""}`));
        const ocultados = cortes.length - visiveis.length;
        return (
          <div className="space-y-3 border border-indigo-200 dark:border-indigo-900/40 bg-indigo-50/40 dark:bg-indigo-950/10 rounded-xl p-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[12px] text-gray-600 dark:text-gray-300">Leitura pronta: <strong>{visiveis.length}</strong> caixa(s){ocultados > 0 ? ` · ${ocultados} já conciliado(s) ocultado(s)` : ""}{ignorados.length > 0 ? ` · ${ignorados.length} sessão(ões) longa(s) ignorada(s)` : ""}. Confira e salve pra aguardar a conciliação.</div>
              <div className="flex gap-2">
                <button type="button" onClick={() => { setCaixas([]); setTxs(null); setRedeNome(""); setIfood(null); setIfoodNome(""); }} className="text-[12px] text-gray-500 hover:underline px-1">descartar</button>
                <Button size="sm" disabled={salvando || visiveis.length === 0} onClick={() => void salvar()}>{salvando ? "Salvando…" : "💾 Salvar na lista"}</Button>
              </div>
            </div>
            {ignorados.length > 0 && (
              <div className="text-[11px] text-gray-400">Ignorados (sessão de vários dias): {ignorados.map((c) => `${c.id ? `#${c.id} ` : ""}${fmtData(c.data)}`).join(", ")}</div>
            )}
            <div className="space-y-2">
              {visiveis.map(({ c, i }) => <LinhaCaixa key={i} titulo={titulo(c, i)} sub={janela(i)} g={resultado.porCaixa[i]} onClick={() => setModal({ titulo: titulo(c, i), sub: janela(i), g: resultado.porCaixa[i], kind: "preview" })} />)}
              {resultado.aberto.total > 0 && <LinhaCaixa amber titulo="Caixa em aberto (não fechado)" sub={`após o último corte — não é salvo até fechar`} g={resultado.aberto} onClick={() => setModal({ titulo: "Caixa em aberto (não fechado)", sub: `vendas após o último corte (${fmtData(cortes[cortes.length - 1].data)} ${cortes[cortes.length - 1].hora.slice(0, 5)})`, g: resultado.aberto, kind: "preview" })} />}
            </div>
          </div>
        );
      })()}

      {/* Lista persistida — Pendentes (aguardando conciliação) */}
      {!resultado && pendentesSalvos.length === 0 && conciliadosSalvos.length === 0 && (
        <div className="text-center text-sm text-gray-400 py-10">Envie o print dos caixas <strong>e</strong> a planilha da Rede pra montar a conciliação por caixa.</div>
      )}

      {pendentesSalvos.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Aguardando conciliação <span className="text-gray-400 font-normal">({pendentesSalvos.length})</span></h3>
          <p className="text-[12px] text-gray-500">Toque num caixa pra ver o detalhe e marcar <strong>Conciliado na Altec</strong>. Dinheiro e o PIX do balcão não vêm da Rede.</p>
          {pendentesSalvos.map((s) => (
            <LinhaCaixa key={s.id} titulo={tituloSalvo(s)} sub={janelaSalvo(s)} g={totaisDe(s)} onClick={() => setModal({ titulo: tituloSalvo(s), sub: janelaSalvo(s), g: totaisDe(s), kind: "pendente", item: s })} />
          ))}
        </div>
      )}

      {/* Histórico de conciliados */}
      {conciliadosSalvos.length > 0 && (
        <details className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">✅ Conciliados na Altec <span className="text-gray-400 font-normal">({conciliadosSalvos.length})</span></summary>
          <div className="px-3 pb-3 space-y-2">
            {conciliadosSalvos.map((s) => (
              <LinhaCaixa key={s.id} titulo={tituloSalvo(s)} sub={`✓ ${s.conciliadoEm ? fmtDataHora(s.conciliadoEm) : ""}${s.conciliadoPor?.nome ? ` · ${s.conciliadoPor.nome}` : ""}`} g={totaisDe(s)} onClick={() => setModal({ titulo: tituloSalvo(s), sub: janelaSalvo(s), g: totaisDe(s), kind: "conciliado", item: s })} />
            ))}
          </div>
        </details>
      )}

      {modal && (
        <Modal title={`💳 ${modal.titulo}`} onClose={() => setModal(null)} maxWidth="max-w-lg">
          <div className="space-y-3">
            {modal.sub && <div className="text-[12px] text-gray-400">{modal.sub}</div>}
            <Breakdown g={modal.g} />
            <div className="flex justify-end items-center gap-3 pt-2">
              {modal.kind === "pendente" && (<>
                {podeConfig && modal.item && <button type="button" onClick={() => { const it = modal.item!; setModal(null); void removerSalvo(it); }} className="text-[12px] text-rose-600 hover:underline px-1">remover</button>}
                <button type="button" onClick={() => { const it = modal.item!; setModal(null); void conciliarSalvo(it); }}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  Conciliado na Altec
                </button>
              </>)}
              {modal.kind === "conciliado" && modal.item && <button type="button" onClick={() => { const it = modal.item!; setModal(null); void desconciliarSalvo(it); }} className="text-[12px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:underline px-1">↩ Desfazer conciliação</button>}
              <Button size="sm" variant="secondary" onClick={() => setModal(null)}>Fechar</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Configurações: pasta do Drive + sócios ─────────────────────────────────
function FechamentoConfig({ rid, restaurant }: { rid: string; restaurant: { nome?: string; fechamentoDriveFolderId?: string; fechamentoDriveFolderNome?: string; fechamentoSociosEmails?: string[]; fechamentoSociosWhatsapp?: string[]; fechamentoEmailRemetente?: string; fechamentoComandas?: ComandaCadastro[]; fechamentoTemIfood?: boolean; fechamentoPedirObsTurno?: boolean } }) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [temIfood, setTemIfood] = useState(!!restaurant.fechamentoTemIfood);
  async function salvarTemIfood(v: boolean) {
    setTemIfood(v);
    try { await updateDoc(doc(db, "restaurants", rid), { fechamentoTemIfood: v }); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falha ao salvar."); }
  }
  const [pedirObs, setPedirObs] = useState(!!restaurant.fechamentoPedirObsTurno);
  async function salvarPedirObs(v: boolean) {
    setPedirObs(v);
    try { await updateDoc(doc(db, "restaurants", rid), { fechamentoPedirObsTurno: v }); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falha ao salvar."); }
  }
  const [central, setCentral] = useState<boolean | null>(null);
  const [destino, setDestino] = useState("");
  const [emails, setEmails] = useState<string[]>(restaurant.fechamentoSociosEmails || []);
  const [novoEmail, setNovoEmail] = useState("");
  const [zaps, setZaps] = useState<string[]>(restaurant.fechamentoSociosWhatsapp || []);
  const [novoZap, setNovoZap] = useState("");
  const [remetente, setRemetente] = useState(restaurant.fechamentoEmailRemetente || "");
  const [remetenteMsg, setRemetenteMsg] = useState("");
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
  async function salvarZaps(lista: string[]) {
    setZaps(lista);
    try { await updateDoc(doc(db, "restaurants", rid), { fechamentoSociosWhatsapp: lista.length ? lista : deleteField() }); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falha ao salvar os números."); }
  }
  function addZap() {
    const d = novoZap.replace(/\D/g, "");
    if (d.length < 10) { setErro("Número inválido — inclua DDD."); return; }
    if (zaps.includes(d)) { setNovoZap(""); return; }
    setErro(""); setNovoZap("");
    void salvarZaps([...zaps, d]);
  }
  const fmtZap = (d: string) => { const n = d.startsWith("55") ? d.slice(2) : d; return n.length >= 10 ? `+55 ${n.slice(0, 2)} ${n.slice(2, n.length - 4)}-${n.slice(-4)}` : d; };
  async function salvarRemetente() {
    setRemetenteMsg("");
    try {
      await updateDoc(doc(db, "restaurants", rid), { fechamentoEmailRemetente: remetente.trim() || deleteField() });
      setRemetenteMsg("✓ Remetente salvo.");
    } catch (e) { setRemetenteMsg("❌ " + (e instanceof Error ? e.message : "Erro")); }
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

        <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
          <h4 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Sócios que recebem por WhatsApp <span className="font-normal text-gray-400 text-xs">— opcional</span></h4>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">Além do email, o mesmo aviso pode ir por WhatsApp pra estes números. (Dispara quando o modelo <code>aviso_fechamento</code> for aprovado pela Meta.)</p>
          {zaps.length > 0 && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 mb-2">
              {zaps.map((z) => (
                <div key={z} className="px-3 py-1.5 text-sm flex items-center gap-2">
                  <span className="flex-1 truncate">💬 {fmtZap(z)}</span>
                  <button type="button" className="text-[11px] text-gray-500 hover:text-rose-600" onClick={() => void salvarZaps(zaps.filter((x) => x !== z))}>remover</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input value={novoZap} onChange={(e) => setNovoZap(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addZap(); }} placeholder="(11) 99999-9999" inputMode="tel"
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
            <Button variant="secondary" size="sm" onClick={addZap}>+ Adicionar</Button>
          </div>
        </div>
        <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Email remetente <span className="font-normal text-gray-400">— opcional (override)</span></label>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">Padrão: <code>"{restaurant.nome || "Restaurante"}" &lt;caixa@planejamento.app&gt;</code> (o destinatário vê o nome do restaurante). Só preencha se quiser outro remetente — o domínio precisa estar <strong>verificado na Resend</strong>.</p>
          <div className="flex gap-2 items-center">
            <input value={remetente} onChange={(e) => setRemetente(e.target.value)} placeholder="Nome <email@dominio.com.br>"
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
            <Button variant="secondary" size="sm" onClick={() => void salvarRemetente()}>Salvar</Button>
            {remetenteMsg && <span className="text-[11px]">{remetenteMsg}</span>}
          </div>
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

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">iFood</h3>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={temIfood} onChange={(e) => void salvarTemIfood(e.target.checked)} className="w-4 h-4 accent-rose-600" />
          <span className="text-sm text-gray-700 dark:text-gray-300">Este restaurante tem iFood</span>
        </label>
        <p className="text-sm text-gray-500 dark:text-gray-400">Quando marcado, a aba <strong>Conciliação de Cartões</strong> passa a aceitar também a planilha de pedidos do iFood, somando os pedidos concluídos por caixa pra você conferir na Altec.</p>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Observação do turno</h3>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={pedirObs} onChange={(e) => void salvarPedirObs(e.target.checked)} className="w-4 h-4 accent-indigo-600" />
          <span className="text-sm text-gray-700 dark:text-gray-300">Pedir observação do turno ao fechar o caixa</span>
        </label>
        <p className="text-sm text-gray-500 dark:text-gray-400">Quando marcado, ao fechar o caixa o app compara o faturamento com a média daquele dia da semana e turno. Se ficou <strong>dentro do normal</strong>, basta um toque em "Foi tudo normal". Se veio <strong>acima ou abaixo</strong>, pede uma observação curta do que aconteceu (chuva, evento, grupo grande, problema…) — pra alimentar a análise depois.</p>
      </div>
    </div>
  );
}

// ─── Tabela de fechamentos ──────────────────────────────────────────────────
function FechamentoTabela({ fechamentos, podeEditar, podeConfig, onExcluir, onConferir }: {
  fechamentos: FechamentoCaixa[];
  podeEditar: boolean;
  podeConfig: boolean;
  onExcluir: (f: FechamentoCaixa) => void;
  onConferir?: (f: FechamentoCaixa) => void;
}) {
  const [detalhe, setDetalhe] = useState<FechamentoCaixa | null>(null);
  const [editar, setEditar] = useState<FechamentoCaixa | null>(null);
  const temAcoes = !!onConferir || podeConfig;
  if (fechamentos.length === 0) {
    return <div className="text-center text-sm text-gray-400 py-12">Tudo conferido! Nenhum fechamento pendente.</div>;
  }
  return (
    <>
      {/* Desktop: tabela */}
      <div className="hidden sm:block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-200 dark:border-gray-800">
              <th className="px-4 py-2.5 font-medium">Data / turno</th>
              <th className="px-4 py-2.5 font-medium text-right">Total vendas</th>
              <th className="px-4 py-2.5 font-medium">Lacre</th>
              <th className="px-4 py-2.5 font-medium">Fechou</th>
              <th className="px-4 py-2.5 font-medium">Obs.</th>
              <th className="px-4 py-2.5 font-medium text-center">Pasta</th>
              {temAcoes && <th className="px-4 py-2.5 font-medium text-right">Ações</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {fechamentos.map((f) => (
              <tr key={f.id} className="group hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                {/* Data / turno — clicável abre detalhes */}
                <td className="px-4 py-3">
                  <button type="button" onClick={() => setDetalhe(f)} className="flex flex-col items-start text-left group/btn">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold text-gray-800 dark:text-gray-100 tabular-nums group-hover/btn:text-indigo-600 dark:group-hover/btn:text-indigo-400">{fmtData(f.data)}</span>
                      <span className="inline-flex items-center rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-[11px] font-medium px-2 py-0.5">{TURNO_CAIXA_LABEL[f.turno]}</span>
                    </span>
                    <span className="text-[11px] text-gray-400 tabular-nums mt-0.5">fechado {fmtDataHora(f.fechadoEm)}</span>
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <button type="button" onClick={() => setDetalhe(f)} className="tabular-nums font-semibold text-gray-800 dark:text-gray-100 hover:text-indigo-600 dark:hover:text-indigo-400">{fmtBRL(f.totalVendas)}</button>
                </td>
                <td className="px-4 py-3 tabular-nums text-gray-500">{f.numeroLacre || "—"}</td>
                <td className="px-4 py-3 text-gray-500 max-w-[140px] truncate" title={f.fechadoPor?.nome || ""}>{f.fechadoPor?.nome || "—"}</td>
                <td className="px-4 py-3 max-w-[200px] truncate text-gray-600 dark:text-gray-300" title={f.observacao || ""}>{f.observacao || "—"}</td>
                <td className="px-4 py-3 text-center">
                  {f.driveFolderUrl ? (
                    <a href={f.driveFolderUrl} target="_blank" rel="noreferrer" title="Abrir pasta no Drive"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors">
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></svg>
                    </a>
                  ) : <span className="text-gray-300">—</span>}
                </td>
                {temAcoes && (
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {onConferir && (
                        <button type="button" onClick={() => setDetalhe(f)} title="Abrir pra conferir"
                          className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg text-[12px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors">
                          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                          Conferir
                        </button>
                      )}
                      {podeConfig && (
                        <button type="button" onClick={() => onExcluir(f)} title="Excluir fechamento"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100">
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile: cards */}
      <div className="sm:hidden space-y-2">
        {fechamentos.map((f) => (
          <div key={f.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
            <button type="button" onClick={() => setDetalhe(f)} className="w-full flex items-start justify-between gap-3 text-left">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-800 dark:text-gray-100 tabular-nums">{fmtData(f.data)}</span>
                  <span className="inline-flex items-center rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-[11px] font-medium px-2 py-0.5">{TURNO_CAIXA_LABEL[f.turno]}</span>
                </div>
                <div className="text-[11px] text-gray-400 tabular-nums mt-0.5">fechado {fmtDataHora(f.fechadoEm)}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-base font-bold text-gray-800 dark:text-gray-100 tabular-nums">{fmtBRL(f.totalVendas)}</div>
                <div className="text-[10px] uppercase tracking-wide text-gray-400">vendas</div>
              </div>
            </button>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-[12px] text-gray-500">
              <div className="flex flex-col gap-0.5 min-w-0">
                {f.fechadoPor?.nome && <span className="truncate">👤 {f.fechadoPor.nome}</span>}
                {f.numeroLacre && <span className="tabular-nums">🔒 {f.numeroLacre}</span>}
                {f.observacao && <span className="truncate text-gray-400 italic">{f.observacao}</span>}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {onConferir && (
                  <button type="button" onClick={() => setDetalhe(f)} title="Abrir pra conferir"
                    className="inline-flex items-center gap-1 px-3 h-9 rounded-lg text-[13px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 active:bg-emerald-100 transition-colors">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                    Conferir
                  </button>
                )}
                {f.driveFolderUrl && (
                  <a href={f.driveFolderUrl} target="_blank" rel="noreferrer" title="Abrir pasta no Drive"
                    className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-gray-500 bg-gray-50 dark:bg-gray-800 hover:text-indigo-600 active:bg-indigo-50 transition-colors">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></svg>
                  </a>
                )}
                {podeConfig && (
                  <button type="button" onClick={() => onExcluir(f)} title="Excluir fechamento"
                    className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-gray-400 bg-gray-50 dark:bg-gray-800 hover:text-rose-600 active:bg-rose-50 transition-colors">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {detalhe && <DetalheFechamentoModal f={detalhe} podeEditar={podeEditar} onClose={() => setDetalhe(null)} onEditar={(x) => { setDetalhe(null); setEditar(x); }} onConferir={onConferir} />}
      {editar && <EditarFechamentoModal f={editar} onClose={() => setEditar(null)} onSaved={() => setEditar(null)} />}
    </>
  );
}

function DetalheFechamentoModal({ f, podeEditar, onClose, onEditar, onConferir }: { f: FechamentoCaixa; podeEditar: boolean; onClose: () => void; onEditar: (f: FechamentoCaixa) => void; onConferir?: (f: FechamentoCaixa) => void }) {
  const linha = (k: string, v?: string | null) => (v != null && v !== "") ? (
    <div className="flex justify-between gap-3 py-1 border-b border-gray-100 dark:border-gray-800 text-sm"><span className="text-gray-500 dark:text-gray-400">{k}</span><span className="text-right text-gray-800 dark:text-gray-200 break-all">{v}</span></div>
  ) : null;
  return (
    <Modal title="💵 Detalhes do fechamento" onClose={onClose} maxWidth="max-w-3xl">
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
          <MaquininhasView maquininhas={f.maquininhas} creditoAltec={f.credito} debitoAltec={f.debito} pixAltec={f.pix} />
        </div>
      )}
      {f.comandas && f.comandas.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Comandas / cortesias ({f.comandas.length})</div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {f.comandas.map((c, i) => (
              <div key={i} className="px-2 py-1 text-[11px] flex items-center gap-2">
                <span className="flex-1 truncate">📋 {c.nome ? `${c.nome} (${c.numero})` : `Comanda ${c.numero}`}</span>
                <span className="shrink-0 tabular-nums font-medium">{c.valor != null ? fmtBRL(c.valor) : "—"}</span>
              </div>
            ))}
            <div className="px-2 py-1 text-[11px] flex items-center justify-between font-semibold bg-gray-50 dark:bg-gray-800/40">
              <span>Total consumido</span><span className="tabular-nums">{fmtBRL(f.comandas.reduce((s, c) => s + (c.valor || 0), 0))}</span>
            </div>
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
      {f.conferidoEm && (
        <div className="mt-3 text-[12px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-900/40 rounded-lg px-3 py-2">✓ Conferido em {fmtDataHora(f.conferidoEm)}{f.conferidoPor?.nome ? ` por ${f.conferidoPor.nome}` : ""}</div>
      )}
      <div className="flex justify-end items-center gap-2 pt-3">
        {f.driveFolderUrl && <a href={f.driveFolderUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300">↗ Abrir pasta no Drive</a>}
        {podeEditar && <Button size="sm" variant="secondary" onClick={() => onEditar(f)}>✏️ Editar</Button>}
        <Button size="sm" variant="secondary" onClick={onClose}>Fechar</Button>
        {onConferir && !f.conferidoEm && (
          <button type="button" onClick={() => { onConferir(f); onClose(); }}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            Conferir
          </button>
        )}
      </div>
    </Modal>
  );
}

function EditarFechamentoModal({ f, onClose, onSaved }: { f: FechamentoCaixa; onClose: () => void; onSaved: () => void }) {
  const toBR = (v?: number) => v == null ? "" : String(v).replace(".", ",");
  const [totalVendas, setTotalVendas] = useState(toBR(f.totalVendas));
  const [dinheiro, setDinheiro] = useState(toBR(f.dinheiro));
  const [pix, setPix] = useState(toBR(f.pix));
  const [credito, setCredito] = useState(toBR(f.credito));
  const [debito, setDebito] = useState(toBR(f.debito));
  const [fundoCaixa, setFundoCaixa] = useState(toBR(f.fundoCaixa));
  const [numeroLacre, setNumeroLacre] = useState(f.numeroLacre || "");
  const [observacao, setObservacao] = useState(f.observacao || "");
  const [data, setData] = useState(f.data);
  const [turno, setTurno] = useState<TurnoCaixa>(f.turno);
  const [maquininhas, setMaquininhas] = useState<MaquininhaFechamento[]>((f.maquininhas || []).map((m) => ({ ...m })));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const inputCls = "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";
  async function salvar() {
    setErro(""); setSalvando(true);
    try {
      const maqClean = maquininhas
        .filter((m) => m.identificador || m.credito != null || m.debito != null || m.pix != null || m.total != null)
        .map((m) => ({
          ...(m.identificador ? { identificador: m.identificador } : {}),
          ...(m.credito != null ? { credito: m.credito } : {}),
          ...(m.debito != null ? { debito: m.debito } : {}),
          ...(m.pix != null ? { pix: m.pix } : {}),
          ...(m.total != null ? { total: m.total } : {}),
        }));
      await updateDoc(doc(db, "fechamentosCaixa", f.id), {
        data, turno,
        totalVendas: parseBRL(totalVendas) ?? deleteField(),
        dinheiro: parseBRL(dinheiro) ?? deleteField(),
        pix: parseBRL(pix) ?? deleteField(),
        credito: parseBRL(credito) ?? deleteField(),
        debito: parseBRL(debito) ?? deleteField(),
        fundoCaixa: parseBRL(fundoCaixa) ?? deleteField(),
        numeroLacre: numeroLacre.trim() || deleteField(),
        observacao: observacao.trim() || deleteField(),
        maquininhas: maqClean.length ? maqClean : deleteField(),
      });
      onSaved();
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao salvar."); }
    finally { setSalvando(false); }
  }
  return (
    <Modal title="✏️ Editar fechamento" onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        {erro && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}
        <p className="text-[11px] text-gray-400">Os anexos no Drive não mudam — aqui você corrige os dados e pode lançar uma maquininha que faltou na foto.</p>
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
          <div><label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Total de vendas</label><input value={totalVendas} onChange={(e) => setTotalVendas(e.target.value)} onBlur={() => setTotalVendas(fmtMilhar)} inputMode="decimal" className={inputCls} /></div>
          <div><label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Dinheiro</label><input value={dinheiro} onChange={(e) => setDinheiro(e.target.value)} onBlur={() => setDinheiro(fmtMilhar)} inputMode="decimal" className={inputCls} /></div>
          <div><label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">PIX</label><input value={pix} onChange={(e) => setPix(e.target.value)} onBlur={() => setPix(fmtMilhar)} inputMode="decimal" className={inputCls} /></div>
          <div><label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Crédito</label><input value={credito} onChange={(e) => setCredito(e.target.value)} onBlur={() => setCredito(fmtMilhar)} inputMode="decimal" className={inputCls} /></div>
          <div><label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Débito</label><input value={debito} onChange={(e) => setDebito(e.target.value)} onBlur={() => setDebito(fmtMilhar)} inputMode="decimal" className={inputCls} /></div>
          <div><label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Fundo de caixa</label><input value={fundoCaixa} onChange={(e) => setFundoCaixa(e.target.value)} onBlur={() => setFundoCaixa(fmtMilhar)} inputMode="decimal" className={inputCls} /></div>
          <div><label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Nº do lacre</label><input value={numeroLacre} onChange={(e) => setNumeroLacre(e.target.value)} className={inputCls} /></div>
        </div>

        {/* Maquininhas — editáveis + adicionar a que faltou */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Maquininhas</label>
            <Button variant="secondary" size="sm" onClick={() => setMaquininhas((prev) => [...prev, {}])}>+ Adicionar maquininha</Button>
          </div>
          {maquininhas.length > 0
            ? <MaquininhasView maquininhas={maquininhas} creditoAltec={parseBRL(credito)} debitoAltec={parseBRL(debito)} pixAltec={parseBRL(pix)}
                onRemove={(i) => setMaquininhas((prev) => prev.filter((_, j) => j !== i))}
                onEdit={(i, patch) => setMaquininhas((prev) => prev.map((m, j) => j === i ? { ...m, ...patch } : m))} />
            : <p className="text-[11px] text-gray-400">Nenhuma maquininha. Use "+ Adicionar maquininha" pra lançar a que faltou na foto.</p>}
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
