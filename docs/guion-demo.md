# Guion de la demo

Duración objetivo: **15 minutos**. Recorre los cuatro casos de uso y dos fallos
provocados. Cada paso muestra un resultado de negocio y un concepto técnico.

## Preparación (5 minutos antes)

1. Verificá que Docker Desktop esté corriendo.
2. Levantá el stack:

   ```bash
   npm run up
   ```

3. Esperá a que los servicios estén sanos:

   ```bash
   docker compose ps
   ```

   Todos los contenedores de servicios deben decir `healthy` o `running`.

4. Abrí estas pestañas:
   - Torre: <http://localhost:3000>
   - Demo: <http://localhost:3000/demo>
   - Analítica: <http://localhost:3000/analitica>
   - Tracking de ejemplo: `http://localhost:3000/tracking/SHP-000001`

5. Para arrancar limpio, en **Demo** usá **Reset de demo** y esperá unos 20
   segundos a que el simulador genere los primeros envíos. El reset vacía los
   topics, reconstruye las vistas y reinicia el reloj simulado.

6. Opcional: corré `npm run acceptance` antes de la demo para validar el stack.
   Tarda unos minutos y deja datos; después hacé un reset.

> El panel de demo muestra el `shipmentId` creado en **Actividad**. Copialo o
> buscalo en la barra superior para abrir el detalle.

## Paso 0 — Arranque (1 min)

**Qué mostrar**

- La torre con los contadores moviéndose y el indicador “en vivo”.
- La lista de últimos movimientos.
- `docker compose ps` con los siete servicios arriba.

**Qué decir**

- El simulador reemplaza a los sistemas de origen y publica eventos en Kafka.
- Cinco grupos de consumidores procesan en paralelo; ninguno llama a otro.
- MongoDB guarda las vistas; Next.js solo lee de ahí y se actualiza por change
  streams + SSE.
- Todo se levanta con `npm run up`.

**Concepto:** productor, consumidor, proyección, CQRS, arranque con un comando.

## Paso 1 — Envío feliz (2 min)

**Acción**

1. En **Demo**, ejecutá **Entrega feliz**.
2. En **Actividad** aparece el detalle y el `SHP-…` creado.
3. Abrí el envío desde la torre o buscalo en la barra superior.

**Qué mostrar**

- La línea de tiempo: `CREADO → INGRESADO_HUB → CLASIFICADO → EN_REPARTO →
  ENTREGADO`.
- La promesa de entrega con su franja.
- El tracking público en otra pestaña, sin datos internos.
- El envío se entrega en menos de un minuto real (el reloj va 120×).

**Qué decir**

- Cada evento lleva `shipmentId` como clave; todos los eventos del envío caen en
  la misma partición y conservan el orden.
- El proyector aplica el último estado y guarda el historial embebido.
- La pantalla pública lee la misma proyección, pero muestra un subconjunto.

**Concepto:** clave de partición, orden por partición, proyección y tracking.

## Paso 2 — Destinatario ausente (2,5 min)

**Acción**

1. En **Demo**, ejecutá **Destinatario ausente**.
2. Abrí el `SHP-…` desde **Actividad**.
3. Esperá unos segundos y refrescá si hace falta (la vista es en vivo).

**Qué mostrar**

- Estado `ENTREGA_FALLIDA` con motivo `AUSENTE`.
- **Reprogramaciones:** decisión `REINTENTO`, fecha del próximo día hábil y
  franja opuesta a la del fallo.
- **Próximo intento** con fecha, franja e intento 2.
- **Notificaciones:** un SMS simulado al destinatario.
- En **Analítica**, el fallo suma en la zona y franja correspondientes.

**Qué decir**

- Un solo evento `ENTREGA_FALLIDA` dispara tres reacciones independientes:
  - **Notificaciones** registra el aviso.
  - **Reprogramación** decide el próximo intento y deja la agenda.
  - **Analítica** incrementa los agregados.
- Ninguna espera a otra; el proyector consume después los eventos resultantes y
  actualiza la vista.
- La regla `AUSENTE` reprograma al día hábil siguiente en la franja opuesta. Los
  demás motivos retienen o devuelven.
- No esperamos el reintento: con 120×, un salto al día siguiente son varios
  minutos reales. Lo importante es ver la decisión y la agenda.

**Concepto:** grupos de consumidores independientes, coreografía, reglas de
negocio, DLQ.

## Paso 3 — Demora en el hub (2,5 min)

**Acción**

1. En **Demo**, ejecutá **Demora en el hub**.
2. Abrí el envío: queda detenido en `INGRESADO_HUB`.
3. Volvé a la torre y mirá la cola de **Alertas de SLA abiertas**.

**Qué mostrar**

- Primero aparece `SIN_INGRESO` (`MEDIA`): la promesa es de 6 h y todavía no
  ingresó al hub.
- Alrededor de un minuto real después aparece `SIN_SALIDA` (`ALTA`): faltan
  menos de 4 h y no salió a reparto.
- Si esperás hasta el vencimiento, aparece `VENCIDO` (`CRITICA`).
- La cola ordena críticas, altas y medias.

