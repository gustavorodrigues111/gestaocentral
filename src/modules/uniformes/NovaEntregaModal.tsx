// Modal — Nova entrega de uniformes OU EPIs (separado).
// Fluxo:
//   1. Escolhe pessoa (autocomplete de pessoas do restaurante)
//   2. Carrega kit padrão da área do cargo dela (se vinculada a empregado) — opcional
//   3. Edita itens + tamanhos + quantidades
//   4. Motivo (admissão / troca / reposição / freelancer)
//   5. Salva → cria entrega + baixa estoque + gera PDF pra download

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import type {
  Admissao, Cargo, EntregaUniforme, ItemUniforme, KitAreaUniforme, Pessoa, Restaurant,
  TermoUniformesConfig, TipoItemUniforme,
} from "../../core/types";
import { criarEntrega } from "../../core/uniformes/uniformesHelpers";
import { gerarTermoUniformesPDF, termoUniformesFilename } from "./gerarTermoPDF";

type Props = {
  tipo: TipoItemUniforme;
  itens: ItemUniforme[];
  kits: KitAreaUniforme[];
  restaurantId: string;
  activeRestaurant: Restaurant;
  pessoa: Pessoa;
  onClose: () => void;
  /** Quando aberto a partir do checklist de uma admissão, pré-preenche
      tudo (motivo=admissao, candidato fixo, tipo fixo). */
  admissaoContexto?: Admissao;
  /** Callback chamado quando a entrega é criada com sucesso —
      usado pra marcar a subtarefa correspondente. */
  onEntregaCriada?: (pdf?: { blob: Blob; filename: string }) => void;
};

type LinhaEntrega = {
  itemId: string;
  variacaoId: string;
  qtd: number;
};

