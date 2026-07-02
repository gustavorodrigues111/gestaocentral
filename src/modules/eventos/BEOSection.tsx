import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { collection, doc, onSnapshot, query, setDoc, where, getDocs } from "firebase/firestore";
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type { BEOEvento, CardapioPdf, LeadEvento, PropostaEvento } from "../../core/types";

const MAX_BEO_PDF_MB = 20;

type Props = {
  lead: LeadEvento;
  podeEditar: boolean;
  meId: string;
  meNome: string;
};

// BEO = Banquet Event Order. Documento final de produção, gerado a partir
// da proposta vigente + dados operacionais (timeline, restrições, setup).
// Vai pra cozinha — primeira versão: texto formatado pronto pra colar no
// WhatsApp (ou exportar como PDF no futuro).
export function BEOSection({ lead, podeEditar, meId, meNome }: Props) {
  const [beos, setBeos] = useState<BEOEvento[]>([]);
  const [propostaVigente, setPropostaVigente] = useState<PropostaEvento | null>(null);
  const [gerando, setGerando] = useState(false);

  // Form pra criar nova versão
  const [horaChegada, setHoraChegada] = useState("");
  const [horaInicio, setHoraInicio] = useState("");
  const [horaEncerramento, setHoraEncerramento] = useState("");
  const [contatoNomeDia, setContatoNomeDia] = useState(lead.cliente.nome);
  const [contatoWaDia, setContatoWaDia] = useState(lead.cliente.whatsapp);
  const [restricoes, setRestricoes] = useState("");
  const [setup, setSetup] = useState("");
  const [observacoes, setObservacoes] = useState("");
  // Cardápios anexados direto no BEO (além dos que vieram da proposta) —
  // ex: cardápio final combinado com o cliente por fora.
  const [cardapiosExtra, setCardapiosExtra] = useState<CardapioPdf[]>([]);

  useEffect(() => {
    const q = query(collection(db, "beosEvento"), where("leadId", "==", lead.id));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as BEOEvento);
      list.sort((a, b) => b.versao - a.versao);
      setBeos(list);
    });
    return () => unsub();
  }, [lead.id]);

  // Carrega proposta vigente
  useEffect(() => {
    (async () => {
      const q = query(collection(db, "propostasEvento"), where("leadId", "==", lead.id));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as PropostaEvento);
      list.sort((a, b) => b.versao - a.versao);
      setPropostaVigente(list[0] || null);
    })();
  }, [lead.id]);

  // Defaults pro form baseados na proposta
  useEffect(() => {
    if (!propostaVigente) return;
    setHoraInicio(propostaVigente.horaInicio || "");
    // Hora de chegada = 1h antes do início
    const hi = parseHora(propostaVigente.horaInicio);
    if (hi) {
      const chegada = new Date(2000, 0, 1, hi.h - 1, hi.m);
      setHoraChegada(`${pad(chegada.getHours())}:${pad(chegada.getMinutes())}`);
      const fim = new Date(2000, 0, 1, hi.h + Math.floor(propostaVigente.duracaoHoras), hi.m + ((propostaVigente.duracaoHoras % 1) * 60));
      setHoraEncerramento(`${pad(fim.getHours())}:${pad(fim.getMinutes())}`);
    }
  }, [propostaVigente]);

  const beoAtual = beos[0] || null;

  async function gerarBEO() {
    if (!podeEditar || !propostaVigente) return;
    setGerando(true);
    try {
      const versao = beos.length > 0 ? Math.max(...beos.map(b => b.versao)) + 1 : 1;
      const id = `beo_${lead.id}_v${versao}`;
      const now = new Date().toISOString();
      const restricoesArr = restricoes.split(/\n+/).map(s => s.trim()).filter(s => s.length > 0);

      const beo: BEOEvento = {
        id,
        restaurantId: lead.restaurantId,
        leadId: lead.id,
        propostaId: propostaVigente.id,
        versao,
        dataEvento: propostaVigente.dataEvento,
        slot: propostaVigente.slot,
        horaChegadaEquipe: horaChegada || "—",
        horaInicioServico: horaInicio || propostaVigente.horaInicio,
        horaEncerramento: horaEncerramento || "—",
        numConvidados: propostaVigente.numConvidados,
        contatoNoDia: {
          nome: contatoNomeDia.trim() || lead.cliente.nome,
          whatsapp: contatoWaDia.trim() || lead.cliente.whatsapp,
        },
        cardapios: [...(propostaVigente.cardapios || []), ...cardapiosExtra],
        restricoesAlimentares: restricoesArr,
        setup: setup.trim() || "Padrão da Laje",
        observacoes: observacoes.trim() || undefined,
        geradoEm: now,
        geradoPor: meId,
        geradoPorNome: meNome,
      };
      await setDoc(doc(db, "beosEvento", id), sanitizeForFirestore(beo));
      setCardapiosExtra([]);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao gerar BEO");
    } finally {
      setGerando(false);
    }
  }

  function copiarBEOTexto(b: BEOEvento) {
    const texto = formatarBEOTexto(b);
    navigator.clipboard.writeText(texto).then(() => {
      alert("BEO copiado pra área de transferência!");
    }).catch(() => {
      // Fallback: mostra em prompt pra usuário copiar manualmente
      window.prompt("Copia o texto abaixo:", texto);
    });
  }

  function enviarBEOWhatsApp(b: BEOEvento) {
    const texto = formatarBEOTexto(b);
    // Sem número específico — usuário escolhe no WhatsApp. Usa só ?text=
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`;
    window.open(url, "_blank");
  }

  if (!propostaVigente) {
    return (
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
          📋 BEO
        </div>
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-900 dark:text-amber-200">
          ⚠ Crie uma proposta primeiro — o BEO consolida dados dela.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
        📋 BEO (ordem do evento pra cozinha)
      </div>

      {beoAtual && (
        <div className="rounded-lg border-2 border-purple-300 dark:border-purple-700 bg-purple-50/40 dark:bg-purple-900/10 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-gray-900 dark:text-gray-100">
              BEO v{beoAtual.versao}
            </span>
            <span className="text-[10px] text-gray-500">
              gerado em {new Date(beoAtual.geradoEm).toLocaleString("pt-BR")}
            </span>
          </div>
          <pre className="text-[11px] font-mono whitespace-pre-wrap bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded p-2 max-h-60 overflow-y-auto">
            {formatarBEOTexto(beoAtual)}
          </pre>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" onClick={() => copiarBEOTexto(beoAtual)}>📋 Copiar</Button>
            <Button size="sm" onClick={() => enviarBEOWhatsApp(beoAtual)}>💬 WhatsApp</Button>
          </div>
        </div>
      )}

      {beos.length > 1 && (
        <details className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 p-2">
          <summary className="cursor-pointer text-xs text-gray-500 dark:text-gray-400">
            Versões anteriores ({beos.length - 1})
          </summary>
          <div className="mt-2 space-y-2">
            {beos.slice(1).map(b => (
              <pre key={b.id} className="text-[10px] font-mono whitespace-pre-wrap bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded p-2 max-h-40 overflow-y-auto">
                {formatarBEOTexto(b)}
              </pre>
            ))}
          </div>
        </details>
      )}

      {/* Form pra gerar BEO (ou nova versão) — painel sempre visível */}
      {podeEditar && (
        <BeoFormPanel beoAtual={beoAtual}>
          {!beoAtual && (
            <div className="mb-3 text-xs text-gray-500 dark:text-gray-400">
              Preencha os horários e o setup abaixo e clique em <strong>Gerar BEO</strong> pra
              consolidar a ordem do evento pra cozinha (a partir da proposta v{propostaVigente.versao}).
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input label="Chegada equipe" type="time" value={horaChegada} onChange={(e) => setHoraChegada(e.target.value)} />
            <Input label="Início serviço" type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
            <Input label="Encerramento" type="time" value={horaEncerramento} onChange={(e) => setHoraEncerramento(e.target.value)} />
          </div>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input label="Contato no dia" value={contatoNomeDia} onChange={(e) => setContatoNomeDia(e.target.value)} />
            <Input label="WhatsApp contato" value={contatoWaDia} onChange={(e) => setContatoWaDia(e.target.value)} />
          </div>
          <div className="mt-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
              Restrições alimentares (uma por linha)
            </label>
            <textarea
              value={restricoes}
              onChange={(e) => setRestricoes(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              rows={2}
              placeholder="2 vegetarianos&#10;1 alergia frutos do mar"
            />
          </div>
          <div className="mt-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
              Setup (mesas, decoração, AV)
            </label>
            <textarea
              value={setup}
              onChange={(e) => setSetup(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              rows={2}
              placeholder="Mesa única retangular, decoração do cliente, playlist via bluetooth..."
            />
          </div>
          <div className="mt-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
              Observações
            </label>
            <textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              rows={2}
            />
          </div>
          {/* Cardápios: herdados da proposta + anexos combinados com o cliente */}
          <div className="mt-3">
            <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
              Cardápios do evento
            </label>
            <div className="mt-1 space-y-1">
              {(propostaVigente.cardapios || []).map(c => (
                <div key={c.id} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                  <span>📄</span>
                  <a href={c.url} target="_blank" rel="noreferrer" className="underline truncate">{c.nome}</a>
                  <span className="text-[10px] px-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-500">da proposta</span>
                </div>
              ))}
              {cardapiosExtra.map(c => (
                <div key={c.id} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                  <span>📎</span>
                  <a href={c.url} target="_blank" rel="noreferrer" className="underline truncate">{c.nome}</a>
                  <button
                    type="button"
                    onClick={() => setCardapiosExtra(prev => prev.filter(x => x.id !== c.id))}
                    className="text-red-500 hover:text-red-700 text-[11px]"
                    title="Remover anexo"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {(propostaVigente.cardapios || []).length === 0 && cardapiosExtra.length === 0 && (
                <div className="text-xs text-gray-400 italic">Nenhum cardápio ainda — anexe o combinado com o cliente.</div>
              )}
            </div>
            <div className="mt-2">
              <BeoCardapioUploader
                restaurantId={lead.restaurantId}
                leadId={lead.id}
                proximaOrdem={(propostaVigente.cardapios || []).length + cardapiosExtra.length}
                onUploaded={(c) => setCardapiosExtra(prev => [...prev, c])}
              />
            </div>
          </div>

          <div className="mt-3">
            <Button onClick={gerarBEO} disabled={gerando}>
              {gerando ? "Gerando..." : beoAtual ? "📋 Gerar nova versão" : "📋 Gerar BEO"}
            </Button>
          </div>
        </BeoFormPanel>
      )}
    </div>
  );
}

// Painel do formulário de BEO. Quando ainda não existe BEO, fica aberto e
// visível (borda sólida destacada) pra deixar o "Gerar BEO" óbvio. Quando já
// existe um BEO, vira um accordion "nova versão" recolhido pra não poluir.
function BeoFormPanel({ beoAtual, children }: { beoAtual: BEOEvento | null; children: ReactNode }) {
  if (!beoAtual) {
    return (
      <div className="mt-2 rounded-lg border-2 border-purple-300 dark:border-purple-700 bg-purple-50/30 dark:bg-purple-900/10 p-3">
        <div className="text-sm font-bold text-purple-800 dark:text-purple-200 mb-1">Gerar BEO</div>
        {children}
      </div>
    );
  }
  return (
    <details className="mt-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-3">
      <summary className="cursor-pointer text-sm font-medium">+ Gerar nova versão</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

// Uploader de PDF de cardápio pro BEO. Mesma mecânica dos cardápios de pacote
// (Firebase Storage), path próprio por lead.
function BeoCardapioUploader({
  restaurantId, leadId, proximaOrdem, onUploaded,
}: {
  restaurantId: string;
  leadId: string;
  proximaOrdem: number;
  onUploaded: (c: CardapioPdf) => void;
}) {
  const { pessoa: me } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [erro, setErro] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  function upload(file: File) {
    setErro("");
    if (file.type !== "application/pdf") {
      setErro("Só PDF.");
      return;
    }
    const mb = file.size / (1024 * 1024);
    if (mb > MAX_BEO_PDF_MB) {
      setErro(`Arquivo muito grande (${mb.toFixed(1)} MB). Máximo: ${MAX_BEO_PDF_MB} MB.`);
      return;
    }
    setUploading(true);
    setProgresso(0);
    const id = `card_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const path = `beos-cardapios/${restaurantId}/${leadId}/${id}.pdf`;
    const ref = storageRef(storage, path);
    const task = uploadBytesResumable(ref, file, {
      contentType: "application/pdf",
      customMetadata: { restaurantId, leadId, uploadedBy: me?.id || "" },
    });
    task.on(
      "state_changed",
      (snap) => setProgresso(Math.max(5, Math.round((snap.bytesTransferred / snap.totalBytes) * 100))),
      (err) => {
        console.error("Storage upload error:", err);
        const cod = (err as { code?: string }).code || "";
        if (cod.includes("unauthorized") || cod.includes("permission")) {
          setErro("Sem permissão pra subir. Regras do Storage podem não estar publicadas: firebase deploy --only storage --project gestaocentral");
        } else {
          setErro(err.message || "Erro ao enviar");
        }
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      },
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          const nomeBase = file.name.replace(/\.pdf$/i, "").slice(0, 60);
          onUploaded({
            id,
            nome: nomeBase || "Cardápio",
            url,
            uploadedAt: new Date().toISOString(),
            uploadedBy: me?.id,
            ordem: proximaOrdem,
          });
          setProgresso(100);
        } catch (e) {
          console.error(e);
          setErro(e instanceof Error ? e.message : "Erro ao salvar");
        } finally {
          setUploading(false);
          if (inputRef.current) inputRef.current.value = "";
        }
      },
    );
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="px-3 py-1.5 rounded-lg border border-dashed border-indigo-300 dark:border-indigo-700 text-xs text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:border-indigo-500 transition-colors disabled:opacity-60"
      >
        {uploading ? `Enviando… ${progresso}%` : "📎 Anexar cardápio (PDF)"}
      </button>
      {erro && <div className="mt-1 text-[11px] text-red-600 dark:text-red-400">{erro}</div>}
    </div>
  );
}

