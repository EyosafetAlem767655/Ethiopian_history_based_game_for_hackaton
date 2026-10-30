import { useUI } from './store';
// Ethiopian pentatonic modes (semitones above the root): Tizita minor and the darker Anchihoye.
const TIZITA_MINOR = [0, 2, 3, 7, 8],
  ANCHIHOYE = [0, 1, 5, 6, 9];
/** Semitone offset of scale degree n (five degrees per octave; negatives go below the root). */
function degree(mode: number[], n: number) {
  const octave = Math.floor(n / 5);
  return mode[n - octave * 5] + 12 * octave;
}
const _ = null;
type Score = {
  bpm: number;
  root: number;
  mode: number[];
  /** Bar-by-bar chord roots in semitones. */
  chords: number[];
  /** Sixteen drum steps; 1 is a stroke, 1.5 an accented downbeat. */
  drum: number[];
  /** Melody scale degrees per sixteenth step (null rests), looping across bars. */
  melody: (number | null)[];
};
const SCORES: Record<'menu' | 'exploration' | 'combat' | 'boss', Score> = {
  // Slow and majestic: a processional with long horn swells.
  menu: {
    bpm: 62,
    root: 130.81,
    mode: TIZITA_MINOR,
    chords: [0, -4, 3, -5],
    drum: [1.5, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    melody: [
      5,
      _,
      _,
      _,
      7,
      _,
      6,
      _,
      8,
      _,
      _,
      _,
      7,
      _,
      _,
      _,
      9,
      _,
      8,
      _,
      7,
      _,
      _,
      _,
      6,
      _,
      5,
      _,
      _,
      _,
      _,
      _,
    ],
  },
  exploration: {
    bpm: 80,
    root: 130.81,
    mode: TIZITA_MINOR,
    chords: [0, 3, -4, -2],
    drum: [1.5, 0, 0, 1, 0, 0, 1, 0, 1.5, 0, 0, 1, 0, 1, 0, 0],
    melody: [
      5,
      _,
      7,
      _,
      8,
      _,
      7,
      6,
      5,
      _,
      _,
      _,
      6,
      7,
      _,
      _,
      8,
      _,
      9,
      _,
      10,
      _,
      9,
      8,
      7,
      _,
      6,
      _,
      5,
      _,
      _,
      _,
    ],
  },
  // Driving war drums under a clipped krar ostinato.
  combat: {
    bpm: 104,
    root: 130.81,
    mode: TIZITA_MINOR,
    chords: [0, 0, -4, -2],
    drum: [1.5, 0, 1, 0, 1, 0, 1, 1, 1.5, 0, 1, 0, 1, 1, 1, 0],
    melody: [5, _, 5, 7, _, 8, 7, _, 5, _, 6, _, 7, _, 3, _],
  },
  boss: {
    bpm: 116,
    root: 98,
    mode: ANCHIHOYE,
    chords: [0, 1, 0, -2],
    drum: [1.5, 0, 1, 1, 1.5, 0, 1, 0, 1.5, 0, 1, 1, 1.5, 1, 1, 1],
    melody: [5, 6, _, 5, 7, _, 6, 5, 8, _, 7, 6, 5, _, 6, _],
  },
};
class BattleAudio {
  context: AudioContext | null = null;
  musicGain: GainNode | null = null;
  effectsGain: GainNode | null = null;
  musicTimer: ReturnType<typeof setInterval> | null = null;
  nextNote = 0;
  note = 0;
  theme: 'menu' | 'exploration' | 'combat' | 'boss' = 'menu';
  constructor() {
    useUI.subscribe((s, p) => {
      if (s.muted !== p.muted || s.volume !== p.volume || s.musicVolume !== p.musicVolume)
        this.updateMusicVolume();
    });
    document.addEventListener('visibilitychange', () => {
      this.updateMusicVolume();
      if (!document.hidden && this.context?.state === 'running')
        this.nextNote = this.context.currentTime + 0.15;
    });
  }
  updateMusicVolume() {
    if (!this.context || !this.musicGain) return;
    const s = useUI.getState();
    this.effectsGain?.gain.setTargetAtTime(
      s.muted || document.hidden ? 0 : Math.max(0, Math.min(1, s.volume)),
      this.context.currentTime,
      0.025,
    );
    this.musicGain.gain.setTargetAtTime(
      s.muted || document.hidden ? 0 : Math.max(0, Math.min(1, s.musicVolume)),
      this.context.currentTime,
      0.25,
    );
  }
  setTheme(theme: typeof this.theme) {
    this.theme = theme;
  }
  noise: AudioBuffer | null = null;
  /**
   * Original generated score: kebero war drums, a horn drone, a choir-like pad and a krar-style
   * plucked melody in Ethiopian modes. Sixteen steps per bar; tempo and density rise from the
   * majestic menu theme to the boss. No recordings, paid APIs or runtime downloads.
   */
  scheduleMusic() {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || document.hidden) return;
    this.nextNote = Math.max(this.nextNote, ctx.currentTime);
    while (this.nextNote < ctx.currentTime + 0.3) {
      const score = SCORES[this.theme],
        step = this.note++ % 16,
        bar = Math.floor(this.note / 16) % score.chords.length,
        at = this.nextNote,
        beat = 60 / score.bpm,
        root = score.root * 2 ** (score.chords[bar] / 12);
      if (score.drum[step]) this.drum(at, score.drum[step]);
      if (step === 0) {
        this.horn(at, root / 2, beat * 4);
        this.choir(at, root, score.mode, beat * 4.2);
      }
      const note = score.melody[(bar * 16 + step) % score.melody.length];
      if (note !== null) this.pluck(at, score.root * 2 ** (degree(score.mode, note) / 12));
      this.nextNote += beat / 4;
    }
  }
  /** A voice routed through its own gain envelope into the music bus, cleaned up when done. */
  voice(type: OscillatorType, frequency: number, at: number, length: number, cutoff = 1800) {
    const ctx = this.context!,
      o = ctx.createOscillator(),
      g = ctx.createGain(),
      filter = ctx.createBiquadFilter();
    o.type = type;
    o.frequency.setValueAtTime(frequency, at);
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    o.connect(filter);
    filter.connect(g);
    g.connect(this.musicGain!);
    g.gain.setValueAtTime(0, at);
    o.start(at);
    o.stop(at + length + 0.1);
    o.onended = () => {
      o.disconnect();
      filter.disconnect();
      g.disconnect();
    };
    return { o, g, filter };
  }
  /** Kebero: a deep pitch-dropping drum body with a short skin slap. */
  drum(at: number, strength: number) {
    const ctx = this.context!;
    const { o, g } = this.voice('sine', 120, at, 0.55, 900);
    o.frequency.exponentialRampToValueAtTime(42, at + 0.32);
    g.gain.linearRampToValueAtTime(0.11 * strength, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
    this.noise ??= (() => {
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate),
        data = buffer.getChannelData(0);
      for (let n = 0; n < data.length; n++) data[n] = Math.random() * 2 - 1;
      return buffer;
    })();
    const slap = ctx.createBufferSource(),
      band = ctx.createBiquadFilter(),
      sg = ctx.createGain();
    slap.buffer = this.noise;
    band.type = 'bandpass';
    band.frequency.value = strength > 1 ? 220 : 380;
    sg.gain.setValueAtTime(0.05 * strength, at);
    sg.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
    slap.connect(band);
    band.connect(sg);
    sg.connect(this.musicGain!);
    slap.start(at);
    slap.stop(at + 0.15);
    slap.onended = () => {
      slap.disconnect();
      band.disconnect();
      sg.disconnect();
    };
  }
  /** Low horn drone (root and fifth) that swells across the bar. */
  horn(at: number, frequency: number, length: number) {
    for (const [ratio, level] of [
      [1, 0.03],
      [1.5, 0.018],
    ]) {
      const { g, filter } = this.voice('sawtooth', frequency * ratio, at, length, 380);
      filter.frequency.linearRampToValueAtTime(700, at + length * 0.5);
      g.gain.linearRampToValueAtTime(level, at + length * 0.4);
      g.gain.linearRampToValueAtTime(0.0001, at + length);
    }
  }
  /** Choir-like pad: detuned voices on the mode's root, third and fifth with slow vibrato. */
  choir(at: number, frequency: number, mode: number[], length: number) {
    for (const [n, detune] of [
      [0, -6],
      [2, 5],
      [4, -3],
      [7, 4],
    ]) {
      const { o, g } = this.voice(
        'triangle',
        frequency * 2 ** (degree(mode, n) / 12),
        at,
        length,
        1400,
      );
      o.detune.value = detune;
      g.gain.linearRampToValueAtTime(0.012, at + length * 0.35);
      g.gain.linearRampToValueAtTime(0.0001, at + length);
    }
  }
  /** Krar/begena-style pluck: bright attack, fast decay, closing filter. */
  pluck(at: number, frequency: number) {
    const { g, filter } = this.voice('square', frequency, at, 0.9, 2600);
    filter.frequency.exponentialRampToValueAtTime(500, at + 0.4);
    g.gain.linearRampToValueAtTime(0.022, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.85);
  }
  unlock() {
    try {
      this.context ??= new AudioContext();
      if (!this.effectsGain) {
        this.effectsGain = this.context.createGain();
        this.effectsGain.connect(this.context.destination);
      }
      if (!this.musicGain) {
        this.musicGain = this.context.createGain();
        this.musicGain.gain.value = 0;
        this.musicGain.connect(this.context.destination);
        this.updateMusicVolume();
      }
      void this.context.resume();
      if (!this.musicTimer) {
        this.musicTimer = setInterval(() => this.scheduleMusic(), 150);
        this.nextNote = this.context.currentTime + 0.1;
      }
    } catch {
      /* Audio controls remain available on unsupported browsers. */
    }
  }
  play(kind: string) {
    const s = useUI.getState(),
      ctx = this.context;
    if (s.muted || !ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const tone = (
      start: number,
      end: number,
      duration: number,
      type: OscillatorType = 'triangle',
      amplitude = 0.12,
    ) => {
      const o = ctx.createOscillator(),
        g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(start, now);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, end), now + duration);
      g.gain.setValueAtTime(Math.max(0.0001, amplitude), now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      o.connect(g);
      g.connect(this.effectsGain!);
      o.start(now);
      o.stop(now + duration);
    };
    if (kind === 'swing' || kind === 'throw') {
      tone(kind === 'throw' ? 700 : 380, 70, 0.16, 'sawtooth', 0.035);
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.13, ctx.sampleRate),
        data = buffer.getChannelData(0);
      for (let n = 0; n < data.length; n++)
        data[n] = (Math.random() * 2 - 1) * (1 - n / data.length);
      const source = ctx.createBufferSource(),
        filter = ctx.createBiquadFilter(),
        gain = ctx.createGain();
      filter.type = 'bandpass';
      filter.frequency.value = kind === 'throw' ? 1800 : 1000;
      gain.gain.value = 0.06;
      source.buffer = buffer;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.effectsGain!);
      source.start();
    } else if (kind === 'block') {
      tone(1100, 380, 0.18, 'triangle', 0.1);
      tone(1540, 700, 0.12, 'sine', 0.035);
    } else if (kind === 'hoof') {
      tone(95, 45, 0.065, 'triangle', 0.09);
    } else if (kind === 'summon' || kind === 'danger') {
      tone(120, 38, 0.45, 'sawtooth', 0.07);
    } else if (kind === 'objective' || kind === 'scroll') {
      tone(540, 820, 0.24, 'sine', 0.045);
    } else if (kind === 'ring' || kind === 'honor' || kind === 'rescue') {
      tone(660, 1100, 0.2, 'sine', 0.075);
    } else if (kind === 'hit') {
      tone(180, 45, 0.12, 'triangle', 0.12);
    } else if (kind === 'defeat') {
      tone(160, 35, 0.38, 'triangle', 0.08);
    }
  }
}
export const audio = new BattleAudio();
