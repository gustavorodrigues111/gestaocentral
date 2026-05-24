import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, setDoc, where, getDocs } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type { BEOEvento, ItemCardapioEvento, LeadEvento, PropostaEvento } from "../../core/types";

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
        cardapio: propostaVigente.cardapio,
        restricoesAlimentares: restricoesArr,
        setup: setup.trim() || "Padrão da Laje",
        observacoes: observacoes.trim() || undefined,
        geradoEm: now,
        geradoPor: meId,
        geradoPorNome: meNome,
      };
      await setDoc(doc(db, "beosEvento", id), sanitizeForFirestore(beo));
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

      {/* Form pra nova versão */}
      {podeEditar && (
        <details className="mt-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-3" open={!beoAtual}>
          <summary className="cursor-pointer text-sm font-medium">
            {beoAtual ? "+ Gerar nova versão" : "+ Gerar BEO"}
          </summary>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
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
          <div className="mt-3">
            <Button size="sm" onClick={gerarBEO} disabled={gerando}>
              {gerando ? "Gerando..." : "📋 Gerar BEO"}
            </Button>
          </div>
        </details>
      )}
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
  if (b.cardapio.length > 0) {
    linhas.push("*CARDÁPIO (na ordem)*");
    const tipos: Record<string, ItemCardapioEvento[]> = {};
    for (const it of b.cardapio) {
      if (!tipos[it.tipo]) tipos[it.tipo] = [];
      tipos[it.tipo].push(it);
    }
    for (const tipo of ["couvert", "entrada", "principal", "acompanhamento", "sobremesa", "bebida", "extra"]) {
      const items = tipos[tipo] || [];
      if (items.length === 0) continue;
      linhas.push(`${tipoLabel(tipo)}: ${items.map(it => it.nome).join(", ")}`);
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

function tipoLabel(tipo: string): string {
  return {
    couvert: "Couvert",
    entrada: "Entrada",
    principal: "Principal",
    acompanhamento: "Acompanhamento",
    sobremesa: "Sobremesa",
    bebida: "Bebida",
    extra: "Extra",
  }[tipo] || tipo;
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
