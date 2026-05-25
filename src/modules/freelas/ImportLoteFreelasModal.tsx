import { useMemo, useState } from "react";
import { addDoc, collection, getDocs, limit, query, updateDoc, where, doc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { todayYmd } from "../../core/utils/date";
import { AREAS } from "../../core/types";
import type { Area, Pessoa } from "../../core/types";

// PROVISÓRIO — botão "Importar lote" no módulo Freelas, restrito ao master.
// Aceita JSON colado, valida item a item, mostra preview, e ao confirmar
// cria/vincula Pessoa e cria os FreelaShifts. Remover quando não precisar mais.

function onlyDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

type ItemImport = {
  nome: string;
  cpf: string;
  pix: string;
  whatsapp?: string;
  data: string; // YYYY-MM-DD
  area: Area;
  entrada?: string; // HH:MM
  saida?: string;   // HH:MM
  intervaloMinutos?: number; // minutos de intervalo (ex: 60)
  valorTipo: "hora" | "diaria";
  valorUnit: number;
  observacao?: string;
};

// Calcula horas líquidas dado entrada/saída em HH:MM e intervalo em minutos.
// Lida com virada de meia-noite (saida < entrada).
function calcHorasLiquidas(entrada: string, saida: string, intervaloMin: number): number {
  const [h1, m1] = entrada.split(":").map(Number);
  const [h2, m2] = saida.split(":").map(Number);
  let minEntrada = h1 * 60 + m1;
  let minSaida   = h2 * 60 + m2;
  if (minSaida < minEntrada) minSaida += 24 * 60;
  const liquido = minSaida - minEntrada - (intervaloMin || 0);
  return Math.max(0, liquido) / 60;
}

type ItemValidado =
  | { ok: true; item: ItemImport; cpfDigits: string }
  | { ok: false; raw: unknown; errors: string[] };

function validarItem(raw: unknown): ItemValidado {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") {
    return { ok: false, raw, errors: ["item não é um objeto"] };
  }
  const r = raw as Record<string, unknown>;

  const nome = typeof r.nome === "string" ? r.nome.trim() : "";
  if (!nome) errors.push("nome vazio");

  const cpfDigits = onlyDigits(String(r.cpf ?? ""));
  if (cpfDigits.length !== 11) errors.push(`cpf inválido (${cpfDigits.length} dígitos, esperado 11)`);

  const pix = typeof r.pix === "string" ? r.pix.trim() : "";
  if (!pix) errors.push("pix vazio");

  const whatsapp = r.whatsapp != null ? onlyDigits(String(r.whatsapp)) : "";

  const data = typeof r.data === "string" ? r.data.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) errors.push(`data inválida ("${data}", use YYYY-MM-DD)`);

  const area = typeof r.area === "string" ? (r.area as Area) : ("" as Area);
  if (!AREAS.includes(area)) errors.push(`area inválida ("${area}", use ${AREAS.join("|")})`);

  const entrada = typeof r.entrada === "string" && r.entrada.trim() ? r.entrada.trim() : undefined;
  if (entrada && !/^\d{1,2}:\d{2}$/.test(entrada)) errors.push(`entrada inválida ("${entrada}", use HH:MM)`);

  const saida = typeof r.saida === "string" && r.saida.trim() ? r.saida.trim() : undefined;
  if (saida && !/^\d{1,2}:\d{2}$/.test(saida)) errors.push(`saida inválida ("${saida}", use HH:MM)`);
  if (saida && !entrada) errors.push("saida informada sem entrada");

  let intervaloMinutos: number | undefined;
  if (r.intervaloMinutos != null) {
    const n = typeof r.intervaloMinutos === "number" ? r.intervaloMinutos : Number(r.intervaloMinutos);
    if (!Number.isFinite(n) || n < 0) errors.push(`intervaloMinutos inválido ("${r.intervaloMinutos}")`);
    else intervaloMinutos = n;
  }

  const valorTipo = r.valorTipo === "hora" || r.valorTipo === "diaria" ? r.valorTipo : null;
  if (!valorTipo) errors.push(`valorTipo inválido (use "hora" ou "diaria")`);

  const valorUnit = typeof r.valorUnit === "number" ? r.valorUnit
                  : typeof r.valorUnit === "string" ? Number(r.valorUnit.replace(",", "."))
                  : NaN;
  if (!Number.isFinite(valorUnit) || valorUnit <= 0) errors.push(`valorUnit inválido ("${r.valorUnit}")`);

  const observacao = typeof r.observacao === "string" ? r.observacao.trim() : "";

  if (errors.length > 0) return { ok: false, raw, errors };
  return {
    ok: true,
    cpfDigits,
    item: {
      nome,
      cpf: cpfDigits,
      pix,
      whatsapp: whatsapp || undefined,
      data,
      area,
      entrada,
      saida,
      intervaloMinutos,
      valorTipo: valorTipo!,
      valorUnit,
      observacao: observacao || undefined,
    },
  };
}

