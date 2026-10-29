# Modelo de datos

MongoDB guarda **vistas derivadas** de los eventos. No es la fuente de verdad:
cualquier colección se puede borrar y reconstruir leyendo Kafka desde el inicio.
La fuente de verdad es el log.

La base se llama `rutasur` y corre como replica set `rs0` de un solo nodo, porque
los change streams lo requieren.

## Panorama de colecciones

| Colección | Contenido | Quién escribe | Clave / índices principales |
| --- | --- | --- | --- |
| `envios` | Un documento por envío: estado, promesa, intentos, historial y reprogramaciones. | Proyector | `_id = shipmentId`; `(estado, zonaId)`; `promesa.venceEn`; `ultimoEventoEn` |
| `alertas` | Alertas de SLA abiertas y cerradas. | Proyector | `_id = alertaId`; `(estado, prioridad)`; `shipmentId`; único `(shipmentId, regla)` |
| `notificaciones` | Registro de cada aviso simulado. | Proyector | `_id = notificacionId`; `shipmentId`; único `notificacionId` |
| `metricas_diarias` | Agregados por fecha, zona, hub y franja. | Analítica | único `(fecha, zonaId, hubId, franja)` |
| `eventos_procesados` | `eventId` ya aplicado por cada consumidor. | Todos los consumidores | único `(consumidor, eventId)`; TTL 7 días |
| `sla_estado` | Estado interno del monitor por envío. | Monitor de SLA | único `shipmentId` |
| `tiempos_hub` | Muestra de tiempo entre ingreso al hub y salida a reparto. | Analítica (replay) | `(hubId, fecha)`; único `shipmentId` |
| `reprogramaciones_pendientes` | Agenda de reintentos que ejecuta el simulador. | Reprogramación y simulador | único `(shipmentId, intentoNuevo)`; `(estado, programadaPara)` |
| `sim_state` | Reloj, contador, tasa y pausa del simulador. | Simulador | `_id = "default"` |

## `envios`

Un documento por envío. El `_id` es el `shipmentId` (string), no un `ObjectId`.
Eso hace que la clave de partición de Kafka y la clave del documento coincidan.

```json
{
  "_id": "SHP-000123",
  "shipmentId": "SHP-000123",
  "estado": "ENTREGA_FALLIDA",
  "estadoDesde": "2026-05-04T18:40:00.000Z",
  "intento": 1,
  "hubId": "HUB-CEN",
  "zonaId": "Z-01",
  "repartidorId": "R-042",
  "promesa": {
    "venceEn": "2026-05-05T02:00:00.000Z",
    "franja": "NOCHE",
    "compromiso": "NOCHE 2026-05-04"
  },
  "historial": [
    {
      "eventId": "evt-SHP-000123-1",
      "tipo": "CREADO",
      "ocurridoEn": "2026-05-04T11:00:00.000Z",
      "secuencia": 1,
      "intento": 1
    },
    {
      "eventId": "evt-SHP-000123-6",
      "tipo": "ENTREGA_FALLIDA",
      "ocurridoEn": "2026-05-04T18:40:00.000Z",
      "secuencia": 6,
      "intento": 1,
      "motivo": "AUSENTE"
    }
  ],
  "ultimaSecuencia": 6,
  "ultimoEventoEn": "2026-05-04T18:40:00.000Z",
  "reprogramaciones": [
    {
      "eventId": "rpg-evt-SHP-000123-6",
      "intento": 1,
      "decision": "REINTENTO",
      "motivo": "AUSENTE",
      "fechaProgramada": "2026-05-05T12:00:00.000Z",
      "franja": "MAÑANA",
      "detalle": "Nuevo intento el proximo dia habil en la franja MAÑANA",
      "ocurridoEn": "2026-05-04T18:40:00.000Z"
    }
  ],
  "proximoIntento": {
    "fechaProgramada": "2026-05-05T12:00:00.000Z",
    "franja": "MAÑANA",
    "intento": 2
  },
  "ultimoMotivo": "AUSENTE",
  "creadoEn": "2026-05-04T11:00:00.000Z",
  "actualizadoEn": "2026-05-04T18:40:01.000Z"
}
```

