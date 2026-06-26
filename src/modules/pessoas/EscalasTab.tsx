// Catálogo de escalas nomeadas (reutilizáveis). Cadastra-se uma vez aqui e
// depois atribui-se a vários empregados (a atribuição faz snapshot dos dias
// numa vigência de workSchedules — ver HorariosTab). Editar a escala aqui NÃO
// mexe em quem já está vinculado.
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { WEEKDAYS, calcDayHours, fmtHHMM, emptyDays, validateWorkScheduleDays, timeToMin } from "../../core/escala/horarios";
import type { EscalaNomeada, HorarioDia } from "../../core/types";

type Days = { [k: number]: HorarioDia };
// Minutos de intervalo: da JANELA (intervalIn/intervalOut), quando houver; senão
// cai no campo legado `break` (duração). Mantém os totais e o ponto coerentes.
const breakMin = (d: HorarioDia): number =>
  (d.intervalIn && d.intervalOut) ? Math.max(0, timeToMin(d.intervalOut) - timeToMin(d.intervalIn)) : (d.break || 0);
const totalDias = (days: Days): number =>
  WEEKDAYS.reduce((s, wd) => { const d = days[wd.idx]; return d?.active ? s + calcDayHours(d.in, d.out, breakMin(d)).totalContract : s; }, 0);
const algumDiaAtivo = (days: Days): boolean => WEEKDAYS.some((wd) => days[wd.idx]?.active);
// Grava `break` derivado da janela (retrocompat com quem só lê duração).
const normalizarDias = (days: Days): Days => {
  const out: Days = {};
  for (const wd of WEEKDAYS) {
    const d = days[wd.idx];
    if (!d?.active) { out[wd.idx] = { active: false }; continue; }
    out[wd.idx] = {
      active: true, in: d.in, out: d.out, break: breakMin(d),
      ...(d.intervalIn ? { intervalIn: d.intervalIn } : {}),
      ...(d.intervalOut ? { intervalOut: d.intervalOut } : {}),
    };
  }
  return out;
};

