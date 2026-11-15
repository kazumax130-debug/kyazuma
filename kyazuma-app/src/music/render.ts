import { getMood, type BassSound, type ChordSound, type DrumStyle, type LeadSound } from './moods';
import { loopSeconds, STEPS_PER_BAR, TOTAL_STEPS, type NoteEvent, type Pattern } from './pattern';
import { midiToFreq } from './theory';

// 24 kHz keeps rendering quick on phones while still sounding clear on their speakers.
export const SAMPLE_RATE = 24000;

const TAU = Math.PI * 2;

type ToneSound = ChordSound | LeadSound | BassSound;

/**
 * A mono buffer that wraps around at the end, so notes ringing past the loop
 * end continue at the start and the loop repeats seamlessly.
 */
type LoopBuffer = Float32Array;

/** Deterministic white noise so the same pattern always renders identically. */
function createNoise(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2147483648 - 1;
  };
}

/**
 * Per-sample multiplier for an exponential decay of exp(-rate * t).
 * Multiplying an envelope by this every sample is much cheaper than calling
 * Math.exp, which matters on Hermes (no JIT) where rendering runs on-device.
 */
const decayStep = (rate: number) => Math.exp(-rate / SAMPLE_RATE);
/** Cheap one-pole low-pass coefficient; accurate enough for musical filtering. */
const lpCoef = (cutoff: number) => {
  const x = (TAU * cutoff) / SAMPLE_RATE;
  return x / (1 + x);
};
const saw = (phase: number) => ((phase / TAU) % 1) * 2 - 1;

const KICK_SECONDS = 0.35;
const SNARE_SECONDS = 0.25;
const HAT_SECONDS = 0.08;

function releaseSeconds(sound: ToneSound): number {
  if (sound === 'pad') return 0.45;
  if (sound === 'piano' || sound === 'epiano') return 0.35;
  return sound === '808' ? 0.08 : 0.06;
}

function addKick(buf: LoopBuffer, start: number, style: DrumStyle, gain: number) {
  const n = buf.length;
  const len = Math.round(KICK_SECONDS * SAMPLE_RATE);
  const amp = decayStep(style === 'house' ? 7 : style === 'lofi' ? 11 : 9);
  const sweep = decayStep(35);
  const noise = createNoise(7);
  const clickLen = 0.003 * SAMPLE_RATE;
  let phase = 0;
  let env = gain;
  let pitch = 110;
  for (let i = 0, j = start % n; i < len; i++, j = j + 1 === n ? 0 : j + 1) {
    phase += (TAU * (45 + pitch)) / SAMPLE_RATE;
    pitch *= sweep;
    buf[j] += Math.sin(phase) * env + (i < clickLen ? noise() * 0.3 * gain : 0);
    env *= amp;
  }
}

function addSnare(buf: LoopBuffer, start: number, style: DrumStyle, gain: number) {
  const n = buf.length;
  const len = Math.round(SNARE_SECONDS * SAMPLE_RATE);
  const noise = createNoise(start + 3);
  const clap = style === 'trap' || style === 'house';
  const burstGap = Math.round(0.011 * SAMPLE_RATE);
  const burst = decayStep(180);
  const tail = decayStep(clap ? 16 : style === 'lofi' ? 26 : style === 'dembow' ? 90 : 20);
  const tone = decayStep(style === 'dembow' ? 55 : 30);
  const toneFreq = style === 'dembow' ? 820 : 185;
  const coef = lpCoef(style === 'lofi' ? 3500 : 7000);
  let prev = 0;
  let lp = 0;
  let burstEnv = 0;
  let tailEnv = 1;
  let toneEnv = 1;
  for (let i = 0, j = start % n; i < len; i++, j = j + 1 === n ? 0 : j + 1) {
    const x = noise();
    const bright = x - prev; // crude high-pass
    prev = x;
    let v: number;
    if (clap) {
      // A few quick bursts followed by a short tail.
      if (i % burstGap === 0 && i < burstGap * 3) burstEnv += 1;
      v = bright * (burstEnv + tailEnv * 0.45) * 0.55;
      burstEnv *= burst;
    } else if (style === 'dembow') {
      // Rim / woodblock
      v = Math.sin((TAU * toneFreq * i) / SAMPLE_RATE) * toneEnv * 0.6 + bright * tailEnv * 0.3;
    } else {
      lp += coef * (x - lp);
      v = lp * tailEnv * 0.7 + Math.sin((TAU * toneFreq * i) / SAMPLE_RATE) * toneEnv * 0.45;
    }
    buf[j] += v * gain;
    tailEnv *= tail;
    toneEnv *= tone;
  }
}

