// Sound: built-in synthesized effects (no files needed) plus imported audio clips.
import * as THREE from 'three';

const SYNTH = {
  pop: (s) => s.tone(520, 0.09, 'sine', 900),
  click: (s) => s.tone(900, 0.04, 'square'),
  beep: (s) => s.tone(660, 0.18, 'square'),
  coin: (s) => { s.tone(988, 0.08, 'square'); s.tone(1319, 0.3, 'square', null, 0.08); },
  jump: (s) => s.tone(280, 0.22, 'square', 640),
  laser: (s) => s.tone(1200, 0.2, 'sawtooth', 180),
  boom: (s) => s.noise(0.5),
  hit: (s) => s.noise(0.12),
  win: (s) => [523, 659, 784, 1047].forEach((f, i) => s.tone(f, 0.16, 'triangle', null, i * 0.12)),
  lose: (s) => [392, 330, 262].forEach((f, i) => s.tone(f, 0.25, 'triangle', null, i * 0.2)),
};
export const SOUND_NAMES = Object.keys(SYNTH);

export class Sounds {
  constructor(camera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.camera = camera;
    this.ctx = this.listener.context;
    this.loader = new THREE.AudioLoader();
    this.playing = new Set();
  }
  resume() { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); }

  tone(freq, dur, type = 'sine', slideTo = null, delay = 0, volume = 0.2) {
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(this.listener.getInput());
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
  noise(dur, volume = 0.35) {
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
    const src = this.ctx.createBufferSource(), gain = this.ctx.createGain();
    src.buffer = buf;
    gain.gain.value = volume;
    src.connect(gain).connect(this.listener.getInput());
    src.start();
  }
  /** Play a built-in effect by name, or a musical note by frequency. Returns false if unknown. */
  synth(name) {
    this.resume();
    if (typeof name === 'number') return this.tone(name, 0.3, 'triangle'), true;
    const fx = SYNTH[String(name).toLowerCase()];
    if (fx) fx(this);
    return !!fx;
  }

  /** Play an audio object's clip (positional if the object asks for it). */
  async playClip(entity, url) {
    this.resume();
    const props = entity.data.props || {};
    if (!entity.audio) {
      entity.audio = props.positional ? new THREE.PositionalAudio(this.listener) : new THREE.Audio(this.listener);
      if (props.positional) entity.audio.setRefDistance(4);
      entity.object.add(entity.audio);
      entity.audio.setBuffer(await this.loader.loadAsync(url));
    }
    const a = entity.audio;
    if (a.isPlaying) a.stop();
    a.setLoop(!!props.loop);
    a.setVolume(props.volume ?? 1);
    a.play();
    this.playing.add(a);
  }
  stopClip(entity) { if (entity.audio?.isPlaying) entity.audio.stop(); }
  stopAll() {
    for (const a of this.playing) { try { if (a.isPlaying) a.stop(); } catch { /* already stopped */ } a.removeFromParent(); }
    this.playing.clear();
  }
  dispose() { this.stopAll(); this.camera.remove(this.listener); }
}
