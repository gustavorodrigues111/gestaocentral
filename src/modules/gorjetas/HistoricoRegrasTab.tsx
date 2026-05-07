import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { empregadoAtivoEm } from "../../core/utils/empregado";
import { todayYmd } from "../../core/utils/date";
import { TIPOS_VINCULO_COM_PESSOA } from "../../core/types";
import type { Cargo, Empregado, SplitVersion } from "../../core/types";
import { gerarAtaPDF } from "./gerarAtaPDF";

type Props = { rid: string };

export function HistoricoRegrasTab({ rid }: Props) {
  const { restaurants } = useRestaurant();
  const restaurant = restaurants.find(r => r.id === rid);
  const [versions, setVersions] = useState<SplitVersion[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [loading, setLoading] = useState(true);
  const [gerandoAtaDe, setGerandoAtaDe] = useState<SplitVersion | null>(null);

  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "splitVersions"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as SplitVersion);
      list.sort((a, b) => (b.effectiveFrom || "").localeCompare(a.effectiveFrom || ""));
      setVersions(list);
      setLoading(false);
    });
    return () => unsub();
  }, [rid]);

  useEffect(() => {
    const q = query(collection(db, "empregados"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setEmpregados(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado));
    });
    return () => unsub();
  }, [rid]);

  useEffect(() => {
    const q = query(collection(db, "cargos"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setCargos(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Cargo));
    });
    return () => unsub();
  }, [rid]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Histórico de versões da regra de divisão. Cada versão pode gerar uma Ata de Assembleia (PDF).
      </p>

      {loading ? (
        <div className="text-sm text-gray-500">Carregando...</div>
      ) : versions.length === 0 ? (
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-6 text-center text-sm text-gray-500">
          Nenhuma versão de regra cadastrada ainda.
        </div>
      ) : (
        <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
          {versions.map((v, i) => (
            <div key={v.id} className={`px-3 py-2 text-sm ${i > 0 ? "border-t border-gray-100 dark:border-gray-800" : ""}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    Vigente desde {v.effectiveFrom}
                    {i === 0 && <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-bold">Atual</span>}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Modo: {v.mode === "global_points" ? "Pontos Globais" : "Por Área + Pontos"} ·
                    Retenção: {v.taxRate}%
                    {v.ata?.meetingDate && ` · Ata: ${v.ata.meetingDate}`}
                    {v.ata?.motivo && ` · "${v.ata.motivo}"`}
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setGerandoAtaDe(v)}>
                  📄 Gerar Ata
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {gerandoAtaDe && restaurant && (
        <GerarAtaModal
          splitVersion={gerandoAtaDe}
          restaurant={restaurant}
          empregados={empregados}
          cargos={cargos}
          onClose={() => setGerandoAtaDe(null)}
        />
      )}
    </div>
  );
}

// ─── Modal: seleciona empregados pra assinar a ata + gera PDF ──────────────
function GerarAtaModal({
  splitVersion, restaurant, empregados, cargos, onClose,
}: {
  splitVersion: SplitVersion;
  restaurant: { id: string; nome: string; cnpj?: string; endereco?: string };
  empregados: Empregado[];
  cargos: Cargo[];
  onClose: () => void;
}) {
  const cargoMap = Object.fromEntries(cargos.map(c => [c.id, c]));

  // Empregados elegíveis: tipoVinculo "com Pessoa" (registrado/estagiário) + ativo HOJE + tem CPF
  const elegiveis = empregados.filter(e => {
    const cargo = cargoMap[e.cargoId];
    if (!cargo) return false;
    if (!TIPOS_VINCULO_COM_PESSOA.includes(cargo.tipoVinculo)) return false;
    if (!empregadoAtivoEm(e, todayYmd())) return false;
    return true;
  }).sort((a, b) => a.nome.localeCompare(b.nome));

  const [search, setSearch] = useState("");
  const [selecionados, setSelecionados] = useState<Set<string>>(
    new Set(elegiveis.map(e => e.id))  // default: todos elegíveis selecionados
  );

  const filtered = elegiveis.filter(e =>
    !search.trim() || e.nome.toLowerCase().includes(search.toLowerCase())
  );

  function toggle(id: string) {
    setSelecionados(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selecionarTodos() { setSelecionados(new Set(elegiveis.map(e => e.id))); }
  function limparSelecao() { setSelecionados(new Set()); }

  const [gerando, setGerando] = useState(false);
  async function gerar() {
    // Restaurant pode não ter cnpj/endereco — passa só o que tem
    const restFull = restaurant as Parameters<typeof gerarAtaPDF>[0]["restaurant"];
    setGerando(true);
    try {
      const pdf = await gerarAtaPDF({
        splitVersion,
        restaurant: restFull,
        cargos,
        empregados,
        empregadosAssinantesIds: [...selecionados],
      });
      pdf.save(`Ata_${restaurant.nome.replace(/\s+/g, "_")}_${splitVersion.effectiveFrom}.pdf`);
    } catch (e) {
      console.error(e);
      alert("Erro ao gerar PDF: " + (e instanceof Error ? e.message : "desconhecido"));
    } finally {
      setGerando(false);
    }
  }

  return (
    <Modal title="📄 Gerar Ata de Assembleia" onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <div className="text-xs bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2 text-blue-800 dark:text-blue-300">
          ℹ️ Selecione os colaboradores que estavam na assembleia (pra assinatura).
          Lista mostra apenas <strong>registrados/estagiários ativos hoje</strong>.
        </div>

        <Input
          placeholder="🔍 Buscar..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="flex gap-2 text-xs">
          <button type="button" onClick={selecionarTodos} className="px-2 py-1 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 hover:bg-indigo-200">
            Selecionar todos ({elegiveis.length})
          </button>
          <button type="button" onClick={limparSelecao} className="px-2 py-1 rounded bg-gray-100 text-gray-600 dark:bg-gray-800 hover:bg-gray-200">
            Limpar
          </button>
          <span className="ml-auto text-gray-500 self-center">
            {selecionados.size} selecionado{selecionados.size !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="border border-gray-200 dark:border-gray-800 rounded-lg max-h-[300px] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-500">
              {search ? "Nenhum encontrado" : "Sem empregados elegíveis"}
            </div>
          ) : filtered.map((e, i) => {
            const cargo = cargoMap[e.cargoId];
            const checked = selecionados.has(e.id);
            return (
              <label
                key={e.id}
                className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 ${i > 0 ? "border-t border-gray-100 dark:border-gray-800" : ""}`}
              >
                <input type="checkbox" checked={checked} onChange={() => toggle(e.id)} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{e.nome}</div>
                  <div className="text-xs text-gray-500">
                    {cargo?.nome || "—"} · {cargo?.area || "—"}
                    {e.cpf && ` · CPF ${e.cpf}`}
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={gerar} disabled={selecionados.size === 0 || gerando}>
            {gerando ? "Gerando..." : "📄 Baixar PDF da Ata"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