### Campos

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `_id` / `shipmentId` | string | Identificador del envío. |
| `estado` | enum | Último estado aplicado. |
| `estadoDesde` | Date | `ocurridoEn` del evento que fijó el estado actual. |
| `intento` | number | Intento actual. |
| `hubId`, `zonaId`, `repartidorId` | string \| null | Dimensiones del último evento. |
| `promesa` | objeto | `venceEn`, `franja` y `compromiso`; llega del topic de promesas. |
| `historial` | array | Eventos de estado aplicados, acotado a los últimos 30. |
| `ultimaSecuencia` | number | Secuencia más alta aplicada; base de la regla de orden. |
| `ultimoEventoEn` | Date | `ocurridoEn` del último evento aplicado. |
| `reprogramaciones` | array | Decisiones del CU2, acotadas a las últimas 10. |
| `proximoIntento` | objeto | Fecha, franja e intento del próximo reintento agendado. |
| `devolucion` | boolean | `true` si la decisión fue `DEVOLUCION`. |
| `retenido` | boolean | `true` si la decisión fue `RETENIDO`. |
| `ultimoMotivo` | enum | Último motivo de fallo. |
| `creadoEn` | Date | `ocurridoEn` del primer evento. |
| `actualizadoEn` | Date | Momento de la última escritura de la vista (reloj real). |

### Invariantes

- Un solo documento por `shipmentId`.
- `ultimaSecuencia` nunca retrocede. Un evento con secuencia menor o igual se
  descarta.
- El historial está acotado con `$slice: -30` y las reprogramaciones con
  `$slice: -10`; el caso tiene menos de 15 eventos por envío.
- `devolucion` y `retenido` son marcas de circuito cerrado; no se borran al
  llegar eventos posteriores.
- La promesa puede llegar antes o después del primer estado; el handler de
  promesa hace upsert con valores por defecto.

## `alertas`

```json
{
  "_id": "ALR-8f14e45fceea167a5a36dedd",
  "alertaId": "ALR-8f14e45fceea167a5a36dedd",
  "shipmentId": "SHP-000123",
  "regla": "SIN_SALIDA",
  "prioridad": "ALTA",
  "causa": "Sin salida a reparto y vence en 3.5 h",
  "estado": "ABIERTA",
  "venceEn": "2026-05-04T19:40:00.000Z",
  "abiertaEn": "2026-05-04T16:10:00.000Z",
  "hubId": "HUB-CEN",
  "zonaId": "Z-01",
  "actualizadoEn": "2026-05-04T16:10:01.000Z"
}
```

- `_id` es el `alertaId` determinístico.
- El índice único `(shipmentId, regla)` impide dos alertas de la misma regla para
  el mismo envío.
- Al cerrarse se setea `cerradaEn` y `estado: "CERRADA"`; no se borra.
- La torre muestra solo las `ABIERTA`, ordenadas por prioridad y luego por
  `abiertaEn` descendente.

## `notificaciones`

```json
{
  "_id": "NTF-3c59dc048e8850243be8079a",
  "notificacionId": "NTF-3c59dc048e8850243be8079a",
  "shipmentId": "SHP-000123",
  "categoria": "REPROGRAMACION",
  "canal": "SMS",
  "destinatario": "+54 9 11 ****-0123",
  "mensaje": "No pudimos entregar tu envio: el destinatario no estaba. Podes reprogramar la entrega. (SHP-000123)",
  "enviadaEn": "2026-05-04T18:40:00.000Z",
  "origenEventId": "evt-SHP-000123-6"
}
```

