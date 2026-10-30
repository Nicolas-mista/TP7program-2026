# Arquitectura

RutaSur es una plataforma de logística orientada a eventos. El simulador produce
el flujo de origen; cinco servicios consumidores lo procesan en grupos
independientes; MongoDB acumula vistas derivadas y Next.js las muestra. Kafka es
el único punto de contacto para el flujo de negocio.

## Principios

1. **Kafka como log de eventos.** Los servicios no se llaman entre sí para el
   negocio. Toda reacción viaja por un topic.
2. **CQRS práctico.** Las escrituras ocurren en el log; las lecturas se resuelven
   contra proyecciones en MongoDB.
3. **Al menos una vez + idempotencia.** Es más simple y suficiente para el caso
   que intentar exactamente una vez con transacciones distribuidas.
4. **Tiempo de evento.** Las reglas usan `ocurridoEn` y un reloj simulado, no la
   hora de la máquina.
5. **Reconstruible.** Cualquier vista se puede borrar y volver a construir
   leyendo el topic desde el inicio.
6. **Aislado.** Cada servicio es un proceso separado y puede detenerse sin
   afectar a los demás.

## Vista de componentes

```
                         ┌──────────────────────────────┐
                         │ Simulador (4000)             │
                         │ envíos, promesas y reintentos│
                         └──────────────┬───────────────┘
                                        │ produce
                                        ▼
       ┌─────────────────────────────────────────────────────────┐
       │ Kafka KRaft · 1 broker · clave de partición = shipmentId│
       └───┬──────────────┬──────────────┬────────────┬──────────┘
           │              │              │            │
           ▼              ▼              ▼            ▼
      proyector    notificaciones  reprogramación  monitor-sla   analítica
       (4002)         (4003)          (4004)        (4005)        (4001)
           │              │              │            │             │
           └──────────────┴──────────────┴────────────┴─────────────┘
                                        │ escriben vistas
                                        ▼
                                 MongoDB rs0 (27017)
                                        │ change streams
                                        ▼
                                 Next.js (3000) ── SSE ──► navegador
```

### Servicios

| Servicio | Grupo | Consume | Produce | Escribe en MongoDB | HTTP de control |
| --- | --- | --- | --- | --- | --- |
| Simulador | — | — | `envios.estados`, `envios.promesas` | `sim_state`, `reprogramaciones_pendientes` | `/status`, `/scenario`, `/inject`, `/control`, `/reset` |
| Proyector | `proyector` | estados, promesas, reprogramaciones, alertas, notificaciones | — | `envios`, `alertas`, `notificaciones` | `/stats`, `/rebuild` |
| Notificaciones | `notificaciones` | estados, alertas | `notificaciones.enviadas` | — | `/rebuild` |
| Reprogramación | `reprogramacion` | estados | `envios.reprogramaciones` | `reprogramaciones_pendientes` | `/rebuild` |
| Monitor de SLA | `monitor-sla` | estados, promesas | `alertas.sla` | `sla_estado` | `/stats`, `/rebuild` |
| Analítica | `analitica` | estados, promesas | — | `metricas_diarias` | `/stats`, `/replay`, `/rebuild` |
| Analítica (replay) | `analitica-replay` | estados desde el inicio | — | `tiempos_hub` | — |
| Web | — | — | — | — (solo lee) | `/api/stream`, `/api/lag`, `/api/demo/*` |

Todos los servicios exponen `GET /health` con `{ ok, servicio, ts }`.

El **proyector** es el único que escribe `envios`, `alertas` y `notificaciones`.
Los demás servicios publican eventos; el proyector los consume y actualiza las
vistas que lee la interfaz. Eso mantiene una sola ruta de escritura para las
pantallas.

## Flujo de un evento

1. El simulador arma el evento y lo publica con `key = shipmentId` en el topic
   correspondiente.
2. Kafka lo asigna a una partición según la clave. Todos los eventos de un mismo
   envío caen en la misma partición y conservan el orden.
3. Cada grupo de consumidores recibe su propia copia del log. Los cinco grupos
   avanzan a distinto ritmo y no se bloquean entre sí.
4. El consumidor valida el JSON contra el esquema del topic con AJV.
5. Si el evento es válido, actualiza el reloj simulado con `ocurridoEn` y ejecuta
   el handler.
6. El handler escribe en MongoDB. En analítica, la escritura y el registro del
   `eventId` ocurren dentro de una transacción.
7. El consumidor registra `(grupo, eventId)` en `eventos_procesados`.
8. Recién entonces hace commit manual del offset (`offset + 1`).
9. Si el handler falla, reintenta hasta dos veces. Si sigue fallando, publica el
   mensaje original en `envios.estados.dlq` y continúa.

### Garantías