function formatarBEOTexto(b: BEOEvento): string {
  const dataEv = new Date(b.dataEvento + "T12:00:00");
  const dataBR = `${pad(dataEv.getDate())}/${pad(dataEv.getMonth() + 1)}/${dataEv.getFullYear()}`;
  const diaSem = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][dataEv.getDay()];
  const linhas: string[] = [];
  linhas.push(`*BEO v${b.versao}*`);
  linhas.push("");
  linhas.push(`📅 ${dataBR} (${diaSem}) · ${b.slot === "almoco" ? "almoço" : b.slot === "jantar" ? "jantar" : "dia inteiro"}`);
  linhas.push(`🕒 Chegada equipe ${b.horaChegadaEquipe} · Início ${b.horaInicioServico} · Fim ${b.horaEncerramento}`);
  linhas.push(`👥 ${b.numConvidados} convidados`);
  linhas.push(`📞 Contato no dia: ${b.contatoNoDia.nome} — ${b.contatoNoDia.whatsapp}`);
  linhas.push("");
  if (b.cardapios && b.cardapios.length > 0) {
    linhas.push("*CARDÁPIOS*");
    for (const c of b.cardapios) {
      linhas.push(`📄 ${c.nome}: ${c.url}`);
    }
    linhas.push("");
  }
  if (b.restricoesAlimentares.length > 0) {
    linhas.push("*RESTRIÇÕES*");
    b.restricoesAlimentares.forEach(r => linhas.push(`• ${r}`));
    linhas.push("");
  }
  if (b.setup) {
    linhas.push("*SETUP*");
    linhas.push(b.setup);
    linhas.push("");
  }
  if (b.observacoes) {
    linhas.push("*OBSERVAÇÕES*");
    linhas.push(b.observacoes);
  }
  return linhas.join("\n");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function parseHora(s: string | undefined): { h: number; m: number } | null {
  if (!s) return null;
  const [hh, mm] = s.split(":").map(n => parseInt(n, 10));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return { h: hh, m: mm };
}
