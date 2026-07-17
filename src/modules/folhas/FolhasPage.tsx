// Conferência de Folhas de Pagamento — auditor por empresa/competência.
// Sobe os espelhos (PDF) → parser (Claude) → motor de regras (código puro) →
// findings P0/P1/P2. NÃO reporta o que está certo. Ver briefing.
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, doc, onSnapshot, query, where, setDoc, deleteDoc } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { authHeader } from "../../core/firebase/idToken";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { reportarFalha } from "../../core/monitor/reportarFalha";
import type { Gorjeta, Empregado } from "../../core/types";
import { conferir, findingsReportaveis } from "./regras";
import { gorjetaMensalPorCpf } from "./gorjetaMensal";
import { cpfDigits, type FolhaEspelho, type Finding, type FolhaWhitelistItem, type FolhaTipo } from "./tipos";

const brl = (n?: number) => (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const maskCpf = (c: string) => { const d = cpfDigits(c); return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : c; };
const mesAtual = () => new Date().toISOString().slice(0, 7);

const SEV_META: Record<string, { label: string; cls: string; dot: string }> = {
  P0: { label: "P0 · bloqueia pagamento", cls: "border-rose-300 bg-rose-50 dark:bg-rose-900/20 dark:border-rose-800", dot: "bg-rose-500" },
  P1: { label: "P1 · erro provável", cls: "border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800", dot: "bg-amber-500" },
  P2: { label: "P2 · confirmar", cls: "border-sky-300 bg-sky-50 dark:bg-sky-900/20 dark:border-sky-800", dot: "bg-sky-500" },
};

export function FolhasPage() {
  const { pessoa: me } = useAuth();
  const { rid } = useParams<{ rid: string }>();
  const { activeRestaurant } = useRestaurant();
  const isMaster = !!me?.isMaster;
  const { can } = useCanAcao(rid || "");
  const podeVer = isMaster || can("folhas", "ver");
  const podeConferir = isMaster || can("folhas", "conferir");
  const podeWhitelist = isMaster || can("folhas", "whitelist");

  const [competencia, setCompetencia] = useState(mesAtual);
  const [folha, setFolha] = useState<FolhaEspelho | null>(null);
  const [adiantamento, setAdiantamento] = useState<FolhaEspelho | null>(null);
  const [gorjetas, setGorjetas] = useState<Gorjeta[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [whitelist, setWhitelist] = useState<FolhaWhitelistItem[]>([]);
  const [subindo, setSubindo] = useState<FolhaTipo | null>(null);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<"conferencia" | "whitelist">("conferencia");
  const folhaRef = useRef<HTMLInputElement | null>(null);
  const adiantRef = useRef<HTMLInputElement | null>(null);

  // ── Assinaturas ──
  useEffect(() => {
    if (!rid) return;
    const u1 = onSnapshot(query(collection(db, "gorjetas"), where("restaurantId", "==", rid)), (s) => setGorjetas(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Gorjeta)), () => setGorjetas([]));
    const u2 = onSnapshot(query(collection(db, "empregados"), where("restaurantId", "==", rid)), (s) => setEmpregados(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Empregado)), () => setEmpregados([]));
    const u3 = onSnapshot(query(collection(db, "folhasWhitelist"), where("restaurantId", "==", rid)), (s) => setWhitelist(s.docs.map((d) => ({ id: d.id, ...d.data() }) as FolhaWhitelistItem)), () => setWhitelist([]));
    return () => { u1(); u2(); u3(); };
  }, [rid]);

  // ── Gorjeta do mês por CPF + conferência (memo determinístico) ──
  const { porCpf } = useMemo(() => gorjetaMensalPorCpf(gorjetas, empregados, competencia), [gorjetas, empregados, competencia]);

  const findings = useMemo<Finding[] | null>(() => {
    if (!folha) return null;
    return conferir({ folha, adiantamento: adiantamento || undefined, gorjetaApp: porCpf, whitelist, competencia });
  }, [folha, adiantamento, porCpf, whitelist, competencia]);
  const reportaveis = useMemo(() => (findings ? findingsReportaveis(findings) : []), [findings]);
  const silenciados = useMemo(() => (findings ? findings.filter((f) => f.whitelisted) : []), [findings]);

  const resumoFolha = useMemo(() => {
    if (!folha) return null;
    const ativos = folha.colaboradores.filter((c) => c.situacao?.tipo !== "demitido");
    return { headcount: ativos.length, liquido: folha.resumoGeral?.liquido, gps: folha.gps };
  }, [folha]);

  async function subir(file: File, tipo: FolhaTipo) {
    if (!rid) return;
    setErro(""); setSubindo(tipo);
    try {
      const path = `folhas/${rid}/${competencia}/${tipo}_${Date.now()}.pdf`;
      const snap = await uploadBytes(storageRef(storage, path), file, { contentType: "application/pdf" });
      const url = await getDownloadURL(snap.ref);
      const r = await fetch("/api/folha-extrair", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ pdfUrl: url, tipo }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.espelho) throw new Error((data as { error?: string }).error || `Erro ${r.status}`);
      const esp = data.espelho as FolhaEspelho;
      if (tipo === "folha") setFolha(esp); else setAdiantamento(esp);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErro(`Falha ao ler o ${tipo}: ${msg}`);
      reportarFalha("Conferência de folhas · extrair", e, { restaurantId: rid, contexto: `${tipo} ${competencia}` });
    } finally { setSubindo(null); }
  }

  async function fecharCompetencia() {
    if (!rid || !folha || !findings) return;
    try {
      const id = `${rid}_${competencia}`;
      await setDoc(doc(db, "folhasConferencia", id), sanitizeForFirestore({
        id, restaurantId: rid, competencia, folha, adiantamento: adiantamento || null,
        findings, status: reportaveis.length ? "com_pendencias" : "fechada",
        resumo: { liquidoClt: resumoFolha?.liquido, headcount: resumoFolha?.headcount, gps: resumoFolha?.gps },
        criadoEm: new Date().toISOString(), criadoPor: me?.id || "",
        fechadaEm: new Date().toISOString(), fechadaPor: me?.id || "",
      }), { merge: true });
      setErro("✓ Competência salva como baseline.");
    } catch (e) { setErro("Erro ao salvar: " + (e instanceof Error ? e.message : "?")); }
  }

  if (!podeVer) return <div className="p-6 text-sm text-gray-500">Você não tem acesso à Conferência de Folhas.</div>;

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">🧾 Conferência de Folhas</h1>
          <p className="text-sm text-gray-500">{activeRestaurant?.nome || "—"} · audita a folha do Senador contra gorjeta, adiantamento e integridade.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Competência</label>
          <input type="month" value={competencia} onChange={(e) => { setCompetencia(e.target.value); setFolha(null); setAdiantamento(null); }} className="px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
        </div>
      </header>

      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-800">
        {([["conferencia", "Conferência"], ["whitelist", "Exceções"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setAba(k)} className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${aba === k ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500"}`}>{l}</button>
        ))}
      </div>

      {aba === "conferencia" ? (
        <>
          {/* Upload */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {([["folha", "Espelho da folha mensal", folha], ["adiantamento", "Espelho de adiantamento (opcional)", adiantamento]] as const).map(([tipo, label, val]) => (
              <div key={tipo} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{label}</span>
                  {val && <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">✓ lido</span>}
                </div>
                {val && <p className="text-[11px] text-gray-400 mt-0.5">{val.colaboradores.length} colaboradores · líquido {brl(val.resumoGeral?.liquido)}</p>}
                {podeConferir && (
                  <>
                    <input ref={tipo === "folha" ? folhaRef : adiantRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f, tipo); e.target.value = ""; }} />
                    <button type="button" disabled={subindo === tipo} onClick={() => (tipo === "folha" ? folhaRef : adiantRef).current?.click()} className="mt-2 text-xs px-3 py-1.5 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 disabled:opacity-50">
                      {subindo === tipo ? "lendo PDF…" : val ? "trocar PDF" : "📄 subir PDF"}
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          {erro && <div className={`text-sm rounded-lg px-3 py-2 ${erro.startsWith("✓") ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400" : "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400"}`}>{erro}</div>}

          {/* Resultado */}
          {folha && findings && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap text-xs text-gray-500">
                <span>👥 {resumoFolha?.headcount} ativos</span>
                <span>💵 líquido {brl(resumoFolha?.liquido)}</span>
                {resumoFolha?.gps ? <span>🏛️ GPS {brl(resumoFolha.gps)}</span> : null}
                <span>💸 {Object.keys(porCpf).length} com gorjeta no app</span>
              </div>

              {reportaveis.length === 0 ? (
                <div className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-4 text-sm text-emerald-800 dark:text-emerald-300">
                  ✓ Nada a corrigir nesta competência. {silenciados.length ? `(${silenciados.length} silenciado(s) por exceção.)` : ""}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">{reportaveis.length} {reportaveis.length === 1 ? "pendência" : "pendências"}</p>
                  {reportaveis.map((f, i) => {
                    const m = SEV_META[f.severidade] || SEV_META.P2;
                    return (
                      <div key={i} className={`rounded-xl border p-3 ${m.cls}`}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`w-2 h-2 rounded-full ${m.dot}`} />
                          <span className="text-[11px] font-bold uppercase text-gray-600 dark:text-gray-300">{m.label}</span>
                          <span className="text-[11px] text-gray-400">Bloco {f.bloco} · {f.tipo}</span>
                          {f.colaborador && <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 ml-auto">{f.colaborador}{f.cpf ? ` · ${maskCpf(f.cpf)}` : ""}</span>}
                        </div>
                        <p className="text-sm text-gray-800 dark:text-gray-200 mt-1.5">{f.explicacao}</p>
                        {(f.esperado != null || f.encontrado != null) && (
                          <div className="text-xs text-gray-500 mt-1 flex gap-3">
                            {f.esperado != null && <span>esperado {brl(f.esperado)}</span>}
                            {f.encontrado != null && <span>encontrado {brl(f.encontrado)}</span>}
                            {f.delta != null && <span className="font-semibold">Δ {brl(f.delta)}</span>}
                          </div>
                        )}
                        {f.acao && <p className="text-xs text-gray-500 mt-1">→ {f.acao}</p>}
                        {podeWhitelist && f.cpf && (
                          <button type="button" onClick={() => void addWhitelist(f)} className="mt-1.5 text-[11px] text-gray-400 hover:text-gray-700 underline">silenciar (criar exceção)</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {silenciados.length > 0 && (
                <details className="text-xs text-gray-500">
                  <summary className="cursor-pointer">{silenciados.length} silenciado(s) por exceção</summary>
                  <ul className="mt-1 space-y-1 pl-3">
                    {silenciados.map((f, i) => <li key={i}>• {f.colaborador} · {f.tipo}</li>)}
                  </ul>
                </details>
              )}

              {podeConferir && (
                <div className="flex justify-end">
                  <button type="button" onClick={() => void fecharCompetencia()} className="text-sm font-semibold px-4 py-2 rounded-lg bg-emerald-600 text-white">💾 Salvar competência (baseline)</button>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <WhitelistTab rid={rid || ""} whitelist={whitelist} podeEditar={podeWhitelist} meId={me?.id || ""} />
      )}
    </div>
  );

  async function addWhitelist(f: Finding) {
    if (!rid || !f.cpf) return;
    const motivo = prompt(`Exceção para ${f.colaborador} (${maskCpf(f.cpf)}).\nPor quê silenciar "${f.tipo}"?`);
    if (!motivo) return;
    const tipoWl = f.tipo.startsWith("adiantamento") ? "sem_adiantamento" : f.tipo.startsWith("cadastral") || f.tipo.startsWith("lote") ? "cadastral" : "geral";
    const id = `wl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await setDoc(doc(db, "folhasWhitelist", id), sanitizeForFirestore({
      id, restaurantId: rid, cpf: cpfDigits(f.cpf), tipo: tipoWl, motivo, inicio: `${competencia}-01`, criadoEm: new Date().toISOString(), criadoPor: me?.id || "",
    }));
  }
}

// ── Aba de exceções ──
function WhitelistTab({ rid, whitelist, podeEditar, meId }: { rid: string; whitelist: FolhaWhitelistItem[]; podeEditar: boolean; meId: string }) {
  const [cpf, setCpf] = useState(""); const [tipo, setTipo] = useState("geral"); const [motivo, setMotivo] = useState("");
  async function add() {
    if (!rid || cpfDigits(cpf).length !== 11 || !motivo.trim()) return;
    const id = `wl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await setDoc(doc(db, "folhasWhitelist", id), sanitizeForFirestore({ id, restaurantId: rid, cpf: cpfDigits(cpf), tipo, motivo: motivo.trim(), criadoEm: new Date().toISOString(), criadoPor: meId }));
    setCpf(""); setMotivo("");
  }
  const TIPOS = [["geral", "Silenciar tudo"], ["sem_adiantamento", "Opt-out de adiantamento"], ["acidente", "Acidente / afastamento"], ["cadastral", "Divergência cadastral"], ["prolabore_duplo", "Pró-labore duplo"]];
  return (
    <div className="space-y-3">
      {podeEditar && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 flex flex-wrap gap-2 items-end">
          <div><label className="text-[11px] text-gray-500 block">CPF</label><input value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" className="px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 w-40" /></div>
          <div><label className="text-[11px] text-gray-500 block">Tipo</label><select value={tipo} onChange={(e) => setTipo(e.target.value)} className="px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100">{TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div className="flex-1 min-w-[180px]"><label className="text-[11px] text-gray-500 block">Motivo</label><input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ex.: opta por não receber adiantamento" className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" /></div>
          <button type="button" onClick={() => void add()} disabled={cpfDigits(cpf).length !== 11 || !motivo.trim()} className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-50">Adicionar</button>
        </div>
      )}
      {whitelist.length === 0 ? <p className="text-sm text-gray-400">Nenhuma exceção cadastrada.</p> : (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {whitelist.map((w) => (
            <div key={w.id} className="flex items-center gap-2 p-2.5 text-sm">
              <span className="font-mono text-xs text-gray-500">{maskCpf(w.cpf)}</span>
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">{w.tipo}</span>
              <span className="text-gray-700 dark:text-gray-200 flex-1">{w.motivo}</span>
              {podeEditar && <button type="button" onClick={() => void deleteDoc(doc(db, "folhasWhitelist", w.id))} className="text-gray-300 hover:text-rose-600">✕</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
