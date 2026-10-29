import type { Kafka, Producer } from "kafkajs";

export interface MensajeSalida {
  key: string;
  value: unknown;
}

/** Productor unico por proceso. Idempotente para no duplicar en reintentos. */
export class EventProducer {
  private readonly producer: Producer;

  constructor(kafka: Kafka) {
    this.producer = kafka.producer({
      idempotent: true,
      maxInFlightRequests: 1,
      allowAutoTopicCreation: false,
    });
  }

  async connect(): Promise<void> {
    await this.producer.connect();
  }

  async enviar(topic: string, key: string, value: unknown): Promise<void> {
    await this.enviarLote(topic, [{ key, value }]);
  }

  async enviarLote(topic: string, mensajes: MensajeSalida[]): Promise<void> {
    if (mensajes.length === 0) return;
    await this.producer.send({
      topic,
      messages: mensajes.map((m) => ({
        key: m.key,
        value: typeof m.value === "string" ? m.value : JSON.stringify(m.value),
      })),
    });
  }

  async disconnect(): Promise<void> {
    await this.producer.disconnect();
  }
}
