// ════════════════════════════════════════════════════════════════════════════
//  PTRP · Editor completo dos parâmetros de uma CCT (por empresa/vigência).
//  Cada premissa aparece DESCRITA e EDITÁVEL. "Carregar de um modelo" pré-
//  preenche com uma das 3 CCTs do grupo; depois é tudo ajustável e salvável.
// ════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import type { ParametrosCCT, TipoAbono, FeriadoMunicipal } from "../../core/ptrp/tipos";
import { cctQuibebe, cctSaoPaulo, cctBelem } from "../../core/ptrp/cctTemplates";

const inp = "w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";
const lbl = "text-[12px] font-semibold text-gray-700 dark:text-gray-200";
const desc = "text-[11px] text-gray-400 leading-tight";

function cctVazia(empresaKey: string): ParametrosCCT {
  return {
    id: `${empresaKey}_${new Date().toISOString().slice(0, 10)}`, empresaKey, cctNome: "", sindicato: "",
    vigenciaDe: "", vigenciaAte: "", vigente: true,
    extras: { faixa1Perc: 50, faixa1AteHoras: null, faixa2Perc: null, domingoPerc: null, feriadoPerc: null, diaCompensadoPerc: null },
    adicionalNoturno: { perc: 20, inicio: "22:00", fim: "05:00", horaReduzidaMin: null },
    enquadramentoPiso: null, regimeCompensacao: "banco", prazoCompensacaoDias: 90, limiteSaldoNegativoHoras: null,
    interjornadaMinHoras: 11, tiposAbono: [], pendencias: [],
  };
}

// Campo numérico (aceita vazio = null p/ opcionais).
function Num({ label, d, value, onChange, req }: { label: string; d?: string; value: number | null | undefined; onChange: (v: number | null) => void; req?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className={lbl}>{label}</label>
      <input type="number" value={value ?? ""} onChange={e => onChange(e.target.value === "" ? (req ? 0 : null) : Number(e.target.value))} className={inp} />
      {d && <span className={desc}>{d}</span>}
    </div>
  );
}
function Txt({ label, d, value, onChange, ph, type = "text" }: { label: string; d?: string; value: string | undefined; onChange: (v: string) => void; ph?: string; type?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className={lbl}>{label}</label>
      <input type={type} value={value ?? ""} placeholder={ph} onChange={e => onChange(e.target.value)} className={inp} />
      {d && <span className={desc}>{d}</span>}
    </div>
  );
}
function Chk({ label, d, value, onChange }: { label: string; d?: string; value: boolean | undefined; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer py-0.5">
      <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} className="mt-0.5" />
      <span><span className={lbl}>{label}</span>{d && <div className={desc}>{d}</div>}</span>
    </label>
  );
}
function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3"><div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-2">{titulo}</div><div className="space-y-2.5">{children}</div></div>;
}

