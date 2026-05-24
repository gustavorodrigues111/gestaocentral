# 📧 Email de confirmação de reserva — plano técnico

> Guardado pra implementar depois. Não está em produção.
> Última revisão: 2026-05-24

## Objetivo

Quando cliente cria reserva pelo form público (`/reservas/:rid`):
- Recebe email automático com comprovante (data, hora, salão, pessoas, ocasião, observações)
- Email tem 2 botões:
  - **✎ Alterar** — abre form pra escolher novo slot, sistema re-valida disponibilidade
  - **✕ Cancelar** — confirma e marca status=cancelada (cliente preserva no CRM)

## Stack proposta

| Camada | Tecnologia | Custo |
|---|---|---|
| Provider de email | **Resend** | $0 (free tier: 3k/mês, 100/dia) |
| Backend | **Vercel Function** (`/api/...`) | $0 (incluso no plan) |
| Firestore | Admin SDK pra ler/escrever | insignificante |
| Token assinado | HMAC-SHA256 com secret em env var | $0 |

Alternativas: Sendgrid, AWS SES — mais barato em volume, mais setup. Resend é o sweet spot pra MVP.

## Arquitetura

### Vercel Function

`POST /api/reservas/enviar-confirmacao`

Recebe `{ reservaId }`. Lê reserva + sitesConfig do restaurante (cor/logo/nome). Gera token HMAC, renderiza HTML do email com a marca do restaurante, envia via Resend. Atualiza `reserva.emailEnviadoEm`.

### Schema novo na Reserva

```ts
type Reserva = {
  // ... campos existentes ...
  emailEnviadoEm?: string;      // ISO timestamp
  tokenAcoes?: string;          // hash HMAC pra autenticar links
};
```

Token gerado uma vez na criação, salvo no doc. Vercel function valida comparando o hash.

### Disparo

Frontend (ReservasPublicaPage) chama a function imediatamente após criar a reserva:

```ts
await setDoc(doc(db, "reservas", id), ...);
await fetch("/api/reservas/enviar-confirmacao", {
  method: "POST",
  body: JSON.stringify({ reservaId: id }),
});
```

Sem await crítico — se falhar, cliente continua vendo "Reserva enviada!". Erro vai pro log.

### Email template (HTML inline)

```
┌────────────────────────────────────┐
│       [Logo do restaurante]        │
│                                    │
│     Sua reserva está pendente      │
│                                    │
│   Olá Gustavo,                     │
│                                    │
│   📅 Sex, 30/05/2026               │
│   🕒 19:30                         │
│   🏛️ Salão Principal               │
│   👥 4 pessoas                     │
│   📝 Aniversário                   │
│                                    │
│   Confirmamos pelo WhatsApp        │
│   em breve.                        │
│                                    │
│   ┌──────────┐  ┌──────────┐      │
│   │ Alterar  │  │ Cancelar │      │
│   └──────────┘  └──────────┘      │
│                                    │
│   [endereço] · [telefone]          │
│   Powered by Planejamento.app      │
└────────────────────────────────────┘
```

Marca/logo/cor vêm do `sitesConfig` — cada restaurante sai com sua identidade.

### Páginas públicas novas

**`/r/reserva/<id>?t=<token>&acao=cancelar|alterar`**

- Valida token (HMAC compare)
- Token inválido → "Link expirado ou inválido"
- `acao=cancelar` → modal de confirmação → atualiza status
- `acao=alterar` → reabre slot picker com a data/hora/salão atuais pré-selecionados, valida disponibilidade ao confirmar
- Sem acao → mostra comprovante visual (mesmo do email)

### Segurança

- Token = `HMAC-SHA256(reservaId + clienteEmail, SECRET)` — secret em env var Vercel
- Validação sempre compara hashes em tempo constante (`crypto.timingSafeEqual`)
- Sem expiração — link válido enquanto a reserva existir
- Rate limit na function (max 10 emails/IP/hora) pra evitar spam

## Variáveis de ambiente (Vercel)

```
RESEND_API_KEY=re_xxxxxxxxxxx
RESERVA_TOKEN_SECRET=<random 32-char string>
FIREBASE_ADMIN_PROJECT_ID=gestaocentral-85b13
FIREBASE_ADMIN_CLIENT_EMAIL=xxx@xxx.iam.gserviceaccount.com
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nxxx\n-----END..."
```

Service account JSON baixa do Firebase Console → Service accounts → "Generate new private key".

## Pré-requisitos (1x setup)

1. Criar conta Resend (https://resend.com) — gratuito
2. Verificar domínio `planejamento.app` no Resend — adicionar 3 registros DNS (DKIM + SPF) no Vercel
3. Baixar service account JSON do Firebase
4. Adicionar env vars no Vercel dashboard

## Roadmap de implementação

Estimativa total: **1.5–2 dias** de trabalho.

| Fase | Tarefa | Tempo |
|---|---|---|
| 1 | Schema: adicionar `tokenAcoes`, `emailEnviadoEm` em Reserva | 30min |
| 2 | Vercel function `/api/reservas/enviar-confirmacao` (envio + token) | 3h |
| 3 | Template HTML do email com cores do tema | 2h |
| 4 | Frontend chama a function após criar reserva | 30min |
| 5 | Página `/r/reserva/<id>` — comprovante + ações | 4h |
| 6 | Fluxo cancelar (modal confirma + update status) | 1h |
| 7 | Fluxo alterar (slot picker reusado + revalida) | 3h |
| 8 | Testes ponta a ponta + ajustes | 2h |

## Extensões futuras (Fase 2)

- Email automático quando admin **confirma** ("✓ Reserva confirmada")
- Email automático quando admin **cancela** ("Reserva cancelada pela casa")
- Lembrete D-1 (cron: enviar reminder na véspera)
- Página de cancelamento mostra calendário pra escolher data alternativa direto
- Configuração por restaurante: habilitar/desabilitar cada tipo de email

## Custos esperados em produção

- Resend free tier: 3.000 emails/mês cobre até ~100 reservas/dia/restaurante
- Acima disso: $20/mês Resend Pro (50k emails)
- Vercel functions: free tier cobre milhares de invocações/dia

Pra Lobozó (estimativa ~30 reservas/dia × 30 dias = 900/mês) — gratuito por muito tempo.
