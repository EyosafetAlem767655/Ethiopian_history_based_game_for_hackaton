import { useUI } from './store';
class BattleAudio {
  context: AudioContext | null = null;
  unlock() {
    try {
      this.context ??= new AudioContext();
      void this.context.resume();
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
      g.gain.setValueAtTime(Math.max(0.0001, amplitude * s.volume), now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      o.connect(g);
      g.connect(ctx.destination);
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
      gain.gain.value = s.volume * 0.06;
      source.buffer = buffer;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
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
