#!/usr/bin/env node
/**
 * Prueba de aceptacion end-to-end contra el stack ya levantado.
 *
 *   npm run up
 *   npm run acceptance
 *
 * Verifica: salud de los servicios, topics, los cuatro casos de uso, la DLQ,
 * la idempotencia ante eventos duplicados, el replay del cuarto indicador,
 * el lag de los grupos y las vistas web.
 */
import { MongoClient } from "mongodb";
import { Kafka } from "kafkajs";

const MONGO_URI =
  process.env.MONGO_URI ?? "mongodb://localhost:27017/rutasur?replicaSet=rs0&directConnection=true";
const MONGO_DB = process.env.MONGO_DB ?? "rutasur";
const BROKERS = (process.env.KAFKA_BROKERS ?? "localhost:9092").split(",").map((b) => b.trim());

const SIM = process.env.SIMULATOR_URL ?? "http://localhost:4000";
const ANALYTICS = process.env.ANALYTICS_URL ?? "http://localhost:4001";
const PROJECTOR = process.env.PROJECTOR_URL ?? "http://localhost:4002";
const NOTIFICATIONS = process.env.NOTIFICATIONS_URL ?? "http://localhost:4003";
const RESCHEDULER = process.env.RESCHEDULER_URL ?? "http://localhost:4004";
const MONITOR = process.env.MONITOR_URL ?? "http://localhost:4005";
const WEB = process.env.WEB_URL ?? "http://localhost:3000";

const TZ = "America/Argentina/Buenos_Aires";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const resultados = [];
function check(nombre, ok, detalle = "") {
  resultados.push({ nombre, ok, detalle });
  const marca = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`  ${marca}  ${nombre}${detalle ? ` \x1b[90m(${detalle})\x1b[0m` : ""}`);
}

async function http(url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const texto = await res.text();
    return { ok: res.ok, status: res.status, texto };
  } catch (error) {
    return { ok: false, status: 0, texto: error.message };
  } finally {
    clearTimeout(timer);
  }
}

function postJson(url, body) {
  return http(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

async function esperar(nombre, fn, timeoutMs = 90_000, intervalo = 1_500) {
  const inicio = Date.now();
  let ultimoError = null;
  while (Date.now() - inicio < timeoutMs) {
    try {
      const valor = await fn();
      if (valor) return valor;
    } catch (error) {
      ultimoError = error;
    }
    await sleep(intervalo);
  }
  if (ultimoError) console.log(`        ultimo error en ${nombre}: ${ultimoError.message}`);
  return null;
}

function fechaTz(fecha) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(fecha);
}

function horaTz(fecha) {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      hour: "2-digit",
      hour12: false,
    }).format(fecha),
  );
}

function franjaDe(fecha) {
  const h = horaTz(fecha);
  if (h >= 8 && h < 13) return "MAÑANA";
  if (h >= 13 && h < 18) return "TARDE";
  return "NOCHE";
}

function resumen(etiqueta) {
  console.log(`\n\x1b[1m${etiqueta}\x1b[0m`);
}

const GRUPOS_PRINCIPALES = ["proyector", "notificaciones", "reprogramacion", "monitor-sla", "analitica"];

async function calcularLagMaximo(kafka, grupos) {
  const admin = kafka.admin();
  await admin.connect();
  try {
    const lista = await admin.listTopics();
    const altos = new Map();
    for (const topic of lista.filter((t) => !t.startsWith("__"))) {
      const offsets = await admin.fetchTopicOffsets(topic);
      altos.set(topic, new Map(offsets.map((o) => [o.partition, Number(o.high)])));
    }
    let maximo = 0;
    for (const grupo of grupos) {
      let committed = [];
      try {
        committed = await admin.fetchOffsets({ groupId: grupo });
      } catch {
        committed = [];
      }
      for (const t of committed) {
        for (const p of t.partitions) {
          const high = altos.get(t.topic)?.get(p.partition) ?? 0;
          const offset = Number(p.offset);
          maximo = Math.max(
            maximo,
            Math.max(0, high - (Number.isFinite(offset) && offset >= 0 ? offset : 0)),
          );
        }
      }
    }
    return maximo;
  } finally {
    await admin.disconnect();
  }
}

