import { getSimSpeed } from "../config";

/**
 * Reloj simulado compartido.
 *
 * El tiempo avanza con el reloj real multiplicado por el factor de aceleracion
 * (por defecto 1 hora simulada = 30 segundos reales). Cada evento observado
 * mueve el reloj al menos hasta su `ocurridoEn`, de modo que los servicios
 * nunca ven un tiempo anterior al ultimo evento consumido.
 */
export class SimClock {
  private lastSimMs: number;
  private lastRealMs: number;
  private inicializado = false;

  constructor(
    private readonly speed: number,
    initial?: Date,
  ) {
    const ahora = initial ?? new Date();
    this.lastSimMs = ahora.getTime();
    this.lastRealMs = Date.now();
    this.inicializado = Boolean(initial);
  }

  observe(ocurridoEn: Date): void {
    const t = ocurridoEn.getTime();
    if (!Number.isFinite(t)) return;
    // El primer evento sincroniza el reloj con el tiempo simulado, aunque el
    // simulador arranque "antes" que el reloj de la maquina.
    if (!this.inicializado) {
      this.lastSimMs = t;
      this.lastRealMs = Date.now();
      this.inicializado = true;
      return;
    }
    if (t > this.lastSimMs) {
      this.lastSimMs = t;
      this.lastRealMs = Date.now();
    }
  }

  now(): Date {
    const transcurrido = Date.now() - this.lastRealMs;
    return new Date(this.lastSimMs + transcurrido * this.speed);
  }

  setNow(fecha: Date): void {
    this.lastSimMs = fecha.getTime();
    this.lastRealMs = Date.now();
    this.inicializado = true;
  }

  /**
   * Vuelve al estado inicial: el proximo evento observado fija el reloj.
   * Se usa en los rebuilds para no arrastrar el tiempo de una corrida previa
   * cuando el simulador reinicia su reloj (reset de demo).
   */
  reiniciar(): void {
    this.lastSimMs = Date.now();
    this.lastRealMs = Date.now();
    this.inicializado = false;
  }

  get factor(): number {
    return this.speed;
  }
}

let instancia: SimClock | null = null;

export function simClock(): SimClock {
  if (!instancia) instancia = new SimClock(getSimSpeed());
  return instancia;
}