| Garantía | Implementación |
| --- | --- |
| Al menos una vez | `autoCommit: false`; commit después de la escritura en Mongo. |
| Sin efectos duplicados | Chequeo de `(consumidor, eventId)` + IDs determinísticos + índices únicos. |
| Orden por envío | Clave `shipmentId` + descarte de `secuencia` menor o igual a la aplicada. |
| Evento inválido | Validación AJV; JSON roto o esquema inválido van a la DLQ. |
| Error de procesamiento | Dos reintentos y luego DLQ con stack y mensaje original. |
| Recuperación | Offsets en Kafka; estado del monitor en `sla_estado`; reintentos en `reprogramaciones_pendientes`; reloj en `sim_state`. |
| Reconstrucción | `POST /rebuild` por consumidor y replay de analítica con grupo nuevo. |

### Idempotencia en detalle

Hay tres capas que se complementan:

1. **Registro por consumidor.** `eventos_procesados` tiene un índice único
   `(consumidor, eventId)`. Si el evento ya está, el handler no se ejecuta. La
   colección tiene TTL de 7 días.
2. **IDs determinísticos.** Alertas, notificaciones y reprogramaciones derivan su
   ID del envío y del evento de origen. Reprocesar el mismo evento produce el
   mismo ID.
3. **Índices únicos de vista.** `alertas` es única por `(shipmentId, regla)`,
   `notificaciones` por `notificacionId` y `metricas_diarias` por
   `(fecha, zonaId, hubId, franja)`. Aun si dos caminos intentan escribir lo
   mismo, la base lo impide.

En analítica la escritura es transaccional: el `$inc` de la métrica y el
`insert` del evento procesado se confirman juntos. Si dos particiones crean la
misma métrica a la vez, el error de clave duplicada aborta la transacción y el
consumidor la reintenta completa.

### Eventos fuera de orden

El proyector aplica un `updateOne` con filtro:

```js
{ _id: shipmentId, $or: [{ ultimaSecuencia: { $lt: secuencia } }, { ultimaSecuencia: { $exists: false } }] }
```

Si el evento está atrasado, el filtro no matchea y el upsert choca con el `_id`
existente; el error `11000` se interpreta como “evento viejo” y se descarta. El
monitor de SLA aplica la misma regla en memoria (`secuencia <= ultimaSecuencia`).

### DLQ

El sobre de DLQ incluye `consumidor`, `topic`, `partition`, `offset`, `motivo`,
`error` y `original` (el mensaje tal cual llegó). Los motivos son:

- `JSON_INVALIDO`: el valor no es JSON parseable.
- `ESQUEMA_INVALIDO`: el JSON no cumple el esquema del topic.
- `ERROR_DE_PROCESAMIENTO`: el handler falló tras los reintentos.

La DLQ no se consume automáticamente: es para revisión manual. El resto del
pipeline sigue avanzando porque el offset se commitea después de publicar en la
DLQ.

## Tiempo simulado

El simulador comprime una jornada: `SIM_SPEED=120` significa 120 segundos
simulados por segundo real, o 1 hora simulada cada 30 segundos.

- `SIM_RATE` es el volumen de la demo en tiempo real (20 envíos por minuto);
  `SIM_SPEED` no multiplica la tasa, solo los tiempos internos de cada envío.
- Cada evento lleva `ocurridoEn`, fijado por el origen.
- Cada proceso mantiene un `SimClock` que avanza con el reloj real multiplicado
  por el factor y se sincroniza al observar el `ocurridoEn` de los eventos.
- El monitor de SLA evalúa al recibir eventos y además cada 2 segundos reales.
- Las franjas se calculan en `America/Argentina/Buenos_Aires`:
  `MAÑANA` 08–12, `TARDE` 13–17, `NOCHE` 18–07.
- El estado del reloj se guarda en `sim_state` para sobrevivir reinicios.

Esto permite que una promesa de 6 horas venza en la demo sin esperar 6 horas
reales, y que las reglas usen el tiempo del negocio.

## Reconstrucción y replay

### Rebuild por consumidor

`POST /rebuild` en cada servicio hace, en orden:

1. Detiene el consumidor.
2. Borra las colecciones o documentos que ese servicio posee.
3. Elimina el grupo de consumidores en Kafka.
4. Vuelve a arrancar con `fromBeginning = true`.

| Servicio | Qué borra antes de reprocesar |
| --- | --- |
| Proyector | `envios`, `alertas`, `notificaciones` y sus `eventos_procesados`. |
| Notificaciones | Solo sus `eventos_procesados` (las notificaciones las escribe el proyector). |
| Reprogramación | `reprogramaciones_pendientes` y sus `eventos_procesados`. |
| Monitor de SLA | `sla_estado` y sus `eventos_procesados`. |
| Analítica | `metricas_diarias`, `tiempos_hub`, estado del replay y sus `eventos_procesados`. |

El **reset de demo** de la web coordina todo: pausa el simulador, detiene el
replay, espera a que los cinco grupos drenen el backlog, vacía los topics con
`deleteRecords` hasta el high watermark, ejecuta los cinco rebuilds, reinicia el
reloj y reanuda. No recrea contenedores. Para un borrado total, `npm run reset`
baja los volúmenes.

### Replay del cuarto indicador

