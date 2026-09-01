import { useMemo, useState } from "react";
import {
  addDoc, collection, deleteField, doc, getDoc, setDoc, updateDoc,
} from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { TimeInput } from "../../core/ui/TimeInput";
import { fmtAnoMes, parseYmd, todayYmd } from "../../core/utils/date";
import { empregadoAtivoEm } from "../../core/utils/empregado";
import { AREAS, type Area, type Empregado, type FreelaIntervalo, type FreelaShift, type Pessoa } from "../../core/types";
import { onlyDigits, resolverPixWhats, somaIntervalos, calcHoras } from "./helpers";
import { SeletorSemana } from "./SeletorSemana";
import { CadastroPorCpf } from "./CadastroPorCpf";
import { IntervalosEditor } from "./IntervalosEditor";

type Props = {
  restaurantId: string;
  empregados: Empregado[];
  pessoas: Pessoa[];
  initialDate?: string;
  // "planejar" (default) → cria turno PLANEJADO (status agendado), grava só os
  // campos previstos. "avulso" → abre um turno agora (status aberto, hoje),
  // grava a entrada REAL — sem planejamento. "retroativo" → lança um turno em
  // data PASSADA já completo (entrada+saída+intervalos reais, status aberto);
  // permissão exclusiva (freelas.lancarRetroativo).
  modo?: "planejar" | "avulso" | "retroativo";
  // Quando presente, o modal ALTERA um turno planejado existente (mesma pessoa,
  // edita data/área/previsto/obs) em vez de criar um novo.
  editShift?: FreelaShift;
  // Pré-seleciona um freela (ex: turno de teste vindo do Processo Seletivo).
  preselectFreelaId?: string;
  onClose: () => void;
  onSaved: () => void;
};

type EscolhaTipo = null | "empregado" | "freela";

type SelecionadoEmp   = { tipo: "empregado"; emp: Empregado };
type SelecionadoFreela = { tipo: "freela"; pessoa: Pessoa };
type Selecionado = SelecionadoEmp | SelecionadoFreela | null;