function addHat(buf: LoopBuffer, start: number, gain: number, decay = 70) {
  const n = buf.length;
  const len = Math.round(HAT_SECONDS * SAMPLE_RATE);
  const noise = createNoise(start + 11);
  const step = decayStep(decay);
  let env = gain;
  let prev = 0;
  for (let i = 0, j = start % n; i < len; i++, j = j + 1 === n ? 0 : j + 1) {
    const x = noise();
    buf[j] += (x - prev) * env;
    prev = x;
    env *= step;
  }
}

/** Decay rates (per second) of the main envelope `a` and a secondary envelope `b`, per sound. */
const TONE_DECAYS: Record<ToneSound, [a: number, b: number]> = {
  piano: [2.2, 3],
  epiano: [1.1, 12],
  pad: [0, 0],
  pluck: [5, 14],
  marimba: [7, 30],
  square: [0, 0],
  bell: [2.8, 5],
  saw: [0, 0],
  flute: [0, 0],
  finger: [3, 6],
  sub: [0, 0],
  '808': [0.9, 60],
  synth: [0, 12],
};

/** Renders one pitched note. `dur` is the held length in seconds; the release rings past it. */
function addTone(buf: LoopBuffer, start: number, dur: number, midi: number, sound: ToneSound, gain: number) {
  const n = buf.length;
  const freq = midiToFreq(midi);
  const release = releaseSeconds(sound);
  const len = Math.round((dur + release) * SAMPLE_RATE);
  const holdSamples = Math.round(dur * SAMPLE_RATE);
  const attackSamples = (sound === 'pad' ? 0.25 : sound === 'flute' ? 0.03 : 0.004) * SAMPLE_RATE;
  const vibratoStart = 0.2 * SAMPLE_RATE;
  const hasVibrato = sound === 'flute' || sound === 'square';
  const releaseStep = decayStep(5 / release);
  const [rateA, rateB] = TONE_DECAYS[sound];
  const stepA = decayStep(rateA);
  const stepB = decayStep(rateB);
  const inc = (TAU * freq) / SAMPLE_RATE;
  const fixedCoef = lpCoef(sound === 'pad' ? 1400 : sound === 'square' ? 2200 : sound === 'saw' ? 2800 : 1800);
  const noise = sound === 'flute' ? createNoise(midi * 31) : null;

  let phase = 0;
  let phase2 = 0;
  let lp = 0;
  let lp2 = 0;
  let a = 1;
  let b = 1;
  let rel = 1;

  for (let i = 0, j = start % n; i < len; i++, j = j + 1 === n ? 0 : j + 1) {
    let f = inc;
    if (hasVibrato && i > vibratoStart) f *= 1 + 0.004 * Math.sin((TAU * 5.2 * i) / SAMPLE_RATE);
    if (sound === '808') f *= 1 + 0.5 * b; // punchy pitch drop
    phase += f;
    phase2 += f * 1.006;

    let v: number;
    switch (sound) {
      case 'piano': {
        const s1 = Math.sin(phase);
        v = (s1 + 0.5 * Math.sin(2 * phase) * b + 0.25 * Math.sin(3 * phase) * b * b) * a * 0.6;
        break;
      }
      case 'epiano':
        v = (Math.sin(phase) + 0.3 * Math.sin(4 * phase) * b) * a * 0.7;
        break;
      case 'pad':
        lp += fixedCoef * ((saw(phase) + saw(phase2)) * 0.5 - lp);
        v = lp * 0.8;
        break;
      case 'pluck':
        lp += lpCoef(300 + 4500 * b) * ((saw(phase) + saw(phase2)) * 0.5 - lp);
        v = lp * a * 1.1;
        break;
      case 'marimba':
        v = (Math.sin(phase) + 0.35 * Math.sin(4 * phase) * b) * a;
        break;
      case 'square':
        lp += fixedCoef * ((Math.sin(phase) >= 0 ? 1 : -1) - lp);
        v = lp * 0.35;
        break;
      case 'bell':
        v = Math.sin(phase + 1.4 * b * Math.sin(3.5 * phase)) * a;
        break;
      case 'saw':
        lp += fixedCoef * ((saw(phase) + saw(phase2)) * 0.5 - lp);
        v = lp * 0.55;
        break;
      case 'flute':
        lp2 += fixedCoef * (noise!() - lp2);
        v = (Math.sin(phase) + 0.12 * Math.sin(2 * phase) + lp2 * 0.08) * 0.8;
        break;
      case 'finger':
        v = (Math.sin(phase) + 0.35 * Math.sin(2 * phase) * b) * (0.55 + 0.45 * a);
        break;
      case 'sub':
        v = Math.sin(phase) + 0.18 * Math.sin(2 * phase);
        break;
      case '808':
        v = Math.tanh(2.4 * Math.sin(phase)) * a * 0.8;
        break;
      case 'synth':
        lp += lpCoef(350 + 1200 * b) * (saw(phase) - lp);
        v = lp * 1.2;
        break;
    }
    const attack = i < attackSamples ? i / attackSamples : 1;
    buf[j] += v * attack * rel * gain;
    a *= stepA;
    b *= stepB;
    if (i >= holdSamples) rel *= releaseStep;
  }
}

