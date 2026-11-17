/**
 * sound.ts — two quiet audio cues for the task, synthesised with the Web Audio
 * API (no audio files):
 *
 *   dwellTick()  a short, soft tick when the centred dwell begins
 *   confirm()    a gentle two-note tone when a reach registers
 *
 * Both cues are identical on every trial of every condition, so they carry no
 * information about the design; they only confirm that the software saw what
 * the participant just did.
 *
 * Browsers allow sound only after a user gesture, so `unlock()` must be called
 * from a click handler (the Start button does this). Everything here is a
 * silent no-op where Web Audio is unavailable (older browsers, the unit-test
 * DOM), and while muted.
 *
 * Key exports: `SoundCues`, `getSoundCues`.
 */

/** Peak gain of each cue. Deliberately low: these should be barely-there confirmations. */
const TICK_GAIN = 0.05;
const TONE_GAIN = 0.06;

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export class SoundCues {
  private ctx: AudioContext | null = null;
  private mutedNow = false;
  private readonly listeners = new Set<(muted: boolean) => void>();

  get muted(): boolean {
    return this.mutedNow;
  }

  /** True when this browser can play the cues at all. */
  get supported(): boolean {
    return audioContextCtor() !== null;
  }

  setMuted(muted: boolean): void {
    if (muted === this.mutedNow) return;
    this.mutedNow = muted;
    for (const listener of this.listeners) listener(muted);
  }

  toggleMuted(): void {
    this.setMuted(!this.mutedNow);
  }

  /** Be told when the mute state changes. Returns a function that stops the notifications. */
  onChange(listener: (muted: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Create (or wake) the audio context. MUST be called from a user gesture
   * such as a click, or the browser keeps the context suspended and silent.
   */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = audioContextCtor();
        if (!Ctor) return;
        this.ctx = new Ctor();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    } catch {
      this.ctx = null; // audio is a nicety: never let it break the task
    }
  }

  /** The centred dwell has begun. */
  dwellTick(): void {
    this.beep(880, 0.045, TICK_GAIN, 0);
  }

  /** The reach registered. Two rising notes a fifth apart. */
  confirm(): void {
    this.beep(660, 0.11, TONE_GAIN, 0);
    this.beep(990, 0.16, TONE_GAIN, 0.07);
  }

  /**
   * One sine-wave note with a fast attack and an exponential decay, so it
   * starts and ends without a click.
   * @param delay seconds from now at which the note starts
   */
  private beep(frequencyHz: number, durationS: number, peakGain: number, delay: number): void {
    const ctx = this.ctx;
    if (!ctx || this.mutedNow || ctx.state !== 'running') return;
    try {
      const start = ctx.currentTime + delay;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequencyHz, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peakGain, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + durationS);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + durationS + 0.02);
    } catch {
      // Ignore: a failed cue must never interrupt a trial.
    }
  }
}

let shared: SoundCues | null = null;

/** The app-wide instance, so the mute choice carries over to a second run in the same visit. */
export function getSoundCues(): SoundCues {
  if (!shared) shared = new SoundCues();
  return shared;
}