- `_id` es el `notificacionId` determinístico.
- `categoria`: `FALLO`, `REPROGRAMACION` o `ALERTA_SLA`.
- `canal`: `SMS`, `EMAIL` o `INTERNO`.
- `enviadaEn` usa el `ocurridoEn` del evento de origen, no la hora de escritura.
- El índice único por `notificacionId` y el registro en `eventos_procesados`
  evitan avisos duplicados.

## `metricas_diarias`

Agregados incrementales del CU4. La clave lógica es
`(fecha, zonaId, hubId, franja)` y tiene un índice único.

```json
{
  "fecha": "2026-05-04",
  "zonaId": "Z-01",
  "hubId": "HUB-CEN",
  "franja": "TARDE",
  "intentos": 42,
  "fallos": 7,
  "entregas": 35,
  "entregasPrimerIntento": 30,
  "primerosIntentosFallidos": 6,
  "entregasEnFecha": 33,
  "fallosPorMotivo": {
    "AUSENTE": 4,
    "DIRECCION_INCORRECTA": 1,
    "RECHAZADO": 1,
    "ZONA_INACCESIBLE": 1
  },
  "actualizadoEn": "2026-05-04T21:00:00.000Z"
}
```

### Cómo se incrementa

Solo los eventos `ENTREGADO` y `ENTREGA_FALLIDA` modifican los agregados.

| Evento | Incrementos |
| --- | --- |
| `ENTREGADO` | `intentos + 1`, `entregas + 1`; si `intento = 1`, `entregasPrimerIntento + 1`; si `ocurridoEn <= promesa.venceEn`, `entregasEnFecha + 1`. |
| `ENTREGA_FALLIDA` | `intentos + 1`, `fallos + 1`; si `intento = 1`, `primerosIntentosFallidos + 1`; `fallosPorMotivo.<motivo> + 1`. |

La fecha y la franja se calculan con `ocurridoEn` en la zona horaria del
simulador. La promesa se toma del mapa en memoria que la analítica precarga del
topic compactado al arrancar y actualiza con cada evento de promesa.

### Indicadores que se calculan al leer

| Indicador | Fórmula |
| --- | --- |
| Tasa de primer intento | `entregasPrimerIntento / (entregasPrimerIntento + primerosIntentosFallidos)` |
| Cumplimiento de SLA | `entregasEnFecha / entregas` |
| Distribución de motivos | `fallosPorMotivo.<motivo>` por zona |
| Tiempo hub → reparto | promedio de `tiempos_hub.minutos` por hub |

Los agregados se escriben con `$inc` atómico y, en analítica, dentro de una
transacción junto con el registro del `eventId`. Si dos particiones crean la
misma fila a la vez, el error de clave duplicada aborta la transacción y el
consumidor la reintenta completa.

## `eventos_procesados`

```json
{
  "consumidor": "proyector",
  "eventId": "evt-SHP-000123-6",
  "topic": "envios.estados",
  "partition": 1,
  "offset": "1042",
  "procesadoEn": "2026-05-04T18:40:01.000Z"
}
```

- Índice único `(consumidor, eventId)`: es la garantía de idempotencia.
- `consumidor` es el `groupId` de Kafka, no el nombre del servicio.
- TTL de 7 días sobre `procesadoEn`. Pasado ese plazo, un evento muy viejo podría
  reprocesarse; en el alcance del TP la retención de los topics y los rebuilds
  hacen que eso no ocurra.
- En analítica, la inserción ocurre en la misma transacción que el `$inc`.

## `sla_estado`

Estado interno del monitor. No lo lee la interfaz; existe para sobrevivir
reinicios sin perder qué reglas ya se dispararon.

