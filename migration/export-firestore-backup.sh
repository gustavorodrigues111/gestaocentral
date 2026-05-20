#!/bin/bash
# ════════════════════════════════════════════════════════════════════════════
#  Export "off-site" do Firestore pro Cloud Storage (camada DR adicional
#  às backups managed do Firebase). Roda manualmente quando quiser.
#
#  O bucket gestaocentral-firestore-backup tem lifecycle: Coldline depois
#  de 30 dias, deletado depois de 365. Custo: centavos/mês.
#
#  Pra restaurar: gcloud firestore import gs://gestaocentral-firestore-backup/<pasta>
#
#  Uso:
#    ./migration/export-firestore-backup.sh
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

PROJECT="gestaocentral-85b13"
BUCKET="gestaocentral-firestore-backup"
PASTA="auto-$(date +%Y%m%d-%H%M%S)"

echo "📦 Disparando export do Firestore..."
echo "   Projeto: $PROJECT"
echo "   Destino: gs://$BUCKET/$PASTA"
echo

OP=$(gcloud firestore export "gs://$BUCKET/$PASTA" \
  --database='(default)' \
  --project="$PROJECT" \
  --format='value(name)')

echo "✓ Export iniciado: $OP"
echo
echo "Aguardando conclusão (poll a cada 10s, pode levar 1-5 min)..."

# gcloud não tem `operations wait`, então polla `describe` até `done=true`
while true; do
  STATUS=$(gcloud firestore operations describe "$OP" --project="$PROJECT" --format='value(done)' 2>/dev/null || echo "")
  if [ "$STATUS" = "True" ]; then
    break
  fi
  sleep 10
  echo -n "."
done
echo
echo "✓ Export concluído: gs://$BUCKET/$PASTA"

# Lista o que foi exportado pra confirmar
echo
echo "📁 Conteúdo:"
gcloud storage ls "gs://$BUCKET/$PASTA/**" 2>&1 | head -20
