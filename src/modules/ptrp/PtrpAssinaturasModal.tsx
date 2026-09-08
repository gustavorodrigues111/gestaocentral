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
import { criarEnvelopeClicksign, statusEnvelopeClicksign } from "../../core/clicksign/clicksignClient";

export type AlvoAssinatura = { snap: PtrpApuracaoColab; whatsapp: string; email: string };
type Reg = { id: string; colaboradorId: string; nome?: string; status?: string; canal?: string; envelopeId?: string; documentId?: string | null; signedUrl?: string | null; enviadoEm?: string; assinadoEm?: string };

const blobToBase64 = (blob: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(blob); });
const soDig = (s?: string) => (s || "").replace(/\D/g, "");
const chip = (st?: string) => st === "assinado" ? { t: "✅ assinado", c: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" }
  : st === "enviado" ? { t: "📤 enviado", c: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" }
  : st === "erro" ? { t: "⚠ erro", c: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" }
  : { t: "⚪ não enviado", c: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" };

export function PtrpAssinaturasModal({ empresaKey, comp, compLabel, alvos, meta, autor, onClose }: { empresaKey: string; comp: string; compLabel: string; alvos: AlvoAssinatura[]; meta: EspelhoMeta; autor: { id: string; nome: string }; onClose: () => void }) {
  const [regs, setRegs] = useState<Reg[]>([]);
  const [aba, setAba] = useState<"enviar" | "status">("enviar");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

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
      const pend = regs.filter(r => r.status === "enviado" && r.envelopeId);
      for (const r of pend) {
        try {
          const st = await statusEnvelopeClicksign(r.envelopeId!);
          const docSigned = st.documents?.find(d => d.signedUrl);
          const assinado = /clos|finish|complet|sign/i.test(st.status || "") || !!docSigned;
          if (assinado) await updateDoc(doc(db, "ptrpEspelhoAssinaturas", r.id), sanitizeForFirestore({ status: "assinado", assinadoEm: new Date().toISOString(), signedUrl: docSigned?.signedUrl || null, documentId: docSigned?.id || r.documentId || null }));
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
                      <td className="text-right">{r?.signedUrl && <a href={r.signedUrl} target="_blank" rel="noreferrer" className="text-[11px] text-emerald-600 hover:underline">ver assinado</a>}</td>
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