type Props = {
  restaurantId: string;
  onClose: () => void;
  onImported: () => void;
};

const EXEMPLO = JSON.stringify(
  [
    {
      nome: "Maria Souza",
      cpf: "12345678901",
      pix: "11999998888",
      whatsapp: "11999998888",
      data: "2026-05-30",
      area: "Cozinha",
      entrada: "14:00",
      saida: "23:00",
      intervaloMinutos: 60,
      valorTipo: "hora",
      valorUnit: 25,
      observacao: "",
    },
  ],
  null,
  2,
);

export function ImportLoteFreelasModal({ restaurantId, onClose, onImported }: Props) {
  const { pessoa: me } = useAuth();
  const [raw, setRaw] = useState("");
  const [parseErr, setParseErr] = useState("");
  const [resultados, setResultados] = useState<ItemValidado[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState("");
  const [importLog, setImportLog] = useState<string[]>([]);

  const validos = useMemo(
    () => (resultados || []).filter((r): r is Extract<ItemValidado, { ok: true }> => r.ok),
    [resultados],
  );
  const invalidos = useMemo(
    () => (resultados || []).filter((r): r is Extract<ItemValidado, { ok: false }> => !r.ok),
    [resultados],
  );

  function validar() {
    setParseErr("");
    setResultados(null);
    setImportErr("");
    setImportLog([]);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      setParseErr(`JSON inválido: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!Array.isArray(parsed)) {
      setParseErr("o JSON precisa ser um array de objetos");
      return;
    }
    setResultados(parsed.map(validarItem));
  }

  async function importar() {
    if (!me) { setImportErr("não autenticado"); return; }
    if (validos.length === 0) { setImportErr("nada válido pra importar"); return; }
    setImporting(true);
    setImportErr("");
    setImportLog([]);
    const log: string[] = [];

    try {
      // Cache de pessoas resolvidas por CPF (evita re-consultar dentro do lote).
      const cache = new Map<string, Pessoa>();
      const today = todayYmd();
      const now = new Date().toISOString();

      // ── Dedup: pré-carrega turnos existentes do restaurante nas datas que
      // o lote vai usar e monta um Set de chaves. Pula no loop se já existir.
      // Chaves: "pid:<pessoaId>-<date>" e "cpf:<cpfSnapshot>-<date>" pra
      // cobrir tanto lançamentos via UI (que podem usar empregadoId) quanto
      // batch (sempre pessoaId).
      const datasUnicas = Array.from(new Set(validos.map((v) => v.item.data)));
      const dedupKeys = new Set<string>();
      try {
        // Firestore `in` aceita até 30 valores; 17 turnos ≈ 7 datas únicas, ok.
        if (datasUnicas.length > 0 && datasUnicas.length <= 30) {
          const shiftsExistentes = await getDocs(
            query(
              collection(db, "freelaShifts"),
              where("restaurantId", "==", restaurantId),
              where("date", "in", datasUnicas),
            ),
          );
          shiftsExistentes.forEach((d) => {
            const s = d.data() as Record<string, unknown>;
            const date = s.date as string;
            const pid = s.pessoaId as string | null;
            const cpf = s.cpfSnapshot as string | undefined;
            if (pid) dedupKeys.add(`pid:${pid}-${date}`);
            if (cpf) dedupKeys.add(`cpf:${onlyDigits(cpf)}-${date}`);
          });
          log.push(`Dedup: ${shiftsExistentes.size} turno(s) existente(s) encontrado(s) nessas datas.`);
        } else if (datasUnicas.length > 30) {
          log.push(`⚠️ ${datasUnicas.length} datas únicas (>30) — dedup pulada, cuidado com duplicações.`);
        }
        setImportLog([...log]);
      } catch (e) {
        log.push(`⚠️ Falha ao pré-carregar dedup: ${e instanceof Error ? e.message : String(e)}. Continuando sem proteção.`);
        setImportLog([...log]);
      }

      let criados = 0;
      let pulados = 0;
      let falhas = 0;

      for (let i = 0; i < validos.length; i++) {
        const { item, cpfDigits } = validos[i];
        try {
          let pessoa = cache.get(cpfDigits) || null;

          if (!pessoa) {
            const snap = await getDocs(
              query(collection(db, "pessoas"), where("cpf", "==", cpfDigits), limit(1)),
            );
            if (!snap.empty) {
              pessoa = { id: snap.docs[0].id, ...snap.docs[0].data() } as Pessoa;
            }
          }

          if (!pessoa) {
            const ref = await addDoc(collection(db, "pessoas"), {
              email: "",
              nome: item.nome,
              cpf: cpfDigits,
              whatsapp: item.whatsapp || "",
              pix: item.pix,
              isMaster: false,
              restaurantIds: [restaurantId],
              permissions: { [restaurantId]: {} },
              ativa: true,
              createdAt: now,
            });
            pessoa = {
              id: ref.id,
              email: "",
              nome: item.nome,
              cpf: cpfDigits,
              whatsapp: item.whatsapp || "",
              pix: item.pix,
              isMaster: false,
              restaurantIds: [restaurantId],
              permissions: { [restaurantId]: {} },
              ativa: true,
              createdAt: now,
            };
            log.push(`✅ ${item.nome} — pessoa criada`);
          } else if (!pessoa.restaurantIds.includes(restaurantId)) {
            const novosIds = [...pessoa.restaurantIds, restaurantId];
            const novasPerms = { ...(pessoa.permissions || {}), [restaurantId]: {} };
            await updateDoc(doc(db, "pessoas", pessoa.id), {
              restaurantIds: novosIds,
              permissions: novasPerms,
            });
            pessoa = { ...pessoa, restaurantIds: novosIds, permissions: novasPerms };
            log.push(`🔗 ${item.nome} — pessoa existente vinculada ao restaurante`);
          } else {
            log.push(`↪ ${item.nome} — pessoa já existente`);
          }
          cache.set(cpfDigits, pessoa);

          // ── Dedup do turno (chave por pessoaId+date ou cpf+date)
          const keyPid = `pid:${pessoa.id}-${item.data}`;
          const keyCpf = `cpf:${cpfDigits}-${item.data}`;
          if (dedupKeys.has(keyPid) || dedupKeys.has(keyCpf)) {
            log.push(`   ⏭ turno ${item.data} já existe pra ${item.nome} — pulado`);
            setImportLog([...log]);
            pulados++;
            continue;
          }

          // Cálculo de horas e total (se possível)
          let horas: number | null = null;
          let totalCalc: number | null = null;
          if (item.entrada && item.saida) {
            horas = calcHorasLiquidas(item.entrada, item.saida, item.intervaloMinutos || 0);
          }
          if (item.valorTipo === "diaria") {
            totalCalc = item.valorUnit;
          } else if (item.valorTipo === "hora" && horas != null) {
            totalCalc = +(horas * item.valorUnit).toFixed(2);
          }

          // Status: agendado se futuro, aberto se hoje, fechamento se passado
          // E o turno já está completo (entrada+saida calculadas).
          let status: "agendado" | "aberto" | "fechamento";
          if (item.data > today) status = "agendado";
          else if (item.data === today) status = "aberto";
          else status = horas != null ? "fechamento" : "aberto";

          // Intervalo em formato HH:MM (pra exibir no fechamento)
          const intervaloStr = item.intervaloMinutos != null
            ? `${String(Math.floor(item.intervaloMinutos / 60)).padStart(2, "0")}:${String(item.intervaloMinutos % 60).padStart(2, "0")}`
            : undefined;

          const payload: Record<string, unknown> = {
            restaurantId,
            empregadoId: null,
            pessoaId: pessoa.id,
            nomeSnapshot: item.nome,
            cpfSnapshot: cpfDigits,
            pixSnapshot: item.pix,
            ...(item.whatsapp ? { whatsappSnapshot: item.whatsapp } : {}),
            date: item.data,
            scheduledDate: item.data,
            area: item.area,
            ...(item.entrada ? { entrada: item.entrada } : {}),
            ...(item.saida ? { saida: item.saida } : {}),
            ...(intervaloStr ? { intervalo: intervaloStr } : {}),
            ...(horas != null ? { horas } : {}),
            valorTipo: item.valorTipo,
            valorUnit: item.valorUnit,
            ...(totalCalc != null ? { totalCalc } : {}),
            status,
            lotePagamentoId: null,
            ...(item.observacao ? { observacao: item.observacao } : {}),
            lancadoPor: me.id,
            lancadoPorNome: me.nome,
            lancadoEm: now,
            updatedAt: now,
          };

          await addDoc(collection(db, "freelaShifts"), payload);
          // Marca como dedup pro próximo turno do mesmo lote não duplicar
          dedupKeys.add(keyPid);
          dedupKeys.add(keyCpf);
          criados++;

          const totalStr = totalCalc != null ? ` = R$ ${totalCalc.toFixed(2)}` : "";
          const horasStr = horas != null ? ` (${horas.toFixed(2)}h)` : "";
          log.push(`   📌 turno ${item.data} ${item.area}${horasStr} · ${item.valorTipo} R$ ${item.valorUnit}${totalStr} · status=${status}`);
          setImportLog([...log]);
        } catch (e) {
          falhas++;
          log.push(`❌ ${item.nome} — erro: ${e instanceof Error ? e.message : String(e)}`);
          setImportLog([...log]);
        }
      }

      log.push("");
      log.push(`Fim. ${criados} criado(s), ${pulados} pulado(s) (já existiam), ${falhas} falha(s).`);
      setImportLog([...log]);
      onImported();
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal title="🧪 Importar lote de freelas (provisório)" onClose={onClose} maxWidth="max-w-3xl">
      <div className="space-y-3 text-sm">
        <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
          <p>
            <strong>Cole um JSON</strong> (array de objetos) com os turnos a lançar. Cada
            objeto cria 1 turno; se o CPF não existir em Pessoas, cria a pessoa também.
          </p>
          <p>
            Campos obrigatórios: <code>nome, cpf, pix, data (YYYY-MM-DD), area, valorTipo, valorUnit</code>.
          </p>
          <p>
            Opcionais: <code>whatsapp, entrada/saida (HH:MM), intervaloMinutos (número), observacao</code>.
            Quando entrada+saída+intervalo vêm preenchidos, o turno já é lançado
            com horas e total calculados, status <code>"fechamento"</code> (pronto pro DP).
          </p>
          <p>
            Áreas válidas: <code>{AREAS.join(", ")}</code> · valorTipo: <code>"hora"</code> ou <code>"diaria"</code>.
          </p>
          <p className="text-amber-700 dark:text-amber-400">
            ⏭ Proteção anti-duplicação ativa: turnos com mesma pessoa + data
            que já existem no restaurante são pulados (log mostra).
          </p>
        </div>

        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={EXEMPLO}
          className="w-full h-64 font-mono text-xs p-3 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
        />

        {parseErr && (
          <div className="text-xs text-red-600 dark:text-red-400">{parseErr}</div>
        )}

        <div className="flex justify-between gap-2 flex-wrap">
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setRaw(EXEMPLO)}>
              Colar exemplo
            </Button>
            <Button variant="secondary" size="sm" onClick={() => { setRaw(""); setResultados(null); setImportLog([]); }}>
              Limpar
            </Button>
          </div>
          <div className="flex gap-2">
            <Button onClick={validar}>1. Validar</Button>
            <Button
              onClick={importar}
              disabled={!resultados || validos.length === 0 || invalidos.length > 0 || importing}
            >
              {importing ? "Importando…" : `2. Importar ${validos.length} turno(s)`}
            </Button>
          </div>
        </div>

        {resultados && (
          <div className="border-t border-gray-200 dark:border-gray-800 pt-3 space-y-2">
            <div className="text-xs font-semibold">
              Preview: {validos.length} válido(s), {invalidos.length} com erro
            </div>

            {invalidos.length > 0 && (
              <div className="text-xs bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-2 space-y-1">
                <div className="font-semibold text-red-700 dark:text-red-300">Itens inválidos (corrige o JSON e valida de novo):</div>
                {invalidos.map((it, i) => (
                  <div key={i} className="text-red-700 dark:text-red-300">
                    #{i + 1}: {it.errors.join(" · ")}
                  </div>
                ))}
              </div>
            )}

            {validos.length > 0 && (
              <div className="text-xs space-y-1 max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-800 rounded p-2">
                {validos.map((v, i) => (
                  <div key={i} className="flex justify-between gap-2">
                    <span><strong>{v.item.nome}</strong> · {v.item.data} · {v.item.area}{v.item.entrada ? ` · ${v.item.entrada}` : ""}</span>
                    <span className="text-gray-500">{v.item.valorTipo === "diaria" ? "diária" : "/h"} R$ {v.item.valorUnit}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {importErr && (
          <div className="text-xs text-red-600 dark:text-red-400">{importErr}</div>
        )}

        {importLog.length > 0 && (
          <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
            <div className="text-xs font-semibold mb-1">Log:</div>
            <pre className="text-[11px] font-mono bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded p-2 max-h-48 overflow-y-auto">
{importLog.join("\n")}
            </pre>
          </div>
        )}
      </div>
    </Modal>
  );
}