type Stem = 'drums' | 'bass' | 'chords' | 'melody';

type RenderContext = {
  length: number;
  stepSamples: number;
  at: (step: number) => number;
};

function contextFor(pattern: Pattern): RenderContext {
  const mood = getMood(pattern.moodId);
  const length = Math.round(loopSeconds(pattern.bpm) * SAMPLE_RATE);
  const stepSamples = length / TOTAL_STEPS;
  const swing = mood.swing * stepSamples;
  return {
    length,
    stepSamples,
    at: (step) => Math.round(step * stepSamples + (step % 2 === 1 ? swing : 0)),
  };
}

function renderStem(pattern: Pattern, stem: Stem, ctx: RenderContext): Float32Array {
  const mood = getMood(pattern.moodId);
  const { length, stepSamples, at } = ctx;
  const stepSeconds = stepSamples / SAMPLE_RATE;
  const out: LoopBuffer = new Float32Array(length);

  // Identical hits (same drum, or same note and length) are rendered once and
  // pasted wherever they occur, which keeps on-device rendering fast.
  const clips = new Map<string, Float32Array>();
  const clip = (key: string, seconds: number, render: (target: Float32Array) => void) => {
    let c = clips.get(key);
    if (!c) {
      c = new Float32Array(Math.round(seconds * SAMPLE_RATE));
      render(c);
      clips.set(key, c);
    }
    return c;
  };
  const paste = (source: Float32Array, start: number, gain: number) => {
    for (let i = 0, j = start % length; i < source.length; i++, j = j + 1 === length ? 0 : j + 1) {
      out[j] += source[i] * gain;
    }
  };
  const addEvents = (events: NoteEvent[], sound: ToneSound, gain: number) => {
    for (const e of events) {
      const dur = e.length * stepSeconds * 0.95;
      const note = clip(`${e.midi}:${e.length}`, dur + releaseSeconds(sound), (c) =>
        addTone(c, 0, dur, e.midi, sound, 1),
      );
      paste(note, at(e.step), gain);
    }
  };

  switch (stem) {
    case 'drums': {
      const style = mood.drums;
      const quiet = style === 'lofi' ? 0.75 : 1;
      const kick = clip('kick', KICK_SECONDS, (c) => addKick(c, 0, style, 1));
      const snare = clip('snare', SNARE_SECONDS, (c) => addSnare(c, 0, style, 1));
      const hat = clip('hat', HAT_SECONDS, (c) => addHat(c, 0, 1));
      const openHat = clip('openHat', HAT_SECONDS, (c) => addHat(c, 0, 1, 22));
      for (let bar = 0; bar < TOTAL_STEPS / STEPS_PER_BAR; bar++) {
        for (let s = 0; s < STEPS_PER_BAR; s++) {
          const start = at(bar * STEPS_PER_BAR + s);
          if (pattern.drums.kick[s]) paste(kick, start, 0.95 * quiet);
          if (pattern.drums.snare[s]) paste(snare, start, 0.7 * quiet);
          const hit = pattern.drums.hat[s];
          if (hit) {
            const gain = (s % 4 === 0 ? 0.32 : 0.24) * quiet;
            const open = style === 'house' && s % 4 === 2;
            paste(open ? openHat : hat, start, gain);
            if (hit === 2) {
              // Trap-style roll: an extra 32nd-note hit.
              paste(hat, start + Math.round(stepSamples / 2), gain * 0.8);
            }
          }
        }
      }
      break;
    }
    case 'bass':
      addEvents(pattern.bass, mood.sounds.bass, mood.sounds.bass === '808' ? 0.75 : 0.6);
      break;
    case 'chords':
      addEvents(pattern.chords, mood.sounds.chord, mood.drums === 'ballad' ? 0.3 : 0.2);
      break;
    case 'melody': {
      addEvents(pattern.melody, mood.sounds.lead, 0.36);
      // Dotted-8th echo for a bit of space.
      const lead = out.slice();
      const delay = Math.round(stepSamples * 3);
      for (let i = 0, d1 = length - delay, d2 = length - 2 * delay; i < length; i++) {
        out[i] += lead[d1] * 0.28 + lead[d2] * 0.1;
        d1 = d1 + 1 === length ? 0 : d1 + 1;
        d2 = d2 + 1 === length ? 0 : d2 + 1;
      }
      break;
    }
  }
  return out;
}

