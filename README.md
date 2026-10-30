# RutaSur

Plataforma de seguimiento de envíos en tiempo real orientada a eventos para un
operador de última milla ficticio. Implementa el caso práctico de **Programación
Avanzada 2026**: Kafka como log de eventos, servicios Node.js independientes,
MongoDB como modelo de lectura y Next.js para la interfaz.

La historia completa se puede ejecutar en una máquina con Docker: el simulador
genera envíos, cinco consumidores reaccionan en paralelo y la torre de control se
actualiza en vivo.

## Requisitos

- Docker Desktop (o Docker Engine + Compose v2) con el motor Linux corriendo.
- Node.js 20 o superior **solo** para desarrollo local, pruebas y scripts.
- Puertos libres: `3000` (o el que definas en `WEB_PORT`), `4000`–`4005`,
  `9092` y `27017`.

No hace falta instalar dependencias en el host para levantar el stack completo:
las imágenes ejecutan `npm ci` durante el build.

## Arranque en un comando

```bash
npm run up
```

La primera ejecución descarga imágenes y compila los contenedores (puede tardar
varios minutos). Cuando termine:

| Pantalla | URL | Usuario |
| --- | --- | --- |
| Torre de control | <http://localhost:3000> | Supervisor |
| Detalle de envío | `http://localhost:3000/envios/SHP-000001` | Supervisor / gerencia |
| Tracking público | `http://localhost:3000/tracking/SHP-000001` | Destinatario |
| Analítica | <http://localhost:3000/analitica> | Gerencia |
| Panel de demo | <http://localhost:3000/demo> | Quien presenta |

El simulador arranca solo y publica envíos a 20 por minuto real, con el reloj
acelerado 120× (1 hora simulada = 30 segundos reales). La tasa es el volumen de
la demo; la aceleración solo comprime los tiempos internos de cada envío.

Para seguir el arranque:

```bash
npm run logs
docker compose ps
```

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run up` | Construye y levanta todo el stack en segundo plano. |
| `npm run down` | Detiene y elimina los contenedores (conserva los volúmenes). |
| `npm run logs` | Sigue los logs de todos los servicios. |
| `npm run infra` | Levanta solo Kafka, MongoDB y los inicializadores. |
| `npm run dev` | Modo desarrollo: infra en Docker + 7 procesos con recarga en caliente. |
| `npm run typecheck` | Verifica tipos de todo el monorepo con `tsc --noEmit`. |
| `npm test` | Ejecuta las pruebas unitarias de reglas de negocio y esquemas. |
| `npm run build:web` | Compila la aplicación Next.js. |
| `npm run acceptance` | Prueba end-to-end contra el stack levantado (CU1–CU4, DLQ, idempotencia, replay). |
| `npm run reset` | Borra los volúmenes de Kafka y MongoDB y vuelve a levantar todo. |

## Arquitectura en 30 segundos

```
                    ┌─────────────────────────────┐
                    │ Simulador (4000)            │
                    │ envíos · promesas · reintentos│
                    └──────────────┬──────────────┘
                                   │ publica
                                   ▼
        ┌──────────────────────────────────────────────────┐
        │ Kafka KRaft · 1 broker · topics con clave shipmentId│
        └───┬──────────────┬──────────────┬────────────┬────┘
            │              │              │            │
            ▼              ▼              ▼            ▼
       proyector    notificaciones  reprogramación  monitor-sla  analítica
        (4002)         (4003)          (4004)        (4005)      (4001)
            │              │              │            │            │
            └──────────────┴──────────────┴────────────┴────────────┘
                                   │ escriben vistas derivadas
                                   ▼
                            MongoDB rs0 (27017)
                                   │ change streams
                                   ▼
                            Next.js (3000) ── SSE ──► navegador
