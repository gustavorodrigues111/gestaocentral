// Governança de IA (SÓ MASTER) — diretrizes do que a IA pode/não pode responder,
// em BLOCOS independentes (adicionados por texto ou voz; a IA checa contradição/
// redundância a cada novo bloco). Registro jurídico das interações (auditoria).
// Alertas de uso fora do escopo saem na Central de Avisos (gate receberAlertas).
// Diretrizes por empresa, replicáveis pra outras.

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, query, where, doc, setDoc, deleteDoc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { authHeader } from "../../core/firebase/idToken";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useDitado } from "../../core/hooks/useDitado";
import { Button } from "../../core/ui/Button";
import { fmtBR } from "../../core/utils/date";

type DiretrizBloco = { id: string; texto: string; criadoEm: string; criadoPor: string };
type IaInteracao = {
  id: string; restaurantId: string; moduleLabel?: string; canal?: string;
  pessoaId?: string; pessoaNome?: string; pergunta?: string; resposta?: string;
  foraDeEscopo?: boolean; motivo?: string; severidade?: string; createdAt?: string; anonimizado?: boolean;
};
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const SEV_META: Record<string, { label: string; cls: string }> = {
  alta: { label: "🔴 Alta", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" },
  media: { label: "🟠 Média", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  baixa: { label: "🟡 Baixa", cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300" },
};
// String derivada (o endpoint da IA e o cliente da Wiki consomem `diretrizes`).
const juntarBlocos = (bs: DiretrizBloco[]) => bs.map(b => `- ${b.texto}`).join("\n");

export function IaGovernancaPage() {
  const { pessoa } = useAuth();
  const { rid } = useParams<{ rid: string }>();
  const { restaurants } = useRestaurant();

  const [aba, setAba] = useState<"diretrizes" | "registros">("diretrizes");
  const [blocos, setBlocos] = useState<DiretrizBloco[]>([]);
  const [carregou, setCarregou] = useState(false);
  const [replicar, setReplicar] = useState(false);
  const [interacoes, setInteracoes] = useState<IaInteracao[]>([]);
  const [filtro, setFiltro] = useState<"todas" | "fora">("todas");
  const [aberta, setAberta] = useState<string | null>(null);
  const [retencaoDias, setRetencaoDias] = useState<number>(0);
  const [purgando, setPurgando] = useState(false);

  useEffect(() => {
    if (!rid) return;
    const u = onSnapshot(doc(db, "iaConfig", rid), snap => {
      const d = snap.data() as { diretrizesBlocos?: DiretrizBloco[]; diretrizes?: string; retencaoDias?: number } | undefined;
      if (d?.diretrizesBlocos && d.diretrizesBlocos.length) setBlocos(d.diretrizesBlocos);
      else if (d?.diretrizes && d.diretrizes.trim()) setBlocos([{ id: uid(), texto: d.diretrizes.trim(), criadoEm: new Date().toISOString(), criadoPor: "migrado" }]);
      else setBlocos([]);
      setRetencaoDias(typeof d?.retencaoDias === "number" ? d.retencaoDias : 0);
      setCarregou(true);
    });
    return () => u();
  }, [rid]);

  useEffect(() => {
    if (!rid || !pessoa?.isMaster) return;
    const u = onSnapshot(query(collection(db, "iaInteracoes"), where("restaurantId", "==", rid)),
      snap => setInteracoes(snap.docs.map(d => ({ id: d.id, ...d.data() }) as IaInteracao).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))));
    return () => u();
  }, [rid, pessoa?.isMaster]);

  if (!pessoa) return null;
  if (!pessoa.isMaster) return <div className="max-w-4xl mx-auto p-8 text-center text-gray-500">A Governança de IA é exclusiva do administrador master.</div>;

  async function persistir(novos: DiretrizBloco[]) {
    if (!rid) return;
    setBlocos(novos);
    await setDoc(doc(db, "iaConfig", rid), sanitizeForFirestore({
      restaurantId: rid, diretrizesBlocos: novos, diretrizes: juntarBlocos(novos),
      atualizadoEm: new Date().toISOString(), atualizadoPor: pessoa!.id,
    }), { merge: true }).catch(e => alert("Erro ao salvar: " + (e instanceof Error ? e.message : "?")));
  }
  const addBloco = (texto: string) => persistir([...blocos, { id: uid(), texto: texto.trim(), criadoEm: new Date().toISOString(), criadoPor: pessoa!.id }]);
  const removeBloco = (id: string) => persistir(blocos.filter(b => b.id !== id));

  const registrosVis = interacoes.filter(i => filtro === "todas" || i.foraDeEscopo);
  const nFora = interacoes.filter(i => i.foraDeEscopo).length;

  function exportarCSV() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const linhas = [["data", "pessoa", "modulo", "pergunta", "resposta", "fora_do_escopo", "severidade", "motivo"].join(",")];
    for (const i of registrosVis) linhas.push([i.createdAt || "", i.pessoaNome || "", i.moduleLabel || "", i.pergunta || "", i.resposta || "", i.foraDeEscopo ? "sim" : "não", i.severidade || "", i.motivo || ""].map(esc).join(","));
    const blob = new Blob(["﻿" + linhas.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `ia-registros-${rid}.csv`; a.click();
    URL.revokeObjectURL(url);
  }
  async function exportarPDF() {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
    const d = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const nomeEmp = restaurants.find(r => r.id === rid)?.nome || rid || "";
    d.setFont("helvetica", "bold"); d.setFontSize(15); d.setTextColor(30, 30, 30);
    d.text("Registro de interações com a IA", 10, 12);
    d.setFont("helvetica", "normal"); d.setFontSize(10); d.setTextColor(100, 116, 139);
    d.text(`${nomeEmp}  ·  ${registrosVis.length} registro(s)${filtro === "fora" ? " (só fora do escopo)" : ""}`, 10, 17);
    autoTable(d, {
      startY: 22,
      head: [["Data", "Pessoa", "Escopo", "Sev.", "Pergunta", "Motivo"]],
      body: registrosVis.map(i => [
        (i.createdAt || "").slice(0, 16).replace("T", " "),
        i.anonimizado ? "— anonimizado —" : (i.pessoaNome || "—"),
        i.foraDeEscopo ? "FORA" : "ok",
        i.foraDeEscopo ? (i.severidade || "") : "",
        i.pergunta || "",
        i.motivo || "",
      ]),
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 1.5, valign: "top", textColor: [30, 30, 30], lineColor: [200, 200, 200], lineWidth: 0.15 },
      headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
      columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 38 }, 2: { cellWidth: 16, halign: "center" }, 3: { cellWidth: 14, halign: "center" }, 4: { cellWidth: 100 }, 5: { cellWidth: 78 } },
      didParseCell: (data) => { if (data.section === "body" && registrosVis[data.row.index]?.foraDeEscopo && data.column.index === 2) { data.cell.styles.textColor = [190, 18, 60]; data.cell.styles.fontStyle = "bold"; } },
    });
    d.save(`ia-registros-${rid}.pdf`);
  }
  async function anonimizar(ids: string[]) {
    await Promise.all(ids.map(id => updateDoc(doc(db, "iaInteracoes", id), { pessoaNome: "Anonimizado", pessoaId: "", anonimizado: true }).catch(() => {})));
  }
  async function anonimizarAntigos() {
    if (!rid || !retencaoDias) return;
    const corte = new Date(Date.now() - retencaoDias * 86400000).toISOString();
    const alvo = interacoes.filter(i => (i.createdAt || "") < corte && !i.anonimizado);
    if (alvo.length === 0) { alert("Nenhum registro além do período pra anonimizar."); return; }
    if (!confirm(`Anonimizar ${alvo.length} registro(s) com mais de ${retencaoDias} dias? Remove o nome da pessoa, mantém pergunta/resposta.`)) return;
    setPurgando(true);
    try { await anonimizar(alvo.map(i => i.id)); alert(`${alvo.length} registro(s) anonimizado(s).`); }
    catch (e) { alert("Erro: " + (e instanceof Error ? e.message : "?")); }
    finally { setPurgando(false); }
  }
  async function salvarRetencao(dias: number) {
    if (!rid) return;
    setRetencaoDias(dias);
    await setDoc(doc(db, "iaConfig", rid), sanitizeForFirestore({ restaurantId: rid, retencaoDias: dias, atualizadoEm: new Date().toISOString(), atualizadoPor: pessoa!.id }), { merge: true }).catch(() => {});
  }
  async function purgarAntigos() {
    if (!rid || !retencaoDias) return;
    const corte = new Date(Date.now() - retencaoDias * 86400000).toISOString();
    const antigos = interacoes.filter(i => (i.createdAt || "") < corte);
    if (antigos.length === 0) { alert("Nenhum registro além do período de retenção."); return; }
    if (!confirm(`Expurgar ${antigos.length} registro(s) com mais de ${retencaoDias} dias? Ação irreversível.`)) return;
    setPurgando(true);
    try { await Promise.all(antigos.map(i => deleteDoc(doc(db, "iaInteracoes", i.id)))); alert(`${antigos.length} registro(s) expurgado(s).`); }
    catch (e) { alert("Erro ao expurgar: " + (e instanceof Error ? e.message : "?")); }
    finally { setPurgando(false); }
  }

  const tabBtn = (val: "diretrizes" | "registros", label: string, badge?: number) => (
    <button type="button" onClick={() => setAba(val)}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${aba === val ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>
      {label}{badge ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{badge}</span> : null}
    </button>
  );

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">🛡️ Governança de IA</h1>
      <p className="text-xs text-gray-500 mb-4">Módulo exclusivo do master. Diretrizes em blocos do que a IA pode responder, registro das interações e alertas de uso fora do escopo (LGPD).</p>

      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800 mb-4">
        {tabBtn("diretrizes", "📋 Diretrizes")}
        {tabBtn("registros", "🗂️ Registros", nFora)}
      </div>

      {aba === "diretrizes" ? (
        <div className="space-y-3">
          <div className="text-sm text-gray-500">{blocos.length} diretriz{blocos.length === 1 ? "" : "es"} nesta empresa. Cada bloco é uma regra independente; a IA checa se um novo bloco contradiz os demais.</div>

          {/* Lista de blocos */}
          {blocos.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm rounded-xl border border-dashed border-gray-200 dark:border-gray-800">Nenhuma diretriz ainda. Adicione a primeira abaixo.</div>
          ) : (
            <div className="space-y-2">
              {blocos.map((b, i) => (
                <div key={b.id} className="flex items-start gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                  <div className="flex-1 min-w-0 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">{b.texto}</div>
                  <button type="button" onClick={() => { if (confirm("Remover esta diretriz?")) removeBloco(b.id); }} className="shrink-0 text-gray-400 hover:text-rose-600 text-sm">🗑️</button>
                </div>
              ))}
            </div>
          )}

          {/* Adicionar bloco (texto/voz + checagem) */}
          <AdicionarDiretriz existentes={blocos.map(b => b.texto)} onAdd={addBloco} />

          {/* Replicar */}
          <div className="flex justify-end pt-1">
            <Button variant="secondary" onClick={() => setReplicar(true)} disabled={!carregou || blocos.length === 0}>📑 Copiar diretrizes para outras empresas</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-sm text-gray-500">{interacoes.length} interaç{interacoes.length === 1 ? "ão" : "ões"} registrada{interacoes.length === 1 ? "" : "s"}{nFora > 0 ? ` · ${nFora} fora do escopo` : ""}</div>
            <div className="flex gap-1.5 ml-auto items-center">
              <Chip active={filtro === "todas"} onClick={() => setFiltro("todas")}>Todas</Chip>
              <Chip active={filtro === "fora"} onClick={() => setFiltro("fora")}>⚠️ Fora do escopo</Chip>
              <button type="button" onClick={exportarCSV} disabled={registrosVis.length === 0} className="text-xs font-medium px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40">⬇️ CSV</button>
              <button type="button" onClick={exportarPDF} disabled={registrosVis.length === 0} className="text-xs font-medium px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40">📄 PDF</button>
            </div>
          </div>

          {/* Retenção / LGPD */}
          <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500 rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2">
            <span>🔒 Retenção:</span>
            <select value={retencaoDias} onChange={e => salvarRetencao(Number(e.target.value))} className="px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100">
              <option value={0}>Manter tudo</option>
              <option value={90}>90 dias</option>
              <option value={180}>180 dias</option>
              <option value={365}>1 ano</option>
              <option value={730}>2 anos</option>
            </select>
            {retencaoDias > 0 && <button type="button" onClick={anonimizarAntigos} disabled={purgando} className="text-indigo-600 hover:underline disabled:opacity-40">🕶️ Anonimizar antigos</button>}
            {retencaoDias > 0 && <button type="button" onClick={purgarAntigos} disabled={purgando} className="text-rose-600 hover:underline disabled:opacity-40">{purgando ? "Processando…" : `🧹 Expurgar > ${retencaoDias} dias`}</button>}
            <span className="text-[11px] text-gray-400 w-full">LGPD: <b>anonimizar</b> mantém pergunta/resposta e remove o nome; <b>expurgar</b> apaga o registro. Ações manuais sobre o que passou do período.</span>
          </div>
          {registrosVis.length === 0 ? (
            <div className="text-center py-10 text-gray-500 dark:text-gray-400 text-sm">Nenhum registro {filtro === "fora" ? "fora do escopo " : ""}ainda.</div>
          ) : (
            <div className="space-y-2">
              {registrosVis.map(i => (
                <div key={i.id} className={`rounded-xl border p-3 ${i.foraDeEscopo ? "border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-900/10" : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"}`}>
                  <button type="button" onClick={() => setAberta(aberta === i.id ? null : i.id)} className="w-full text-left">
                    <div className="flex items-center gap-2 flex-wrap">
                      {i.foraDeEscopo && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">⚠️ Fora do escopo</span>}
                      {i.foraDeEscopo && i.severidade && <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${(SEV_META[i.severidade] || SEV_META.baixa).cls}`}>{(SEV_META[i.severidade] || SEV_META.baixa).label}</span>}
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{i.anonimizado ? <span className="italic text-gray-400">🕶️ Anonimizado</span> : (i.pessoaNome || "—")}</span>
                      <span className="text-[11px] text-gray-400">{i.moduleLabel || "IA"} · {fmtBR((i.createdAt || "").slice(0, 10))}</span>
                    </div>
                    <div className="text-sm text-gray-700 dark:text-gray-300 mt-1 line-clamp-2">“{i.pergunta}”</div>
                    {i.foraDeEscopo && i.motivo && <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">Motivo: {i.motivo}</div>}
                  </button>
                  {aberta === i.id && (
                    <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                      <div className="text-[11px] font-semibold text-gray-500 mb-1">Resposta da IA</div>
                      <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{i.resposta || "—"}</div>
                      {!i.anonimizado && (
                        <div className="flex justify-end mt-2">
                          <button type="button" onClick={() => { if (confirm("Anonimizar este registro? Remove o nome da pessoa, mantém pergunta/resposta.")) anonimizar([i.id]); }} className="text-[11px] text-indigo-600 hover:underline">🕶️ Anonimizar este registro</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {replicar && <ReplicarModal blocos={blocos} restaurantes={restaurants.filter(r => r.id !== rid).map(r => ({ id: r.id, nome: r.nome }))} pessoaId={pessoa.id} onClose={() => setReplicar(false)} />}
    </div>
  );
}

// Adicionar diretriz: texto ou voz, com checagem de contradição/redundância pela IA.
function AdicionarDiretriz({ existentes, onAdd }: { existentes: string[]; onAdd: (texto: string) => void }) {
  const dit = useDitado();
  const [texto, setTexto] = useState("");
  const [checando, setChecando] = useState(false);
  const [aviso, setAviso] = useState<{ veredito: string; explicacao: string } | null>(null);
  const [erro, setErro] = useState("");
  const valor = dit.gravando ? (dit.transcricao + (dit.parcial ? (dit.transcricao ? " " : "") + dit.parcial : "")) : texto;

  function micToggle() {
    if (dit.gravando) { dit.parar(); setTexto((dit.transcricao + " " + dit.parcial).replace(/\s+/g, " ").trim()); }
    else { setErro(""); setAviso(null); dit.setTranscricao(texto); dit.setParcial(""); dit.iniciar(); }
  }

  async function verificar() {
    const nova = (dit.gravando ? (dit.transcricao + " " + dit.parcial) : texto).replace(/\s+/g, " ").trim();
    if (nova.length < 3) { setErro("Escreva ou fale a diretriz."); return; }
    if (dit.gravando) dit.parar();
    setChecando(true); setErro(""); setAviso(null);
    try {
      const r = await fetch("/api/ia-diretriz-validar", {
        method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ nova, existentes }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
      if (d.veredito === "ok") { onAdd(nova); setTexto(""); dit.setTranscricao(""); dit.setParcial(""); }
      else setAviso({ veredito: d.veredito, explicacao: d.explicacao || "" });
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao validar."); }
    finally { setChecando(false); }
  }

  function adicionarMesmoAssim() {
    const nova = valor.replace(/\s+/g, " ").trim();
    if (nova.length < 3) return;
    onAdd(nova); setTexto(""); dit.setTranscricao(""); dit.setParcial(""); setAviso(null);
  }

  return (
    <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-900/10 p-3 space-y-2">
      <div className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">➕ Nova diretriz</div>
      <div className="flex gap-2 items-start">
        <button type="button" onClick={micToggle} disabled={checando} title={dit.gravando ? "Parar" : "Ditar por voz"}
          className={`shrink-0 w-10 h-10 rounded-xl border flex items-center justify-center text-lg ${dit.gravando ? "border-rose-400 bg-rose-50 dark:bg-rose-900/20 text-rose-600" : "border-gray-300 dark:border-gray-700 text-gray-500 hover:bg-white dark:hover:bg-gray-800"}`}>{dit.gravando ? "⏹️" : "🎙️"}</button>
        <textarea value={valor} onChange={e => { setTexto(e.target.value); if (dit.gravando) dit.parar(); }} rows={2} disabled={checando}
          placeholder="Ex.: A IA não pode dar orientação jurídica que não esteja documentada."
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
      </div>
      {dit.gravando && <div className="text-[11px] text-rose-600 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse" /> Ouvindo…</div>}
      {(erro || dit.erroMic) && <div className="text-[11px] text-rose-600">{erro || dit.erroMic}</div>}
      {aviso && (
        <div className={`rounded-lg px-3 py-2 text-sm ${aviso.veredito === "contradiz" ? "bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800" : "bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800"}`}>
          <div className="font-semibold mb-0.5">{aviso.veredito === "contradiz" ? "⚠️ Contradiz uma diretriz existente" : "↔️ Parece redundante"}</div>
          <div className="text-[13px]">{aviso.explicacao}</div>
          <div className="flex gap-2 justify-end mt-2">
            <button type="button" onClick={() => setAviso(null)} className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 dark:border-gray-600">Revisar texto</button>
            <button type="button" onClick={adicionarMesmoAssim} className="text-xs px-2.5 py-1 rounded-lg bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900">Adicionar mesmo assim</button>
          </div>
        </div>
      )}
      {!aviso && (
        <div className="flex justify-end">
          <Button onClick={verificar} disabled={checando || valor.trim().length < 3}>{checando ? "Verificando…" : "Verificar e adicionar"}</Button>
        </div>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${active ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>{children}</button>
  );
}

function ReplicarModal({ blocos, restaurantes, pessoaId, onClose }: {
  blocos: DiretrizBloco[]; restaurantes: { id: string; nome: string }[]; pessoaId: string; onClose: () => void;
}) {
  const [sel, setSel] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const toggle = (id: string) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  async function copiar() {
    if (sel.length === 0) return;
    setSalvando(true);
    try {
      const now = new Date().toISOString();
      await Promise.all(sel.map(id => setDoc(doc(db, "iaConfig", id), sanitizeForFirestore({
        restaurantId: id, diretrizesBlocos: blocos, diretrizes: juntarBlocos(blocos), atualizadoEm: now, atualizadoPor: pessoaId,
      }), { merge: true })));
      alert(`Diretrizes copiadas para ${sel.length} empresa(s).`);
      onClose();
    } catch (e) { alert("Erro ao copiar: " + (e instanceof Error ? e.message : "?")); }
    finally { setSalvando(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md p-5 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">📑 Copiar diretrizes</h2>
        <p className="text-xs text-gray-500 mt-1 mb-3">Os {blocos.length} blocos atuais vão substituir as diretrizes das empresas marcadas.</p>
        {restaurantes.length === 0 ? (
          <div className="text-sm text-gray-500 py-4 text-center">Você não tem outras empresas pra copiar.</div>
        ) : (
          <div className="space-y-1.5 mb-4">
            {restaurantes.map(r => (
              <label key={r.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
                <input type="checkbox" checked={sel.includes(r.id)} onChange={() => toggle(r.id)} />{r.nome}
              </label>
            ))}
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={copiar} disabled={salvando || sel.length === 0}>{salvando ? "Copiando…" : `Copiar para ${sel.length || ""}`}</Button>
        </div>
      </div>
    </div>
  );
}
