// ════════════════════════════════════════════════════════════════════════════
//  Sub-tab "Pessoas em admissão" — lista de admissões em andamento + botão
//  pra iniciar nova admissão. Cards mostram status, candidato, prazo e
//  ações principais (reenviar link, copiar link, cancelar, aprovar).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import {
  ADMISSAO_STATUS_LABEL,
  type Admissao,
  type Cargo,
  type Restaurant,
} from "../../core/types";
import {
  avancarStatus,
  cancelarAdmissao,
  getPrazoDias,
  getSchemaAdmissao,
  iniciarAdmissao,
  linkWhatsAppCandidato,
  marcarDocumentosRecebidos,
  marcarLinkEnviado,
  montarMensagemEnvioLink,
  proximoStatus,
  reenviarAdmissao,
  statusEfetivo,
  temDadosFinaisCompletos,
  urlPublicaAdmissao,
} from "../../core/admissao/admissaoHelpers";
import { IniciarAdmissaoModal } from "./IniciarAdmissaoModal";
import { CancelarAdmissaoModal } from "./CancelarAdmissaoModal";

type Props = {
  rid: string;
  activeRestaurant: Restaurant;
};

function fmtDataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function fmtTempoRestante(expiraEm: string): string {
  const ms = new Date(expiraEm).getTime() - Date.now();
  if (ms <= 0) return "expirado";
  const horas = Math.floor(ms / 3600_000);
  const minutos = Math.floor((ms % 3600_000) / 60_000);
  if (horas >= 24) {
    const dias = Math.floor(horas / 24);
    const restoH = horas % 24;
    return `${dias}d${restoH > 0 ? ` ${restoH}h` : ""} restantes`;
  }
  if (horas > 0) return `${horas}h ${minutos}min restantes`;
  return `${minutos}min restantes`;
}

const STATUS_COR: Record<string, string> = {
  formulario_enviado:    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  formulario_preenchido: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  documentos_recebidos:  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  admitido:              "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  cancelada:             "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
  expirada:              "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
};

