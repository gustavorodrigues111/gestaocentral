// Versão do build, injetada pelo Vite (define em vite.config.ts).
//
// `APP_COMMIT` é o SHA curto (7 chars) do commit que gerou esse bundle —
// vem do Vercel (VERCEL_GIT_COMMIT_SHA) em prod, ou do git local em dev.
// `APP_BUILD_DATE` é o dia em que o `vite build` rodou (YYYY-MM-DD).
//
// Pra suporte: peça pro usuário ler o chip de versão no canto do header e
// confira se confere com a versão mais recente do main.

declare const __APP_COMMIT__: string;
declare const __APP_BUILD_DATE__: string;

export const APP_COMMIT: string =
  typeof __APP_COMMIT__ !== "undefined" ? __APP_COMMIT__ : "dev";
export const APP_BUILD_DATE: string =
  typeof __APP_BUILD_DATE__ !== "undefined" ? __APP_BUILD_DATE__ : "";

// Formato curto pra exibir no header: "v.abc1234 · 2026-06-01"
export const APP_VERSION_LABEL: string = APP_BUILD_DATE
  ? `v.${APP_COMMIT} · ${APP_BUILD_DATE}`
  : `v.${APP_COMMIT}`;