export function EscalasTab({ restaurantId }: { restaurantId: string }) {
  const [escalas, setEscalas] = useState<EscalaNomeada[]>([]);
  const [editar, setEditar] = useState<EscalaNomeada | null>(null);
  const [nova, setNova] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!restaurantId) return;
    const q = query(collection(db, "escalasNomeadas"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => setEscalas(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as EscalaNomeada)));
    return () => unsub();
  }, [restaurantId]);

  const ativas = useMemo(() => escalas.filter((e) => e.ativo).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")), [escalas]);
  const arquivadas = useMemo(() => escalas.filter((e) => !e.ativo).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")), [escalas]);

  async function arquivar(e: EscalaNomeada, ativo: boolean) {
    try { await updateDoc(doc(db, "escalasNomeadas", e.id), { ativo, atualizadoEm: new Date().toISOString() }); }
    catch (err) { setErro(err instanceof Error ? err.message : "Falha ao arquivar."); }
  }
  async function excluir(e: EscalaNomeada) {
    if (!window.confirm(`Excluir a escala "${e.nome}"?\n\nEmpregados já vinculados NÃO são afetados (a vigência deles é um snapshot). Some só do catálogo.`)) return;
    try { await deleteDoc(doc(db, "escalasNomeadas", e.id)); }
    catch (err) { setErro(err instanceof Error ? err.message : "Falha ao excluir."); }
  }

  const Card = ({ e }: { e: EscalaNomeada }) => (
    <div className={`rounded-xl border p-3 flex items-center justify-between gap-3 ${e.ativo ? "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800" : "bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-800 opacity-80"}`}>
      <button type="button" onClick={() => setEditar(e)} className="min-w-0 text-left flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-800 dark:text-gray-100 truncate">{e.nome}</span>
          <span className="text-[11px] text-gray-500 tabular-nums">{fmtHHMM(e.totalContract)}/sem</span>
        </div>
        {e.descricao && <div className="text-[11px] text-gray-400 truncate mt-0.5">{e.descricao}</div>}
      </button>
      <div className="flex items-center gap-1.5 shrink-0">
        <Button size="sm" variant="secondary" onClick={() => setEditar(e)}>✏️ Editar</Button>
        <Button size="sm" variant="secondary" onClick={() => void arquivar(e, !e.ativo)}>{e.ativo ? "📦 Arquivar" : "↩ Reativar"}</Button>
        <button type="button" onClick={() => void excluir(e)} title="Excluir" className="text-gray-400 hover:text-rose-600 px-1">🗑</button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">Cadastre escalas reutilizáveis e depois atribua a vários empregados na aba <strong>Horários</strong> de cada um.</p>
        <Button size="sm" onClick={() => setNova(true)}>+ Nova escala</Button>
      </div>
      {erro && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}

      {ativas.length === 0 ? (
        <div className="text-center text-sm text-gray-400 py-12 border border-dashed border-gray-200 dark:border-gray-800 rounded-xl">Nenhuma escala cadastrada ainda. Crie a primeira em "+ Nova escala".</div>
      ) : (
        <div className="space-y-2">{ativas.map((e) => <Card key={e.id} e={e} />)}</div>
      )}

      {arquivadas.length > 0 && (
        <details className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-200">📦 Arquivadas <span className="text-gray-400 font-normal">({arquivadas.length})</span></summary>
          <div className="px-3 pb-3 space-y-2">{arquivadas.map((e) => <Card key={e.id} e={e} />)}</div>
        </details>
      )}

      {(nova || editar) && (
        <EscalaModal
          restaurantId={restaurantId}
          escala={editar}
          onClose={() => { setNova(false); setEditar(null); }}
          onSaved={() => { setNova(false); setEditar(null); }}
        />
      )}
    </div>
  );
}

// ─── Modal: criar/editar escala nomeada (1 padrão semanal) ──────────────────
function EscalaModal({ restaurantId, escala, onClose, onSaved }: {
  restaurantId: string;
  escala: EscalaNomeada | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { pessoa: me } = useAuth();
  const [nome, setNome] = useState(escala?.nome || "");
  const [descricao, setDescricao] = useState(escala?.descricao || "");
  const [days, setDays] = useState<Days>(() => escala?.days || emptyDays());
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const patchDia = (idx: number, patch: Partial<HorarioDia>) => setDays((d) => ({ ...d, [idx]: { ...(d[idx] || { active: false }), ...patch } }));
  const limparDia = (idx: number) => setDays((d) => ({ ...d, [idx]: { active: false } }));
  const daysNorm = useMemo(() => normalizarDias(days), [days]);
  const erros = useMemo(() => validateWorkScheduleDays(daysNorm, 0, 99999).errors, [daysNorm]);
  const intervaloInvalido = WEEKDAYS.some((wd) => {
    const d = days[wd.idx];
    if (!d?.active || !(d.intervalIn && d.intervalOut)) return false;
    return timeToMin(d.intervalOut) <= timeToMin(d.intervalIn);
  });

  async function salvar() {
    setErro("");
    if (!nome.trim()) { setErro("Dê um nome pra escala."); return; }
    if (!algumDiaAtivo(days)) { setErro("Marque ao menos um dia ativo."); return; }
    if (intervaloInvalido) { setErro("Em algum dia o fim do intervalo está antes do início."); return; }
    setSalvando(true);
    try {
      const agora = new Date().toISOString();
      const payload: Omit<EscalaNomeada, "id"> = {
        restaurantId, nome: nome.trim(), descricao: descricao.trim() || undefined,
        totalContract: totalDias(days), days: daysNorm,
        ativo: escala?.ativo ?? true,
        criadoEm: escala?.criadoEm || agora, criadoPor: escala?.criadoPor || me?.id || "", atualizadoEm: agora,
      };
      const limpo = sanitizeForFirestore(payload);
      if (escala) await updateDoc(doc(db, "escalasNomeadas", escala.id), limpo as Record<string, unknown>);
      else await addDoc(collection(db, "escalasNomeadas"), limpo);
      onSaved();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar a escala.");
    } finally { setSalvando(false); }
  }

  return (
    <Modal title={escala ? "✏️ Editar escala" : "📆 Nova escala"} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-4">
        {erro && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}
        <p className="text-[12px] text-gray-500 dark:text-gray-400">Uma escala = um padrão semanal fixo. Pra alternar escalas (inclusive folga de domingo em ciclo), cadastre uma escala por padrão e componha a alternância no cadastro do empregado.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Nome da escala *" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex: Comercial 8h–17h" />
          <Input label="Descrição (opcional)" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="ex: Cozinha — folga aos domingos" />
        </div>

        <DiasGrid days={days} onPatch={patchDia} onLimpar={limparDia} />
        {erros.length > 0 && (
          <div className="text-[11px] text-amber-700 dark:text-amber-400 space-y-0.5">{erros.map((er, i) => <div key={i}>⚠ {er.mensagem} <span className="opacity-60">({er.artigo})</span></div>)}</div>
        )}

        <div className="flex items-center justify-between pt-1">
          <span className="text-[12px] text-gray-500">Carga semanal: <strong className="tabular-nums">{fmtHHMM(totalDias(days))}</strong></span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={salvando} onClick={onClose}>Cancelar</Button>
            <Button size="sm" disabled={salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar escala"}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── Grid de dias: entrada · intervalo (de/até) · saída ─────────────────────
// Intervalo como JANELA (início/fim) — espelha a Sólides. Em branco = sem intervalo.
function DiasGrid({ days, onPatch, onLimpar }: { days: Days; onPatch: (idx: number, patch: Partial<HorarioDia>) => void; onLimpar: (idx: number) => void }) {
  const cols = "grid-cols-[52px_40px_1fr_1fr_1fr_1fr_58px_26px]";
  const inp = "w-full px-1 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 disabled:opacity-40";
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden bg-white dark:bg-gray-900">
      <div className={`grid ${cols} gap-1 px-3 py-2 bg-gray-50 dark:bg-gray-800 text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400`}>
        <div>Dia</div><div className="text-center">Ativo</div><div className="text-center">Entrada</div><div className="text-center">Int. de</div><div className="text-center">Int. até</div><div className="text-center">Saída</div><div className="text-right">Contr.</div><div></div>
      </div>
      {WEEKDAYS.map((wd) => {
        const d = days[wd.idx] || { active: false };
        const calc = d.active ? calcDayHours(d.in, d.out, breakMin(d)) : null;
        return (
          <div key={wd.idx} className={`grid ${cols} gap-1 px-3 py-2 items-center border-t border-gray-100 dark:border-gray-800 text-sm`}>
            <div className="font-medium text-gray-700 dark:text-gray-300">{wd.short}</div>
            <div className="text-center"><input type="checkbox" checked={!!d.active} onChange={(e) => onPatch(wd.idx, { active: e.target.checked })} /></div>
            <div><input type="time" disabled={!d.active} value={d.in || ""} onChange={(e) => onPatch(wd.idx, { in: e.target.value })} className={inp} /></div>
            <div><input type="time" disabled={!d.active} value={d.intervalIn || ""} onChange={(e) => onPatch(wd.idx, { intervalIn: e.target.value || undefined })} className={inp} title="Início do intervalo (em branco = sem intervalo)" /></div>
            <div><input type="time" disabled={!d.active} value={d.intervalOut || ""} onChange={(e) => onPatch(wd.idx, { intervalOut: e.target.value || undefined })} className={inp} title="Fim do intervalo (volta)" /></div>
            <div><input type="time" disabled={!d.active} value={d.out || ""} onChange={(e) => onPatch(wd.idx, { out: e.target.value })} className={inp} /></div>
            <div className="text-right text-xs text-gray-700 dark:text-gray-300 tabular-nums">{calc ? fmtHHMM(calc.totalContract) : "—"}</div>
            <div className="text-center">{d.active && <button type="button" onClick={() => onLimpar(wd.idx)} title="Limpar" className="text-xs text-gray-400 hover:text-rose-600">✕</button>}</div>
          </div>
        );
      })}
    </div>
  );
}