**Qué decir**

- La alerta no la dispara un evento, sino la **ausencia** de un evento esperado.
- El monitor cruza el último estado con la promesa y evalúa al recibir eventos y
  cada 2 segundos.
- Usa el reloj simulado que viaja en los eventos, no el reloj de la máquina.
- Una misma regla no vuelve a alertar sobre el mismo envío. Cuando llega
  `ENTREGADO`, el monitor publica el cierre.
- El estado se respalda en `sla_estado`; un reinicio no pierde ni repite alertas.

**Concepto:** procesamiento con estado, cruce de dos streams, tiempo de evento
frente a tiempo de proceso, tolerancia a reinicios.

## Paso 4 — Caída de un servicio (2 min)

**Acción**

1. Detené notificaciones:

   ```bash
   docker compose stop notifications
   ```

2. En **Demo**, ejecutá **Destinatario ausente** (o **Evento duplicado**).
3. Abrí el envío: el estado y la reprogramación aparecen, pero **no** la
   notificación.
4. Mirá el lag:
   - En **Demo**, panel **Lag por grupo**.
   - O por HTTP:

     ```bash
     curl http://localhost:3000/api/lag
     ```

   El grupo `notificaciones` empieza a acumular mensajes.

5. Reiniciá el servicio:

   ```bash
   docker compose start notifications
   ```

6. Esperá unos segundos: la notificación aparece una sola vez y el lag vuelve a
   cero.

**Qué decir**

- Cada servicio es un proceso separado; la caída de notificaciones no detiene la
  torre, el tracking, las alertas ni la analítica.
- Kafka conserva los mensajes y el offset del grupo. Al reiniciar, retoma desde
  donde quedó.
- La garantía es **al menos una vez**: si el proceso muere después de escribir en
  Mongo y antes de commitear, el evento se reintenta. La idempotencia por
  `(consumidor, eventId)` evita el aviso duplicado.
- El lag es la diferencia entre el high watermark y el offset commiteado.

**Concepto:** aislamiento, offsets, at-least-once, idempotencia.

## Paso 5 — Evento inválido (1,5 min)

**Acción**

1. En **Demo**, ejecutá **Evento malformado**. Se publican un esquema inválido y
   un JSON roto.
2. Leé la DLQ:

   ```bash
   docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
     --bootstrap-server kafka:29092 \
     --topic envios.estados.dlq \
     --from-beginning \
     --max-messages 6
   ```

**Qué mostrar**

- Cada mensaje de la DLQ tiene `consumidor`, `topic`, `partition`, `offset`,
  `motivo`, `error` y `original`.
- Van a aparecer copias de varios consumidores: cada grupo valida por su cuenta.
- `JSON_INVALIDO` para el texto roto y `ESQUEMA_INVALIDO` para el evento que no
  cumple el esquema.
- El resto del flujo sigue funcionando: no hay reinicios ni bloqueos.

**Qué decir**

- La validación es por topic con JSON Schema y AJV.
- Un mensaje inválido no se reintenta indefinidamente: se publica en la DLQ, se
  commitea el offset y se sigue.
- La DLQ es para revisión manual; no se consume automáticamente.

**Concepto:** manejo de errores, DLQ, validación de esquemas, commit.

## Paso 6 — Analítica (2 min)

**Acción**

1. Abrí <http://localhost:3000/analitica>.
2. Mirá los KPI: intentos cerrados, entregas, fallos, tasa de primer intento y
   cumplimiento de SLA.
3. Recorré las tablas:
   - Tasa de primer intento por zona y franja.
   - Motivos de fallo por zona.
   - Cumplimiento de SLA por hub.
4. Probá los filtros por zona, hub y fecha; usá **Hoy** y **7 días**.

**Qué mostrar**

- La zona y la franja con más fallos (las zonas `Z-05` y `Z-06` tienen las tasas
  de fallo más altas del simulador).
- La distribución de motivos: el simulador genera 60% `AUSENTE`, 20%
  `DIRECCION_INCORRECTA`, 15% `RECHAZADO` y 5% `ZONA_INACCESIBLE`.
- La página se refresca cada 10 segundos.

**Qué decir**

- Los indicadores se calculan con agregados incrementales en
  `metricas_diarias`, no recalculando sobre todos los envíos.
- Cada evento `ENTREGADO` o `ENTREGA_FALLIDA` hace `$inc` sobre la fila
  `(fecha, zona, hub, franja)`.
- Las tasas se calculan al leer: primer intento y cumplimiento de SLA.
- La pregunta de negocio es “¿dónde y cuándo fallamos más?” y “¿qué hub llega
  tarde?”.

**Concepto:** agregaciones incrementales, dimensiones, modelo de lectura.

## Paso 7 — Reprocesamiento (2 min)

**Acción**

1. Antes de empezar, la tabla **Tiempo hub a reparto** puede estar vacía.
2. En **Demo**, ejecutá **Reprocesar histórico** (o el botón de la vista de
   analítica).
