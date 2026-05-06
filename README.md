# Gestão Central

ERP modular para restaurantes — sucessor do AppTip.

## Stack

- **Vite + React 18 + TypeScript**
- **Firebase Auth** (email + senha) + **Firestore** + **App Check** (reCAPTCHA v3)
- **Tailwind CSS**
- **React Router**
- **Vercel** pra deploy

## Estrutura

```
src/
├── core/                    # compartilhado
│   ├── auth/                # Firebase Auth + permissions
│   ├── firebase/            # config + init
│   ├── layout/              # AppShell, Sidebar, Header, HomePage
│   ├── restaurant/          # context do restaurante ativo
│   ├── types/               # tipos compartilhados
│   └── ui/                  # Button, Input, etc
├── modules/
│   ├── pessoas/
│   ├── configuracoes/
│   └── ... (gorjetas, escala, reservas, etc — em sprints futuros)
└── config/
    └── modules.ts           # registry de todos os módulos
```

Cada módulo é auto-contido. Pra adicionar um novo:
1. Cria pasta em `src/modules/{moduleId}/`
2. Adiciona em `src/config/modules.ts`
3. Mapeia rota no `App.tsx → ModuleRouter`

## 3 Áreas

- **Operação** (laranja `#d4a017`) — atividade ao vivo
- **Time** (azul `#3b82f6`) — gestão de pessoas
- **Escritório** (cinza `#64748b`) — administrativo

## Setup do Firebase (uma vez só)

1. [console.firebase.google.com](https://console.firebase.google.com) → **Adicionar projeto** → nome `gestaocentral` (ou o que preferir)
2. **Authentication** → Get started → ativa **Email/Password**
3. **Firestore Database** → Create database → modo **production** → região `southamerica-east1`
4. **Project Settings** (engrenagem) → **General** → **Your apps** → ícone web `</>` → registra app
5. Copia as 6 chaves do `firebaseConfig`
6. (Opcional) **App Check** → reCAPTCHA v3 → registra apptip.app + localhost

## Configurar `.env.local`

```bash
cp .env.example .env.local
# Edita .env.local com as 6 chaves do Firebase
```

## Criar primeiro Master (uma vez só)

Sem fluxo automatizado de primeiro setup ainda. Manualmente:

**Firebase Auth:**
- Console → Authentication → Users → **Add user** com seu email + senha

**Firestore:**
- Console → Firestore → criar collection `pessoas`
- Document ID = **uid do usuário** (copia da Authentication)
- Campos:
  - `email`: seu@email.com (string)
  - `nome`: Seu Nome (string)
  - `isMaster`: true (boolean)
  - `restaurantIds`: [] (array)
  - `permissions`: {} (map)
  - `ativa`: true (boolean)
  - `createdAt`: data ISO atual (string)

## Instalar e rodar

```bash
npm install
npm run dev
```

Abre em `http://localhost:5173`.

## Cadastrar primeiro restaurante

Sprint 0 ainda usa o console Firestore manual:
- Collection `restaurants` → documento novo (ID auto)
- Campos:
  - `nome`: Lobozó (string)
  - `shortCode`: LOB (string)
  - `modulosAtivos`: ["pessoas", "configuracoes"] (array de strings)
  - `ativo`: true
  - `createdAt`: data ISO
- Adiciona o ID gerado no array `restaurantIds` da sua pessoa

## Build

```bash
npm run build
```

## Sprints

| Sprint | Status | Módulos |
|---|---|---|
| 0 | ✅ atual | Pessoas + Configurações + Auth + Layout |
| 1 | em breve | Gorjetas + VT |
| 2 | planejado | Escala + Fechamento |
| 3 | planejado | Contagens + Checklists |
| 4 | planejado | Trilha do Empregado |
| 5 | planejado | Reservas + CRM |
| 6 | planejado | Reuniões + Ocorrências + Ideias |
| 7 | planejado | Compras + Fichas + Temperaturas |
| 8 | planejado | Recursos + Fale com DP + Freelas |