async function main() {
  const mongo = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5_000 });
  await mongo.connect();
  const db = mongo.db(MONGO_DB);

  const kafka = new Kafka({
    clientId: "rutasur-acceptance",
    brokers: BROKERS,
    connectionTimeout: 5_000,
    requestTimeout: 15_000,
    retry: { retries: 5, initialRetryTime: 300 },
  });

  const col = {
    envios: db.collection("envios"),
    alertas: db.collection("alertas"),
    notificaciones: db.collection("notificaciones"),
    metricas: db.collection("metricas_diarias"),
    tiempos: db.collection("tiempos_hub"),
    procesados: db.collection("eventos_procesados"),
  };

  let producer = null;
  let rateOriginal = null;

  try {
    resumen("1. Servicios arriba");
    const servicios = [
      ["simulador", `${SIM}/health`],
      ["analitica", `${ANALYTICS}/health`],
      ["proyector", `${PROJECTOR}/health`],
      ["notificaciones", `${NOTIFICATIONS}/health`],
      ["reprogramacion", `${RESCHEDULER}/health`],
      ["monitor-sla", `${MONITOR}/health`],
      ["web", `${WEB}/`],
    ];
    for (const [nombre, url] of servicios) {
      const ok = await esperar(nombre, async () => (await http(url)).ok, 120_000, 2_000);
      check(`servicio ${nombre}`, Boolean(ok));
    }

    resumen("2. Topics de Kafka");
    const admin = kafka.admin();
    await admin.connect();
    const topics = await admin.listTopics();
    const esperados = [
      "envios.estados",
      "envios.promesas",
      "envios.reprogramaciones",
      "alertas.sla",
      "notificaciones.enviadas",
      "envios.estados.dlq",
    ];
    for (const topic of esperados) {
      check(`topic ${topic}`, topics.includes(topic));
    }
    await admin.disconnect();

    const estadoSim = await http(`${SIM}/status`);
    const simStatus = JSON.parse(estadoSim.texto);
    rateOriginal = simStatus.rate;

    resumen("3. CU1 + CU4: entrega feliz");
    const feliz = JSON.parse((await postJson(`${SIM}/scenario`, { nombre: "feliz" })).texto);
    check("escenario feliz crea un envio", Boolean(feliz.shipmentId), feliz.shipmentId);
    const felizOk = await esperar("envio feliz ENTREGADO", async () => {
      const doc = await col.envios.findOne({ _id: feliz.shipmentId });
      return doc?.estado === "ENTREGADO" ? doc : null;
    }, 120_000);
    check("el envio feliz termina ENTREGADO", Boolean(felizOk));
    if (felizOk) {
      check(
        "el historial registra CREADO -> ENTREGADO",
        felizOk.historial?.[0]?.tipo === "CREADO" &&
          felizOk.historial?.some((h) => h.tipo === "ENTREGADO"),
        `${felizOk.historial?.length ?? 0} eventos`,
      );
      check(
        "el envio tiene promesa de entrega",
        Boolean(felizOk.promesa?.venceEn),
        felizOk.promesa?.franja,
      );
      const metrica = await col.metricas.findOne({
        zonaId: felizOk.zonaId,
        hubId: felizOk.hubId,
        fecha: fechaTz(new Date(felizOk.estadoDesde)),
        franja: franjaDe(new Date(felizOk.estadoDesde)),
      });
      check("la metrica diaria suma la entrega", (metrica?.entregas ?? 0) >= 1);
    }

    resumen("4. CU2: fallo, notificacion y reprogramacion");
    const ausente = JSON.parse((await postJson(`${SIM}/scenario`, { nombre: "ausente" })).texto);
    check("escenario ausente crea un envio", Boolean(ausente.shipmentId), ausente.shipmentId);
    const ausenteDoc = await esperar("envio ausente ENTREGA_FALLIDA", async () => {
      const doc = await col.envios.findOne({ _id: ausente.shipmentId });
      return doc?.estado === "ENTREGA_FALLIDA" ? doc : null;
    }, 120_000);
    check("el envio ausente falla", Boolean(ausenteDoc));

    const notificacion = await esperar("notificacion del fallo", async () => {
      return col.notificaciones.findOne({ shipmentId: ausente.shipmentId });
    }, 30_000);
    check(
      "se registra la notificacion al destinatario",
      Boolean(notificacion),
      notificacion?.canal,
    );

    const reprogramado = await esperar("reprogramacion REINTENTO", async () => {
      const doc = await col.envios.findOne({ _id: ausente.shipmentId });
      const r = doc?.reprogramaciones?.find((x) => x.decision === "REINTENTO");
      return r ?? null;
    }, 30_000);
    check(
      "la regla AUSENTE reprograma al dia habil siguiente",
      Boolean(reprogramado),
      reprogramado?.franja,
    );
    check(
      "el proximo intento queda agendado",
      Boolean(ausenteDoc?.proximoIntento?.fechaProgramada) || Boolean(reprogramado?.fechaProgramada),
    );

    resumen("5. CU2: tercer fallo -> devolucion");
    const tercero = JSON.parse((await postJson(`${SIM}/scenario`, { nombre: "tercer-fallo" })).texto);
    const terceroDoc = await esperar("tercer fallo procesado", async () => {
      const doc = await col.envios.findOne({ _id: tercero.shipmentId });
      return doc?.devolucion ? doc : null;
    }, 120_000);
    check("el tercer fallo decide DEVOLUCION", Boolean(terceroDoc));
    check(
      "el envio queda marcado para devolucion",
      Boolean(terceroDoc?.devolucion),
      terceroDoc?.reprogramaciones?.at(-1)?.detalle,
    );

    resumen("6. CU3: alertas de SLA");
    const demorado = JSON.parse((await postJson(`${SIM}/scenario`, { nombre: "demorado" })).texto);
    const alerta = await esperar("alerta SIN_INGRESO", async () => {
      return col.alertas.findOne({ shipmentId: demorado.shipmentId, regla: "SIN_INGRESO" });
    }, 90_000);
    check("el envio demorado dispara SIN_INGRESO", Boolean(alerta), alerta?.prioridad);
    check(
      "la alerta tiene prioridad y causa",
      Boolean(alerta?.prioridad && alerta?.causa),
      alerta?.causa,
    );
    const estadoDemorado = await esperar("envio demorado en el hub", async () => {
      const doc = await col.envios.findOne({ _id: demorado.shipmentId });
      return doc?.estado === "INGRESADO_HUB" ? doc : null;
    }, 90_000);
    check("el envio demorado queda en el hub", Boolean(estadoDemorado));

    resumen("7. Lag de los grupos");
    const lagOk = await esperar("lag estable", async () => {
      const maximo = await calcularLagMaximo(kafka, GRUPOS_PRINCIPALES);
      return maximo < 5_000 ? { maximo } : null;
    }, 90_000);
    check("los consumidores alcanzan el log", Boolean(lagOk), `lag maximo ${lagOk?.maximo ?? "?"}`);

    resumen("8. Idempotencia: el mismo evento dos veces");
    await postJson(`${SIM}/control`, { pausado: true });
    const drenado = await esperar("drenaje del backlog", async () => {
      const maximo = await calcularLagMaximo(kafka, GRUPOS_PRINCIPALES);
      return maximo === 0 ? true : null;
    }, 90_000, 1_000);
    check("el backlog se drena al pausar el simulador", drenado === true);
    await sleep(1_500);

    const simNow = JSON.parse((await http(`${SIM}/status`)).texto).simNow;
    const ocurridoEn = new Date(simNow);
    const eventId = `evt-acceptance-dup-${Date.now()}`;
    // Un id distinto por corrida: la prueba debe poder repetirse sin que el
    // documento anterior (con la misma secuencia) haga descartar el evento.
    const shipmentId = `SHP-ACCEPTANCE-DUP-${Date.now()}`;
    const zonaId = "Z-01";
    const hubId = "HUB-CEN";
    const franja = franjaDe(ocurridoEn);
    const fecha = fechaTz(ocurridoEn);
    const bucket = { fecha, zonaId, hubId, franja };
    const metricaAntes = await col.metricas.findOne(bucket);

    const evento = {
      eventId,
      shipmentId,
      tipo: "ENTREGA_FALLIDA",
      ocurridoEn: ocurridoEn.toISOString(),
      secuencia: 5,
      version: 1,
      hubId,
      zonaId,
      repartidorId: "R-001",
      intento: 2,
      motivo: "AUSENTE",
    };

    producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1 });
    await producer.connect();
    await producer.send({
      topic: "envios.estados",
      messages: [
        { key: shipmentId, value: JSON.stringify(evento) },
        { key: shipmentId, value: JSON.stringify(evento) },
      ],
    });

    const dupDoc = await esperar("evento duplicado proyectado", async () => {
      const doc = await col.envios.findOne({ _id: shipmentId });
      return doc?.historial?.some((h) => h.eventId === eventId) ? doc : null;
    }, 30_000);
    check("el evento duplicado se proyecto una vez", Boolean(dupDoc));
    check(
      "el historial tiene una sola entrada para el eventId",
      dupDoc?.historial?.filter((h) => h.eventId === eventId).length === 1,
      `${dupDoc?.historial?.filter((h) => h.eventId === eventId).length ?? 0} entradas`,
    );

    const notifs = await esperar("notificacion unica", async () => {
      const total = await col.notificaciones.countDocuments({ shipmentId });
      return total > 0 ? total : null;
    }, 20_000);
    check("la notificacion no se duplica", notifs === 1, `${notifs ?? 0} notificaciones`);

    await sleep(2_000);
    const metricaDespues = await col.metricas.findOne(bucket);
    const delta = (metricaDespues?.fallos ?? 0) - (metricaAntes?.fallos ?? 0);
    check("la metrica suma el fallo una sola vez", delta === 1, `delta ${delta}`);

    const reprocesado = await col.procesados.countDocuments({
      consumidor: "proyector",
      eventId,
    });
    check("el proyector registro el eventId una sola vez", reprocesado === 1);

    resumen("9. DLQ: evento malformado");
    const dlqGroupId = `acceptance-dlq-${Date.now()}`;
    const consumer = kafka.consumer({ groupId: dlqGroupId });
    const motivos = new Set();
    const originales = [];
    await consumer.connect();
    // Solo los mensajes nuevos: la corrida no debe depender de DLQ viejas.
    await consumer.subscribe({ topic: "envios.estados.dlq", fromBeginning: false });
    await consumer.run({
      eachMessage: async ({ message }) => {
        try {
          const dlq = JSON.parse(message.value?.toString("utf8") ?? "{}");
          if (
            String(dlq.original ?? "").includes("SHP-MALFORMADO") ||
            String(dlq.original ?? "").includes("esto no es json")
          ) {
            motivos.add(dlq.motivo);
            originales.push(dlq.original);
          }
        } catch {
          // mensaje inesperado
        }
      },
    });
    await sleep(1_500);
    const inyeccion = await postJson(`${SIM}/inject`, { tipo: "malformado" });
    check("la inyeccion malformada se ejecuta", inyeccion.ok);
    await esperar("eventos en la DLQ", async () => (motivos.size >= 2 ? true : null), 30_000);
    check("el esquema invalido llega a la DLQ", motivos.has("ESQUEMA_INVALIDO"), [...motivos].join(", "));
    check("el JSON roto llega a la DLQ", motivos.has("JSON_INVALIDO"));
    check("la DLQ conserva el mensaje original", originales.length >= 2);
    await consumer.disconnect();
    const adminDlq = kafka.admin();
    await adminDlq.connect();
    await adminDlq.deleteGroups([dlqGroupId]).catch(() => undefined);
    await adminDlq.disconnect();

    await postJson(`${SIM}/control`, { pausado: false });

    resumen("10. CU4: replay del cuarto indicador");
    const replay = await postJson(`${ANALYTICS}/replay`, {});
    check("el replay arranca", replay.ok);
    const muestras = await esperar("muestras hub -> reparto", async () => {
      const total = await col.tiempos.countDocuments({});
      return total > 0 ? total : null;
    }, 120_000, 2_000);
    check("el replay reconstruye tiempos hub -> reparto", Boolean(muestras), `${muestras ?? 0} muestras`);

    const stats = await http(`${ANALYTICS}/stats`);
    const statsJson = JSON.parse(stats.texto);
    check("la analitica expone metricas", (statsJson.metricas ?? 0) > 0, `${statsJson.metricas} filas`);

    resumen("11. Vistas web");
    const home = await http(`${WEB}/`);
    check("la torre responde", home.ok);
    const analitica = await http(`${WEB}/analitica`);
    check("la vista de analitica responde", analitica.ok);
    const detalle = await http(`${WEB}/envios/${feliz.shipmentId}`);
    check(
      "el detalle del envio responde",
      detalle.ok && detalle.texto.includes(feliz.shipmentId),
    );
    const tracking = await http(`${WEB}/tracking/${feliz.shipmentId}`);
    check("el tracking publico responde", tracking.ok);

    resumen("Resumen");
    const fallidos = resultados.filter((r) => !r.ok);
    console.log(
      `  ${resultados.length - fallidos.length}/${resultados.length} verificaciones OK` +
        (fallidos.length > 0 ? `, ${fallidos.length} con problemas` : ""),
    );
    if (fallidos.length > 0) {
      for (const f of fallidos) console.log(`   - ${f.nombre}${f.detalle ? `: ${f.detalle}` : ""}`);
      process.exitCode = 1;
    }
  } finally {
    if (rateOriginal !== null) {
      await postJson(`${SIM}/control`, { rate: rateOriginal }).catch(() => undefined);
    }
    await postJson(`${SIM}/control`, { pausado: false }).catch(() => undefined);
    await producer?.disconnect().catch(() => undefined);
    await mongo.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("\nAceptacion interrumpida:", error);
  process.exit(1);
});
