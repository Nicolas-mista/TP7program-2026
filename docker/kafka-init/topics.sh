#!/bin/sh
# Crea los topics del TP si no existen. Es idempotente.
set -eu

BOOTSTRAP="${KAFKA_BOOTSTRAP:-kafka:29092}"
KAFKA_BIN="${KAFKA_BIN:-/opt/kafka/bin}"

echo "Esperando a Kafka en $BOOTSTRAP..."
listo=0
for i in $(seq 1 60); do
  if "$KAFKA_BIN/kafka-topics.sh" --bootstrap-server "$BOOTSTRAP" --list >/dev/null 2>&1; then
    listo=1
    break
  fi
  sleep 2
done

if [ "$listo" -ne 1 ]; then
  echo "ERROR: Kafka no respondio" >&2
  exit 1
fi

crear() {
  topic="$1"
  particiones="$2"
  politica="$3"
  retencion="$4"
  if "$KAFKA_BIN/kafka-topics.sh" --bootstrap-server "$BOOTSTRAP" --describe --topic "$topic" >/dev/null 2>&1; then
    echo "topic $topic ya existe"
    return 0
  fi
  echo "creando $topic (particiones=$particiones, cleanup=$politica, retention=$retencion)"
  "$KAFKA_BIN/kafka-topics.sh" --bootstrap-server "$BOOTSTRAP" --create \
    --topic "$topic" \
    --partitions "$particiones" \
    --replication-factor 1 \
    --config cleanup.policy="$politica" \
    --config retention.ms="$retencion"
}

# 30 dias
crear envios.estados 3 delete 2592000000
# Promesa: ultima version por clave, retencion infinita
crear envios.promesas 3 compact -1
crear envios.reprogramaciones 1 delete 2592000000
# 7 dias
crear alertas.sla 1 delete 604800000
crear notificaciones.enviadas 1 delete 604800000
crear envios.estados.dlq 1 delete 2592000000

echo "Topics disponibles:"
"$KAFKA_BIN/kafka-topics.sh" --bootstrap-server "$BOOTSTRAP" --list
