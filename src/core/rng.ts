/**
 * rng.ts — small seeded pseudo-random number generator.
 *
 * Target orders must be reproducible from a saved seed, so schedule generation
 * never calls Math.random(). `mulberry32` is a compact, well-distributed 32-bit
 * generator that is more than adequate for shuffling eight targets.
 *
 * Key exports: `mulberry32`, `shuffled`, `randomSeed`.
 */

export type Rng = () => number;

/** Returns a function yielding uniform floats in [0, 1), fully determined by `seed`. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle returning a new array; `items` is left untouched. */
export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A fresh unsigned 32-bit seed for a new session. Uses the Web Crypto API when
 * available so that seeds (and therefore 50/50 assignment) are not predictable.
 */
export function randomSeed(): number {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    return c.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 4294967296) >>> 0;
}
