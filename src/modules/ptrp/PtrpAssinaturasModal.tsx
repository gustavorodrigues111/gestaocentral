// ════════════════════════════════════════════════════════════════════════════
//  PTRP · Coleta de assinaturas dos espelhos (ClickSign).
//  Depois do mês FECHADO, dispara o espelho de cada colaborador pro ClickSign
//  (WhatsApp + email do cadastro). O empregado assina; ao abrir o modal o app
//  consulta o status (sem webhook — org bloqueia) e marca "assinado".
//
//  Coleção ptrpEspelhoAssinaturas/{empresa}_{comp}_{colaborador}.
//  Aba Enviar (seleciona quem) + aba Status (situação por colaborador no mês).
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { gerarEspelhoPDF, type EspelhoMeta } from "../../core/ptrp/espelhoPDF";
import type { PtrpApuracaoColab } from "../../core/ptrp/tipos";
import { criarEnvelopeClicksign, statusEnvelopeClicksign, baixarAssinadoClicksign } from "../../core/clicksign/clicksignClient";
import { pickDriveFolder } from "../../core/google/drivePicker";
import { findOrCreateSubfolder, uploadFileToFolder, isDriveConnected } from "../../core/google/driveClient";

export type AlvoAssinatura = { snap: PtrpApuracaoColab; whatsapp: string; email: string };
type Reg = { id: string; colaboradorId: string; nome?: string; status?: string; canal?: string; envelopeId?: string; documentId?: string | null; signedUrl?: string | null; driveUrl?: string | null; driveFileId?: string | null; enviadoEm?: string; assinadoEm?: string };

