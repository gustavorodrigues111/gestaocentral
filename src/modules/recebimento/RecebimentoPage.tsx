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
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfigurar, canVer } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import { Modal } from "../../core/ui/Modal";
import type { RecebimentoNota } from "../../core/types";
import { pickDriveFolder } from "../../core/google/drivePicker";
import { isDriveConnected, findOrCreateSubfolder, uploadFileToFolder } from "../../core/google/driveClient";
import { authHeader } from "../../core/firebase/idToken";

// Arquivo → base64 (sem o prefixo data:...;base64,).
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || "").split(",")[1] || "");
    r.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    r.readAsDataURL(file);
  });
}

const pad = (n: number) => String(n).padStart(2, "0");
const fmtBRL = (v?: number) => v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDataHora = (iso: string) => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtDataBR = (ymd?: string) => ymd ? ymd.split("-").reverse().join("/") : "—";

// Semana de segunda a domingo que contém a data, com rótulo "dd.mm.aa a dd.mm.aa".
function semanaDe(d: Date): { label: string } {
  const day = d.getDay();                 // 0=dom … 6=sáb
  const diffSeg = day === 0 ? -6 : 1 - day;
  const seg = new Date(d); seg.setDate(d.getDate() + diffSeg); seg.setHours(0, 0, 0, 0);
  const dom = new Date(seg); dom.setDate(seg.getDate() + 6);
  const f = (x: Date) => `${pad(x.getDate())}.${pad(x.getMonth() + 1)}.${String(x.getFullYear()).slice(2)}`;
  return { label: `${f(seg)} a ${f(dom)}` };
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
  const podeVer = canVer(me, rid, "recebimento");
  const podeConfig = canConfigurar(me, rid, "recebimento");

  const [tab, setTab] = useState<"lista" | "config">("lista");
  const [notas, setNotas] = useState<RecebimentoNota[]>([]);
  const [novo, setNovo] = useState(false);
  const [erro, setErro] = useState("");

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

  async function excluir(n: RecebimentoNota) {
    if (!window.confirm(`Excluir o recebimento de ${n.emissor || "nota sem emissor"} (${fmtDataHora(n.recebidoEm)})?\n\nO arquivo no Drive NÃO é apagado.`)) return;
    try { await deleteDoc(doc(db, "recebimentos", n.id)); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falha ao excluir."); }
  }

  if (!restaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (!podeVer) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-600 dark:text-gray-400">Você não tem acesso ao Recebimento.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-4">
      {/* Abas */}
      <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-800">
        <button type="button" onClick={() => setTab("lista")}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === "lista" ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-gray-500"}`}>
          📋 Recebimentos
        </button>
        {podeConfig && (
          <button type="button" onClick={() => setTab("config")}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === "config" ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-gray-500"}`}>
            ⚙️ Configurações
          </button>
        )}
        {tab === "lista" && (
          <div className="ml-auto">
            <Button size="sm" onClick={() => { setErro(""); setNovo(true); }}>+ Novo recebimento</Button>
          </div>
        )}
      </div>

      {erro && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}

      {tab === "config" && podeConfig && <RecebimentoConfig rid={rid} restaurant={restaurant} />}

      {tab === "lista" && (
        <RecebimentoTabela notas={ordenadas} podeConfig={podeConfig} onExcluir={excluir} />
      )}

      {novo && (
        <NovoRecebimentoModal
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

// ─── Configurações: pasta do Drive ──────────────────────────────────────────
function RecebimentoConfig({ rid, restaurant }: { rid: string; restaurant: { recebimentoDriveFolderId?: string; recebimentoDriveFolderNome?: string } }) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

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

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3 max-w-2xl">
      <h3 className="font-semibold text-gray-900 dark:text-gray-100">Pasta do Drive pras notas</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        As notas recebidas são arquivadas aqui. O sistema cria automaticamente subpastas por semana (segunda→domingo), nomeadas <code>dd.mm.aa a dd.mm.aa</code>.
      </p>
      {erro && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}
      <div className="flex items-center gap-3">
        <div className="flex-1 text-sm">
          {restaurant.recebimentoDriveFolderId
            ? <span className="text-emerald-700 dark:text-emerald-300">📁 {restaurant.recebimentoDriveFolderNome || "pasta selecionada"}</span>
            : <span className="text-amber-600">Nenhuma pasta selecionada</span>}
        </div>
        <Button variant="secondary" size="sm" disabled={salvando} onClick={() => void escolherPasta()}>
          {salvando ? "Salvando…" : restaurant.recebimentoDriveFolderId ? "Trocar pasta" : "Selecionar pasta"}
        </Button>
      </div>
    </div>
  );
}

// ─── Tabela de recebimentos ─────────────────────────────────────────────────
function RecebimentoTabela({ notas, podeConfig, onExcluir }: {
  notas: RecebimentoNota[];
  podeConfig: boolean;
  onExcluir: (n: RecebimentoNota) => void;
}) {
  if (notas.length === 0) {
    return <div className="text-center text-sm text-gray-400 py-12">Nenhum recebimento ainda. Clique em <strong>+ Novo recebimento</strong>.</div>;
  }
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-200 dark:border-gray-800">
            <th className="px-3 py-2">Recebido em</th>
            <th className="px-3 py-2">Emissão</th>
            <th className="px-3 py-2">Emissor</th>
            <th className="px-3 py-2 text-right">Valor</th>
            <th className="px-3 py-2">Recebeu</th>
            <th className="px-3 py-2">Conforme?</th>
            <th className="px-3 py-2">Divergência</th>
            <th className="px-3 py-2">Nota</th>
            {podeConfig && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {notas.map((n) => (
            <tr key={n.id} className={n.conforme ? "" : "bg-rose-50/50 dark:bg-rose-950/10"}>
              <td className="px-3 py-2 whitespace-nowrap tabular-nums">{fmtDataHora(n.recebidoEm)}</td>
              <td className="px-3 py-2 whitespace-nowrap tabular-nums text-gray-500">{fmtDataBR(n.dataEmissao)}</td>
              <td className="px-3 py-2">{n.emissor || "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtBRL(n.valorTotal)}</td>
              <td className="px-3 py-2 text-gray-500">{n.recebidoPor?.nome || "—"}</td>
              <td className="px-3 py-2">
                {n.conforme
                  ? <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">✓ Sim</span>
                  : <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">⚠ Não</span>}
              </td>
              <td className="px-3 py-2 max-w-[220px] truncate text-gray-600 dark:text-gray-300" title={n.divergencia || ""}>{n.conforme ? "—" : (n.divergencia || "—")}</td>
              <td className="px-3 py-2">
                {n.notaDriveUrl
                  ? <a href={n.notaDriveUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline whitespace-nowrap">abrir ↗</a>
                  : "—"}
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
  );
}

// ─── Modal: novo recebimento ────────────────────────────────────────────────
function NovoRecebimentoModal({ rid, restaurant, por, onClose, onSalvo }: {
  rid: string;
  restaurant: { recebimentoDriveFolderId?: string };
  por: { id: string; nome: string };
  onClose: () => void;
  onSalvo: () => void;
}) {
  const [notaFile, setNotaFile] = useState<File | null>(null);
  const [conforme, setConforme] = useState(true);
  const [divergencia, setDivergencia] = useState("");
  const [fotoDivFile, setFotoDivFile] = useState<File | null>(null);
  const [emissor, setEmissor] = useState("");
  const [valor, setValor] = useState("");
  const [dataEmissao, setDataEmissao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [lendo, setLendo] = useState(false);
  const [leuOcr, setLeuOcr] = useState(false);
  const [ocrErro, setOcrErro] = useState("");
  const [erro, setErro] = useState("");

  // Ao anexar a nota: arquiva no state e dispara o OCR (Haiku) pra pré-preencher
  // os campos. O usuário SEMPRE confere/corrige antes de salvar.
  async function lerNota(file: File) {
    setLendo(true); setLeuOcr(false); setOcrErro("");
    try {
      const data = await fileToBase64(file);
      const resp = await fetch("/api/ocr-nota", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ data, mediaType: file.type || "image/jpeg" }),
      });
      const j = await resp.json().catch(() => ({}));
      if (resp.ok) {
        if (j.emissor) setEmissor(j.emissor);
        if (j.valorTotal != null) setValor(String(j.valorTotal).replace(".", ","));
        if (j.dataEmissao) setDataEmissao(j.dataEmissao);
        setLeuOcr(true);
      } else {
        setOcrErro((j as { error?: string }).error || `Leitura indisponível (HTTP ${resp.status}).`);
      }
    } catch (e) {
      setOcrErro(e instanceof Error ? e.message : "Falha ao chamar o leitor de nota.");
    } finally { setLendo(false); }
  }
  function aoAnexar(f: File) { setNotaFile(f); void lerNota(f); }

  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  async function salvar() {
    setErro("");
    if (!notaFile) { setErro("Anexe a nota (foto ou PDF)."); return; }
    if (!conforme && !divergencia.trim()) { setErro("Descreva a divergência."); return; }
    if (!restaurant.recebimentoDriveFolderId) { setErro("Configure a pasta do Drive em Configurações antes de receber."); return; }
    if (!isDriveConnected()) { setErro("Conecte o Google Drive (nas Configurações do app) pra arquivar a nota."); return; }
    setSalvando(true);
    try {
      const agora = new Date();
      const recebidoEm = agora.toISOString();
      const { label } = semanaDe(agora);
      const semanaId = await findOrCreateSubfolder(restaurant.recebimentoDriveFolderId, label);
      const baseNome = `${pad(agora.getDate())}.${pad(agora.getMonth() + 1)} ${(emissor || "nota").replace(/[\\/]/g, "-")} ${pad(agora.getHours())}h${pad(agora.getMinutes())}`;
      const extNota = (notaFile.name.match(/\.[a-z0-9]+$/i) || [""])[0] || (notaFile.type.includes("pdf") ? ".pdf" : ".jpg");
      const subidaNota = await uploadFileToFolder(semanaId, new File([notaFile], `${baseNome}${extNota}`, { type: notaFile.type }));
      let fotoDiv: { id: string; url?: string } | null = null;
      if (!conforme && fotoDivFile) {
        const extFoto = (fotoDivFile.name.match(/\.[a-z0-9]+$/i) || [".jpg"])[0];
        const s = await uploadFileToFolder(semanaId, new File([fotoDivFile], `${baseNome} - divergencia${extFoto}`, { type: fotoDivFile.type }));
        fotoDiv = { id: s.id, url: s.webViewLink };
      }
      const nota: Omit<RecebimentoNota, "id"> = {
        restaurantId: rid,
        recebidoEm,
        recebidoPor: por,
        conforme,
        semanaLabel: label,
        notaDriveFileId: subidaNota.id,
        notaNome: `${baseNome}${extNota}`,
        ...(subidaNota.webViewLink ? { notaDriveUrl: subidaNota.webViewLink } : {}),
        ...(emissor.trim() ? { emissor: emissor.trim() } : {}),
        ...(parseBRL(valor) != null ? { valorTotal: parseBRL(valor) } : {}),
        ...(dataEmissao ? { dataEmissao } : {}),
        ...(!conforme && divergencia.trim() ? { divergencia: divergencia.trim() } : {}),
        ...(fotoDiv ? { fotoDivergenciaDriveFileId: fotoDiv.id, ...(fotoDiv.url ? { fotoDivergenciaUrl: fotoDiv.url } : {}) } : {}),
      };
      await addDoc(collection(db, "recebimentos"), nota);
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar o recebimento.");
    } finally { setSalvando(false); }
  }

  return (
    <Modal title="🧾 Novo recebimento" onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        {erro && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}

        {/* Anexar nota — câmera / galeria / PDF */}
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Nota fiscal</label>
          {notaFile ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="truncate flex-1">📎 {notaFile.name}</span>
              <button type="button" className="text-[11px] text-gray-500 hover:underline" onClick={() => setNotaFile(null)}>trocar</button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button type="button" onClick={() => camRef.current?.click()} className="flex-1 text-xs font-medium px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">📷 Câmera</button>
              <button type="button" onClick={() => galRef.current?.click()} className="flex-1 text-xs font-medium px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">🖼️ Galeria</button>
              <button type="button" onClick={() => pdfRef.current?.click()} className="flex-1 text-xs font-medium px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">📄 PDF</button>
            </div>
          )}
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) aoAnexar(f); }} />
          <input ref={galRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) aoAnexar(f); }} />
          <input ref={pdfRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) aoAnexar(f); }} />
          {lendo && <p className="text-[11px] text-indigo-600 dark:text-indigo-300 mt-1">🔍 Lendo a nota… os campos abaixo vão ser pré-preenchidos (confira antes de salvar).</p>}
          {leuOcr && !lendo && <p className="text-[11px] text-emerald-600 dark:text-emerald-300 mt-1">✓ Li a nota e pré-preenchi os campos — <strong>confira/corrija</strong> antes de salvar.</p>}
          {ocrErro && !lendo && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">⚠ Não consegui ler a nota automaticamente ({ocrErro}). Preencha os campos manualmente.</p>}
        </div>

        {/* Dados da nota (OCR vai pré-preencher na Fase 2) */}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-0.5">Emissor</label>
            <input value={emissor} onChange={(e) => setEmissor(e.target.value)} placeholder="Fornecedor / emissor da nota"
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

        {/* Conformidade */}
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

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" disabled={salvando} onClick={onClose}>Cancelar</Button>
          <Button size="sm" disabled={salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar recebimento"}</Button>
        </div>
      </div>
    </Modal>
  );
}
