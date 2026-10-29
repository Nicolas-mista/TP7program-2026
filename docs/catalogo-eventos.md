# Catálogo de eventos

Todos los eventos viajan como JSON UTF-8. La clave de partición es siempre el
`shipmentId`, lo que garantiza que los eventos de un mismo envío lleguen en orden
a la misma partición.

## Sobre común

| Campo | Tipo | Obligatorio | Propósito |
| --- | --- | --- | --- |
| `eventId` | string | Sí | Identificador único del evento; permite descartar duplicados. |
| `shipmentId` | string | Sí | Clave de partición y de correlación. |
| `tipo` | string | Sí | Estado o tipo de evento. |
| `ocurridoEn` | string ISO-8601 | Sí | Momento en que ocurrió en el mundo real (tiempo de evento). |
| `secuencia` | entero ≥ 1 | Sí | Número creciente por envío; detecta eventos fuera de orden. |
| `version` | entero ≥ 1 | Sí | Versión del esquema del evento. |
| `hubId` | string \| null | No | Centro de distribución. |
| `zonaId` | string \| null | No | Zona de reparto. |
| `repartidorId` | string \| null | No | Repartidor asignado. |

`ocurridoEn` es distinto del timestamp que asigna Kafka al recibir el mensaje. La
diferencia entre ambos es la demora de sincronización del origen. Las reglas de
negocio usan `ocurridoEn`.

## Topics

| Topic | Particiones | Limpieza | Retención | Productor | Consumidores |
| --- | --- | --- | --- | --- | --- |
| `envios.estados` | 3 | delete | 30 días | Simulador | proyector, notificaciones, reprogramación, monitor-sla, analítica |
| `envios.promesas` | 3 | compact | infinita | Simulador | proyector, monitor-sla, analítica |
| `envios.reprogramaciones` | 1 | delete | 30 días | Reprogramación | proyector |
| `alertas.sla` | 1 | delete | 7 días | Monitor de SLA | proyector, notificaciones |
| `notificaciones.enviadas` | 1 | delete | 7 días | Notificaciones | proyector |
| `envios.estados.dlq` | 1 | delete | 30 días | Cualquier consumidor | Revisión manual |

`envios.promesas` está compactado porque solo interesa la última promesa por
envío. Los demás topics usan `delete`.

## `envios.estados`

Es el topic principal. Cada evento representa una transición del envío.

### Estados

```
CREADO ──► INGRESADO_HUB ──► CLASIFICADO ──► EN_REPARTO ──► ENTREGADO
                                                  │
                                                  └────────► ENTREGA_FALLIDA
                                                                  │
                                      AUSENTE ──► nuevo intento ──┘
                                      RECHAZADO / tercer fallo ──► DEVOLUCION
                                      DIRECCION_INCORRECTA / ZONA_INACCESIBLE ──► RETENIDO
```

| Estado | Significado |
| --- | --- |
| `CREADO` | El comercio registró el envío. |
| `INGRESADO_HUB` | El paquete llegó al centro de distribución. |
| `CLASIFICADO` | Quedó asignado a una zona y a un repartidor. |
| `EN_REPARTO` | Salió en el vehículo. |
| `ENTREGADO` | Se entregó al destinatario. |
| `ENTREGA_FALLIDA` | El intento falló; requiere `motivo` e `intento`. |

### Ejemplo: creación

```json
{
  "eventId": "evt-SHP-000123-1",
  "shipmentId": "SHP-000123",
  "tipo": "CREADO",
  "ocurridoEn": "2026-05-04T11:00:00.000Z",
  "secuencia": 1,
  "version": 1,
  "hubId": "HUB-CEN",
  "zonaId": "Z-01",
  "repartidorId": "R-042",
  "intento": 1
}
```

### Ejemplo: entrega fallida