```

- **Kafka es el único canal entre servicios.** Ningún servicio llama a otro para
  el flujo de negocio.
- **MongoDB guarda vistas derivadas**, no la fuente de verdad. Se puede borrar y
  reconstruir leyendo los topics desde el inicio.
- **Next.js solo lee MongoDB.** Las actualizaciones en vivo llegan por change
  streams + Server-Sent Events.
- **Cada servicio es un proceso separado** y puede caerse sin detener a los
  demás.

## Topics

| Topic | Clave | Produce | Consume | Retención |
| --- | --- | --- | --- | --- |
| `envios.estados` | `shipmentId` | Simulador | proyector, notificaciones, reprogramación, monitor-sla, analítica | 30 días · 3 particiones |
| `envios.promesas` | `shipmentId` | Simulador | proyector, monitor-sla, analítica | compactado |
| `envios.reprogramaciones` | `shipmentId` | Reprogramación | proyector | 30 días |
| `alertas.sla` | `shipmentId` | Monitor de SLA | proyector, notificaciones | 7 días |
| `notificaciones.enviadas` | `shipmentId` | Notificaciones | proyector | 7 días |
| `envios.estados.dlq` | `shipmentId` | Cualquier consumidor | Revisión manual | 30 días |

El detalle de campos, ejemplos y reglas está en
[`docs/catalogo-eventos.md`](docs/catalogo-eventos.md).

## Garantías del pipeline

- **Al menos una vez** con commit manual del offset después de escribir en
  MongoDB.
- **Idempotencia** por `(consumidor, eventId)` en `eventos_procesados`, más IDs
  determinísticos e índices únicos en las colecciones de vista.
- **Orden por envío**: la clave de partición es `shipmentId`; el proyector
  descarta eventos con `secuencia` menor o igual a la aplicada.
- **Validación de esquema** con AJV por topic. Un JSON roto o un evento inválido
  va a la DLQ con motivo, error y mensaje original; el consumo continúa.
- **Reintentos** acotados antes de enviar a la DLQ.
- **Tiempo de evento**: las reglas de SLA usan `ocurridoEn` y un reloj simulado,
  no el reloj de la máquina.
- **Reconstrucción**: cada consumidor expone `POST /rebuild`; la analítica puede
  reprocesar el histórico con un grupo nuevo sin tocar a los demás.

## Estructura del repositorio

```
apps/web/                 Next.js: torre, detalle, tracking, analítica y demo
packages/shared/          Config, eventos, esquemas, Kafka, Mongo, dominio, reloj
services/simulator/       Generador de envíos, escenarios e inyecciones
services/projector/       Proyección de envíos, alertas y notificaciones
services/notifications/   Avisos al destinatario y al supervisor
services/rescheduler/     Reglas de reprogramación y agenda de reintentos
services/sla-monitor/     Estado por envío y alertas tempranas de SLA
services/analytics/       métricas_diarias, motivos, SLA y replay
docker/                   Dockerfiles e inicializadores de Kafka y MongoDB
scripts/                  Orquestación de desarrollo, reset y aceptación
docs/                     Arquitectura, eventos, modelo de datos y guion de demo
```

## Documentación

- [`docs/arquitectura.md`](docs/arquitectura.md): componentes, flujos,
  garantías, tiempo, replay y decisiones de diseño.
- [`docs/catalogo-eventos.md`](docs/catalogo-eventos.md): topics, esquemas,
  ejemplos, estados y reglas de negocio.
- [`docs/modelo-datos.md`](docs/modelo-datos.md): colecciones, campos, índices,
  invariantes y reconstrucción.
- [`docs/guion-demo.md`](docs/guion-demo.md): recorrido de 15 minutos con los
  ocho pasos de la consigna.

## Demo rápida

1. Abrí <http://localhost:3000> y verificá que los contadores se muevan.
2. En <http://localhost:3000/demo>, ejecutá **Entrega feliz** y abrí el envío
   desde la torre o buscando el `SHP-…` que aparece en **Actividad**.
3. Ejecutá **Destinatario ausente**: en el detalle aparecen la notificación, la
   reprogramación y el próximo intento.
4. Ejecutá **Demora en el hub**: la alerta de SLA aparece en la cola de la torre.
5. Inyectá un **Evento malformado** y revisá la DLQ.
6. Abrí **Analítica** y mirá los tres indicadores.
7. En **Demo**, usá **Reprocesar histórico** para completar el cuarto indicador.
8. Para volver a empezar, usá **Reset de demo** (vacía topics y reconstruye
   vistas) o `npm run reset` (borra también los volúmenes).

El guion completo, con tiempos y conceptos para la defensa, está en
[`docs/guion-demo.md`](docs/guion-demo.md).

## Verificación

Con el stack levantado:

```bash
npm run acceptance
```

La prueba comprueba salud de los servicios, topics, CU1–CU4, idempotencia ante
un evento duplicado, DLQ, lag, replay y las vistas web. También se puede correr
sin Docker la parte estática:

```bash
npm install
npm run typecheck
npm test
npm run build:web
```

## Problemas frecuentes

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| `Cannot connect to the Docker daemon` | Docker Desktop no está corriendo. | Iniciá Docker Desktop y reintentá `npm run up`. |
| La web muestra “No hay conexión con MongoDB” | Mongo todavía no inició el replica set o el contenedor se detuvo. | `docker compose ps`, `docker compose logs mongo mongo-init`. |
| Los servicios reinician en loop | Kafka no está sano o los topics no se crearon. | `docker compose logs kafka kafka-init`. |
| `Bind for 0.0.0.0:3000 failed` | Otro proceso usa el puerto. | Liberá el puerto o definí `WEB_PORT` (por ejemplo `WEB_PORT=3001`) en `.env` y volvé a levantar. |
| Quiero empezar de cero | Quedaron datos o offsets viejos. | `npm run reset` (borra volúmenes). |
| El replay no completa datos | No hay eventos históricos en `envios.estados`. | Generá tráfico o una ráfaga y reintentá. |

## Configuración

Las variables están documentadas en [`.env.example`](.env.example). Las más
relevantes:

| Variable | Default | Uso |
| --- | --- | --- |
| `WEB_PORT` | `3000` | Puerto del host para la web (el contenedor sigue en `3000`). |
| `SIM_SPEED` | `120` | Factor de aceleración del reloj simulado. |
| `SIM_RATE` | `20` | Envíos por minuto real (volumen de la demo). |
| `SIM_SEED` | `42` | Semilla para corridas reproducibles. |
| `SIM_START_HOUR` | `08` | Hora simulada de arranque. |
| `SIM_TZ` | `America/Argentina/Buenos_Aires` | Zona horaria de franjas y fechas. |
| `KAFKA_BROKERS` | `localhost:9092` | Brokers para ejecución en el host. |
| `MONGO_URI` | `mongodb://localhost:27017/rutasur?replicaSet=rs0&directConnection=true` | Conexión local. |

Dentro de Docker Compose, `KAFKA_BROKERS` y `MONGO_URI` se sobrescriben para usar
los nombres internos `kafka:29092` y `mongo:27017`.
