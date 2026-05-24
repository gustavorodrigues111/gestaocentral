// Hook que carrega o SiteConfig de um restaurante.
// Se não existir, retorna um default + função de criar quando o user salvar.
//
// Comportamento:
//   - 1 doc em /sitesConfig com id = restaurantId
//   - onSnapshot pra refletir mudanças
//   - retorna { config, loading, erro } + função save(parcial)

import { useEffect, useState, useCallback } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { SiteConfig } from "../../core/types";

export function defaultSiteConfig(rid: string, nomeRestaurante: string): SiteConfig {
  const now = new Date().toISOString();
  return {
    id: rid,
    restaurantId: rid,
    slogan: "",
    historia: "",
    endereco: {
      rua: "",
      cidade: "",
      uf: "SP",
    },
    telefone: "",
    emailContato: "",
    horarios: [
      { dia: 0, fechado: true,  turnos: [] },
      { dia: 1, fechado: true,  turnos: [] },
      { dia: 2, fechado: false, turnos: [{ abre: "19:00", fecha: "23:00" }] },
      { dia: 3, fechado: false, turnos: [{ abre: "19:00", fecha: "23:00" }] },
      { dia: 4, fechado: false, turnos: [{ abre: "19:00", fecha: "23:00" }] },
      { dia: 5, fechado: false, turnos: [{ abre: "19:00", fecha: "23:00" }] },
      { dia: 6, fechado: false, turnos: [{ abre: "12:00", fecha: "16:00" }, { abre: "19:00", fecha: "23:00" }] },
    ],
    excecoes: [],
    redes: [],
    features: {
      hasDelivery: false,
      hasEventos: false,
      hasLaje: false,
      hasTrabalheConosco: true,
      hasReservas: true,
      hasGaleria: false,
    },
    delivery: [],
    tema: {
      corPrimaria: "#1a5c2a",
      corSecundaria: "#d4af37",
      corFundo: "#ffffff",
      corTexto: "#1a1a1a",
      fonteHeading: "system-ui, sans-serif",
      fonteCorpo: "system-ui, sans-serif",
      raioBorda: "8px",
    },
    slug: nomeRestaurante.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || rid,
    templateId: "default",
    publicado: false,
    createdAt: now,
    updatedAt: now,
  };
}

export type UseSiteConfigResult = {
  config: SiteConfig | null;
  existe: boolean;          // se já foi salvo no Firestore
  loading: boolean;
  erro: string;
  save: (parcial: Partial<SiteConfig>, meId: string) => Promise<void>;
};

export function useSiteConfig(rid: string, nomeRestaurante: string): UseSiteConfigResult {
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [existe, setExiste] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!rid) return;
    const ref = doc(db, "sitesConfig", rid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          setConfig({ id: snap.id, ...snap.data() } as SiteConfig);
          setExiste(true);
        } else {
          setConfig(defaultSiteConfig(rid, nomeRestaurante));
          setExiste(false);
        }
        setLoading(false);
        setErro("");
      },
      (err) => {
        setLoading(false);
        setErro(err.code === "permission-denied" ? "permission_denied" : (err.message || "Erro"));
      },
    );
    return () => unsub();
  }, [rid, nomeRestaurante]);

  const save = useCallback(async (parcial: Partial<SiteConfig>, meId: string) => {
    if (!rid) return;
    const ref = doc(db, "sitesConfig", rid);
    const base = config || defaultSiteConfig(rid, nomeRestaurante);
    const payload: SiteConfig = {
      ...base,
      ...parcial,
      id: rid,
      restaurantId: rid,
      updatedAt: new Date().toISOString(),
      updatedBy: meId,
    };
    await setDoc(ref, sanitizeForFirestore(payload), { merge: true });
  }, [rid, nomeRestaurante, config]);

  return { config, existe, loading, erro, save };
}
