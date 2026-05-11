# Scripts de migração AppTip → Planejamento

Migra Pessoas (e futuramente outras entidades) do projeto Firebase
`gorjeta-app` (AppTip legado) pro `gestaocentral-85b13` (planejamento.app).

## Pré-requisitos

- Node.js 18+
- Google Cloud SDK autenticado com Application Default Credentials:
  ```bash
  gcloud auth application-default login
  ```
- Acesso (papel `Editor` ou `Owner`) nos dois projetos GCP.

## Setup (1 vez)

Da pasta `migration/`:

```bash
npm install
```

Baixa `firebase-admin` (~50 MB).

## Passo 1 — Listar restaurantes e contagens

```bash
npm run listar
```

Saída exemplo:
```
🏠 RESTAURANTES NO APPTIP
  1775789224652  →  Lobozo
                    pessoas: 18, employees: 22

🎯 RESTAURANTES NO PLANEJAMENTO
  T671zhYNYCeYDWt9vxTQ  →  Lobozo
                          unidades: Cidade Velha, Porto Futuro, Cozinha de Produção

📋 Exemplo de pessoa no AppTip:
  nome                  Maria Silva
  cpf                   12345678901
  email                 maria@...
  ...
```

Anote os 2 IDs (origem AppTip + destino Planejamento) do restaurante que
quer migrar.

## Passo 2 — Migrar pessoas (DRY-RUN primeiro)

```bash
node migrar-pessoas.mjs --from=<rid-apptip> --to=<rid-planejamento> --dry-run
```

Mostra o que seria feito **sem escrever nada**. Confira o output:
- `+ Nova` = pessoa nova vai ser criada
- `↻ Adiciona vínculo` = pessoa já existe (mesmo CPF), só adiciona o restaurante novo em `restaurantIds`
- `= Já vinculada` = pulado (pessoa já tinha esse rest)
- `⚠ sem email` = pessoa não tem email → não conseguirá fazer signup (você adiciona depois)

## Passo 3 — Rodar de verdade

Se o dry-run ficou bom:

```bash
node migrar-pessoas.mjs --from=<rid-apptip> --to=<rid-planejamento>
```

(sem `--dry-run`)

## Verificação

Abre `admin.planejamento.app` → Pessoas. Confere que as pessoas aparecem.

## Próximo passo (manual)

Pra cada Pessoa, ir no restaurante de destino → **Pessoas → Empregados →
+ Empregado** → busca a Pessoa pelo nome/CPF → preenche cargo, admissão,
unidade padrão, VT. O sistema vincula automaticamente.

## Notas

- **Senhas não migram** — pessoa precisa fazer signup com o email.
- **Pessoas sem email** importam mas não conseguem logar até você adicionar email.
- **CPF é a chave de deduplicação** — se Maria está em A e B no AppTip,
  importar os 2 restaurantes resulta em 1 Pessoa só com `restaurantIds = [A, B]`.
- **Empregados/cargos/horários NÃO são migrados** por este script —
  cadastro manual no Planejamento depois.
