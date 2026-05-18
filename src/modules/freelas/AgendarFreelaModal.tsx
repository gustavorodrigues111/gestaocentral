import { useMemo, useState } from "react";
import {
  addDoc, collection, deleteField, doc, getDoc, setDoc, updateDoc,
} from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { fmtAnoMes, parseYmd, todayYmd } from "../../core/utils/date";
import { AREAS, type Area, type Empregado, type Pessoa } from "../../core/types";
import { CadastroRapidoFreelaModal } from "./CadastroRapidoFreelaModal";
import {
  listarCandidatos,
  resolverPixWhats,
  type FreelaCandidato,
} from "./helpers";

type Props = {
  restaurantId: string;
  empregados: Empregado[];
  pessoas: Pessoa[];
  initialDate?: string;
  // Quando true, modal abre direto pra "lançamento" (status="aberto") em vez
  // de "agendamento" (status="agendado"). Usado pela tab Lançamento.
  modoLancamento?: boolean;
  onClose: () => void;
  onSaved: () => void;
};

// Modal pra criar 1 turno de freela. Pode ser:
// - Agendamento (data futura, status="agendado"): só seleciona pessoa + data + área
// - Lançamento direto (status="aberto"): pode já preencher entrada/saída/valor
export function AgendarFreelaModal({
  restaurantId, empregados, pessoas, initialDate, modoLancamento, onClose, onSaved,
}: Props) {
  const { pessoa: me } = useAuth();
  const [date, setDate] = useState(initialDate || todayYmd());
  const [area, setArea] = useState<Area | "">("");
  const [candidatoId, setCandidatoId] = useState("");
  const [obs, setObs] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [showCadastro, setShowCadastro] = useState(false);

  const candidatos = useMemo(
    () => listarCandidatos(empregados, pessoas, restaurantId),
    [empregados, pessoas, restaurantId],
  );
  const candidato: FreelaCandidato | null = useMemo(
    () => candidatos.find((c) => `${c.tipo}:${c.id}` === candidatoId) || null,
    [candidatos, candidatoId],
  );

  async function salvar() {
    setErr("");
    if (!me) return;
    if (!candidato) { setErr("Selecione um freela."); return; }
    if (!date) { setErr("Data obrigatória."); return; }
    if (candidato.tipo === "freela") {
      // freela cadastrado precisa ter PIX (já filtrado nos candidatos)
      if (!candidato.pix) {
        setErr("Esse freela está sem PIX. Complete o cadastro em Pessoas.");
        return;
      }
    }
    setSaving(true);
    try {
      const extras = resolverPixWhats(candidato, pessoas);
      const now = new Date().toISOString();
      const status = modoLancamento ? "aberto" : "agendado";

      const payload = {
        restaurantId,
        empregadoId: candidato.tipo === "empregado" ? candidato.id : null,
        pessoaId: candidato.tipo === "freela" ? candidato.id : null,
        nomeSnapshot: candidato.nome,
        ...(candidato.cpf ? { cpfSnapshot: candidato.cpf } : {}),
        ...(extras.pix ? { pixSnapshot: extras.pix } : {}),
        ...(extras.whatsapp ? { whatsappSnapshot: extras.whatsapp } : {}),
        date,
        scheduledDate: date,
        ...(area ? { area } : {}),
        status,
        lotePagamentoId: null,
        ...(obs.trim() ? { observacao: obs.trim() } : {}),
        lancadoPor: me.id,
        lancadoPorNome: me.nome,
        lancadoEm: now,
        updatedAt: now,
      };
      await addDoc(collection(db, "freelaShifts"), payload);

      // Se for empregado, marca "freela" na escala daquele dia (Praticada)
      // — só faz sentido em modo Lançamento (dia já chegou) ou Agendamento
      // pra data futura. Em ambos os casos, é "freela" na escala.
      if (candidato.tipo === "empregado") {
        await marcarFreelaNaEscala(restaurantId, candidato.id, date);
      }

      onSaved();
    } catch (e) {
      console.error(e);
      setErr("Erro ao salvar. Tente novamente.");
      setSaving(false);
    }
  }

  return (
    <>
      <Modal
        title={modoLancamento ? "📝 Lançar turno de freela" : "📅 Agendar freela"}
        onClose={onClose}
        maxWidth="max-w-md"
      >
        <div className="space-y-3">
          <Input
            label="Data *"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              Freela *
            </label>
            <select
              value={candidatoId}
              onChange={(e) => setCandidatoId(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
            >
              <option value="">— selecione —</option>
              <optgroup label="🧑‍💼 Empregados (turno extra)">
                {candidatos.filter((c) => c.tipo === "empregado").map((c) => (
                  <option key={`${c.tipo}:${c.id}`} value={`${c.tipo}:${c.id}`}>
                    {c.nome}
                  </option>
                ))}
              </optgroup>
              <optgroup label="🎒 Freelas cadastrados">
                {candidatos.filter((c) => c.tipo === "freela").map((c) => (
                  <option key={`${c.tipo}:${c.id}`} value={`${c.tipo}:${c.id}`}>
                    {c.nome}
                  </option>
                ))}
              </optgroup>
            </select>
            <button
              type="button"
              onClick={() => setShowCadastro(true)}
              className="self-start text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline mt-1"
            >
              + Cadastrar novo freela
            </button>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              Área (opcional)
            </label>
            <select
              value={area}
              onChange={(e) => setArea(e.target.value as Area | "")}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="">—</option>
              {AREAS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              Observação (opcional)
            </label>
            <textarea
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              rows={2}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100"
              placeholder="Ex: cobertura de cobertura noite de quinta…"
            />
          </div>

          {candidato?.tipo === "empregado" && (
            <div className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-2">
              Esse é um empregado registrado — ao salvar, o dia <strong>{date}</strong> dele será
              automaticamente marcado como <strong>"freela"</strong> na escala (Praticada).
            </div>
          )}

          {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button onClick={salvar} disabled={saving}>
              {saving ? "Salvando…" : modoLancamento ? "Lançar" : "Agendar"}
            </Button>
          </div>
        </div>
      </Modal>

      {showCadastro && (
        <CadastroRapidoFreelaModal
          restaurantId={restaurantId}
          onSaved={(p) => {
            // Auto-seleciona o freela recém-criado
            setCandidatoId(`freela:${p.id}`);
            setShowCadastro(false);
          }}
          onClose={() => setShowCadastro(false)}
        />
      )}
    </>
  );
}

// Marca "freela" na escala Praticada (real) do empregado naquele dia.
// Usa lifecycle relaxado: tenta gravar; se ainda não existe doc escala do mês, cria;
// se prevista não está fechada, escreve mesmo assim em `real` (admin pode ajustar
// depois). Isso é deliberadamente permissivo — freela é evento operacional, escala
// se acomoda.
async function marcarFreelaNaEscala(rid: string, empregadoId: string, ymdDate: string) {
  const d = parseYmd(ymdDate);
  const ano = d.getFullYear();
  const mes = d.getMonth() + 1;
  const escalaId = `${rid}_${fmtAnoMes(ano, mes)}`;
  const ref = doc(db, "escalas", escalaId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      id: escalaId,
      restaurantId: rid,
      ano, mes,
      prevista: {},
      real: { [empregadoId]: { [ymdDate]: "freela" } },
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  await updateDoc(ref, {
    [`real.${empregadoId}.${ymdDate}`]: "freela",
    updatedAt: new Date().toISOString(),
  });
}

// (Reservado pra "desmarcar" caso o turno seja cancelado depois — não usado ainda)
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