```json
{
  "_id": "SHP-000123",
  "shipmentId": "SHP-000123",
  "estado": "INGRESADO_HUB",
  "venceEn": "2026-05-05T02:00:00.000Z",
  "intento": 1,
  "hubId": "HUB-CEN",
  "zonaId": "Z-01",
  "ultimaSecuencia": 3,
  "reglasDisparadas": ["SIN_INGRESO"],
  "alertasAbiertas": [
    { "regla": "SIN_INGRESO", "alertaId": "ALR-8f14e45fceea167a5a36dedd" }
  ],
  "actualizadoEn": "2026-05-04T16:10:01.000Z"
}
```

- `reglasDisparadas` evita repetir una alerta para el mismo envío.
- `alertasAbiertas` permite emitir el cierre cuando llega `ENTREGADO`.
- El monitor persiste en lote cada 2 segundos y al detenerse.
- Al arrancar recarga la colección completa; si está vacía, reconstruye desde los
  topics.

## `tiempos_hub`

Lo escribe el replay del cuarto indicador. Una muestra por envío.

```json
{
  "shipmentId": "SHP-000123",
  "hubId": "HUB-CEN",
  "fecha": "2026-05-04",
  "ingresadoEn": "2026-05-04T12:20:00.000Z",
  "enRepartoEn": "2026-05-04T13:05:00.000Z",
  "minutos": 45,
  "actualizadoEn": "2026-05-04T21:00:00.000Z"
}
```

- Se calcula como `EN_REPARTO.ocurridoEn - INGRESADO_HUB.ocurridoEn`.
- El índice único por `shipmentId` hace que el replay sea idempotente: si vuelve
  a leer el envío, actualiza la misma muestra.
- La vista de analítica promedia `minutos` por hub y cuenta `muestras`.

## `reprogramaciones_pendientes`

Es la agenda que comparte el servicio de reprogramación con el simulador. El
servicio decide; el simulador ejecuta el reintento cuando el reloj simulado llega
a `programadaPara`.

```json
{
  "_id": "SHP-000123-2",
  "shipmentId": "SHP-000123",
  "intentoOrigen": 1,
  "intentoNuevo": 2,
  "decision": "REINTENTO",
  "motivo": "AUSENTE",
  "programadaPara": "2026-05-05T12:00:00.000Z",
  "franja": "MAÑANA",
  "estado": "PENDIENTE",
  "ultimaSecuencia": 6,
  "hubId": "HUB-CEN",
  "zonaId": "Z-01",
  "repartidorId": "R-042",
  "actualizadoEn": "2026-05-04T18:40:01.000Z"
}
```

| Estado | Significado |
| --- | --- |
| `PENDIENTE` | Esperando la hora simulada. |
| `EMITIDA` | El simulador ya emitió `EN_REPARTO`; espera el resultado. |
| `COMPLETADA` | El resultado (`ENTREGADO` o `ENTREGA_FALLIDA`) ya se emitió. |
| `CANCELADA` | El envío se entregó o volvió a reparto antes; no corresponde reintentar. |

`resultadoEn`, `resultadoForzado` y `resultadoMotivo` se completan cuando el
simulador emite el reintento, para que el resultado sea consistente entre ticks.

## `sim_state`

Documento único (`_id = "default"`) con el estado del simulador.

```json
{
  "_id": "default",
  "simNow": "2026-05-04T15:30:00.000Z",
  "contador": 128,
  "speed": 120,
  "rate": 20,
  "seed": 42,
  "pausado": false,
  "actualizadoEn": "2026-05-04T12:45:00.000Z"
}
```

- `simNow` permite continuar donde quedó tras un reinicio.
- `contador` genera los `SHP-000001`, `SHP-000002`, etc. No se reinicia en el
  reset de demo para no reutilizar IDs que siguen en el log de Kafka.
- `rate` y `pausado` se cambian desde el panel de demo.
- `seed` documenta la semilla usada.

## Índices