```json
{
  "eventId": "evt-SHP-000123-6",
  "shipmentId": "SHP-000123",
  "tipo": "ENTREGA_FALLIDA",
  "ocurridoEn": "2026-05-04T18:40:00.000Z",
  "secuencia": 6,
  "version": 1,
  "hubId": "HUB-CEN",
  "zonaId": "Z-01",
  "repartidorId": "R-042",
  "intento": 1,
  "motivo": "AUSENTE"
}
```

### Reglas

- `secuencia` es creciente por envío. El proyector descarta un evento si su
  secuencia es menor o igual a la última aplicada.
- `eventId` es único. Un evento ya registrado no se vuelve a aplicar.
- `intento` empieza en 1 y aumenta con cada reintento.
- `ENTREGA_FALLIDA` exige `motivo` e `intento` (validado con `if/then` en el
  esquema).
- Los eventos que emite el simulador al reconstruir un reintento llevan
  `reintento: true`. Es informativo; las reglas no dependen de él.
- Motivos válidos: `AUSENTE`, `DIRECCION_INCORRECTA`, `RECHAZADO`,
  `ZONA_INACCESIBLE`.

## `envios.promesas`

Fija la promesa de entrega del envío. Se publica al crearlo y se proyecta en el
documento del envío. El topic está compactado: la última versión por
`shipmentId` es la vigente.

```json
{
  "eventId": "prm-SHP-000123-1",
  "shipmentId": "SHP-000123",
  "tipo": "PROMESA",
  "ocurridoEn": "2026-05-04T11:00:00.000Z",
  "secuencia": 1,
  "version": 1,
  "hubId": "HUB-CEN",
  "zonaId": "Z-01",
  "repartidorId": "R-042",
  "promesa": {
    "venceEn": "2026-05-05T02:00:00.000Z",
    "franja": "NOCHE",
    "compromiso": "NOCHE 2026-05-04"
  }
}
```

La franja se calcula sobre `venceEn` en la zona
`America/Argentina/Buenos_Aires`:

| Franja | Horas |
| --- | --- |
| `MAÑANA` | 08:00–12:59 |
| `TARDE` | 13:00–17:59 |
| `NOCHE` | 18:00–07:59 |

## `envios.reprogramaciones`

Lo publica el servicio de reprogramación después de cada `ENTREGA_FALLIDA`. Es
la decisión de negocio, no la ejecución física del reintento.

```json
{
  "eventId": "rpg-evt-SHP-000123-6",
  "shipmentId": "SHP-000123",
  "tipo": "REPROGRAMACION",
  "ocurridoEn": "2026-05-04T18:40:00.000Z",
  "secuencia": 6,
  "version": 1,
  "hubId": "HUB-CEN",
  "zonaId": "Z-01",
  "repartidorId": "R-042",
  "intento": 1,
  "decision": "REINTENTO",
  "motivo": "AUSENTE",
  "fechaProgramada": "2026-05-05T12:00:00.000Z",
  "franja": "MAÑANA",
  "detalle": "Nuevo intento el proximo dia habil en la franja MAÑANA",
  "origenEventId": "evt-SHP-000123-6"
}
```

### Reglas de decisión

| Condición | Decisión | Fecha programada |
| --- | --- | --- |
| `intento >= 3` (cualquier motivo) | `DEVOLUCION` | — |
| `AUSENTE` | `REINTENTO` | Siguiente día hábil, franja opuesta. |
| `DIRECCION_INCORRECTA` | `RETENIDO` | — |
| `RECHAZADO` | `DEVOLUCION` | — |
| `ZONA_INACCESIBLE` | `RETENIDO` | — |

La franja opuesta es `MAÑANA ↔ TARDE`; `NOCHE` pasa a `MAÑANA`. Los horarios de
inicio son 09:00, 14:00 y 19:00 de Argentina (UTC-3). Solo se programan días
hábiles (lunes a viernes).

