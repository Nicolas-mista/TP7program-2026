import { Kafka, logLevel } from "kafkajs";
import { getKafkaBrokers } from "../config";

export function createKafka(clientId: string): Kafka {
  return new Kafka({
    clientId,
    brokers: getKafkaBrokers(),
    logLevel: logLevel.ERROR,
    connectionTimeout: 10_000,
    requestTimeout: 30_000,
    retry: { retries: 8, initialRetryTime: 300, maxRetryTime: 5_000 },
  });
}