export function NovoTurnoModal({
  restaurantId, empregados, pessoas, initialDate, modo = "planejar", editShift, preselectFreelaId, onClose, onSaved,
}: Props) {
  const { pessoa: me } = useAuth();
  const preFreela = preselectFreelaId ? pessoas.find((p) => p.id === preselectFreelaId) || null : null;
  const isEdit = !!editShift;
  const isAvulso = modo === "avulso" && !isEdit;
  const isRetro = modo === "retroativo" && !isEdit;
  const ontem = (() => { const d = parseYmd(todayYmd()); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  // Avulso é sempre hoje (abrir agora). Retroativo abre em data passada (default ontem).
  // Planejar/editar pode ser hoje ou futuro.
  const [date, setDate] = useState(editShift?.date || (isAvulso ? todayYmd() : (isRetro ? ontem : (initialDate || todayYmd()))));
  const [area, setArea] = useState<Area | "">(editShift?.area || "");
  const [entrada, setEntrada] = useState(editShift?.entradaPrevista || "");
  const [saidaPrevista, setSaidaPrevista] = useState(editShift?.saidaPrevista || "");
  const [intervalos, setIntervalos] = useState<FreelaIntervalo[]>(editShift?.intervalosPrevistos || []);
  const [obs, setObs] = useState(editShift?.observacao || "");

  const [escolhaTipo, setEscolhaTipo] = useState<EscolhaTipo>(preFreela ? "freela" : null);
  const [selecionado, setSelecionado] = useState<Selecionado>(preFreela ? { tipo: "freela", pessoa: preFreela } : null);
  const [mostrarCadastro, setMostrarCadastro] = useState(false);

  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  // Estado-alvo: planejar sempre cria PLANEJADO (status agendado), mesmo pra
  // hoje (abrir é ação por botão). Avulso já abre o turno.
  const statusAlvo: "agendado" | "aberto" = (isAvulso || isRetro) ? "aberto" : "agendado";

  // "Ativo como EMPREGADO neste dia": empregado comum usa estaAtivo; freela
  // mensalista só é empregado DENTRO do período de cobertura — fora dele volta a
  // ser freela (senão, lançar turno antes/depois do período o mostra como
  // empregado da casa, que ele não é).
  const ativoComoEmpEm = (e: Empregado) => e.freelaMensalista ? empregadoAtivoEm(e, date) : e.estaAtivo;

  // Empregados ativos do restaurante NESTA data
  const empregadosAtivos = useMemo(
    () => empregados
      .filter((e) => e.restaurantId === restaurantId && ativoComoEmpEm(e))
      .sort((a, b) => a.nome.localeCompare(b.nome)),
    [empregados, restaurantId, date],
  );

  // Freelas = pessoas vinculadas ao restaurante com PIX e que NÃO são
  // empregados ATIVOS DESTE restaurante. Empregados ativos em OUTRAS
  // unidades PODEM virar freela aqui (CLT do Lobozó cobrindo turno no
  // Sororoca é caso real). Bug anterior: cpfsEmpregados não filtrava por
  // restaurantId — bloqueava todos os empregados do sistema.
  const cpfsEmpregadosDesteRest = useMemo(
    () => new Set(
      empregados
        .filter((e) => e.restaurantId === restaurantId && ativoComoEmpEm(e) && e.cpf)
        .map((e) => onlyDigits(e.cpf)),
    ),
    [empregados, restaurantId, date],
  );
  const freelas = useMemo(
    () => pessoas
      .filter((p) => p.restaurantIds.includes(restaurantId) && p.ativa && p.pix)
      .filter((p) => !p.cpf || !cpfsEmpregadosDesteRest.has(onlyDigits(p.cpf)))
      .sort((a, b) => a.nome.localeCompare(b.nome)),
    [pessoas, restaurantId, cpfsEmpregadosDesteRest],
  );

  async function salvar() {
    setErr("");
    if (!me) {
      setErr("Você não está autenticado. Faça login novamente.");
      return;
    }
    if (!isEdit && !selecionado) { setErr("Selecione um freela."); return; }
    if (!date) { setErr("Data obrigatória."); return; }
    if (!area) { setErr("Área obrigatória."); return; }
    if (isAvulso && !entrada) {
      setErr("Confirme a hora de entrada (chegada) pra abrir o turno.");
      return;
    }
    if (isRetro) {
      if (date >= todayYmd()) { setErr("Turno retroativo é só pra data PASSADA. Pra hoje use \"Abrir turno\"."); return; }
      if (!entrada || !saidaPrevista) { setErr("Informe entrada e saída do turno passado."); return; }
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();

      // ─── Alterar turno planejado existente (pessoa fixa) ───
      if (isEdit && editShift) {
        await updateDoc(doc(db, "freelaShifts", editShift.id), {
          date,
          scheduledDate: date,
          area,
          entradaPrevista: entrada || deleteField(),
          saidaPrevista: saidaPrevista || deleteField(),
          intervalosPrevistos: intervalos.length ? intervalos : deleteField(),
          observacao: obs.trim() || deleteField(),
          updatedAt: now,
        });
        // Empregado da casa: se a data mudou, move a marca "freela" na escala.
        if (editShift.empregadoId && editShift.date !== date) {
          await limparFreelaDaEscala(restaurantId, editShift.empregadoId, editShift.date);
          await marcarFreelaNaEscala(restaurantId, editShift.empregadoId, date);
        }
        onSaved();
        return;
      }

      if (!selecionado) { setSaving(false); return; }
      const isEmp = selecionado.tipo === "empregado";
      const nome  = isEmp ? selecionado.emp.nome   : selecionado.pessoa.nome;
      const cpf   = isEmp ? selecionado.emp.cpf    : selecionado.pessoa.cpf;
      const extras = isEmp
        ? resolverPixWhats({ tipo: "empregado", id: selecionado.emp.id, nome, cpf: cpf || undefined }, pessoas)
        : { pix: selecionado.pessoa.pix, whatsapp: selecionado.pessoa.whatsapp };

      const payload = {
        restaurantId,
        empregadoId: isEmp ? selecionado.emp.id : null,
        pessoaId:    isEmp ? null : selecionado.pessoa.id,
        nomeSnapshot: nome,
        ...(cpf ? { cpfSnapshot: cpf } : {}),
        ...(extras.pix ? { pixSnapshot: extras.pix } : {}),
        ...(extras.whatsapp ? { whatsappSnapshot: extras.whatsapp } : {}),
        date,
        scheduledDate: date,
        area,
        ...(isAvulso
          ? { entrada } // entrada REAL — abre o turno na hora
          : isRetro
          ? {
              // Retroativo: turno passado já COMPLETO — grava os campos REAIS,
              // cai direto no Fechamento (aguardando precificação).
              entrada,
              saida: saidaPrevista,
              ...(intervalos.length ? { intervalos, intervalo: somaIntervalos(intervalos) } : {}),
              horas: calcHoras(entrada, saidaPrevista, somaIntervalos(intervalos)),
            }
          : {
              // Planejado: grava só os PREVISTOS (nunca os campos reais).
              ...(entrada ? { entradaPrevista: entrada } : {}),
              ...(saidaPrevista ? { saidaPrevista } : {}),
              ...(intervalos.length ? { intervalosPrevistos: intervalos } : {}),
            }),
        status: statusAlvo,
        lotePagamentoId: null,
        ...(obs.trim() ? { observacao: obs.trim() } : {}),
        lancadoPor: me.id,
        lancadoPorNome: me.nome,
        lancadoEm: now,
        updatedAt: now,
      };
      console.log("[NovoTurno] payload pronto, gravando...", payload);
      const ref = await addDoc(collection(db, "freelaShifts"), payload);
      console.log("[NovoTurno] gravado OK, id =", ref.id);

      if (isEmp) {
        await marcarFreelaNaEscala(restaurantId, selecionado.emp.id, date);
      }
      onSaved();
    } catch (e) {
      console.error("[NovoTurno] ERRO:", e);
      setErr(`Erro ao salvar: ${e instanceof Error ? e.message : String(e)}`);
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isEdit ? "✏️ Alterar turno planejado" : (isAvulso ? "🟢 Abrir turno avulso" : isRetro ? "⏪ Lançar turno passado" : "📋 Planejar turno de freela")}
      onClose={onClose}
      maxWidth="max-w-lg"
    >
      <div className="space-y-4">
        {/* ─── Data ─── (avulso é sempre hoje) */}
        {isAvulso ? (
          <div className="text-[11px] text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded p-2">
            🟢 Abrindo um turno <strong>agora</strong> (hoje), sem planejamento prévio.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              Data *{isRetro && <span className="ml-1 text-amber-600 dark:text-amber-400 font-normal">(passada)</span>}
            </label>
            <SeletorSemana value={date} onChange={setDate} />
            {isRetro && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400">⏪ Lançamento retroativo — escolha um dia já passado.</p>
            )}
          </div>
        )}

        {/* ─── Quem é o freela: 2 abas sempre visíveis (alternáveis) ─── */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
            Quem é o freela? *
          </label>

          {/* Edição: pessoa é fixa (pra trocar, exclua e crie outro turno). */}
          {isEdit && editShift && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2">
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {editShift.empregadoId ? "👨‍💼 " : "🎒 "}{editShift.nomeSnapshot}
              </div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400">
                {editShift.empregadoId ? "Empregado da casa" : "Freela"} · pra trocar a pessoa, exclua e crie outro turno
              </div>
            </div>
          )}

          {/* Quando ainda não selecionou, as 2 abas/chips ficam sempre visíveis
              pra permitir trocar sem precisar achar um "← voltar". */}
          {!isEdit && !selecionado && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (escolhaTipo === "empregado") return;
                    setEscolhaTipo("empregado");
                    setMostrarCadastro(false);
                  }}
                  className={`rounded-lg border px-3 py-3 text-sm font-medium transition-colors ${
                    escolhaTipo === "empregado"
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                      : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-indigo-400 hover:bg-indigo-50/30 dark:hover:bg-indigo-900/20"
                  }`}
                >
                  👨‍💼 Empregado da casa
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (escolhaTipo === "freela") return;
                    setEscolhaTipo("freela");
                    setMostrarCadastro(false);
                  }}
                  className={`rounded-lg border px-3 py-3 text-sm font-medium transition-colors ${
                    escolhaTipo === "freela"
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                      : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-indigo-400 hover:bg-indigo-50/30 dark:hover:bg-indigo-900/20"
                  }`}
                >
                  🎒 Freela
                </button>
              </div>

              {/* Lista empregados */}
              {escolhaTipo === "empregado" && (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 max-h-64 overflow-y-auto">
                  {empregadosAtivos.length === 0 ? (
                    <div className="p-3 text-xs text-gray-500">Nenhum empregado ativo.</div>
                  ) : (
                    empregadosAtivos.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => setSelecionado({ tipo: "empregado", emp: e })}
                        className="w-full text-left px-3 py-2 text-sm border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40"
                      >
                        {e.nome}
                      </button>
                    ))
                  )}
                </div>
              )}

              {/* Lista freelas + cadastro */}
              {escolhaTipo === "freela" && !mostrarCadastro && (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 max-h-64 overflow-y-auto">
                  {freelas.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelecionado({ tipo: "freela", pessoa: p })}
                      className="w-full text-left px-3 py-2 text-sm border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40"
                    >
                      {p.nome}
                      {p.cpf && <span className="ml-2 text-[10px] text-gray-500">{p.cpf}</span>}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setMostrarCadastro(true)}
                    className="w-full text-left px-3 py-2 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
                  >
                    + Cadastrar novo freela
                  </button>
                </div>
              )}

              {/* Cadastro por CPF */}
              {escolhaTipo === "freela" && mostrarCadastro && (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-900">
                  <CadastroPorCpf
                    restaurantId={restaurantId}
                    onConcluido={(p) => {
                      setMostrarCadastro(false);
                      setSelecionado({ tipo: "freela", pessoa: p });
                    }}
                    onCancelar={() => setMostrarCadastro(false)}
                  />
                </div>
              )}
            </>
          )}

          {/* Selecionado */}
          {!isEdit && selecionado && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 px-3 py-2">
              <div>
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {selecionado.tipo === "empregado" ? "👨‍💼 " : "🎒 "}
                  {selecionado.tipo === "empregado" ? selecionado.emp.nome : selecionado.pessoa.nome}
                </div>
                <div className="text-[11px] text-gray-600 dark:text-gray-400">
                  {selecionado.tipo === "empregado" ? "Empregado da casa" : "Freela"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setSelecionado(null); setEscolhaTipo(null); setMostrarCadastro(false); }}
                className="text-[11px] text-gray-500 hover:underline"
              >
                Trocar
              </button>
            </div>
          )}
        </div>

        {/* ─── Área ─── */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Área *</label>
          <select
            value={area}
            onChange={(e) => setArea(e.target.value as Area | "")}
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="">— selecione —</option>
            {AREAS.map((a) => (<option key={a} value={a}>{a}</option>))}
          </select>
        </div>

        {/* ─── Horário ─── */}
        {isAvulso ? (
          // Avulso: confirma só a ENTRADA real (chegada). Saída/intervalos
          // ficam pro fechamento.
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              Hora de entrada (chegada) *
            </label>
            <TimeInput value={entrada} onChange={setEntrada} placeholder="HH:MM" />
            <p className="text-[10px] text-gray-400 dark:text-gray-500">Saída e intervalos são confirmados no fechamento.</p>
          </div>
        ) : isRetro ? (
          // Retroativo: turno passado COMPLETO — entrada, saída e intervalos reais.
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Entrada *</label>
                <TimeInput value={entrada} onChange={setEntrada} placeholder="HH:MM" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Saída *</label>
                <TimeInput value={saidaPrevista} onChange={setSaidaPrevista} placeholder="HH:MM" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Intervalos (opcional)</label>
              <IntervalosEditor value={intervalos} onChange={setIntervalos} />
            </div>
            {entrada && saidaPrevista && (
              <p className="text-[11px] text-gray-600 dark:text-gray-400">
                Total: <strong>{calcHoras(entrada, saidaPrevista, somaIntervalos(intervalos)).toFixed(2)}h</strong>
                {intervalos.length > 0 && <span className="text-gray-400"> · {somaIntervalos(intervalos)}min de intervalo</span>}
              </p>
            )}
          </>
        ) : (
          // Planejar: tudo PREVISTO (opcional). Vira sugestão na hora de abrir/fechar.
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                  Início previsto (opcional)
                </label>
                <TimeInput value={entrada} onChange={setEntrada} placeholder="HH:MM" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                  Saída prevista (opcional)
                </label>
                <TimeInput value={saidaPrevista} onChange={setSaidaPrevista} placeholder="HH:MM" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                Intervalos previstos (opcional)
              </label>
              <IntervalosEditor value={intervalos} onChange={setIntervalos} planejadoDefault />
            </div>
          </>
        )}

        {/* ─── Observação ─── */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Observação (opcional)</label>
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={2}
            placeholder="Ex: cobertura de noite de quinta…"
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100"
          />
        </div>

        <div className="text-[11px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded p-2">
          💡 Valor (R$/h ou diária) é preenchido pelo <strong>DP</strong> depois.
        </div>

        {selecionado?.tipo === "empregado" && (
          <div className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-2">
            Empregado registrado — ao salvar, o dia <strong>{date}</strong> será marcado como <strong>"freela"</strong> na escala (Praticada).
          </div>
        )}

        {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving || (!isEdit && !selecionado)}>
            {saving ? "Salvando…" : (isEdit ? "💾 Salvar" : (isAvulso ? "🟢 Abrir turno" : isRetro ? "⏪ Lançar turno passado" : "📋 Planejar"))}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

async function marcarFreelaNaEscala(rid: string, empregadoId: string, ymdDate: string) {
  const d = parseYmd(ymdDate);
  const ano = d.getFullYear();
  const mes = d.getMonth() + 1;
  const escalaId = `${rid}_${fmtAnoMes(ano, mes)}`;
  const ref = doc(db, "escalas", escalaId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      id: escalaId, restaurantId: rid, ano, mes,
      prevista: {}, real: { [empregadoId]: { [ymdDate]: "freela" } },
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  await updateDoc(ref, {
    [`real.${empregadoId}.${ymdDate}`]: "freela",
    updatedAt: new Date().toISOString(),
  });
}

export async function limparFreelaDaEscala(rid: string, empregadoId: string, ymdDate: string) {
  const d = parseYmd(ymdDate);
  const ano = d.getFullYear();
  const mes = d.getMonth() + 1;
  const ref = doc(db, "escalas", `${rid}_${fmtAnoMes(ano, mes)}`);
  await updateDoc(ref, {
    [`real.${empregadoId}.${ymdDate}`]: deleteField(),
    updatedAt: new Date().toISOString(),
  });
}