export function PtrpCctEditor({ empresaKey, inicial, onClose }: { empresaKey: string; inicial: ParametrosCCT | null; onClose: () => void }) {
  const { pessoa: me } = useAuth();
  const [p, setP] = useState<ParametrosCCT>(inicial ? { ...inicial } : cctVazia(empresaKey));
  const [salvando, setSalvando] = useState(false);
  const [err, setErr] = useState("");
  const set = (patch: Partial<ParametrosCCT>) => setP(x => ({ ...x, ...patch }));
  const setExtra = (patch: Partial<ParametrosCCT["extras"]>) => setP(x => ({ ...x, extras: { ...x.extras, ...patch } }));
  const setNot = (patch: Partial<ParametrosCCT["adicionalNoturno"]>) => setP(x => ({ ...x, adicionalNoturno: { ...x.adicionalNoturno, ...patch } }));

  function carregarModelo(m: string) {
    if (!m) return;
    const t = m === "quibebe" ? cctQuibebe(empresaKey) : m === "belem" ? cctBelem(empresaKey)
      : cctSaoPaulo(empresaKey, m === "sp_especial" ? "especial" : m === "sp_diferenciado" ? "diferenciado" : "normal", m !== "sp_normal");
    // mantém o id atual (se editando) pra não duplicar doc
    setP({ ...t, id: p.id });
  }

  async function salvar() {
    if (!p.cctNome.trim()) { setErr("Dê um nome à convenção."); return; }
    if (!p.vigenciaDe || !p.vigenciaAte) { setErr("Informe a vigência (de/até)."); return; }
    setErr(""); setSalvando(true);
    try {
      const doc0 = { ...p, id: `${empresaKey}_${p.vigenciaDe}`, empresaKey, atualizadoEm: new Date().toISOString(), atualizadoPor: { id: me?.id || "", nome: me?.nome || "" } };
      await setDoc(doc(db, "parametrosCCT", doc0.id), sanitizeForFirestore(doc0));
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : "Falha ao salvar."); setSalvando(false); }
  }

  const abonos = p.tiposAbono || [];
  const setAbono = (i: number, patch: Partial<TipoAbono>) => set({ tiposAbono: abonos.map((a, j) => j === i ? { ...a, ...patch } : a) });
  const feriados = p.calendarioFeriados?.feriados || [];
  const setFeriados = (fs: FeriadoMunicipal[]) => set({ calendarioFeriados: { municipio: p.calendarioFeriados?.municipio || "", uf: p.calendarioFeriados?.uf || "", feriados: fs } });

  return (
    <Modal title={`Convenção · ${empresaKey}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3 max-h-[72vh] overflow-y-auto pr-1">
        <div className="flex items-end gap-2 flex-wrap rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 p-2.5">
          <div className="flex-1 min-w-[200px]">
            <label className={lbl}>Carregar de um modelo (pré-preenche tudo)</label>
            <select defaultValue="" onChange={e => { carregarModelo(e.target.value); e.currentTarget.value = ""; }} className={inp}>
              <option value="">— escolher modelo —</option>
              <option value="quibebe">Quibebe — EAA/Sescon-SP</option>
              <option value="sp_especial">SP Especial — SINTHORESP</option>
              <option value="sp_diferenciado">SP Diferenciado — SINTHORESP</option>
              <option value="sp_normal">SP Normal — SINTHORESP</option>
              <option value="belem">Belém — SINTHRBS/PA</option>
            </select>
          </div>
          <span className={desc}>Depois de carregar, ajuste cada premissa abaixo e salve.</span>
        </div>

        <Secao titulo="Identificação">
          <Txt label="Nome da convenção" d="Ex.: SINTHORESP/SINDRESBAR-SP 2025/2027" value={p.cctNome} onChange={v => set({ cctNome: v })} />
          <Txt label="Sindicato" value={p.sindicato || ""} onChange={v => set({ sindicato: v })} />
          <div className="grid grid-cols-2 gap-2">
            <Txt label="Vigência — de" d="Data-base (início)" type="date" value={p.vigenciaDe} onChange={v => set({ vigenciaDe: v })} />
            <Txt label="até" type="date" value={p.vigenciaAte} onChange={v => set({ vigenciaAte: v })} />
          </div>
          <Chk label="CCT vigente" d="Desmarque se venceu e ainda não renovou (ex.: Belém 2024/2025)." value={p.vigente} onChange={v => set({ vigente: v })} />
          <div className="flex flex-col gap-0.5">
            <label className={lbl}>Enquadramento de piso (SP)</label>
            <select value={p.enquadramentoPiso || ""} onChange={e => set({ enquadramentoPiso: (e.target.value || null) as ParametrosCCT["enquadramentoPiso"] })} className={inp}>
              <option value="">— não se aplica —</option><option value="normal">Normal</option><option value="diferenciado">Diferenciado</option><option value="especial">Especial</option>
            </select>
            <span className={desc}>SINTHORESP: o piso muda os percentuais de extra e noturno.</span>
          </div>
        </Secao>

        <Secao titulo="Horas extras (%)">
          <div className="grid grid-cols-2 gap-2">
            <Num label="1ª faixa (%)" d="Adicional das 1ªs horas extra do dia." req value={p.extras.faixa1Perc} onChange={v => setExtra({ faixa1Perc: v ?? 0 })} />
            <Num label="Até quantas horas/dia" d="Limite da 1ª faixa (ex.: 2). Vazio = faixa única." value={p.extras.faixa1AteHoras} onChange={v => setExtra({ faixa1AteHoras: v })} />
            <Num label="2ª faixa (%)" d="Adicional acima da 1ª faixa (ex.: 80)." value={p.extras.faixa2Perc} onChange={v => setExtra({ faixa2Perc: v })} />
            <Num label="Domingo (%)" d="Vazio = usa a faixa normal." value={p.extras.domingoPerc} onChange={v => setExtra({ domingoPerc: v })} />
            <Num label="Feriado (%)" value={p.extras.feriadoPerc} onChange={v => setExtra({ feriadoPerc: v })} />
            <Num label="Dia já compensado (%)" value={p.extras.diaCompensadoPerc} onChange={v => setExtra({ diaCompensadoPerc: v })} />
          </div>
        </Secao>

        <Secao titulo="Adicional noturno">
          <div className="grid grid-cols-2 gap-2">
            <Num label="Adicional (%)" d="Ex.: 30 (Quibebe), 20-50 (SP piso), 25 (Belém)." req value={p.adicionalNoturno.perc} onChange={v => setNot({ perc: v ?? 0 })} />
            <Num label="Hora reduzida (min)" d="Duração da hora noturna. Vazio = legal (52m30s)." value={p.adicionalNoturno.horaReduzidaMin} onChange={v => setNot({ horaReduzidaMin: v })} />
            <Txt label="Início da faixa" type="time" value={p.adicionalNoturno.inicio} onChange={v => setNot({ inicio: v })} />
            <Txt label="Fim da faixa" type="time" value={p.adicionalNoturno.fim} onChange={v => setNot({ fim: v })} />
          </div>
        </Secao>

        <Secao titulo="Compensação / banco de horas">
          <div className="flex flex-col gap-0.5">
            <label className={lbl}>Regime</label>
            <select value={p.regimeCompensacao} onChange={e => set({ regimeCompensacao: e.target.value as ParametrosCCT["regimeCompensacao"] })} className={inp}>
              <option value="banco">Banco de horas</option>
              <option value="compensacao_prazo">Compensação com prazo (paga extra se vencer)</option>
            </select>
            <span className={desc}>Quibebe usa "compensação com prazo"; SP/Belém usam banco.</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Num label="Prazo de compensação (dias)" d="Vencido → paga como extra. Ex.: 60 (QUI), 365/90 (SP), 90 (Belém)." req value={p.prazoCompensacaoDias} onChange={v => set({ prazoCompensacaoDias: v ?? 0 })} />
            <Num label="Saldo negativo máx. (horas)" d="SP especial: 30. Vazio = não permite negativo." value={p.limiteSaldoNegativoHoras} onChange={v => set({ limiteSaldoNegativoHoras: v })} />
          </div>
          <Chk label="Prazo conta da quinzena (dia 15/30)" d="Quibebe: o prazo de 60 dias conta da quinzena da ocorrência." value={p.contaPrazoDaQuinzena} onChange={v => set({ contaPrazoDaQuinzena: v })} />
        </Secao>

        <Secao titulo="Jornada">
          <div className="grid grid-cols-2 gap-2">
            <Num label="Jornada diária máx. (h)" d="Ex.: 10 (SP), 11 no 12x36 (Belém)." value={p.jornadaDiariaMaxHoras} onChange={v => set({ jornadaDiariaMaxHoras: v })} />
            <Num label="Interjornada mín. (h)" d="Descanso entre jornadas (legal: 11)." value={p.interjornadaMinHoras} onChange={v => set({ interjornadaMinHoras: v ?? 11 })} />
            <Num label="Intervalo mín. (min)" d="Intrajornada. SP cadastrada: 30." value={p.intervalo?.minMin} onChange={v => set({ intervalo: { ...p.intervalo, minMin: v } })} />
            <Num label="Intervalo máx. (min)" d="Belém: até 300 (5h)." value={p.intervalo?.maxMin} onChange={v => set({ intervalo: { ...p.intervalo, maxMin: v } })} />
            <Num label="Folga dominical a cada (semanas)" d="Belém: ao menos a cada 6." value={p.folgaDominicalCadaSemanas} onChange={v => set({ folgaDominicalCadaSemanas: v })} />
          </div>
          <Chk label="Permite 12x36" value={p.permite12x36} onChange={v => set({ permite12x36: v })} />
        </Secao>

        <Secao titulo="Feriado">
          <Chk label="Trabalho em feriado = hora extra" value={p.regrasFeriado?.trabalhadoComoExtra} onChange={v => set({ regrasFeriado: { ...p.regrasFeriado, trabalhadoComoExtra: v } })} />
          <div className="grid grid-cols-2 gap-2">
            <Num label="Adicional se estava de folga (%)" d="Belém: 100%." value={p.regrasFeriado?.folgaAdicionalPerc} onChange={v => set({ regrasFeriado: { ...p.regrasFeriado, folgaAdicionalPerc: v } })} />
            <Num label="Compensável em (dias)" value={p.regrasFeriado?.compensavelDias} onChange={v => set({ regrasFeriado: { ...p.regrasFeriado, compensavelDias: v } })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Txt label="Município (feriados locais)" value={p.calendarioFeriados?.municipio} onChange={v => set({ calendarioFeriados: { municipio: v, uf: p.calendarioFeriados?.uf || "", feriados } })} />
            <Txt label="UF" value={p.calendarioFeriados?.uf} onChange={v => set({ calendarioFeriados: { municipio: p.calendarioFeriados?.municipio || "", uf: v, feriados } })} />
          </div>
          {feriados.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="text" placeholder="MM-DD" value={f.data} onChange={e => setFeriados(feriados.map((x, j) => j === i ? { ...x, data: e.target.value } : x))} className={`${inp} w-24`} />
              <input type="text" placeholder="Nome do feriado" value={f.nome} onChange={e => setFeriados(feriados.map((x, j) => j === i ? { ...x, nome: e.target.value } : x))} className={inp} />
              <button type="button" onClick={() => setFeriados(feriados.filter((_, j) => j !== i))} className="text-rose-500 text-sm">✕</button>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setFeriados([...feriados, { data: "", nome: "" }])}>＋ Feriado local</Button>
        </Secao>

        <Secao titulo="Abonos (ausências legais)">
          {abonos.length === 0 && <div className={desc}>Nenhum abono cadastrado.</div>}
          {abonos.map((a, i) => (
            <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-800 p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <input type="text" placeholder="tipo (ex.: casamento)" value={a.tipo} onChange={e => setAbono(i, { tipo: e.target.value })} className={inp} />
                <button type="button" onClick={() => set({ tiposAbono: abonos.filter((_, j) => j !== i) })} className="text-rose-500 text-sm">✕</button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input type="number" placeholder="qtd" value={a.quantidade ?? ""} onChange={e => setAbono(i, { quantidade: Number(e.target.value) })} className={inp} />
                <select value={a.unidade} onChange={e => setAbono(i, { unidade: e.target.value as TipoAbono["unidade"] })} className={inp}>
                  <option value="dias_uteis">dias úteis</option><option value="dias_corridos">dias corridos</option><option value="horas">horas</option>
                </select>
                <select value={a.periodo || "evento"} onChange={e => setAbono(i, { periodo: e.target.value as TipoAbono["periodo"] })} className={inp}>
                  <option value="evento">por evento</option><option value="semestre">por semestre</option><option value="ano">por ano</option>
                </select>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <Chk label="Exige comprovação" value={a.exigeComprovacao} onChange={v => setAbono(i, { exigeComprovacao: v })} />
                <div className="flex items-center gap-1"><span className={desc}>prazo (h):</span><input type="number" value={a.prazoComprovacaoHoras ?? ""} onChange={e => setAbono(i, { prazoComprovacaoHoras: e.target.value === "" ? null : Number(e.target.value) })} className={`${inp} w-20`} /></div>
              </div>
              <input type="text" placeholder="observação" value={a.obs || ""} onChange={e => setAbono(i, { obs: e.target.value })} className={inp} />
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => set({ tiposAbono: [...abonos, { tipo: "", quantidade: 1, unidade: "dias_uteis", periodo: "evento" }] })}>＋ Abono</Button>
        </Secao>

        <Secao titulo="Comprovante / marcação">
          <Chk label="Relatório mensal assinado substitui o comprovante de cada batida" d="Reforça o espelho mensal como documento central (Quibebe cl.43)." value={p.comprovanteMensalSubstitui} onChange={v => set({ comprovanteMensalSubstitui: v })} />
          <Chk label="Marcação pelo próprio empregado" value={p.marcacaoPeloProprioEmpregado} onChange={v => set({ marcacaoPeloProprioEmpregado: v })} />
          <Chk label="Via impressa da marcação sob demanda" value={p.viaImpressaSobDemanda} onChange={v => set({ viaImpressaSobDemanda: v })} />
        </Secao>

        <Secao titulo="Pendências / observações">
          <textarea value={(p.pendencias || []).join("\n")} onChange={e => set({ pendencias: e.target.value.split("\n").filter(Boolean) })} rows={3} placeholder="Uma por linha (ex.: confirmar enquadramento; renovar CCT)" className={inp} />
        </Secao>

        {err && <div className="text-sm text-rose-600">{err}</div>}
      </div>
      <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-gray-800 mt-2">
        <Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
        <Button onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando…" : "💾 Salvar convenção"}</Button>
      </div>
    </Modal>
  );
}