export function NovaEntregaModal({
  tipo, itens, kits, restaurantId, activeRestaurant, pessoa, onClose,
  admissaoContexto, onEntregaCriada,
}: Props) {
  // Modo "admissão": pessoa fixa (candidato), tipo fixo, motivo=admissao.
  // Não permite trocar a pessoa.
  const modoAdmissao = !!admissaoContexto;
  // Catálogo de pessoas + cargos pra autocomplete e detecção de área
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  useEffect(() => {
    const u1 = onSnapshot(
      query(collection(db, "pessoas"), where("restaurantIds", "array-contains", restaurantId)),
      (snap) => setPessoas(snap.docs.map(d => ({ ...d.data(), id: d.id }) as Pessoa)),
    );
    const u2 = onSnapshot(
      query(collection(db, "cargos"), where("restaurantId", "==", restaurantId)),
      (snap) => setCargos(snap.docs.map(d => ({ ...d.data(), id: d.id }) as Cargo)),
    );
    return () => { u1(); u2(); };
  }, [restaurantId]);

  const [pessoaSelId, setPessoaSelId] = useState(
    () => admissaoContexto?.pessoaIdVinculada || "",
  );
  const pessoaSel = pessoas.find(p => p.id === pessoaSelId);

  // Detecção de área via teamData[rid].cargoId
  const areaDaPessoa = useMemo(() => {
    if (!pessoaSel) return null;
    const teamData = (pessoaSel as unknown as {
      teamData?: { [rid: string]: { cargoId?: string } };
    }).teamData;
    const cargoId = teamData?.[restaurantId]?.cargoId;
    if (!cargoId) return null;
    const c = cargos.find(c => c.id === cargoId);
    return c?.area || null;
  }, [pessoaSel, cargos, restaurantId]);

  // Linhas da entrega (editáveis)
  const [linhas, setLinhas] = useState<LinhaEntrega[]>([]);
  const [motivo, setMotivo] = useState<EntregaUniforme["motivo"]>(
    modoAdmissao ? "admissao" : "admissao",
  );
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");

  // Itens filtrados por tipo
  const itensTipo = useMemo(
    () => itens.filter(i => i.ativo && i.tipo === tipo)
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [itens, tipo],
  );

  // Aplica kit padrão da área (só itens do tipo correto)
  function aplicarKit() {
    if (!areaDaPessoa) return;
    const kit = kits.find(k => k.area === areaDaPessoa);
    if (!kit) return;
    const novas: LinhaEntrega[] = [];
    for (const ki of kit.itens) {
      const item = itens.find(i => i.id === ki.itemId && i.tipo === tipo);
      if (!item) continue;
      // Se kit definiu variacaoId, usa. Senão pega a primeira variação.
      const variacaoId = ki.variacaoId || item.variacoes[0]?.id;
      if (!variacaoId) continue;
      novas.push({ itemId: item.id, variacaoId, qtd: ki.quantidade });
    }
    setLinhas(novas);
  }
  // Auto-aplica kit quando seleciona pessoa
  useEffect(() => {
    if (areaDaPessoa) aplicarKit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaDaPessoa, tipo]);

  function addLinha() {
    setLinhas(prev => [...prev, { itemId: "", variacaoId: "", qtd: 1 }]);
  }
  function rmLinha(idx: number) {
    setLinhas(prev => prev.filter((_, i) => i !== idx));
  }
  function setLinha(idx: number, patch: Partial<LinhaEntrega>) {
    setLinhas(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  }

  const pessoasFiltradas = useMemo(() => {
    if (!busca.trim()) return pessoas.slice(0, 10);
    const q = busca.toLowerCase();
    return pessoas.filter(p =>
      p.nome.toLowerCase().includes(q) ||
      (p.cpf || "").includes(q),
    ).slice(0, 10);
  }, [busca, pessoas]);

  async function salvarEGerarPDF() {
    setErro("");
    if (!modoAdmissao && !pessoaSelId) { setErro("Selecione a pessoa."); return; }
    if (linhas.length === 0) { setErro("Adicione pelo menos 1 item."); return; }
    for (const l of linhas) {
      if (!l.itemId || !l.variacaoId || !l.qtd || l.qtd < 1) {
        setErro("Confira todas as linhas (item + variação + quantidade > 0).");
        return;
      }
    }

    setSalvando(true);
    try {
      // Em modo admissão SEM pessoa vinculada, usa o snapshot do candidato.
      const candidatoSnapshot = (modoAdmissao && !pessoaSelId && admissaoContexto)
        ? {
            nome: admissaoContexto.candidato.nome,
            cpf: admissaoContexto.candidato.cpf,
            whatsapp: admissaoContexto.candidato.whatsapp,
          }
        : undefined;
      // Cria entrega
      const empregadoId = (pessoaSel as unknown as {
        teamData?: { [rid: string]: { empregadoId?: string } };
      })?.teamData?.[restaurantId]?.empregadoId;
      const entrega = await criarEntrega({
        restaurantId,
        pessoaId: pessoaSelId || undefined,
        candidatoSnapshot,
        empregadoId,
        admissaoId: admissaoContexto?.id,
        tipo,
        motivo,
        itens: linhas,
        observacao: observacao.trim() || undefined,
        pessoa,
        catalogo: itens,
      });

      // Busca config de termo (override por restaurante)
      const cfgSnap = await getDocs(query(
        collection(db, "termoUniformesConfig"),
        where("restaurantId", "==", restaurantId),
      ));
      const cfg = cfgSnap.docs[0]
        ? ({ id: cfgSnap.docs[0].id, ...cfgSnap.docs[0].data() } as TermoUniformesConfig)
        : null;

      // Função do empregado (cargo) — pra cabeçalho do PDF
      const teamData = (pessoaSel as unknown as {
        teamData?: { [rid: string]: { cargoId?: string } };
      } | undefined)?.teamData;
      const cargoId = teamData?.[restaurantId]?.cargoId;
      const cargo = cargos.find(c => c.id === cargoId);

      // Gera PDF — usa candidato da admissão se em modo admissão, senão usa pessoa
      const nomePdf = modoAdmissao && admissaoContexto
        ? admissaoContexto.candidato.nome
        : (pessoaSel?.nome || "");
      const cpfPdf = modoAdmissao && admissaoContexto
        ? admissaoContexto.candidato.cpf
        : (pessoaSel?.cpf || "");
      const pdfParams = {
        entrega,
        restaurant: activeRestaurant,
        candidatoNome: nomePdf,
        candidatoCpf: cpfPdf,
        funcao: cargo?.nome,
        config: cfg,
      };
      const doc = await gerarTermoUniformesPDF(pdfParams);
      const filename = termoUniformesFilename(pdfParams);
      doc.save(filename); // baixa cópia local (comportamento de antes)
      onEntregaCriada?.({ blob: doc.output("blob"), filename });
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar.");
      setSalvando(false);
    }
  }

  return (
    <Modal
      title={`Nova entrega de ${tipo === "epi" ? "EPI" : "Uniforme"}`}
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      <div className="p-4 space-y-4">
        {/* Modo admissão: mostra candidato fixo da admissão */}
        {modoAdmissao && admissaoContexto && (
          <div className="rounded border border-indigo-300 bg-indigo-50/40 dark:bg-indigo-900/20 dark:border-indigo-800 p-3">
            <div className="text-[10px] uppercase tracking-wider font-bold text-indigo-700 dark:text-indigo-300">
              Candidato em admissão
            </div>
            <div className="text-sm font-semibold mt-0.5">{admissaoContexto.candidato.nome}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400">
              CPF {admissaoContexto.candidato.cpf}
              {pessoaSel && <> · vinculado a pessoa <strong>{pessoaSel.nome}</strong></>}
            </div>
          </div>
        )}

        {/* Selecionar pessoa (só fora do modo admissão) */}
        {!modoAdmissao && <div>
          <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">
            Pessoa *
          </label>
          {pessoaSel ? (
            <div className="mt-1 flex items-center gap-2 p-2 rounded border border-indigo-300 bg-indigo-50/40 dark:bg-indigo-900/20 dark:border-indigo-800">
              <div className="flex-1">
                <div className="font-semibold text-sm">{pessoaSel.nome}</div>
                <div className="text-xs text-gray-500">
                  CPF {pessoaSel.cpf || "—"}
                  {areaDaPessoa && <> · área: <strong>{areaDaPessoa}</strong></>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setPessoaSelId(""); setLinhas([]); }}
                className="text-xs text-gray-500 hover:text-rose-600"
              >
                trocar
              </button>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome ou CPF…"
                className="mt-1 w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                autoFocus
              />
              {busca.trim() && (
                <div className="mt-1 border border-gray-200 dark:border-gray-800 rounded max-h-40 overflow-y-auto">
                  {pessoasFiltradas.length === 0 ? (
                    <div className="text-xs text-gray-500 italic p-2">Ninguém encontrado.</div>
                  ) : pessoasFiltradas.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { setPessoaSelId(p.id); setBusca(""); }}
                      className="w-full text-left p-2 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-800 last:border-0"
                    >
                      <div className="font-medium">{p.nome}</div>
                      <div className="text-gray-500">{p.cpf || "sem CPF"}</div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>}

        {/* Motivo */}
        <div>
          <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">Motivo</label>
          <select
            value={motivo}
            onChange={(e) => setMotivo(e.target.value as EntregaUniforme["motivo"])}
            className="mt-1 w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          >
            <option value="admissao">Admissão</option>
            <option value="troca">Troca (item velho/danificado)</option>
            <option value="reposicao">Reposição</option>
            <option value="freelancer">Freelancer</option>
          </select>
        </div>

        {/* Itens */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">
              Itens a entregar
            </label>
            <div className="flex gap-2">
              {areaDaPessoa && (
                <button
                  type="button"
                  onClick={aplicarKit}
                  className="text-[11px] px-2 py-1 rounded border border-dashed border-indigo-400 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
                >
                  ↻ aplicar kit da área "{areaDaPessoa}"
                </button>
              )}
              <button
                type="button"
                onClick={addLinha}
                className="text-[11px] px-2 py-1 rounded border border-dashed border-gray-400 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                + item
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            {linhas.map((l, idx) => {
              const item = itens.find(i => i.id === l.itemId);
              const variacoes = item?.variacoes || [];
              const variacaoSel = variacoes.find(v => v.id === l.variacaoId);
              const insufic = variacaoSel && variacaoSel.estoque < l.qtd;
              return (
                <div key={idx} className="grid grid-cols-[1fr_120px_60px_30px] gap-1.5 items-center">
                  <select
                    value={l.itemId}
                    onChange={(e) => setLinha(idx, { itemId: e.target.value, variacaoId: "" })}
                    className="px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                  >
                    <option value="">— item —</option>
                    {itensTipo.map(i => (
                      <option key={i.id} value={i.id}>{i.nome}</option>
                    ))}
                  </select>
                  <select
                    value={l.variacaoId}
                    onChange={(e) => setLinha(idx, { variacaoId: e.target.value })}
                    disabled={!item}
                    className="px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                  >
                    <option value="">— tamanho —</option>
                    {variacoes.map(v => (
                      <option key={v.id} value={v.id}>
                        {v.tamanho} · {v.estoque} em estoque
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    value={l.qtd}
                    onChange={(e) => setLinha(idx, { qtd: parseInt(e.target.value, 10) || 0 })}
                    className={`px-2 py-1.5 text-sm rounded border ${
                      insufic ? "border-rose-400" : "border-gray-300 dark:border-gray-700"
                    } bg-white dark:bg-gray-900 tabular-nums`}
                  />
                  <button
                    type="button"
                    onClick={() => rmLinha(idx)}
                    className="text-rose-500 hover:text-rose-700 text-xs"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
            {linhas.length === 0 && (
              <div className="text-xs text-gray-400 italic text-center py-3">
                Nenhum item adicionado.
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">
            Observação (opcional)
          </label>
          <input
            type="text"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="ex: kit pra D1, troca por desgaste"
            className="mt-1 w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          />
        </div>

        {erro && <div className="text-xs text-rose-600 dark:text-rose-400">{erro}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvarEGerarPDF} disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar e gerar PDF"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
