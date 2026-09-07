// ════════════════════════════════════════════════════════════════════════════
//  PTRP · Turnos — templates de horário de trabalho (sem data). A Escala mensal
//  aloca um turno (ou folga) em cada dia; a apuração compara as batidas contra
//  o turno previsto do dia. Por empresa.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import type { PtrpTurno } from "../../core/ptrp/tipos";

const inp = "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";
const lbl = "text-xs font-semibold text-gray-600 dark:text-gray-400";

function cargaPrevista(t: Pick<PtrpTurno, "janelas" | "intervaloMin">): number {
  let m = 0;
  for (const j of t.janelas) { const [ih, im] = j.in.split(":").map(Number); const [oh, om] = j.out.split(":").map(Number); m += Math.max(0, (oh * 60 + om) - (ih * 60 + im)); }
  return Math.max(0, m - (t.intervaloMin || 0));
}
const hm = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;

export function PtrpTurnosTab() {
  const { pessoa: me } = useAuth();
  const [empresas, setEmpresas] = useState<string[]>([]);
  const [empresa, setEmpresa] = useState("");
  const [turnos, setTurnos] = useState<PtrpTurno[]>([]);
  const [edit, setEdit] = useState<PtrpTurno | null>(null);
  const [novo, setNovo] = useState(false);

  useEffect(() => onSnapshot(collection(db, "ptrpSyncState"), s => {
    const ks = s.docs.map(d => d.id).sort();
    setEmpresas(ks); setEmpresa(e => e || ks[0] || "");
  }), []);
  useEffect(() => onSnapshot(collection(db, "ptrpTurnos"), s => setTurnos(s.docs.map(d => ({ id: d.id, ...d.data() }) as PtrpTurno))), []);

  const lista = useMemo(() => turnos.filter(t => t.empresaKey === empresa).sort((a, b) => a.nome.localeCompare(b.nome)), [turnos, empresa]);

  async function remover(t: PtrpTurno) { if (confirm(`Excluir o turno "${t.nome}"?`)) await deleteDoc(doc(db, "ptrpTurnos", t.id)); }

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <select value={empresa} onChange={e => setEmpresa(e.target.value)} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100">
          {empresas.length === 0 && <option value="">— sem empresas (rode o sync) —</option>}
          {empresas.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <Button size="sm" onClick={() => setNovo(true)} disabled={!empresa}>＋ Novo turno</Button>
      </div>
      {lista.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-500">Nenhum turno pra <strong>{empresa || "—"}</strong>. Crie um, ou importe do Sólides (em breve).</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {lista.map(t => (
            <div key={t.id} className={`rounded-xl border p-3 ${t.ativo === false ? "opacity-60 border-gray-200 dark:border-gray-800" : "border-gray-200 dark:border-gray-800"} bg-white dark:bg-gray-900`}>
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{t.nome}</div>
                <div className="flex gap-1 shrink-0">
                  <button type="button" onClick={() => setEdit(t)} className="text-indigo-500 hover:text-indigo-600 text-xs" title="Editar">✏️</button>
                  <button type="button" onClick={() => void remover(t)} className="text-rose-500 hover:text-rose-600 text-xs" title="Excluir">✕</button>
                </div>
              </div>
              <div className="mt-1 text-[12.5px] text-gray-600 dark:text-gray-300">
                {t.janelas.map((j, i) => <span key={i}>{i > 0 ? " · " : ""}{j.in}–{j.out}</span>)}
                {t.intervaloMin ? <span className="text-gray-400"> · int {t.intervaloMin}min</span> : null}
              </div>
              <div className="mt-0.5 text-[11px] text-gray-400">
                carga {hm(cargaPrevista(t))}{t.preAssinalarIntervalo ? " · pré-assinala int." : ""}{t.adicionalNoturno ? " · noturno" : ""}{t.repeticao ? ` · ${t.repeticao.tipo}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
      {(novo || edit) && me && <TurnoModal empresa={empresa} editar={edit} onClose={() => { setNovo(false); setEdit(null); }} />}
    </div>
  );
}

function TurnoModal({ empresa, editar, onClose }: { empresa: string; editar: PtrpTurno | null; onClose: () => void }) {
  const [nome, setNome] = useState(editar?.nome || "");
  const [j1in, setJ1in] = useState(editar?.janelas?.[0]?.in || "11:00");
  const [j1out, setJ1out] = useState(editar?.janelas?.[0]?.out || "15:00");
  const [temJ2, setTemJ2] = useState(!!editar?.janelas?.[1]);
  const [j2in, setJ2in] = useState(editar?.janelas?.[1]?.in || "17:00");
  const [j2out, setJ2out] = useState(editar?.janelas?.[1]?.out || "23:00");
  const [intervaloMin, setIntervaloMin] = useState(String(editar?.intervaloMin ?? 60));
  const [tolerancia, setTolerancia] = useState(String(editar?.toleranciaEntradaMin ?? 5));
  const [preAssinala, setPreAssinala] = useState(!!editar?.preAssinalarIntervalo);
  const [noturno, setNoturno] = useState(!!editar?.adicionalNoturno);
  const [repeticao, setRepeticao] = useState<string>(editar?.repeticao?.tipo || "");
  const [ativo, setAtivo] = useState(editar?.ativo !== false);
  const [salvando, setSalvando] = useState(false);
  const [err, setErr] = useState("");

  async function salvar() {
    if (!nome.trim()) { setErr("Dê um nome ao turno."); return; }
    setErr(""); setSalvando(true);
    try {
      const janelas = [{ in: j1in, out: j1out }, ...(temJ2 ? [{ in: j2in, out: j2out }] : [])];
      const t: Omit<PtrpTurno, "id"> = {
        empresaKey: empresa, nome: nome.trim(), janelas,
        intervaloMin: Number(intervaloMin) || 0,
        toleranciaEntradaMin: Number(tolerancia) || 0,
        preAssinalarIntervalo: preAssinala,
        adicionalNoturno: noturno,
        ...(repeticao ? { repeticao: { tipo: repeticao as "12x36" | "5x1" | "6x1" | "semanal" } } : {}),
        ativo,
      };
      if (editar) await setDoc(doc(db, "ptrpTurnos", editar.id), sanitizeForFirestore({ id: editar.id, ...t }));
      else await addDoc(collection(db, "ptrpTurnos"), sanitizeForFirestore(t));
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : "Falha ao salvar."); setSalvando(false); }
  }

  return (
    <Modal title={editar ? "Editar turno" : "Novo turno"} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <div className="flex flex-col gap-1"><label className={lbl}>Nome</label><input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex.: Salão 11–15 / 17–23" className={inp} /></div>
        <div>
          <label className={lbl}>1ª janela</label>
          <div className="grid grid-cols-2 gap-2 mt-1"><input type="time" value={j1in} onChange={e => setJ1in(e.target.value)} className={inp} /><input type="time" value={j1out} onChange={e => setJ1out(e.target.value)} className={inp} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" checked={temJ2} onChange={e => setTemJ2(e.target.checked)} /> Tem 2ª janela (jornada partida)</label>
        {temJ2 && <div className="grid grid-cols-2 gap-2"><input type="time" value={j2in} onChange={e => setJ2in(e.target.value)} className={inp} /><input type="time" value={j2out} onChange={e => setJ2out(e.target.value)} className={inp} /></div>}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1"><label className={lbl}>Intervalo (min)</label><input type="number" value={intervaloMin} onChange={e => setIntervaloMin(e.target.value)} className={inp} /></div>
          <div className="flex flex-col gap-1"><label className={lbl}>Tolerância entrada (min)</label><input type="number" value={tolerancia} onChange={e => setTolerancia(e.target.value)} className={inp} /></div>
        </div>
        <div className="flex flex-col gap-1"><label className={lbl}>Repetição (padrão do ciclo)</label>
          <select value={repeticao} onChange={e => setRepeticao(e.target.value)} className={inp}>
            <option value="">— nenhuma (escala mensal define o dia) —</option>
            <option value="12x36">12x36</option><option value="5x1">5x1</option><option value="6x1">6x1</option><option value="semanal">Semanal</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" checked={preAssinala} onChange={e => setPreAssinala(e.target.checked)} /> Pré-assinalar intervalo (CCT SP cadastrada — sistema gera a marcação do intervalo)</label>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" checked={noturno} onChange={e => setNoturno(e.target.checked)} /> Cruza a faixa noturna (adicional)</label>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)} /> Ativo</label>
        {err && <div className="text-sm text-rose-600">{err}</div>}
        <div className="flex justify-end gap-2 pt-1"><Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button><Button onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button></div>
      </div>
    </Modal>
  );
}
