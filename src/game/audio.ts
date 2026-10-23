/* Procedural sound engine — every SFX is synthesized with WebAudio. No assets needed. */

interface SfxOpts {
  vol?: number; // 0..1 multiplier
  pan?: number; // -1..1
  delay?: number;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private ambience: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private volume = 0.8;
  private lastStepAt = 0;

  get ready() {
    return !!this.ctx;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    // shared white-noise buffer (2s)
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  dispose() {
    this.stopAmbience();
    if (this.ctx) void this.ctx.close().catch(() => undefined);
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
  }

  // ---------- primitives ----------
  private out(pan: number): { node: GainNode; panner: StereoPannerNode | null } {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    let panner: StereoPannerNode | null = null;
    if (typeof ctx.createStereoPanner === 'function') {
      panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(panner);
      panner.connect(this.master!);
    } else {
      g.connect(this.master!);
    }
    return { node: g, panner };
  }

  private noise(dur: number, o: { freq?: number; q?: number; type?: BiquadFilterType; gain?: number; decay?: number; freqEnd?: number } & SfxOpts) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'lowpass';
    f.frequency.setValueAtTime(o.freq ?? 2000, t);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.freqEnd), t + dur);
    f.Q.value = o.q ?? 0.8;
    const { node } = this.out(o.pan ?? 0);
    const peak = (o.gain ?? 0.6) * (o.vol ?? 1);
    node.gain.setValueAtTime(peak, t);
    node.gain.exponentialRampToValueAtTime(0.001, t + dur * (o.decay ?? 1));
    src.connect(f);
    f.connect(node);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, freqEnd: number, dur: number, o: { type?: OscillatorType; gain?: number } & SfxOpts) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(Math.max(20, freq), t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    const { node } = this.out(o.pan ?? 0);
    const peak = (o.gain ?? 0.5) * (o.vol ?? 1);
    node.gain.setValueAtTime(peak, t);
    node.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(node);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // ---------- weapons ----------
  ak(o: SfxOpts = {}) {
    const v = o.vol ?? 1;
    this.noise(0.22, { freq: 3200, freqEnd: 300, gain: 0.95, vol: v, pan: o.pan });
    this.tone(160, 42, 0.18, { gain: 0.85, vol: v, pan: o.pan });
    this.noise(0.04, { freq: 7000, type: 'highpass', gain: 0.5, vol: v, pan: o.pan });
  }

  m4(o: SfxOpts = {}) {
    // suppressed thwip
    const v = o.vol ?? 1;
    this.noise(0.13, { freq: 1700, freqEnd: 250, gain: 0.62, vol: v, pan: o.pan });
    this.tone(230, 75, 0.11, { gain: 0.5, vol: v, pan: o.pan });
    this.noise(0.03, { freq: 5500, type: 'highpass', gain: 0.25, vol: v, pan: o.pan });
  }

  awp(o: SfxOpts = {}) {
    const v = o.vol ?? 1;
    this.noise(0.5, { freq: 2600, freqEnd: 150, gain: 1, vol: v, pan: o.pan });
    this.tone(120, 28, 0.4, { gain: 1, vol: v, pan: o.pan });
    this.noise(0.3, { freq: 900, gain: 0.35, vol: v, pan: o.pan, delay: 0.16 });
  }

  pistol(o: SfxOpts = {}) {
    const v = o.vol ?? 1;
    this.noise(0.1, { freq: 3600, freqEnd: 600, gain: 0.55, vol: v, pan: o.pan });
    this.tone(260, 95, 0.09, { gain: 0.42, vol: v, pan: o.pan });
  }

  usp(o: SfxOpts = {}) {
    const v = o.vol ?? 1;
    this.noise(0.09, { freq: 1400, freqEnd: 250, gain: 0.5, vol: v, pan: o.pan });
    this.tone(200, 80, 0.09, { gain: 0.4, vol: v, pan: o.pan });
  }

  deagle(o: SfxOpts = {}) {
    const v = o.vol ?? 1;
    this.noise(0.26, { freq: 3000, freqEnd: 220, gain: 0.9, vol: v, pan: o.pan });
    this.tone(140, 38, 0.22, { gain: 0.9, vol: v, pan: o.pan });
  }

  // ---------- actions ----------
  knifeSwing(o: SfxOpts = {}) {
    this.noise(0.16, { freq: 900, freqEnd: 220, type: 'bandpass', q: 1.6, gain: 0.5, ...o });
  }

  knifeHit(o: SfxOpts = {}) {
    this.noise(0.12, { freq: 1200, gain: 0.7, ...o });
    this.tone(300, 90, 0.1, { gain: 0.5, ...o });
  }

  reload(stage = 0, o: SfxOpts = {}) {
    // mag out / mag in / rack
    if (stage === 0) {
      this.noise(0.06, { freq: 2500, type: 'bandpass', gain: 0.5, ...o });
      this.tone(500, 300, 0.06, { type: 'square', gain: 0.12, ...o });
    } else if (stage === 1) {
      this.noise(0.07, { freq: 1800, type: 'bandpass', gain: 0.6, ...o });
      this.tone(700, 420, 0.07, { type: 'square', gain: 0.14, ...o });
    } else {
      this.noise(0.08, { freq: 3200, type: 'bandpass', gain: 0.6, ...o });
      this.tone(900, 500, 0.08, { type: 'square', gain: 0.13, ...o });
    }
  }

  empty(o: SfxOpts = {}) {
    this.tone(2800, 1800, 0.035, { type: 'square', gain: 0.12, ...o });
  }

  hit(headshot: boolean, o: SfxOpts = {}) {
    if (headshot) {
      this.tone(3100, 3100, 0.06, { type: 'sine', gain: 0.35, ...o });
      this.tone(1550, 1550, 0.08, { type: 'sine', gain: 0.3, ...o, delay: 0.04 });
    } else {
      this.tone(2100, 1900, 0.06, { type: 'sine', gain: 0.35, ...o });
    }
  }

  killConfirm(o: SfxOpts = {}) {
    this.tone(660, 660, 0.07, { type: 'triangle', gain: 0.4, ...o });
    this.tone(990, 990, 0.09, { type: 'triangle', gain: 0.4, ...o, delay: 0.07 });
  }

  hurt(o: SfxOpts = {}) {
    this.tone(190, 80, 0.16, { gain: 0.5, ...o });
    this.noise(0.1, { freq: 700, gain: 0.4, ...o });
  }

  death(o: SfxOpts = {}) {
    this.tone(320, 60, 0.35, { type: 'sawtooth', gain: 0.22, ...o });
    this.noise(0.25, { freq: 600, gain: 0.4, ...o });
  }

  explosion(o: SfxOpts = {}) {
    const v = o.vol ?? 1;
    this.noise(1.3, { freq: 900, freqEnd: 60, gain: 1, decay: 1.4, vol: v, pan: o.pan });
    this.tone(95, 24, 1.1, { gain: 1, vol: v, pan: o.pan });
    this.noise(0.2, { freq: 4500, type: 'highpass', gain: 0.5, vol: v, pan: o.pan });
    this.noise(0.5, { freq: 500, gain: 0.4, vol: v, pan: o.pan, delay: 0.25 });
  }

  beep(o: SfxOpts = {}) {
    this.tone(1250, 1250, 0.05, { type: 'square', gain: 0.16, ...o });
  }

  footstep(sneaking: boolean, o: SfxOpts = {}) {
    const now = performance.now();
    if (now - this.lastStepAt < 240) return;
    this.lastStepAt = now;
    const g = sneaking ? 0.07 : 0.2;
    this.noise(0.09, { freq: 500 + Math.random() * 500, gain: g, ...o, vol: (o.vol ?? 1) });
    this.noise(0.05, { freq: 3000, type: 'highpass', gain: g * 0.5, ...o, vol: (o.vol ?? 1) });
  }

  land(o: SfxOpts = {}) {
    this.noise(0.12, { freq: 450, gain: 0.5, ...o });
  }

  jump(o: SfxOpts = {}) {
    this.noise(0.07, { freq: 700, gain: 0.18, ...o });
  }

  buy(o: SfxOpts = {}) {
    this.tone(880, 880, 0.08, { type: 'triangle', gain: 0.35, ...o });
    this.tone(1320, 1320, 0.12, { type: 'triangle', gain: 0.35, ...o, delay: 0.08 });
  }

  denied(o: SfxOpts = {}) {
    this.tone(220, 160, 0.16, { type: 'square', gain: 0.2, ...o });
  }

  click(o: SfxOpts = {}) {
    this.tone(1500, 1200, 0.04, { type: 'square', gain: 0.1, ...o });
  }

  scope(o: SfxOpts = {}) {
    this.noise(0.08, { freq: 2200, type: 'bandpass', gain: 0.35, ...o });
    this.tone(600, 900, 0.06, { type: 'triangle', gain: 0.15, ...o });
  }

  swap(o: SfxOpts = {}) {
    this.noise(0.09, { freq: 1600, type: 'bandpass', gain: 0.4, ...o });
  }

  pin(o: SfxOpts = {}) {
    this.tone(2400, 1400, 0.05, { type: 'square', gain: 0.14, ...o });
    this.noise(0.05, { freq: 4000, type: 'highpass', gain: 0.3, ...o });
  }

  bounce(o: SfxOpts = {}) {
    this.tone(700 + Math.random() * 300, 300, 0.07, { type: 'triangle', gain: 0.25, ...o });
  }

  roundStart() {
    this.tone(520, 780, 0.35, { type: 'triangle', gain: 0.4 });
    this.tone(780, 1040, 0.4, { type: 'triangle', gain: 0.4, delay: 0.3 });
  }

  win() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => this.tone(f, f, 0.22, { type: 'triangle', gain: 0.4, delay: i * 0.14 }));
  }

  lose() {
    const notes = [392, 330, 262, 196];
    notes.forEach((f, i) => this.tone(f, f * 0.97, 0.26, { type: 'triangle', gain: 0.4, delay: i * 0.16 }));
  }

  // ---------- ambience ----------
  startAmbience() {
    if (!this.ctx || !this.master || !this.noiseBuf || this.ambience) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    // slow wind gusts via LFO
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    src.connect(f);
    f.connect(gain);
    gain.connect(this.master);
    src.start();
    lfo.start();
    this.ambience = { src, gain };
  }

  stopAmbience() {
    if (!this.ambience || !this.ctx) return;
    try {
      this.ambience.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
      const src = this.ambience.src;
      window.setTimeout(() => {
        try {
          src.stop();
        } catch {
          /* noop */
        }
      }, 800);
    } catch {
      /* noop */
    }
    this.ambience = null;
  }
}
