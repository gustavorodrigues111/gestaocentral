// ProrrogarContratoModal — extraído do Gestor de Tarefas pra ser reusável
// (Gestor + módulo Prazos Trabalhistas). Localiza a admissão pelo empregadoId,
// acha o Termo de Prorrogação e envia pro Clicksign (envelope novo só com ele).
import { useEffect, useState } from "react";
import { collection, query, where, getDocs, getDoc, doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";

export function ProrrogarContratoModal({ empregadoId, autor, onClose }: {
  empregadoId: string;
  autor: { id: string; nome: string };
  onClose: () => void;
}) {
  const [estado, setEstado] = useState<"carregando" | "ok" | "erro">("carregando");
  const [mensagem, setMensagem] = useState("");
  const [admissao, setAdmissao] = useState<Record<string, unknown> | null>(null);
  const [restaurantInfo, setRestaurantInfo] = useState<Record<string, unknown> | null>(null);
  const [termoProrrogacao, setTermoProrrogacao] = useState<{
    nome: string;
    link?: string;
    linkFileId?: string;
  } | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const q = query(
          collection(db, "admissoes"),
          where("empregadoIdCriado", "==", empregadoId),
        );
        const snap = await getDocs(q);
        if (cancel) return;
        if (snap.empty) {
          setEstado("erro");
          setMensagem("Não encontrei a admissão deste empregado. O Termo de Prorrogação vive na admissão original.");
          return;
        }
        const admDoc = snap.docs[0];
        const adm = { id: admDoc.id, ...admDoc.data() } as Record<string, unknown>;
        setAdmissao(adm);
        // Encontra o termo de prorrogação
        const termos = (adm.termosAssinados as Array<{
          id: string; nome: string; tipoEspecial?: string; link?: string; linkFileId?: string;
        }> | undefined) || [];
        const termo = termos.find(t => t.tipoEspecial === "prorrogacao" || t.id === "tm_prorrogacao_experiencia");
        if (!termo) {
          setEstado("erro");
          setMensagem("Esta admissão não tem o termo 'Termo de Prorrogação' configurado. Abra o checklist da admissão e adicione o termo.");
          return;
        }
        setTermoProrrogacao({ nome: termo.nome, link: termo.link, linkFileId: termo.linkFileId });
        // Restaurante
        const rid = adm.restaurantId as string;
        const restSnap = await getDoc(doc(db, "restaurants", rid));
        if (cancel) return;
        if (!restSnap.exists()) {
          setEstado("erro");
          setMensagem("Restaurante da admissão não encontrado.");
          return;
        }
        setRestaurantInfo({ id: restSnap.id, ...restSnap.data() });
        setEstado("ok");
      } catch (e) {
        if (cancel) return;
        setEstado("erro");
        setMensagem(e instanceof Error ? e.message : "Falha ao carregar admissão.");
      }
    })();
    return () => { cancel = true; };
  }, [empregadoId]);

  async function enviarProrrogacaoPraClicksign() {
    if (!admissao || !restaurantInfo || !termoProrrogacao?.linkFileId) return;
    const cand = (admissao as { candidato?: { nome?: string; email?: string; cpf?: string; whatsapp?: string } }).candidato || {};
    const empresaNome = (restaurantInfo as { clicksignEmpresaNome?: string }).clicksignEmpresaNome?.trim();
    const empresaEmail = (restaurantInfo as { clicksignEmpresaEmail?: string }).clicksignEmpresaEmail?.trim();
    if (!cand.email) { setMensagem("Candidato sem e-mail."); return; }
    if (!empresaNome || !empresaEmail) {
      setMensagem("Configure o signatário da empresa em Admissão → Configurações.");
      return;
    }
    setEnviando(true);
    setMensagem("");
    try {
      // Imports dinâmicos pra não engordar o bundle do TarefasPage
      const [{ downloadDriveFileBase64 }, { criarEnvelopeClicksign, CLICKSIGN_SANDBOX }] = await Promise.all([
        import("../../core/google/driveClient"),
        import("../../core/clicksign/clicksignClient"),
      ]);
      const base64 = await downloadDriveFileBase64(termoProrrogacao.linkFileId!);
      const cpfDigits = (cand.cpf || "").replace(/\D/g, "");
      const cpfFmt = cpfDigits.length === 11
        ? `${cpfDigits.slice(0, 3)}.${cpfDigits.slice(3, 6)}.${cpfDigits.slice(6, 9)}-${cpfDigits.slice(9)}`
        : undefined;
      const dn = (admissao as { dadosPreenchidos?: { data_nascimento?: string } }).dadosPreenchidos?.data_nascimento;
      const restAuto = (restaurantInfo as { clicksignEmpresaAssinaturaAuto?: boolean }).clicksignEmpresaAssinaturaAuto;
      const restCpf = (restaurantInfo as { clicksignEmpresaCpf?: string }).clicksignEmpresaCpf;
      const restNasc = (restaurantInfo as { clicksignEmpresaNascimento?: string }).clicksignEmpresaNascimento;
      const { envelopeId, status } = await criarEnvelopeClicksign({
        envelopeName: `Prorrogação de Experiência - ${cand.nome || empregadoId}`,
        signers: [
          {
            name: empresaNome,
            email: empresaEmail,
            autoSignature: restAuto || undefined,
            documentation: restAuto && restCpf ? (
              restCpf.replace(/\D/g, "").length === 11
                ? `${restCpf.replace(/\D/g, "").slice(0,3)}.${restCpf.replace(/\D/g, "").slice(3,6)}.${restCpf.replace(/\D/g, "").slice(6,9)}-${restCpf.replace(/\D/g, "").slice(9)}`
                : undefined
            ) : undefined,
            birthday: restAuto ? restNasc || undefined : undefined,
          },
          {
            name: cand.nome || "Empregado",
            email: cand.email,
            phone: cand.whatsapp || undefined,
            documentation: cpfFmt,
            birthday: typeof dn === "string" ? dn : undefined,
          },
        ],
        docs: [{
          filename: `Termo de Prorrogacao - ${cand.nome || empregadoId}.pdf`,
          base64,
        }],
        externalId: admissao.id as string,
      });
      // Persiste no histórico da admissão
      const historicoAtual = ((admissao as { clicksignHistorico?: Array<unknown> }).clicksignHistorico || []) as Array<{
        envelopeId: string; enviadoEm: string; arquivos: Array<{ fileId?: string; filename: string }>;
      }>;
      const novoEnvio = {
        envelopeId,
        enviadoEm: new Date().toISOString(),
        enviadoPor: { id: autor.id, nome: autor.nome },
        sandbox: CLICKSIGN_SANDBOX,
        statusInicial: status,
        arquivos: [{
          fileId: termoProrrogacao.linkFileId!,
          filename: `Termo de Prorrogacao - ${cand.nome || empregadoId}.pdf`,
        }],
      };
      await updateDoc(doc(db, "admissoes", admissao.id as string), {
        clicksignEnvelopeId: envelopeId,
        clicksignStatus: status,
        clicksignEnviadoEm: new Date().toISOString(),
        clicksignHistorico: [...historicoAtual, novoEnvio],
        updatedAt: new Date().toISOString(),
      });
      setMensagem(`✓ Termo enviado pro Clicksign. O empregado recebe por e-mail. (Envelope ${envelopeId.slice(0, 8)}…)`);
    } catch (e) {
      setMensagem("Erro: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setEnviando(false);
    }
  }

  const candNome = (admissao as { candidato?: { nome?: string } } | null)?.candidato?.nome || "—";
  const temPdf = !!termoProrrogacao?.linkFileId;

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
            ✓ Prorrogar contrato de experiência
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-900 text-xl leading-none p-1"
          >
            ✕
          </button>
        </div>
        <div className="p-4 space-y-3 text-sm">
          {estado === "carregando" && (
            <div className="text-gray-500 italic">Carregando admissão…</div>
          )}
          {estado === "erro" && (
            <div className="text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 rounded p-3">
              {mensagem}
            </div>
          )}
          {estado === "ok" && (
            <>
              <div className="text-gray-700 dark:text-gray-300">
                Empregado: <strong>{candNome}</strong>
              </div>
              <div className="text-gray-700 dark:text-gray-300">
                Termo:{" "}
                {termoProrrogacao?.link ? (
                  <a
                    href={termoProrrogacao.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 hover:underline"
                  >
                    ↗ {termoProrrogacao.nome}
                  </a>
                ) : (
                  <span className="text-amber-700">— sem PDF subido —</span>
                )}
              </div>
              {!temPdf && (
                <div className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-3">
                  ⚠ O Termo de Prorrogação ainda não foi subido pra pasta
                  "docs a assinar" desta admissão. Abra o checklist de termos
                  da admissão, encontre "Termo de Prorrogação" e clique em
                  "⬆️ Subir pra assinatura". Depois volte aqui.
                </div>
              )}
              {temPdf && (
                <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-800 rounded p-3">
                  Ao confirmar, vou criar um novo envelope no Clicksign só
                  com o Termo de Prorrogação. O empregado recebe por e-mail e
                  pode assinar. Sem ação aqui, o termo continua guardado e
                  nada é enviado.
                </div>
              )}
              {mensagem && (
                <div className={`text-xs ${mensagem.startsWith("✓")
                  ? "text-emerald-700 dark:text-emerald-300"
                  : "text-rose-700 dark:text-rose-300"}`}>
                  {mensagem}
                </div>
              )}
            </>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
            <Button variant="secondary" onClick={onClose} disabled={enviando}>
              Fechar
            </Button>
            {estado === "ok" && temPdf && !mensagem.startsWith("✓") && (
              <Button onClick={enviarProrrogacaoPraClicksign} disabled={enviando}>
                {enviando ? "Enviando…" : "✍️ Enviar pro Clicksign"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