Cuando la decisión es `REINTENTO`, el servicio deja un documento en
`reprogramaciones_pendientes`. El simulador lo ejecuta cuando el reloj simulado
llega a `programadaPara`, emite `EN_REPARTO` con el nuevo `intento` y luego el
resultado (`ENTREGADO` o `ENTREGA_FALLIDA`). Si el envío se entrega o vuelve a
reparto antes, la reprogramación pendiente se cancela.

## `alertas.sla`

Lo publica el monitor de SLA. Una alerta se abre cuando se cumple una regla y se
cierra cuando el envío se entrega. El mismo par `(shipmentId, regla)` no vuelve a
alertar.

```json
{
  "eventId": "alr-ALR-8f14e45fceea167a5a36dedd-apertura",
  "shipmentId": "SHP-000123",
  "tipo": "ALERTA_SLA",
  "ocurridoEn": "2026-05-04T16:10:00.000Z",
  "secuencia": 4,
  "version": 1,
  "hubId": "HUB-CEN",
  "zonaId": "Z-01",
  "repartidorId": null,
  "alertaId": "ALR-8f14e45fceea167a5a36dedd",
  "regla": "SIN_SALIDA",
  "prioridad": "ALTA",
  "causa": "Sin salida a reparto y vence en 3.5 h",
  "estado": "ABIERTA",
  "venceEn": "2026-05-04T19:40:00.000Z"
}
```

### Reglas y prioridades

| Regla | Condición | Prioridad |
| --- | --- | --- |
| `SIN_INGRESO` | Estado `CREADO`, faltan menos de 10 h para el vencimiento y todavía no ingresó al hub. | `MEDIA` |
| `SIN_SALIDA` | Estado `CREADO`, `INGRESADO_HUB` o `CLASIFICADO`, faltan menos de 4 h y no está en reparto. | `ALTA` |
| `FALLO_EN_DIA_LIMITE` | `ENTREGA_FALLIDA` y la promesa vence el mismo día. | `ALTA` |
| `VENCIDO` | Pasó `venceEn` sin `ENTREGADO`. | `CRITICA` |

El monitor evalúa al recibir eventos y cada 2 segundos reales. Cuando llega
`ENTREGADO`, publica el cierre con `estado: "CERRADA"` y el mismo `alertaId`.

## `notificaciones.enviadas`

Lo publica el servicio de notificaciones. Es un registro simulado: no se envía
un SMS real.

### Notificación por fallo

```json
{
  "eventId": "evt-NTF-3c59dc048e8850243be8079a",
  "shipmentId": "SHP-000123",
  "tipo": "NOTIFICACION_ENVIADA",
  "ocurridoEn": "2026-05-04T18:40:00.000Z",
  "secuencia": 6,
  "version": 1,
  "hubId": "HUB-CEN",
  "zonaId": "Z-01",
  "repartidorId": "R-042",
  "notificacionId": "NTF-3c59dc048e8850243be8079a",
  "categoria": "REPROGRAMACION",
  "canal": "SMS",
  "destinatario": "+54 9 11 ****-0123",
  "mensaje": "No pudimos entregar tu envio: el destinatario no estaba. Podes reprogramar la entrega. (SHP-000123)",
  "origenEventId": "evt-SHP-000123-6"
}
```

La categoría es `REPROGRAMACION` para `AUSENTE` y `FALLO` para los demás motivos.

### Notificación interna por alerta

```json
{
  "eventId": "evt-NTF-9bf31c7ff062936a96d3c8bd",
  "shipmentId": "SHP-000123",
  "tipo": "NOTIFICACION_ENVIADA",
  "ocurridoEn": "2026-05-04T16:10:00.000Z",
  "secuencia": 4,
  "version": 1,
  "hubId": "HUB-CEN",
  "zonaId": "Z-01",
  "notificacionId": "NTF-9bf31c7ff062936a96d3c8bd",
  "categoria": "ALERTA_SLA",
  "canal": "INTERNO",
  "destinatario": "supervisor@rutasur",
  "mensaje": "Alerta ALTA (SIN_SALIDA) para SHP-000123: Sin salida a reparto y vence en 3.5 h",
  "origenEventId": "alr-ALR-8f14e45fceea167a5a36dedd-apertura"
}
```