La analítica crea un `ConsumerService` nuevo con grupo `analitica-replay` y
`fromBeginning: true` sobre `envios.estados`. Lee el histórico completo,
empareja `INGRESADO_HUB` con `EN_REPARTO` por envío y hace upsert en
`tiempos_hub`. No modifica offsets ni colecciones de los demás servicios. Al
iniciar captura el high watermark de cada partición y se detiene cuando lo
alcanza: así termina aunque el simulador siga publicando. Es la demostración de
retención del log y offsets independientes.

## Tiempo real en la interfaz

1. La web mantiene un `MongoClient` por proceso.
2. Al abrir la primera conexión SSE, `lib/live.ts` abre change streams sobre
   `envios`, `alertas` y `notificaciones`.
3. Cada cambio se agrupa durante 350 ms para no recalcular de más.
4. Se recalcula el snapshot correspondiente (`tower`, `shipment` o `tracking`) y
   se envía por SSE como evento `snapshot`.
5. El cliente `useLive` reemplaza el estado; el primer render viene del servidor,
   así que no hay parpadeo inicial.
6. Cada 15 segundos se envía un comentario `: ping` para mantener viva la
   conexión.
7. La vista de analítica no usa SSE: se refresca cada 10 segundos con
   `router.refresh()` porque los agregados son menos volátiles.

La web nunca consume Kafka para mostrar datos. Solo usa el admin de Kafka para
calcular lag y para el reset de demo.

## Aislamiento y recuperación

- Cada servicio corre en su propio contenedor con `restart: unless-stopped`.
- Si un consumidor se detiene, su grupo queda con lag; los demás siguen.
- Al reiniciar, retoma desde el último offset commiteado. Los eventos que ya
  habían sido procesados se descartan por `eventos_procesados`.
- El monitor reconstruye su estado desde `sla_estado`; si la colección se perdió,
  vuelve a leer promesas y estados.
- El simulador recupera reloj, contador y reintentos pendientes de MongoDB.
- La reprogramación persiste la agenda en `reprogramaciones_pendientes`; el
  simulador la ejecuta cuando llega la hora simulada.

## Decisiones de diseño

| Decisión | Elección | Motivo | Alternativa descartada |
| --- | --- | --- | --- |
| Garantía de entrega | Al menos una vez + consumidores idempotentes | Simple y suficiente; no pierde eventos. | Exactamente una vez con transacciones distribuidas. |
| Confirmación de offsets | Manual, después de escribir en Mongo | Un fallo a mitad de proceso reintenta el evento. | Commit automático: puede perder eventos. |
| Particiones de `envios.estados` | 3 | Permite mostrar reparto de carga y rebalanceo. | 1 partición: no demuestra paralelismo. |
| Formato de eventos | JSON + JSON Schema en cada consumidor | Legible y sin componentes extra. | Avro + Schema Registry. |
| Estado del monitor | Consumidor propio con estado en memoria y respaldo en Mongo | La lógica queda a la vista y es fácil de explicar. | Kafka Streams o ksqlDB. |
| Kafka local | Un broker en modo KRaft | Un contenedor, sin ZooKeeper. | Clúster de 3 brokers. |
| Tiempo real | Change streams + SSE | La interfaz no depende de Kafka. | Consumir Kafka desde Next.js. |
| Modelo de lectura | Colecciones derivadas y reconstruibles | Permite replay y rebuild sin tocar el log. | Consultar el log en cada request. |

## Puertos y variables

| Componente | Puerto | Variables principales |
| --- | --- | --- |
| Web | 3000 | `MONGO_URI`, `KAFKA_BROKERS`, `*_URL` |
| Simulador | 4000 | `SIM_SPEED`, `SIM_RATE`, `SIM_SEED`, `SIM_START_HOUR`, `SIM_TZ` |
| Analítica | 4001 | `MONGO_URI`, `KAFKA_BROKERS` |
| Proyector | 4002 | `MONGO_URI`, `KAFKA_BROKERS` |
| Notificaciones | 4003 | `MONGO_URI`, `KAFKA_BROKERS` |
| Reprogramación | 4004 | `MONGO_URI`, `KAFKA_BROKERS` |
| Monitor de SLA | 4005 | `MONGO_URI`, `KAFKA_BROKERS`, `SIM_SPEED` |
| Kafka | 9092 (host) / 29092 (interno) | `KAFKA_BROKERS` |
| MongoDB | 27017 | `MONGO_URI`, `MONGO_DB` |

Dentro de Compose, los servicios usan `kafka:29092` y `mongo:27017`. En el host,
`localhost:9092` y `localhost:27017`.

## Límites y extensiones

El alcance deja afuera autenticación, telemetría GPS, envío real de SMS/correo,
alta disponibilidad y pruebas de carga formales. Las extensiones naturales son:
Schema Registry con Avro, Kafka Connect con sink a MongoDB, monitor en Kafka
Streams/ksqlDB, clúster de tres brokers y un topic de telemetría con series
temporales.
