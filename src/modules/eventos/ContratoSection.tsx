// Seção de CONTRATO do evento — gera o texto (modelo preenchido), permite
// editar, gera o PDF e (Fase 4) envia pra assinatura no ClickSign.
import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useAbrirWhatsapp } from "../../core/whatsapp/roteios";
import { criarEnvelopeClicksign, statusEnvelopeClicksign, CLICKSIGN_SANDBOX } from "../../core/clicksign/clicksignClient";
import type { LeadEvento, PropostaEvento } from "../../core/types";
import { montarContratoTexto } from "./contratoHelpers";

// Storage URL → base64 (sem estourar o stack em PDF grande).
async function urlParaBase64(url: string): Promise<string> {
  const buf = await (await fetch(url)).arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return btoa(bin);
}

export function ContratoSection({ lead, podeEditar }: { lead: LeadEvento; podeEditar: boolean }) {
  const { restaurants } = useRestaurant();
  const restaurant = restaurants.find((r) => r.id === lead.restaurantId) || null;
  const abrirWhatsapp = useAbrirWhatsapp();

  const [proposta, setProposta] = useState<PropostaEvento | null>(null);
  useEffect(() => {
    const q = query(collection(db, "propostasEvento"), where("leadId", "==", lead.id));
    return onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PropostaEvento).sort((a, b) => b.versao - a.versao);
      setProposta(list[0] || null);
    });
  }, [lead.id]);

  const [texto, setTexto] = useState(lead.contrato?.texto || "");
  const [sujo, setSujo] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  useEffect(() => { if (!sujo) setTexto(lead.contrato?.texto || ""); /* eslint-disable-next-line */ }, [lead.contrato?.texto]);

  async function salvarTexto(t: string) {
    await updateDoc(doc(db, "leadsEvento", lead.id), sanitizeForFirestore({ "contrato.texto": t, "contrato.geradoEm": lead.contrato?.geradoEm || new Date().toISOString() })).catch(() => {});
    setSujo(false);
  }

  function gerarModelo() {
    if (texto.trim() && !confirm("Isso substitui o texto atual do contrato pelo modelo preenchido com os dados atuais. Continuar?")) return;
    const t = montarContratoTexto(lead, proposta, restaurant, {});
    setTexto(t);
    void salvarTexto(t);
  }

  async function gerarPdf() {
    if (gerandoPdf) return;
    if (!texto.trim()) { alert("Gere o modelo do contrato primeiro."); return; }
    if (sujo) await salvarTexto(texto);
    setGerandoPdf(true);
    try {
      const resp = await fetch("/api/contrato-pdf", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rid: lead.restaurantId, texto }) });
      const j = (await resp.json()) as { pdfUrl?: string; error?: string };
      if (!resp.ok || !j.pdfUrl) throw new Error(j.error || `HTTP ${resp.status}`);
      await updateDoc(doc(db, "leadsEvento", lead.id), sanitizeForFirestore({ "contrato.pdfUrl": j.pdfUrl, "contrato.geradoEm": new Date().toISOString() })).catch(() => {});
      window.open(j.pdfUrl, "_blank");
    } catch (e) {
      alert("Não consegui gerar o PDF do contrato: " + (e instanceof Error ? e.message : ""));
    } finally {
      setGerandoPdf(false);
    }
  }

  // Garante um PDF do contrato (gera se ainda não tem) e devolve a URL.
  async function garantirPdf(): Promise<string | null> {
    if (sujo) await salvarTexto(texto);
    const resp = await fetch("/api/contrato-pdf", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rid: lead.restaurantId, texto }) });
    const j = (await resp.json()) as { pdfUrl?: string; error?: string };
    if (!resp.ok || !j.pdfUrl) throw new Error(j.error || `HTTP ${resp.status}`);
    await updateDoc(doc(db, "leadsEvento", lead.id), sanitizeForFirestore({ "contrato.pdfUrl": j.pdfUrl, "contrato.geradoEm": new Date().toISOString() })).catch(() => {});
    return j.pdfUrl;
  }

  const [csBusy, setCsBusy] = useState<"enviar" | "status" | "">("");
  async function enviarClickSign() {
    if (csBusy) return;
    const c = lead.cliente;
    const dc = restaurant?.eventosConfig?.dadosContratada || {};
    const clienteEmail = (c.email || "").trim();
    const clienteDoc = (c.tipoPessoa === "PJ" ? c.representanteLegal?.cpf : c.cpf) || "";
    const casaEmail = (dc.representanteEmail || "").trim();
    if (!clienteEmail) { alert("O cliente precisa ter e-mail pra assinar no ClickSign (edite o lead)."); return; }
    if (!casaEmail) { alert("Falta o e-mail do representante da empresa (Comercial → Dados da empresa)."); return; }
    if (!texto.trim()) { alert("Gere o contrato primeiro."); return; }
    if (!confirm(`Enviar o contrato pra assinatura no ClickSign?\n\n• Cliente: ${clienteEmail}\n• Empresa: ${casaEmail}${CLICKSIGN_SANDBOX ? "\n\n(ambiente SANDBOX — sem validade jurídica)" : ""}`)) return;
    setCsBusy("enviar");
    try {
      const url = await garantirPdf();
      if (!url) throw new Error("não consegui gerar o PDF");
      const base64 = await urlParaBase64(url);
      const casaNome = dc.representanteNome || dc.razaoSocial || restaurant?.nome || "Empresa";
      const clienteNome = c.tipoPessoa === "PJ" ? (c.representanteLegal?.nome || c.razaoSocial || c.nome) : c.nome;
      const { envelopeId, status } = await criarEnvelopeClicksign({
        envelopeName: `Contrato de evento — ${c.nome}`,
        signers: [
          { name: casaNome, email: casaEmail, documentation: dc.representanteCpf || undefined },
          { name: clienteNome, email: clienteEmail, documentation: clienteDoc || undefined, phone: (c.whatsapp || "").replace(/\D/g, "") || undefined },
        ],
        docs: [{ filename: `contrato-evento-${(c.nome || "cliente").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`, base64 }],
        message: "Segue o contrato do evento para assinatura. Qualquer dúvida estamos à disposição.",
        externalId: lead.id,
      });
      await updateDoc(doc(db, "leadsEvento", lead.id), sanitizeForFirestore({
        "contrato.clicksignEnvelopeId": envelopeId, "contrato.clicksignStatus": status, "contrato.clicksignEnviadoEm": new Date().toISOString(),
      })).catch(() => {});
      alert("Contrato enviado pro ClickSign! Cliente e empresa vão receber o pedido de assinatura por e-mail.");
    } catch (e) {
      alert("Falha no ClickSign: " + (e instanceof Error ? e.message : ""));
    } finally { setCsBusy(""); }
  }
  async function verificarStatus() {
    const envId = lead.contrato?.clicksignEnvelopeId;
    if (!envId || csBusy) return;
    setCsBusy("status");
    try {
      const { status } = await statusEnvelopeClicksign(envId);
      await updateDoc(doc(db, "leadsEvento", lead.id), sanitizeForFirestore({ "contrato.clicksignStatus": status })).catch(() => {});
    } catch (e) { alert("Não consegui checar o status: " + (e instanceof Error ? e.message : "")); }
    finally { setCsBusy(""); }
  }

  const pdfUrl = lead.contrato?.pdfUrl;
  const csStatus = lead.contrato?.clicksignStatus;
  const dadosCasaOk = !!restaurant?.eventosConfig?.dadosContratada?.razaoSocial;

  return (
    <div className="space-y-2">
      {!texto.trim() ? (
        <div className="text-sm text-gray-600 dark:text-gray-400">
          Gera o contrato padrão preenchido com os dados do cliente, da empresa e da proposta. Depois você edita o que quiser e gera o PDF pra assinatura.
        </div>
      ) : null}

      {!dadosCasaOk && (
        <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-900/15 px-2.5 py-1.5 text-[12px] text-amber-800 dark:text-amber-300">
          ⚠ Faltam os <strong>dados da empresa</strong> pro contrato — preencha em <strong>Comercial → Dados da empresa</strong>.
        </div>
      )}

      {podeEditar && (
        <div className="flex flex-wrap gap-2 items-center">
          <Button size="sm" variant="secondary" onClick={gerarModelo}>
            {texto.trim() ? "↻ Regerar do modelo" : "📄 Gerar contrato"}
          </Button>
          {texto.trim() && (
            <Button size="sm" onClick={() => void gerarPdf()} disabled={gerandoPdf}>
              {gerandoPdf ? "Gerando PDF…" : "🧾 Gerar PDF"}
            </Button>
          )}
          {pdfUrl && (
            <>
              <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">📄 abrir PDF</a>
              <button type="button" onClick={() => void abrirWhatsapp(lead.restaurantId, "eventos", lead.cliente.whatsapp, lead.cliente.nome, "Segue o contrato do seu evento pra conferência. Qualquer dúvida estou à disposição! 🙌")}
                className="text-xs text-emerald-700 dark:text-emerald-400 hover:underline">💬 enviar por WhatsApp</button>
            </>
          )}
          {texto.trim() && (
            <Button size="sm" variant="secondary" onClick={() => void enviarClickSign()} disabled={csBusy === "enviar"}>
              {csBusy === "enviar" ? "Enviando…" : "✍️ Enviar pra assinatura (ClickSign)"}
            </Button>
          )}
        </div>
      )}

      {lead.contrato?.clicksignEnvelopeId && (
        <div className="rounded-md border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-900/15 px-2.5 py-1.5 text-[12px] flex items-center gap-2 flex-wrap">
          <span className="text-indigo-800 dark:text-indigo-300">✍️ ClickSign: <strong>{csStatus || "enviado"}</strong>{CLICKSIGN_SANDBOX ? " (sandbox)" : ""}</span>
          <button type="button" onClick={() => void verificarStatus()} disabled={csBusy === "status"} className="text-indigo-600 dark:text-indigo-400 hover:underline">
            {csBusy === "status" ? "checando…" : "↻ atualizar status"}
          </button>
        </div>
      )}

      {texto.trim() && (
        <textarea
          value={texto}
          onChange={(e) => { setTexto(e.target.value); setSujo(true); }}
          onBlur={() => { if (sujo) void salvarTexto(texto); }}
          disabled={!podeEditar}
          rows={16}
          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-[12px] font-mono leading-relaxed dark:text-gray-100"
        />
      )}
      {sujo && <div className="text-[11px] text-amber-600 dark:text-amber-400">Alterações não salvas — salva ao sair do campo, ou clica em Gerar PDF.</div>}

      <p className="text-[11px] text-gray-400">Assinatura eletrônica via ClickSign (cliente + a casa). Modelo de base — revise juridicamente antes de usar pra valer.</p>
    </div>
  );
}