Canales posibles: `SMS`, `EMAIL`, `INTERNO`. En la implementación se usan `SMS`
para fallos y `INTERNO` para alertas.

## `envios.estados.dlq`

Lo publica cualquier consumidor cuando un mensaje no se puede procesar. No se
consume automáticamente: queda para revisión manual.

```json
{
  "eventId": "dlq-proyector-envios.estados-2-1042",
  "tipo": "EVENTO_RECHAZADO",
  "ocurridoEn": "2026-05-04T18:41:02.000Z",
  "version": 1,
  "consumidor": "proyector",
  "topic": "envios.estados",
  "partition": 2,
  "offset": "1042",
  "motivo": "ESQUEMA_INVALIDO",
  "error": "/tipo must be equal to one of the allowed values",
  "original": "{\"shipmentId\":\"SHP-MALFORMADO\",\"tipo\":\"ESTADO_INEXISTENTE\"}"
}
```

| Motivo | Cuándo |
| --- | --- |
| `JSON_INVALIDO` | El valor no se puede parsear como JSON. |
| `ESQUEMA_INVALIDO` | El JSON no cumple el esquema del topic. |
| `ERROR_DE_PROCESAMIENTO` | El handler falló tras dos reintentos. |

El `original` se recorta a 20 000 caracteres y el `error` a 2 000 para no generar
mensajes gigantes.

## Validación de esquemas

Los esquemas están en
[`packages/shared/src/events/schemas/`](../packages/shared/src/events/schemas/)
y se compilan con AJV + `ajv-formats`. El mapeo es:

| Topic | Archivo |
| --- | --- |
| `envios.estados` | `estado.json` |
| `envios.promesas` | `promesa.json` |
| `envios.reprogramaciones` | `reprogramacion.json` |
| `alertas.sla` | `alerta-sla.json` |
| `notificaciones.enviadas` | `notificacion.json` |
| `envios.estados.dlq` | `dlq.json` |

Los esquemas usan `additionalProperties: true` para tolerar campos nuevos de
versiones futuras. Los campos obligatorios y los enums son estrictos. En
`estado.json`, la regla `if/then` exige `motivo` e `intento` cuando
`tipo = ENTREGA_FALLIDA`.

Un mensaje inválido no detiene el consumo: se publica en la DLQ, se commitea el
offset y se sigue con el siguiente.

## Identificadores

| Evento | Patrón | Determinismo |
| --- | --- | --- |
| Estado | `evt-<shipmentId>-<secuencia>` | Por envío y secuencia. |
| Promesa | `prm-<shipmentId>-1` | Una por envío. |
| Reprogramación | `rpg-<origenEventId>` | Deriva del fallo que la originó. |
| Alerta | `ALR-<sha1(shipmentId\|regla)[0..24]>` | Misma regla y envío → misma alerta. |
| Evento de alerta | `alr-<alertaId>-apertura` / `-cierre` | Apertura y cierre únicos. |
| Notificación | `NTF-<sha1(shipmentId\|origenEventId)[0..24]>` | Mismo origen → misma notificación. |
| Evento de notificación | `evt-<notificacionId>` | Deriva de la notificación. |
| DLQ | `dlq-<consumidor>-<topic>-<partition>-<offset>` | Único por mensaje rechazado. |

Los IDs determinísticos permiten que un reprocesamiento produzca los mismos
documentos y que los índices únicos eviten duplicados.

## Versionado

`version` identifica la versión del esquema. La versión actual es `1`. Para
evolucionar un evento se agregan campos opcionales y se incrementa `version`
cuando el cambio es incompatible. La validación por topic permite que cada
consumidor rechace lo que no entiende sin afectar a los demás.
