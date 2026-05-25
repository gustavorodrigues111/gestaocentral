// Preview do email de COMPROVANTE de reserva (enviado pelo Resend após
// cliente submeter form público). Renderiza com dados mockados pra admin
// validar como vai chegar na inbox do cliente — sem precisar criar uma
// reserva real só pra disparar email.
//
// Não tem editor (texto é hardcoded no helper) — esse tab é só preview.
// Quando quiser editar copy, mexer em src/modules/sites/email/comprovanteReserva.ts.

import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { montarEmailComprovanteReserva } from "../sites/email/comprovanteReserva";
import type { SiteConfig } from "../../core/types";

type Props = {
  restaurantId: string;
};

type Device = "mobile" | "desktop";

export function EmailComprovanteTab({ restaurantId }: Props) {
  const { restaurants } = useRestaurant();
  const restaurante = restaurants.find(r => r.id === restaurantId);
  const restauranteNome = restaurante?.nome || "Restaurante";

  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [device, setDevice] = useState<Device>("mobile");

  useEffect(() => {
    setLoading(true);
    setErro("");
    (async () => {
      try {
        const snap = await getDoc(doc(db, "sitesConfig", restaurantId));
        if (!snap.exists()) {
          setErro("Esse restaurante ainda não tem site configurado em Sites → Geral. " +
            "Configura logo, endereço e telefone lá pra ver o preview com identidade correta.");
          setSiteConfig(null);
        } else {
          setSiteConfig({ id: snap.id, ...snap.data() } as SiteConfig);
        }
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao carregar site config");
      } finally {
        setLoading(false);
      }
    })();
  }, [restaurantId]);

  // Dados mockados pra renderizar — usa valores realistas pra admin ver o
  // visual real. Data fixa amanhã às 20h pra não ficar mudando preview.
  const previewArgs = useMemo(() => {
    if (!siteConfig) return null;
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    const dataIso = amanha.toISOString().slice(0, 10);
    return {
      emailDestinatario: "cliente@exemplo.com",
      nomeDestinatario: "Maria Silva",
      data: dataIso,
      horario: "20:00",
      pessoas: 4,
      salaoNome: "Salão Principal",
      ocasiao: "Aniversário",
      observacoes: "Mesa próxima da janela, se possível.",
      restauranteNome,
      siteConfig,
    };
  }, [siteConfig, restauranteNome]);

  const emailPayload = useMemo(() => {
    if (!previewArgs) return null;
    return montarEmailComprovanteReserva(previewArgs);
  }, [previewArgs]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-semibold">Email de comprovante</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
            Enviado automaticamente quando cliente cria reserva pelo site público.
            Pra editar a copy, mexe em <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">comprovanteReserva.ts</code>.
          </p>
        </div>
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
          <DeviceBtn ativo={device === "mobile"} onClick={() => setDevice("mobile")}>
            📱 Mobile
          </DeviceBtn>
          <DeviceBtn ativo={device === "desktop"} onClick={() => setDevice("desktop")}>
            🖥 Desktop
          </DeviceBtn>
        </div>
      </div>

      {loading && (
        <div className="text-sm text-gray-500 py-8 text-center">Carregando...</div>
      )}
      {erro && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-200">
          ⚠ {erro}
        </div>
      )}

      {emailPayload && (
        <>
          {/* Meta: subject + from/to mockados */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3 text-sm space-y-1">
            <div className="flex gap-2">
              <span className="text-gray-500 dark:text-gray-400 w-16 shrink-0">De:</span>
              <span className="font-medium">
                {restauranteNome} &lt;reservas@{(siteConfig?.slug || "lobozo")}.com.br&gt;
              </span>
            </div>
            <div className="flex gap-2">
              <span className="text-gray-500 dark:text-gray-400 w-16 shrink-0">Pra:</span>
              <span>{emailPayload.to}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-gray-500 dark:text-gray-400 w-16 shrink-0">Assunto:</span>
              <span className="font-medium">{emailPayload.subject}</span>
            </div>
          </div>

          {/* Iframe com o HTML renderizado. srcDoc isola styles e scripts
              do email do admin (não cruza). Largura ajustada por device. */}
          <div className="flex justify-center">
            <div
              className="border border-gray-300 dark:border-gray-700 rounded-lg overflow-hidden shadow-sm transition-all"
              style={{ width: device === "mobile" ? 390 : 640, maxWidth: "100%" }}
            >
              <iframe
                title="Preview email comprovante"
                srcDoc={emailPayload.html}
                style={{
                  width: "100%",
                  height: 880,
                  border: "none",
                  display: "block",
                  backgroundColor: "#fff",
                }}
              />
            </div>
          </div>

          {/* Versão text/plain (clientes que bloqueiam HTML) */}
          <details className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <summary className="px-3 py-2 cursor-pointer text-sm text-gray-600 dark:text-gray-400 select-none">
              Versão texto puro (clientes que bloqueiam HTML)
            </summary>
            <pre className="px-3 pb-3 text-xs whitespace-pre-wrap font-mono text-gray-700 dark:text-gray-300">
              {emailPayload.text}
            </pre>
          </details>
        </>
      )}
    </div>
  );
}

function DeviceBtn({ ativo, onClick, children }: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
        ativo
          ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
          : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
      }`}
    >
      {children}
    </button>
  );
}
