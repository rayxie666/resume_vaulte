// Synthesized purr — amplitude-modulated filtered noise, no audio asset.
// Off by default (spec §5); volume deliberately tiny.

export class Purr {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  start(): void {
    if (this.ctx) return;
    try {
      const ctx = new AudioContext();
      // 2s loop of brown noise.
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;

      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 150;

      // ~24Hz tremolo = the purr rumble.
      const tremolo = ctx.createGain();
      tremolo.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 24;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.45;
      lfo.connect(lfoGain).connect(tremolo.gain);

      const master = ctx.createGain();
      master.gain.value = 0;
      master.gain.linearRampToValueAtTime(0.045, ctx.currentTime + 0.4);

      src.connect(lp).connect(tremolo).connect(master).connect(ctx.destination);
      src.start();
      lfo.start();
      this.ctx = ctx;
      this.master = master;
    } catch {
      this.ctx = null;
      this.master = null;
    }
  }

  stop(): void {
    const ctx = this.ctx;
    const master = this.master;
    this.ctx = null;
    this.master = null;
    if (!ctx || !master) return;
    try {
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
      window.setTimeout(() => void ctx.close().catch(() => undefined), 400);
    } catch {
      void ctx.close().catch(() => undefined);
    }
  }
}