const blobToBase64 = (blob: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(blob); });
const b64ToFile = (b64: string, nome: string) => { const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return new File([arr], nome, { type: "application/pdf" }); };
const soDig = (s?: string) => (s || "").replace(/\D/g, "");
const chip = (st?: string) => st === "assinado" ? { t: "✅ assinado", c: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" }
  : st === "enviado" ? { t: "📤 enviado", c: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" }
  : st === "erro" ? { t: "⚠ erro", c: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" }
  : { t: "⚪ não enviado", c: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" };

export function PtrpAssinaturasModal({ empresaKey, comp, compLabel, restaurantId, driveFolderInit, alvos, meta, autor, onClose }: { empresaKey: string; comp: string; compLabel: string; restaurantId: string; driveFolderInit: { id?: string; nome?: string }; alvos: AlvoAssinatura[]; meta: EspelhoMeta; autor: { id: string; nome: string }; onClose: () => void }) {
  const [regs, setRegs] = useState<Reg[]>([]);
  const [aba, setAba] = useState<"enviar" | "status">("enviar");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [pasta, setPasta] = useState<{ id?: string; nome?: string }>(driveFolderInit);

  async function escolherPasta() {
    try {
      const p = await pickDriveFolder();
      if (!p) return;
      setPasta({ id: p.id, nome: p.name });
      await updateDoc(doc(db, "restaurants", restaurantId), { drivePontoAssinadoFolderId: p.id, drivePontoAssinadoFolderNome: p.name });
      setMsg(`✓ Pasta definida: ${p.name}`);
    } catch (e) { setMsg("Falha ao escolher pasta: " + (e instanceof Error ? e.message : "erro")); }
  }

  useEffect(() => onSnapshot(query(collection(db, "ptrpEspelhoAssinaturas"), where("empresaKey", "==", empresaKey), where("competencia", "==", comp)),
    s => setRegs(s.docs.map(d => ({ id: d.id, ...d.data() }) as Reg)), () => setRegs([])), [empresaKey, comp]);

  const regPorColab = useMemo(() => { const m: Record<string, Reg> = {}; for (const r of regs) m[r.colaboradorId] = r; return m; }, [regs]);

  // Seleção default = quem ainda não assinou.
  useEffect(() => { setSel(new Set(alvos.filter(a => regPorColab[a.snap.colaboradorId]?.status !== "assinado").map(a => a.snap.colaboradorId))); }, [alvos, regPorColab]);
  // Ao abrir → consulta o status dos que estão "enviado" (sem cron).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void atualizarStatus(); }, []);

  async function atualizarStatus() {
    setBusy("status");
    try {
      // Precisa arquivar quem já assinou mas ainda não subiu pro Drive.
      const pend = regs.filter(r => (r.status === "enviado" || (r.status === "assinado" && !r.driveUrl)) && r.envelopeId);
      for (const r of pend) {
        try {
          const st = await statusEnvelopeClicksign(r.envelopeId!);
          const docSigned = st.documents?.find(d => d.signedUrl);
          const assinado = r.status === "assinado" || /clos|finish|complet|sign/i.test(st.status || "") || !!docSigned;
          if (!assinado) continue;
          const documentId = docSigned?.id || r.documentId || null;
          let driveUrl = r.driveUrl || null, driveFileId = r.driveFileId || null;
          // Arquiva o assinado no Drive: {pasta escolhida}/Pontos assinados/{competência}.
          if (pasta.id && isDriveConnected() && documentId && !r.driveUrl) {
            try {
              const dl = await baixarAssinadoClicksign(r.envelopeId!, documentId);
              const base = await findOrCreateSubfolder(pasta.id, "Pontos assinados");
              const mes = await findOrCreateSubfolder(base, comp);
              const up = await uploadFileToFolder(mes, b64ToFile(dl.base64, `espelho-assinado-${comp}-${(r.nome || "colab").split(" ")[0].toLowerCase()}.pdf`));
              driveUrl = up.webViewLink || null; driveFileId = up.id || null;
            } catch { /* Drive off/erro → mantém só o link do ClickSign */ }
          }
          await updateDoc(doc(db, "ptrpEspelhoAssinaturas", r.id), sanitizeForFirestore({ status: "assinado", assinadoEm: r.assinadoEm || new Date().toISOString(), signedUrl: docSigned?.signedUrl || r.signedUrl || null, documentId, driveUrl, driveFileId }));
        } catch { /* ignora um envelope com erro pontual */ }
      }
    } finally { setBusy(""); }
  }

  async function enviar() {
    const escolhidos = alvos.filter(a => sel.has(a.snap.colaboradorId));
    if (!escolhidos.length) { setMsg("Selecione ao menos um colaborador."); return; }
    setBusy("enviar"); setMsg("");
    let ok = 0, fail = 0;
    for (const a of escolhidos) {
      const c = a.snap;
      try {
        if (!a.email && !a.whatsapp) throw new Error("sem WhatsApp nem email");
        const pdf = await gerarEspelhoPDF([c], meta);
        const base64 = await blobToBase64(pdf.output("blob"));
        const env = await criarEnvelopeClicksign({
          envelopeName: `Espelho de ponto — ${c.nome} — ${compLabel}`,
          signers: [{ name: c.nome, email: a.email || "", phone: a.whatsapp ? soDig(a.whatsapp) : undefined, documentation: soDig(c.cpf) || undefined }],
          docs: [{ filename: `espelho-${comp}-${c.nome.split(" ")[0].toLowerCase()}.pdf`, base64 }],
          message: `Olá ${c.nome.split(" ")[0]}, segue o seu espelho de ponto de ${compLabel} para conferência e assinatura. Qualquer divergência, fale com o DP.`,
          externalId: `${empresaKey}_${comp}_${c.colaboradorId}`,
        });
        await setDoc(doc(db, "ptrpEspelhoAssinaturas", `${empresaKey}_${comp}_${c.colaboradorId}`), sanitizeForFirestore({
          id: `${empresaKey}_${comp}_${c.colaboradorId}`, empresaKey, competencia: comp, colaboradorId: c.colaboradorId, cpf: soDig(c.cpf), nome: c.nome,
          envelopeId: env.envelopeId, documentId: null, status: "enviado",
          canal: a.whatsapp && a.email ? "whatsapp+email" : a.whatsapp ? "whatsapp" : "email",
          enviadoEm: new Date().toISOString(), enviadoPor: autor,
        }));
        ok++;
      } catch { fail++; }
    }
    setMsg(`✓ ${ok} enviado(s)${fail ? ` · ${fail} falha(s) (sem contato ou erro do ClickSign)` : ""}.`);
    setBusy(""); setAba("status");
  }

  const toggle = (id: string) => setSel(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selecionaveis = alvos.filter(a => regPorColab[a.snap.colaboradorId]?.status !== "assinado");

  return (
    <Modal title={`✍️ Assinatura dos espelhos · ${compLabel}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
          {(["enviar", "status"] as const).map(t => (
            <button key={t} type="button" onClick={() => setAba(t)} className={`px-3 py-1.5 text-sm font-semibold -mb-px border-b-2 ${aba === t ? "border-emerald-500 text-emerald-600 dark:text-emerald-300" : "border-transparent text-gray-500 hover:text-gray-700"}`}>{t === "enviar" ? "📤 Enviar" : "📋 Status"}</button>
          ))}
          <div className="flex-1" />
          <button type="button" onClick={() => void atualizarStatus()} disabled={!!busy} className="text-[11px] px-2 self-center text-gray-500 hover:text-gray-700 disabled:opacity-40">{busy === "status" ? "atualizando…" : "↻ atualizar status"}</button>
        </div>

        <div className="flex items-center gap-2 flex-wrap text-[11px] text-gray-500 bg-gray-50 dark:bg-gray-800/40 rounded-lg px-2.5 py-1.5">
          <span>📁 Pasta dos assinados: {pasta.nome ? <strong className="text-gray-700 dark:text-gray-200">{pasta.nome}</strong> : <span className="text-amber-600 dark:text-amber-400">não definida</span>}</span>
          <button type="button" onClick={() => void escolherPasta()} className="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline">{pasta.id ? "alterar" : "escolher pasta"}</button>
          {pasta.id && <span className="text-gray-400">→ Pontos assinados / {comp}</span>}
          {!isDriveConnected() && <span className="text-amber-600 dark:text-amber-400">· conecte o Drive (Configurações) pra arquivar</span>}
        </div>

        {aba === "enviar" ? (
          <>
            <div className="flex items-center justify-between gap-2 text-[11px] text-gray-500">
              <span>Envia o espelho por <strong>WhatsApp + email</strong> (do cadastro) via ClickSign. Já assinados não aparecem.</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSel(new Set(selecionaveis.map(a => a.snap.colaboradorId)))} className="hover:text-gray-700">todos</button>
                <button type="button" onClick={() => setSel(new Set())} className="hover:text-gray-700">nenhum</button>
              </div>
            </div>
            <div className="max-h-[46vh] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
              {selecionaveis.length === 0 && <div className="p-4 text-center text-[12px] text-gray-400">Todos já assinaram 🎉</div>}
              {selecionaveis.map(a => { const c = a.snap; const st = regPorColab[c.colaboradorId]?.status; const semContato = !a.email && !a.whatsapp; return (
                <label key={c.colaboradorId} className={`flex items-center gap-2 px-3 py-2 ${semContato ? "opacity-60" : "cursor-pointer"}`}>
                  <input type="checkbox" disabled={semContato} checked={sel.has(c.colaboradorId)} onChange={() => toggle(c.colaboradorId)} />
                  <span className="flex-1 min-w-0"><span className="text-[13px] font-medium text-gray-800 dark:text-gray-100 truncate">{c.nome}</span>
                    <span className="block text-[10.5px] text-gray-400">{a.whatsapp ? `📱 ${a.whatsapp}` : ""}{a.whatsapp && a.email ? " · " : ""}{a.email ? `✉️ ${a.email}` : ""}{semContato ? "sem WhatsApp nem email no cadastro" : ""}</span>
                  </span>
                  {st && <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${chip(st).c}`}>{chip(st).t}</span>}
                </label>
              ); })}
            </div>
            {msg && <div className={`text-[12px] ${msg.startsWith("✓") ? "text-emerald-600" : "text-rose-600"}`}>{msg}</div>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>Fechar</Button>
              <Button onClick={() => void enviar()} disabled={!!busy || sel.size === 0}>{busy === "enviar" ? "Enviando…" : `✍️ Enviar (${sel.size})`}</Button>
            </div>
          </>
        ) : (
          <>
            <div className="max-h-[52vh] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800">
              <table className="w-full text-[12px] [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2">
                <thead><tr className="text-[10px] uppercase text-gray-400 text-left border-b border-gray-200 dark:border-gray-800"><th className="py-1.5">Colaborador</th><th>Canal</th><th>Status</th><th>Assinado em</th><th></th></tr></thead>
                <tbody>
                  {alvos.map(a => { const r = regPorColab[a.snap.colaboradorId]; const st = r?.status; return (
                    <tr key={a.snap.colaboradorId} className="border-b border-gray-50 dark:border-gray-800/40">
                      <td className="font-medium text-gray-700 dark:text-gray-200 truncate">{a.snap.nome}</td>
                      <td className="text-gray-500">{r?.canal || "—"}</td>
                      <td><span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${chip(st).c}`}>{chip(st).t}</span></td>
                      <td className="text-gray-500 tabular-nums">{r?.assinadoEm ? new Date(r.assinadoEm).toLocaleDateString("pt-BR") : "—"}</td>
                      <td className="text-right whitespace-nowrap">{r?.driveUrl && <a href={r.driveUrl} target="_blank" rel="noreferrer" className="text-[11px] text-emerald-600 hover:underline mr-2">📁 Drive</a>}{r?.signedUrl && <a href={r.signedUrl} target="_blank" rel="noreferrer" className="text-[11px] text-gray-500 hover:underline">assinado</a>}</td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            </div>
            <div className="text-[11px] text-gray-400">O status é consultado ao abrir e no botão "↻ atualizar status" (o ClickSign não notifica automático aqui).</div>
            <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Fechar</Button></div>
          </>
        )}
      </div>
    </Modal>
  );
}
