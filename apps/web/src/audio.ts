import { useUI } from './store';
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
  scheduleMusic() {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || document.hidden) return;
    this.nextNote = Math.max(this.nextNote, ctx.currentTime);
    while (this.nextNote < ctx.currentTime + 0.3) {
      // Original slow modal composition. No recordings, paid APIs or runtime downloads.
      const patterns = {
        menu: [0, 7, 10, 5, 0, 12, 7, 3],
        exploration: [0, 5, 7, 10, 12, 7, 5, 3],
        combat: [0, 3, 7, 5, 0, 7, 10, 5],
        boss: [0, 1, 7, 3, 0, 10, 7, 1],
      };
      const semitone = patterns[this.theme][this.note++ % 8],
        root = this.theme === 'boss' ? 98 : 130.8128;
      for (const [interval, amplitude] of [
        [0, 0.025],
        [12, 0.012],
        [19, 0.007],
      ]) {
        const o = ctx.createOscillator(),
          g = ctx.createGain(),
          filter = ctx.createBiquadFilter();
        o.type = 'sine';
        o.frequency.value = root * 2 ** ((semitone + interval) / 12);
        filter.type = 'lowpass';
        filter.frequency.value = 1100;
        const at = this.nextNote;
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(amplitude, at + 0.7);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 5.5);
        o.connect(filter);
        filter.connect(g);
        g.connect(this.musicGain!);
        o.start(at);
        o.stop(at + 5.7);
        o.onended = () => {
          o.disconnect();
          filter.disconnect();
          g.disconnect();
        };
      }
      this.nextNote += this.theme === 'combat' || this.theme === 'boss' ? 1.65 : 2.4;
    }
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