export function AdmissaoLista({ rid, activeRestaurant }: Props) {
  const { pessoa: me } = useAuth();
  const [admissoes, setAdmissoes] = useState<Admissao[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [showIniciar, setShowIniciar] = useState(false);

  // Mostrar admitidas/canceladas é opcional (default: esconde)
  const [mostrarFinalizadas, setMostrarFinalizadas] = useState(false);

  useEffect(() => {
    if (!rid) return;
    const q1 = query(collection(db, "admissoes"), where("restaurantId", "==", rid));
    const u1 = onSnapshot(q1, (snap) => {
      setAdmissoes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Admissao)));
    });
    const q2 = query(collection(db, "cargos"), where("restaurantId", "==", rid));
    const u2 = onSnapshot(q2, (snap) => {
      setCargos(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Cargo)));
    });
    return () => { u1(); u2(); };
  }, [rid]);

  const cargoPorId = useMemo(() => {
    const m = new Map<string, Cargo>();
    for (const c of cargos) m.set(c.id, c);
    return m;
  }, [cargos]);

  // Filtra + ordena (mais recente primeiro)
  const visiveis = useMemo(() => {
    const lista = admissoes.filter((a) => {
      const st = statusEfetivo(a);
      if (mostrarFinalizadas) return true;
      return st !== "admitido" && st !== "cancelada";
    });
    return lista.sort((a, b) => b.iniciadoEm.localeCompare(a.iniciadoEm));
  }, [admissoes, mostrarFinalizadas]);

  async function handleIniciar(
    input: Omit<Parameters<typeof iniciarAdmissao>[0], "restaurantSnapshot">,
  ) {
    if (!me) return;
    const adm = await iniciarAdmissao(
      {
        ...input,
        restaurantSnapshot: {
          nome: activeRestaurant.nome,
          whatsappDP: activeRestaurant.whatsappDP || undefined,
          prazoDias: getPrazoDias(activeRestaurant),
        },
      },
      me,
    );
    setShowIniciar(false);
    // Auto-marcar enviado já após criar? Não — espera o RH clicar em
    // "Enviar WhatsApp" pra iniciar o timer. Mas se quiser, pode marcar
    // direto e abrir o WhatsApp na sequência. Pra UX mais limpa, deixa
    // o usuário clicar explicitamente.
    return adm;
  }

  async function handleEnviarWhats(adm: Admissao) {
    if (!me) return;
    const prazoDias = getPrazoDias(activeRestaurant);
    let admissao = adm;
    // Se ainda não foi marcado como enviado, marca agora (inicia timer)
    if (!adm.enviadoEm) {
      await marcarLinkEnviado(adm.id, prazoDias);
      admissao = { ...adm, enviadoEm: new Date().toISOString(), expiraEm: new Date(Date.now() + prazoDias * 86400000).toISOString() };
    }
    const url = urlPublicaAdmissao(admissao.token, activeRestaurant.subdomain);
    const msg = montarMensagemEnvioLink(
      admissao.candidato.nome,
      activeRestaurant.nome,
      url,
      prazoDias,
    );
    const link = linkWhatsAppCandidato(admissao.candidato.whatsapp, msg);
    if (!link) {
      alert(`WhatsApp do candidato inválido. Edite o cadastro pra continuar.`);
      return;
    }
    window.open(link, "_blank");
  }

  async function handleReenviar(adm: Admissao) {
    if (!me) return;
    if (!confirm("Gerar novo link? O link anterior deixa de funcionar (os dados preenchidos ficam preservados).")) return;
    const prazoDias = getPrazoDias(activeRestaurant);
    const { token } = await reenviarAdmissao(adm, prazoDias, me);
    // Abre wa.me com o novo link
    const url = urlPublicaAdmissao(token, activeRestaurant.subdomain);
    const msg = montarMensagemEnvioLink(
      adm.candidato.nome,
      activeRestaurant.nome,
      url,
      prazoDias,
    );
    const link = linkWhatsAppCandidato(adm.candidato.whatsapp, msg);
    if (link) window.open(link, "_blank");
  }

  async function handleCopiarLink(adm: Admissao) {
    const url = urlPublicaAdmissao(adm.token, activeRestaurant.subdomain);
    try {
      await navigator.clipboard.writeText(url);
      alert("Link copiado pra área de transferência.");
    } catch {
      prompt("Copie o link:", url);
    }
  }

  const [admCancelando, setAdmCancelando] = useState<Admissao | null>(null);

  async function handleAvancar(adm: Admissao) {
    const prox = proximoStatus(adm.status);
    if (!prox) return;
    // Pra passar de documentos_recebidos → dados_finais_preenchidos exige
    // que os 4 campos (cargo, data admissão, salário, horários) estejam ok.
    if (prox === "dados_finais_preenchidos" && !temDadosFinaisCompletos(adm)) {
      alert(
        "Pra avançar pra 'Dados finais preenchidos' é preciso ter: cargo, data " +
        "de admissão, salário e horários cadastrados. Edite os dados básicos da " +
        "admissão pra completar (em iteração futura).",
      );
      return;
    }
    if (!confirm(`Avançar pra "${ADMISSAO_STATUS_LABEL[prox]}"?`)) return;
    await avancarStatus(adm.id, prox);
  }

  async function handleConfirmarDocs(adm: Admissao) {
    if (!me) return;
    if (!confirm("Confirma que os documentos foram recebidos via WhatsApp?")) return;
    await marcarDocumentosRecebidos(adm.id, me);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowIniciar(true)}>
            ➕ Nova admissão
          </Button>
          <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 ml-2 select-none">
            <input
              type="checkbox"
              checked={mostrarFinalizadas}
              onChange={(e) => setMostrarFinalizadas(e.target.checked)}
              className="accent-indigo-600"
            />
            mostrar admitidas/canceladas
          </label>
        </div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400">
          {visiveis.length} admissão(ões) em andamento
        </div>
      </div>

      {visiveis.length === 0 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center text-sm text-gray-500 dark:text-gray-400">
          Nenhuma admissão em andamento. Clique em <strong>"Nova admissão"</strong> pra começar.
        </div>
      )}

      <div className="space-y-2">
        {visiveis.map((adm) => {
          const st = statusEfetivo(adm);
          const cargo = cargoPorId.get(adm.cargoId);
          return (
            <section
              key={adm.id}
              className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4"
            >
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-gray-900 dark:text-gray-100">{adm.candidato.nome}</span>
                    <span
                      className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${
                        STATUS_COR[st] || "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {ADMISSAO_STATUS_LABEL[st]}
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 space-y-0.5">
                    <div>📧 {adm.candidato.email} · 📱 {adm.candidato.whatsapp}</div>
                    <div>Cargo: <strong>{cargo?.nome || "—"}</strong> · Iniciada por {adm.iniciadoPor.nome} em {fmtDataHora(adm.iniciadoEm)}</div>
                    {adm.enviadoEm && (
                      <div>
                        Link enviado em {fmtDataHora(adm.enviadoEm)}
                        {adm.expiraEm && st === "formulario_enviado" && (
                          <span className="ml-1 text-amber-700 dark:text-amber-400">
                            · ⏳ {fmtTempoRestante(adm.expiraEm)}
                          </span>
                        )}
                        {(adm.reenvios?.length || 0) > 0 && (
                          <span className="ml-1 text-gray-400">({adm.reenvios?.length} reenvio(s))</span>
                        )}
                      </div>
                    )}
                    {adm.preenchidoEm && (
                      <div className="text-sky-700 dark:text-sky-400">✓ Formulário preenchido em {fmtDataHora(adm.preenchidoEm)}</div>
                    )}
                    {adm.documentosRecebidosEm && (
                      <div className="text-emerald-700 dark:text-emerald-400">✓ Documentos recebidos em {fmtDataHora(adm.documentosRecebidosEm)} por {adm.documentosRecebidosPor?.nome}</div>
                    )}
                    {adm.aprovadoEm && (
                      <div className="text-indigo-700 dark:text-indigo-400">✓ Admitido em {fmtDataHora(adm.aprovadoEm)} por {adm.aprovadoPor?.nome}</div>
                    )}
                    {adm.canceladoEm && (
                      <div className="text-rose-700 dark:text-rose-400">✕ Cancelada em {fmtDataHora(adm.canceladoEm)} por {adm.canceladoPor?.nome} — "{adm.motivoCancelamento}"</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Ações conforme status */}
                  {(st === "formulario_enviado" || (!adm.enviadoEm)) && (
                    <Button size="sm" onClick={() => handleEnviarWhats(adm)}>
                      💬 {adm.enviadoEm ? "Reenviar" : "Enviar link via WhatsApp"}
                    </Button>
                  )}
                  {st === "expirada" && (
                    <Button size="sm" onClick={() => handleReenviar(adm)}>
                      🔄 Gerar novo link
                    </Button>
                  )}
                  {(st === "formulario_enviado" || st === "expirada") && adm.enviadoEm && (
                    <Button size="sm" variant="secondary" onClick={() => handleCopiarLink(adm)}>
                      📋 Copiar link
                    </Button>
                  )}
                  {st === "formulario_preenchido" && (
                    <Button size="sm" onClick={() => handleConfirmarDocs(adm)}>
                      ✓ Confirmar docs recebidos
                    </Button>
                  )}
                  {/* Avançar etapa — só se há próxima e status não é terminal */}
                  {proximoStatus(adm.status) && st !== "cancelada" && st !== "expirada" && st !== "formulario_preenchido" && (
                    <Button size="sm" onClick={() => handleAvancar(adm)}>
                      ▶ Avançar
                    </Button>
                  )}
                  {/* Cancelar — disponível enquanto não foi admitido nem cancelado */}
                  {st !== "admitido" && st !== "cancelada" && (
                    <Button size="sm" variant="secondary" onClick={() => setAdmCancelando(adm)}>
                      ✕ Cancelar
                    </Button>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {showIniciar && (
        <IniciarAdmissaoModal
          rid={rid}
          cargos={cargos}
          schemaUsado={getSchemaAdmissao(activeRestaurant)}
          onClose={() => setShowIniciar(false)}
          onConfirm={handleIniciar}
        />
      )}

      {admCancelando && (
        <CancelarAdmissaoModal
          candidatoNome={admCancelando.candidato.nome}
          onClose={() => setAdmCancelando(null)}
          onConfirm={async (motivos, texto) => {
            if (!me) return;
            await cancelarAdmissao(admCancelando.id, motivos, texto, me);
            setAdmCancelando(null);
          }}
        />
      )}
    </div>
  );
}