/** The parts of a pattern each stem depends on, used as its cache key. */
function stemKey(pattern: Pattern, stem: Stem): string {
  const base = `${pattern.moodId}|${pattern.bpm}|`;
  switch (stem) {
    case 'drums':
      return base + JSON.stringify(pattern.drums);
    case 'bass':
      return base + JSON.stringify(pattern.bass);
    case 'chords':
      return base + JSON.stringify(pattern.chords);
    case 'melody':
      return base + JSON.stringify(pattern.melody);
  }
}

const STEMS: Stem[] = ['drums', 'bass', 'chords', 'melody'];

/**
 * Creates a renderer that remembers each part's audio, so muting a part or
 * rerolling a single part only re-renders what actually changed.
 */
export function createRenderer() {
  const cache = new Map<Stem, { key: string; audio: Float32Array }>();
  return (pattern: Pattern): Float32Array => {
    const ctx = contextFor(pattern);
    const out = new Float32Array(ctx.length);
    for (const stem of STEMS) {
      if (pattern.muted[stem]) continue;
      const key = stemKey(pattern, stem);
      let entry = cache.get(stem);
      if (!entry || entry.key !== key) {
        entry = { key, audio: renderStem(pattern, stem, ctx) };
        cache.set(stem, entry);
      }
      const audio = entry.audio;
      for (let i = 0; i < out.length; i++) out[i] += audio[i];
    }
    // Normalize with gentle soft clipping.
    let peak = 0;
    for (let i = 0; i < out.length; i++) {
      const v = out[i] < 0 ? -out[i] : out[i];
      if (v > peak) peak = v;
    }
    const scale = peak > 0 ? 1.1 / peak : 1;
    for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * scale) * 0.92;
    return out;
  };
}

export function renderPattern(pattern: Pattern): Float32Array {
  return createRenderer()(pattern);
}

export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}