| Colección | Índice | Tipo |
| --- | --- | --- |
| `envios` | `{ estado: 1, zonaId: 1 }` | Compuesto |
| `envios` | `{ "promesa.venceEn": 1 }` | Simple |
| `envios` | `{ ultimoEventoEn: -1 }` | Simple |
| `alertas` | `{ estado: 1, prioridad: 1 }` | Compuesto |
| `alertas` | `{ shipmentId: 1 }` | Simple |
| `alertas` | `{ shipmentId: 1, regla: 1 }` | Único `alerta_por_regla` |
| `notificaciones` | `{ shipmentId: 1 }` | Simple |
| `notificaciones` | `{ notificacionId: 1 }` | Único `notificacion_unica` |
| `metricas_diarias` | `{ fecha: 1, zonaId: 1, hubId: 1, franja: 1 }` | Único `metrica_unica` |
| `eventos_procesados` | `{ consumidor: 1, eventId: 1 }` | Único `procesado_unico` |
| `eventos_procesados` | `{ procesadoEn: 1 }` | TTL 7 días `procesados_ttl` |
| `sla_estado` | `{ shipmentId: 1 }` | Único |
| `tiempos_hub` | `{ hubId: 1, fecha: 1 }` | Compuesto |
| `tiempos_hub` | `{ shipmentId: 1 }` | Único `tiempo_hub_unico` |
| `reprogramaciones_pendientes` | `{ shipmentId: 1, intentoNuevo: 1 }` | Único |
| `reprogramaciones_pendientes` | `{ estado: 1, programadaPara: 1 }` | Compuesto |

Todos los servicios llaman a `crearIndices()` al arrancar. La operación es
idempotente y también crea las colecciones que falten.

## Vistas que consume la interfaz

| Pantalla | Consulta |
| --- | --- |
| Torre | Agrupa `envios` por `estado`; lee `alertas` con `estado = ABIERTA`; últimos 12 envíos por `ultimoEventoEn`. |
| Detalle | `envios` por `_id`; `alertas` y `notificaciones` por `shipmentId`. |
| Tracking | `envios` por `_id`, solo estado, promesa e historial. No expone datos internos. |
| Analítica | Agrupa `metricas_diarias` por zona/franja, zona y hub; promedia `tiempos_hub`. |
| Demo | `/stats` de proyector y analítica, `/status` del simulador y lag de los grupos. |

La torre, el detalle y el tracking se actualizan por change streams + SSE. La
analítica se refresca cada 10 segundos.

## Consistencia y reconstrucción

- **Eventual.** Las vistas van detrás del log por el tiempo de procesamiento. La
  torre muestra lo proyectado, no el último mensaje de Kafka.
- **Escritura antes del commit.** Si el proceso muere después de escribir en
  Mongo y antes de commitear, el evento se reintenta; la idempotencia evita el
  efecto duplicado.
- **Orden.** La secuencia por envío y el filtro del proyector impiden que un
  evento viejo pise uno nuevo.
- **Reconstrucción.** El proyector puede borrar `envios`, `alertas` y
  `notificaciones` y reprocesar los cinco topics. La analítica puede borrar
  `metricas_diarias` y reprocesar estados y promesas. El replay reconstruye
  `tiempos_hub` con un grupo nuevo.
- **Reset de demo.** Vacía los topics y ejecuta los rebuilds; conserva el
  contador del simulador para no reutilizar IDs. `npm run reset` borra también
  los volúmenes de Kafka y MongoDB.

## Consultas útiles

```js
// Estado de un envío
db.envios.findOne({ _id: "SHP-000123" })

// Alertas abiertas (la prioridad se ordena en la capa web)
db.alertas.find({ estado: "ABIERTA" }).sort({ abiertaEn: -1 })

// Métricas de una zona y un día
db.metricas_diarias.find({ fecha: "2026-05-04", zonaId: "Z-01" })

// Eventos ya procesados por el proyector
db.eventos_procesados.countDocuments({ consumidor: "proyector" })

// Reintentos pendientes
db.reprogramaciones_pendientes.find({ estado: "PENDIENTE" })
```
