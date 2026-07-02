// Modal de conclusão da admissão quando o empregado ainda NÃO foi criado.
// Deixa escolher entre:
//   • Criar uma Pessoa + Empregado novos (fluxo padrão), ou
//   • Vincular a uma Pessoa que já existe no sistema (ex: criada por fora antes
//     de o módulo existir) — nesse caso não duplica cadastro.
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import type { Pessoa } from "../../core/types";

const soDigitos = (s?: string) => (s || "").replace(/\D/g, "");

type Props = {
  candidatoNome: string;
  candidatoCpf?: string;
  onCriarNova: () => void | Promise<void>;
  onVincular: (pessoaId: string) => void | Promise<void>;
  onClose: () => void;
};

export function ConcluirAdmissaoModal({ candidatoNome, candidatoCpf, onCriarNova, onVincular, onClose }: Props) {
  const [modo, setModo] = useState<"nova" | "vincular">("nova");
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [filtro, setFiltro] = useState("");
  const [selecionadaId, setSelecionadaId] = useState<string>("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "pessoas"),
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Pessoa).filter(p => p.ativa !== false);
        list.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
        setPessoas(list);
      },
      () => { /* silent */ },
    );
    return () => unsub();
  }, []);

  // Sugestão automática: pessoa com o MESMO CPF do candidato.
  const cpfCand = soDigitos(candidatoCpf);
  const sugestao = useMemo(
    () => (cpfCand ? pessoas.find(p => soDigitos(p.cpf) === cpfCand) : undefined),
    [pessoas, cpfCand],
  );

  const filtradas = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    if (!f) return pessoas.slice(0, 30);
    return pessoas.filter(p =>
      p.nome.toLowerCase().includes(f) ||
      (p.email || "").toLowerCase().includes(f) ||
      soDigitos(p.cpf).includes(soDigitos(filtro)),
    ).slice(0, 30);
  }, [pessoas, filtro]);

  async function confirmar() {
    if (salvando) return;
    setSalvando(true);
    try {
      if (modo === "nova") await onCriarNova();
      else if (selecionadaId) await onVincular(selecionadaId);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal title={`Concluir admissão — ${candidatoNome}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          O empregado ainda não foi criado. Como você quer concluir?
        </p>

        <div className="grid grid-cols-1 gap-2">
          <button
            type="button"
            onClick={() => setModo("nova")}
            className={`text-left px-3 py-2.5 rounded-lg border transition-colors ${
              modo === "nova" ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30" : "border-gray-200 dark:border-gray-700 hover:border-gray-300"
            }`}
          >
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">➕ Criar nova pessoa e empregado</div>
            <div className="text-[12px] text-gray-500 dark:text-gray-400">Cria o cadastro do zero a partir dos dados da admissão.</div>
          </button>
          <button
            type="button"
            onClick={() => setModo("vincular")}
            className={`text-left px-3 py-2.5 rounded-lg border transition-colors ${
              modo === "vincular" ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30" : "border-gray-200 dark:border-gray-700 hover:border-gray-300"
            }`}
          >
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">🔗 Vincular a uma pessoa existente</div>
            <div className="text-[12px] text-gray-500 dark:text-gray-400">Já cadastrou essa pessoa por fora? Associa e conclui sem duplicar.</div>
          </button>
        </div>

        {modo === "vincular" && (
          <div className="space-y-2">
            {sugestao && (
              <button
                type="button"
                onClick={() => setSelecionadaId(sugestao.id)}
                className={`w-full text-left px-3 py-2 rounded-lg border ${
                  selecionadaId === sugestao.id ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/25" : "border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10"
                }`}
              >
                <div className="text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-300">Mesmo CPF do candidato</div>
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{sugestao.nome}</div>
                {sugestao.email && <div className="text-[11px] text-gray-500">{sugestao.email}</div>}
              </button>
            )}
            <input
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Buscar por nome, e-mail ou CPF…"
              autoFocus
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
            />
            <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
              {filtradas.length === 0 ? (
                <div className="p-4 text-center text-sm text-gray-500">Nenhuma pessoa encontrada.</div>
              ) : filtradas.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelecionadaId(p.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                    selecionadaId === p.id ? "bg-indigo-50 dark:bg-indigo-900/30" : "hover:bg-gray-50 dark:hover:bg-gray-800/60"
                  }`}
                >
                  <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 flex items-center justify-center text-xs font-semibold shrink-0">
                    {p.nome.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{p.nome}</div>
                    {(p.email || p.cpf) && <div className="text-[11px] text-gray-500 truncate">{p.email || p.cpf}</div>}
                  </div>
                  {selecionadaId === p.id && <span className="text-indigo-600 dark:text-indigo-400 text-sm">✓</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={confirmar}
            disabled={salvando || (modo === "vincular" && !selecionadaId)}
          >
            {salvando ? "Concluindo…" : modo === "nova" ? "Criar e concluir" : "Vincular e concluir"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