3. Mirá cómo el estado pasa de “en curso” a “inactivo” y cómo se completan las
   muestras y la tabla.

**Qué mostrar**

- El cuarto indicador: tiempo medio entre `INGRESADO_HUB` y `EN_REPARTO` por hub.
- El replay lee `envios.estados` desde el inicio con un grupo nuevo
  (`analitica-replay`).
- No reinicia ni afecta a los otros servicios.
- Cada clic vuelve a leer el histórico completo y reconstruye `tiempos_hub`.

**Qué decir**

- Kafka retiene los eventos; el grupo nuevo tiene sus propios offsets.
- El replay es idempotente: hace upsert por `shipmentId` en `tiempos_hub`.
- Captura el high watermark al iniciar y termina al alcanzarlo, aunque el
  simulador siga generando envíos.
- Esto demuestra retención del log, reconstrucción de vistas y offsets
  independientes.
- El botón se habilita de nuevo cuando el replay termina.

**Concepto:** replay, retención, offsets por grupo, reconstrucción.

## Paso 8 — Cierre (1 min)

**Qué decir**

- CU1: ciclo de vida y tracking en vivo.
- CU2: tres reacciones independientes a un fallo.
- CU3: alertas tempranas con estado y tiempo de evento.
- CU4: analítica incremental y replay del histórico.
- Garantías: al menos una vez, idempotencia, orden, DLQ, reconstrucción,
  aislamiento.
- Todo se levanta con un comando y se valida con `npm run acceptance`.

**Para la próxima demo**

- **Reset de demo** en el panel, o `npm run reset` para borrar también los
  volúmenes.

## Plan B

| Situación | Qué hacer |
| --- | --- |
| Docker no está disponible | Mostrar `npm run typecheck`, `npm test`, `npm run build:web` y los documentos de arquitectura/eventos. |
| La torre está vacía | Esperar 20 s; verificar `curl http://localhost:4000/status` y `docker compose logs simulator`. |
| Un escenario no aparece | Revisar `docker compose logs projector simulator`; el lag puede estar alto. |
| La alerta no aparece | Verificar que el envío tenga promesa y que el reloj simulado haya avanzado. |
| El replay no completa | Verificar que haya eventos en `envios.estados`; generar una ráfaga y reintentar. |
| El reset falla | `npm run reset` (baja volúmenes y vuelve a construir). |
| Puertos ocupados | Liberar `3000`, `4000`–`4005`, `9092` o `27017`, o cambiar el mapeo en `docker-compose.yml`. |

## Preguntas frecuentes de la defensa

**¿Por qué al menos una vez y no exactamente una vez?**
Porque exactamente una vez requiere transacciones distribuidas entre Kafka y
MongoDB. Con consumidores idempotentes se obtiene el mismo efecto práctico con
menos complejidad. El commit manual después de escribir evita perder eventos.

**¿Cómo se evita duplicar un aviso o una métrica?**
Tres capas: registro `(consumidor, eventId)` en `eventos_procesados`, IDs
determinísticos e índices únicos en las colecciones de vista. En analítica, el
`$inc` y el registro del evento van en la misma transacción.

**¿Qué pasa si un evento llega fuera de orden?**
El proyector compara `secuencia` con `ultimaSecuencia` y descarta el atrasado. El
monitor aplica la misma regla. La clave `shipmentId` garantiza que los eventos de
un envío estén en la misma partición, pero la regla protege ante reinyecciones o
reprocesamientos.

**¿Por qué 3 particiones?**
Alcanzan para mostrar reparto de carga y rebalanceo con un solo broker. La clave
`shipmentId` mantiene el orden por envío. Con una sola partición no se podría
demostrar el paralelismo.

**¿Cómo sobrevive el monitor a un reinicio?**
Persiste su estado en `sla_estado`: último estado, vencimiento, reglas ya
disparadas y alertas abiertas. Al arrancar recarga la colección; si falta, vuelve
a leer promesas y estados.

**¿Por qué SSE y no WebSocket?**
El flujo es de un solo sentido (servidor → navegador). SSE usa HTTP, no necesita
infraestructura adicional y se integra bien con Next.js. Los change streams de
MongoDB alimentan el route handler.

**¿Por qué MongoDB como replica set?**
Los change streams requieren replica set. Se usa un solo nodo `rs0`, suficiente
para el alcance local.

**¿Cómo se reconstruye una vista?**
Se borra la colección, se elimina el grupo de consumidores y se vuelve a leer el
topic desde el inicio. Cada servicio expone `POST /rebuild`. El reset de demo
coordina los cinco rebuilds y vacía los topics.

**¿Qué pasa si se cae un servicio?**
Los demás siguen. Kafka conserva los mensajes y el offset del grupo. Al
reiniciar, el servicio retoma desde el último offset y la idempotencia evita
duplicados.

**¿Qué queda fuera del alcance?**
Autenticación, telemetría GPS, envío real de SMS/correo, alta disponibilidad y
pruebas de carga formales. Las extensiones naturales son Schema Registry, Kafka
Connect, Kafka Streams/ksqlDB y un clúster de tres brokers.
