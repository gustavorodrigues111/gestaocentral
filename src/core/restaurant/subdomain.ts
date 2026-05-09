// ════════════════════════════════════════════════════════════════════════════
//  Subdomain routing
// ════════════════════════════════════════════════════════════════════════════
//
//  Cada restaurante pode ter um `subdomain` (ex: "lobozo") que vira sua porta
//  de entrada brandada: `lobozo.planejamento.app` → tela de login do Lobozo
//  com o nome do restaurante visível, e após login fica fixo nesse rest.
//
//  Casos especiais que NÃO contam como subdomain:
//    - localhost / 127.0.0.1                  (dev)
//    - planejamento.app / www.planejamento.app  (root público)
//    - app.planejamento.app                   (entrada genérica master)
//    - *.vercel.app                            (preview deploys)
//
//  Pra teste local de subdomain, use *.localhost.direct (DNS público que
//  resolve qualquer subdomínio em 127.0.0.1) ou edite /etc/hosts.

import type { Restaurant } from "../types";

// Hosts que NUNCA são tratados como subdomain de restaurante
const RESERVED_SUBDOMAINS = new Set([
  "www",
  "app",
  "admin",
  "api",
  "staging",
  "preview",
  "test",
]);

/**
 * Lê o subdomain da URL atual. Retorna null se não houver subdomain ativo
 * (root domain, localhost, vercel preview, reservados).
 *
 * Exemplos:
 *   "lobozo.planejamento.app"           → "lobozo"
 *   "lobozo.localhost.direct:5173"      → "lobozo"
 *   "planejamento.app"                  → null
 *   "app.planejamento.app"              → null  (reservado)
 *   "localhost:5173"                    → null
 *   "gestaocentral.vercel.app"          → null
 */
export function detectSubdomain(hostname?: string): string | null {
  const host = (hostname ?? window.location.hostname).toLowerCase();

  // Localhost simples sem subdomain
  if (host === "localhost" || host === "127.0.0.1") return null;

  // *.vercel.app — preview deploys
  if (host.endsWith(".vercel.app")) return null;

  const parts = host.split(".");

  // Precisa ter pelo menos 3 partes pra ter subdomain (sub.domain.tld)
  // Caso especial: localhost.direct → 2 partes mas sem subdomain
  if (parts.length < 3) return null;

  const sub = parts[0];

  // Se for reservado, ignora
  if (RESERVED_SUBDOMAINS.has(sub)) return null;

  // Validação básica: lowercase, alfa-num + hífen
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]?$/.test(sub)) return null;

  return sub;
}

/**
 * True se a URL atual é o ROOT domain (`planejamento.app` ou `www.planejamento.app`).
 *
 * Quando true, mostramos uma WelcomePage em vez do app normal — o root é uma
 * porta de entrada que pede o subdomínio do restaurante.
 *
 * Falsy pra: subdomínios de restaurante (lobozo.*), reservados (admin.*,
 * app.*, etc), localhost (dev), *.vercel.app (preview).
 */
export function isWelcomePageHost(hostname?: string): boolean {
  const host = (hostname ?? window.location.hostname).toLowerCase();

  // Dev e preview deploys: nunca welcome (acesso direto ao app pra testar)
  if (host === "localhost" || host === "127.0.0.1") return false;
  if (host.endsWith(".vercel.app")) return false;

  const parts = host.split(".");
  // 2 partes (apex): "planejamento.app" → root
  if (parts.length === 2) return true;
  // 3 partes começando com www: "www.planejamento.app" → root
  if (parts.length === 3 && parts[0] === "www") return true;
  return false;
}

/**
 * Valida se uma string serve como subdomain (3-30 chars, lowercase, [a-z0-9-]).
 */
export function isValidSubdomain(s: string): boolean {
  if (s.length < 3 || s.length > 30) return false;
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(s);
}

/**
 * Acha o restaurante que bate com um subdomain (case insensitive).
 * Retorna null se nenhum bater.
 */
export function findRestaurantBySubdomain(
  restaurants: Restaurant[],
  subdomain: string,
): Restaurant | null {
  const target = subdomain.toLowerCase();
  return restaurants.find(r =>
    (r.subdomain || "").toLowerCase() === target
  ) || null;
}
