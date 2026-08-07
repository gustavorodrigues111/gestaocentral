// Seção de CONTRATO do evento — gera o texto (modelo preenchido), permite
// editar, gera o PDF e (Fase 4) envia pra assinatura no ClickSign.
import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useAbrirWhatsapp } from "../../core/whatsapp/roteios";
import type { LeadEvento, PropostaEvento } from "../../core/types";
import { montarContratoTexto } from "./contratoHelpers";

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

  const pdfUrl = lead.contrato?.pdfUrl;
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

      <p className="text-[11px] text-gray-400">Assinatura via ClickSign (cliente + a casa) entra na próxima etapa. Rascunho de base — revise juridicamente.</p>
    </div>
  );
}
