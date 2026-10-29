/** Generador pseudoaleatorio reproducible (mulberry32). */
export class Rng {
  private estado: number;

  constructor(seed: number) {
    this.estado = seed >>> 0;
  }

  next(): number {
    this.estado = (this.estado + 0x6d2b79f5) >>> 0;
    let t = this.estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(valores: readonly T[]): T {
    return valores[this.int(0, valores.length - 1)] as T;
  }

  chance(probabilidad: number): boolean {
    return this.next() < probabilidad;
  }
}
