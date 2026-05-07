# Firestore Security Rules

Este projeto usa regras sérias do Firestore (`firestore.rules`) com:

- **Multi-tenancy** por `restaurantId` (cada doc tem o `rid`; pessoa só acessa
  dados dos seus restaurantes em `pessoa.restaurantIds[]`)
- **Permissões por módulo** (`pessoa.permissions[rid][moduleId].ver/configurar`)
- **Permissões especiais** (`pessoa.specialPermissions[rid].pessoasExcluir`,
  `gorjetasConfigurarRegra`, `escalaReabrir`)
- **Master bypass** (`pessoa.isMaster == true` faz qualquer coisa)

## Como funciona

A cada operação Firestore, as regras chamam `get()` no doc da própria pessoa
logada e verificam se ela tem o gate necessário pro recurso em questão. As
chamadas `get()` são cacheadas durante a avaliação de uma única regra, então
não há custo extra por checagem.

## Deploy

Precisa do [Firebase CLI](https://firebase.google.com/docs/cli):

```bash
# 1. Instala (uma vez)
npm install -g firebase-tools

# 2. Login (uma vez)
firebase login

# 3. Conecta ao projeto
firebase use --add
# ↑ escolhe o projeto Firebase do gestaocentral

# 4. Deploy só das regras
firebase deploy --only firestore:rules
```

> ⚠️ **As regras entram em vigor IMEDIATAMENTE em produção.** Se algo quebrar,
> volte a regra antiga via `firebase firestore:rules` ou ajuste e re-deploy.

## Plano de teste antes do deploy real

**Recomendação forte:** rodar primeiro num projeto Firebase de **staging** (ou
emulador local) antes de aplicar em produção, porque a UI faz queries que
podem falhar se a regra estiver mais restritiva que o esperado.

### Opção 1: Firebase Emulator (local)

```bash
firebase init emulators        # escolhe Firestore
firebase emulators:start --only firestore
```

Depois rode o app local apontando pro emulador (ajustar `src/core/firebase/config.ts`).

### Opção 2: Projeto staging separado

Cria um segundo projeto Firebase, copia os dados (ou popula com dados de teste),
deploya as regras lá primeiro, e roda o app contra ele.

### Smoke tests pra rodar manualmente após deploy

| Cenário | Esperado |
|---|---|
| Login com pessoa **master** | Lê/escreve em todos os restaurantes |
| Pessoa com `permissions[rid].pessoas.configurar` | Cria empregado no rid, mas não em outro |
| Pessoa com **só** `permissions[rid].pessoas.ver` | Lista empregados, mas botão "+ novo" falha (permission denied no Firestore) |
| Pessoa SEM permissão de `gorjetas` | Lê gorjetas (read amplo dentro do rest.), mas escrita falha |
| Pessoa com `gorjetas.configurar` mas **sem** `gorjetasConfigurarRegra` | Lança gorjeta OK, mas tentar criar `splitVersion` falha |
| Pessoa do restaurant A tentando ler doc do restaurant B | Permission denied |
| Pessoa inativa (`ativa: false`) | Tudo falha |
| Empregado com `pessoaId` mas sem `permissions` | Pode ler comunicados do restaurante (Portal do Empregado) |
| Reabrir mês de escala fechado **sem** `escalaReabrir` | Falha |

## Trade-offs documentados

### "Read amplo dentro do restaurante" (escolha consciente)

**Decisão:** permissões de **módulo** controlam só **escrita**. Leitura é
liberada pra qualquer pessoa que tenha o `rid` em `pessoa.restaurantIds[]`.

**Por quê:**

1. **Portal do Empregado** — empregado registrado precisa ler escalas/gorjetas/
   comunicados sem ter permissão de gestor; restringir read por módulo
   quebraria o portal.
2. **Telas administrativas** — exibem dados cruzados (Gorjetas mostra
   empregados; Escala mostra cargos; Reunioes lista participantes). Read
   fino quebraria UIs.
3. **Multi-tenancy primário** — o gate principal já é `temAcesso(rid)`: se
   o restaurante não está em `pessoa.restaurantIds[]`, nada é lido.
4. **Negócio interno pequeno** — usuários são todos da mesma "casa".

**Implicação:** quem tem acesso ao restaurante vê tudo (gorjetas de outros
empregados, etc). Pra granularidade fina por módulo no read, seria preciso
introduzir uma permissão tipo `apenasOPortal` ou refatorar todas as queries
do front. Trade-off aceito conscientemente.

### `historicos` e `mudancasAgendadas` ficam mais permissivos

Esses são mecanismos transversais. O cliente escreve em vários pontos. Liberar
read pra qualquer ativa e create pra autenticada simplifica sem expor dados
sensíveis (são metadados de mudança).

### `pessoas.delete`

**Só master** pelas rules. A permissão `pessoasExcluir` (specialPermission) é
checada na UI (`canExcluirPessoa`) — mas no servidor mantemos master-only.

Motivo: a sintaxe `.values().hasAny([{...}])` do Firestore Rules só bate com
mapas **exatamente iguais**, então não dá pra checar de forma genérica
"alguém tem `pessoasExcluir == true` em algum restaurante" sem virar uma
expressão frágil. Pra liberar não-master, mover a operação pra Cloud Function
com verificação programática.

### `splitVersions` (regra de gorjeta)

Escrita exige `gorjetasConfigurarRegra`. Mexer na regra recalcula divisões
históricas via versionamento → impacto financeiro. Permissão própria, separada
de `gorjetas.configurar`.

### `escalas` reabrir mês fechado

Update normal exige `escala.configurar`. Mas se o doc atual tem `fechadoEm` setado,
exige `escalaReabrir` — proteção contra reabrir mês já fechado por engano.

## Coleções não cobertas

Qualquer collection nova adicionada no código mas não declarada em
`firestore.rules` será **negada por padrão** (default deny). Lembre de
atualizar este arquivo quando adicionar módulos novos.

Coleções cobertas até a Sprint 21C:

```
auditLog                 cargos                checklistRuns
checklistTemplates       clientes              comunicados
comunicadosLeituras      contagens             empregados
escalas                  eventosTrilha         fornecedores
gorjetas                 historicos            ideias
insumos                  mesas                 mudancasAgendadas
ocorrencias              pedidos               permissionTemplates
pessoas                  reservas              restaurants
reunioes                 splitVersions         vtFolhas
```

## Rollback de emergência

Se as regras quebrarem produção e você precisar liberar tudo enquanto
investiga, use temporariamente:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

E re-deploy com `firebase deploy --only firestore:rules`. **NÃO deixe assim
em produção** — é o que tinha antes deste polish.
