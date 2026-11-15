import { getMood, type DrumStyle, type Mood, type MoodId } from './moods';
import {
  STEPS_PER_BAR,
  type DrumPattern,
  type NoteEvent,
  type PartId,
  type Pattern,
} from './pattern';
import { buildChord, degreeToMidi, SCALES, type Chord } from './theory';

type Random = () => number;

function pick<T>(items: readonly T[], random: Random = Math.random): T {
  return items[Math.floor(random() * items.length)];
}

function randInt(min: number, max: number, random: Random = Math.random): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** Parses "x..x" style strings: "." = off, "x" = hit, "r" = roll. */
function steps(template: string): number[] {
  return [...template].map((c) => (c === 'x' ? 1 : c === 'r' ? 2 : 0));
}

const DRUM_TEMPLATES: Record<DrumStyle, { kick: string[]; snare: string[]; hat: string[] }> = {
  pop: {
    kick: ['x.......x.x.....', 'x.....x...x.....', 'x.......x.......', 'x..x....x.x.....'],
    snare: ['....x.......x...', '....x.......x..x'],
    hat: ['x.x.x.x.x.x.x.x.', 'xxxxxxxxxxxxxxxx', 'x.xxx.xxx.xxx.xx'],
  },
  lofi: {
    kick: ['x.........x.....', 'x......x..x.....', 'x.....x...x...x.'],
    snare: ['....x.......x...', '....x.......x.x.'],
    hat: ['x.x.x.x.x.x.x.x.', 'x.x.x.xxx.x.x.x.', 'x...x.x.x...x.x.'],
  },
  ballad: {
    kick: ['x.......x.......', 'x......xx.......', 'x.......x.....x.'],
    snare: ['....x.......x...'],
    hat: ['x.x.x.x.x.x.x.x.', 'x...x...x...x...'],
  },
  trap: {
    kick: ['x......x..x.....', 'x.....x.......x.', 'x.........x..x..', 'x..x......x.....'],
    snare: ['........x.......'],
    hat: ['x.x.x.x.x.x.xrxr', 'xxx.x.x.xxx.x.rr', 'x.x.x.x.xrx.x.x.', 'x.x.xrx.x.x.x.x.'],
  },
  house: {
    kick: ['x...x...x...x...'],
    snare: ['....x.......x...', '....x.......x..x'],
    hat: ['..x...x...x...x.', '..x...x...x...xx', 'x.x.x.x.x.x.x.x.'],
  },
  dembow: {
    kick: ['x...x...x...x...', 'x.......x.......'],
    snare: ['...x..x....x..x.', '...x..x.....x.x.'],
    hat: ['x.x.x.x.x.x.x.x.', 'x...x...x...x...'],
  },
};

type BassNote = [step: number, length: number, tone: 'r' | 'f' | 'o'];

const BASS_TEMPLATES: Record<Exclude<DrumStyle, 'trap'>, BassNote[][]> = {
  pop: [
    [[0, 2, 'r'], [2, 2, 'r'], [4, 2, 'r'], [6, 2, 'r'], [8, 2, 'r'], [10, 2, 'r'], [12, 2, 'r'], [14, 2, 'o']],
    [[0, 3, 'r'], [3, 3, 'r'], [6, 2, 'r'], [8, 3, 'r'], [11, 3, 'r'], [14, 2, 'f']],
  ],
  lofi: [
    [[0, 6, 'r'], [6, 4, 'r'], [10, 6, 'f']],
    [[0, 8, 'r'], [10, 6, 'r']],
  ],
  ballad: [
    [[0, 8, 'r'], [8, 8, 'f']],
    [[0, 16, 'r']],
  ],
  house: [
    [[2, 2, 'r'], [6, 2, 'r'], [10, 2, 'r'], [14, 2, 'r']],
    [[2, 2, 'r'], [6, 2, 'o'], [10, 2, 'r'], [14, 2, 'o']],
  ],
  dembow: [
    [[0, 3, 'r'], [3, 5, 'r'], [8, 3, 'r'], [11, 5, 'f']],
    [[0, 6, 'r'], [6, 2, 'r'], [8, 8, 'f']],
  ],
};

type ChordHit = [step: number, length: number];

const CHORD_RHYTHMS: Record<DrumStyle, ChordHit[][]> = {
  pop: [
    [[0, 8], [8, 8]],
    [[0, 3], [3, 3], [6, 2], [8, 3], [11, 3], [14, 2]],
    [[0, 6], [6, 4], [10, 6]],
  ],
  lofi: [[[0, 10], [10, 6]], [[0, 16]], [[0, 6], [6, 10]]],
  ballad: [], // arpeggiated, see generateChords
  trap: [[[0, 16]]],
  house: [
    [[2, 2], [6, 2], [10, 2], [14, 2]],
    [[0, 3], [3, 3], [6, 4], [10, 3], [13, 3]],
  ],
  dembow: [
    [[0, 3], [3, 5], [8, 3], [11, 5]],
    [[2, 2], [6, 2], [10, 2], [14, 2]],
  ],
};

/** How busy the melody is: onset probability on 8th and 16th off-beats. */
const MELODY_DENSITY: Record<DrumStyle, { p8: number; p16: number; maxLen: number }> = {
  pop: { p8: 0.55, p16: 0.12, maxLen: 4 },
  lofi: { p8: 0.4, p16: 0.05, maxLen: 6 },
  ballad: { p8: 0.35, p16: 0, maxLen: 8 },
  trap: { p8: 0.45, p16: 0.1, maxLen: 4 },
  house: { p8: 0.6, p16: 0.18, maxLen: 3 },
  dembow: { p8: 0.5, p16: 0.08, maxLen: 4 },
};

export function chordsOf(pattern: Pick<Pattern, 'moodId' | 'keyRoot' | 'progression'>): Chord[] {
  const mood = getMood(pattern.moodId);
  return pattern.progression.degrees.map((d) =>
    buildChord(d, pattern.keyRoot, mood.scale, mood.sevenths),
  );
}

function generateDrums(mood: Mood): DrumPattern {
  const t = DRUM_TEMPLATES[mood.drums];
  return { kick: steps(pick(t.kick)), snare: steps(pick(t.snare)), hat: steps(pick(t.hat)) };
}

/** A chord's root as a MIDI note in the bass register, between E2 (40) and D#3 (51). */
function bassRoot(chord: Chord, keyRoot: number, mood: Mood): number {
  const pc = (keyRoot + SCALES[mood.scale][chord.degree % 7]) % 12;
  return 40 + ((pc + 8) % 12);
}

function generateBass(mood: Mood, chords: Chord[], keyRoot: number, drums: DrumPattern): NoteEvent[] {
  const events: NoteEvent[] = [];
  if (mood.drums === 'trap') {
    // 808s follow the kick drum and ring until the next kick.
    const kicks = drums.kick.flatMap((v, i) => (v ? [i] : []));
    chords.forEach((chord, bar) => {
      const root = bassRoot(chord, keyRoot, mood);
      kicks.forEach((step, i) => {
        const next = kicks[i + 1] ?? STEPS_PER_BAR;
        events.push({ step: bar * STEPS_PER_BAR + step, length: next - step, midi: root });
      });
    });
    return events;
  }
  const template = pick(BASS_TEMPLATES[mood.drums]);
  chords.forEach((chord, bar) => {
    const root = bassRoot(chord, keyRoot, mood);
    const fifth = root + (degreeToMidi(chord.degree + 4, 0, mood.scale) - degreeToMidi(chord.degree, 0, mood.scale));
    for (const [step, length, tone] of template) {
      const midi = tone === 'r' ? root : tone === 'f' ? fifth : root + 12;
      events.push({ step: bar * STEPS_PER_BAR + step, length, midi });
    }
  });
  return events;
}

function voiceChord(chord: Chord, keyRoot: number, mood: Mood): number[] {
  return chord.tones
    .map((t) => {
      let m = degreeToMidi(t, 48 + keyRoot, mood.scale);
      while (m < 53) m += 12;
      while (m > 65) m -= 12;
      return m;
    })
    .sort((a, b) => a - b);
}

function generateChords(mood: Mood, chords: Chord[], keyRoot: number): NoteEvent[] {
  const events: NoteEvent[] = [];
  if (mood.drums === 'ballad') {
    // Arpeggio: 8th notes walking up and down the chord.
    const order = pick([
      [0, 1, 2, 3, 2, 1, 0, 1],
      [0, 2, 1, 3, 0, 2, 1, 3],
      [0, 1, 2, 1, 3, 2, 1, 2],
    ]);
    chords.forEach((chord, bar) => {
      const notes = voiceChord(chord, keyRoot, mood);
      const tones = [...notes, notes[0] + 12];
      order.forEach((index, i) => {
        events.push({ step: bar * STEPS_PER_BAR + i * 2, length: 4, midi: tones[index % tones.length] });
      });
    });
    return events;
  }
  const rhythm = pick(CHORD_RHYTHMS[mood.drums]);
  chords.forEach((chord, bar) => {
    const notes = voiceChord(chord, keyRoot, mood);
    for (const [step, length] of rhythm) {
      for (const midi of notes) events.push({ step: bar * STEPS_PER_BAR + step, length, midi });
    }
  });
  return events;
}

function nearestChordTone(degree: number, chord: Chord): number {
  const tones = chord.tones.map((t) => t % 7);
  for (let distance = 0; distance < 7; distance++) {
    for (const candidate of [degree - distance, degree + distance]) {
      if (tones.includes(((candidate % 7) + 7) % 7)) return candidate;
    }
  }
  return degree;
}

function generateMelody(mood: Mood, chords: Chord[], keyRoot: number): NoteEvent[] {
  const density = MELODY_DENSITY[mood.drums];
  const phraseSteps = STEPS_PER_BAR * 2;

  // Rhythm for a 2-bar phrase, reused for the second phrase so the melody feels intentional.
  const onsets: number[] = [];
  for (let s = 0; s < phraseSteps; s++) {
    const nearEnd = s >= phraseSteps - 4;
    const p = s === 0 ? 1 : s % 4 === 0 ? 0.7 : s % 2 === 0 ? density.p8 : density.p16;
    if (Math.random() < (nearEnd ? p * 0.3 : p)) onsets.push(s);
  }

  const base = keyRoot <= 5 ? 60 + keyRoot : 48 + keyRoot;
  const clamp = (d: number) => Math.max(0, Math.min(9, d));
  const events: NoteEvent[] = [];
  let degree = nearestChordTone(randInt(2, 5), chords[0]);
  let firstPhrase: number[] = [];

  for (let phrase = 0; phrase < 2; phrase++) {
    const degrees: number[] = [];
    onsets.forEach((s, i) => {
      const step = phrase * phraseSteps + s;
      const chord = chords[Math.floor(step / STEPS_PER_BAR)];
      if (phrase === 1 && firstPhrase[i] !== undefined && Math.random() < 0.7) {
        // Echo the first phrase's contour, re-fitted to the new chords on strong beats.
        degree = s % 4 === 0 ? nearestChordTone(firstPhrase[i], chord) : firstPhrase[i];
      } else if (s % 4 === 0) {
        degree = nearestChordTone(degree + randInt(-2, 2), chord);
      } else {
        degree += pick([-2, -1, -1, 1, 1, 2]);
      }
      degree = clamp(degree);
      degrees.push(degree);
    });
    if (phrase === 1 && degrees.length > 0) {
      // Land the loop on the last chord's root so it resolves nicely.
      const last = chords[chords.length - 1];
      degrees[degrees.length - 1] = clamp(nearestChordTone(degrees[degrees.length - 1], { ...last, tones: [last.degree] }));
    }
    firstPhrase = degrees;
    onsets.forEach((s, i) => {
      const next = onsets[i + 1] ?? phraseSteps;
      events.push({
        step: phrase * phraseSteps + s,
        length: Math.max(1, Math.min(next - s, density.maxLen)),
        midi: degreeToMidi(degrees[i], base, mood.scale),
      });
    });
  }
  return events;
}

export function generatePattern(moodId: MoodId): Pattern {
  const mood = getMood(moodId);
  const keyRoot = randInt(0, 11);
  const progression = pick(mood.progressions);
  const partial = { moodId, keyRoot, progression };
  const chords = chordsOf(partial);
  const drums = generateDrums(mood);
  return {
    version: 1,
    ...partial,
    bpm: randInt(mood.bpm[0], mood.bpm[1]),
    drums,
    bass: generateBass(mood, chords, keyRoot, drums),
    chords: generateChords(mood, chords, keyRoot),
    melody: generateMelody(mood, chords, keyRoot),
    muted: { drums: false, bass: false, chords: false, melody: false },
  };
}

/** Returns a copy of the pattern with one part replaced by a fresh random variation. */
export function rerollPart(pattern: Pattern, part: PartId | 'progression'): Pattern {
  const mood = getMood(pattern.moodId);
  if (part === 'progression') {
    const others = mood.progressions.filter((p) => p.name !== pattern.progression.name);
    const progression = pick(others.length > 0 ? others : mood.progressions);
    const next = { ...pattern, progression };
    const chords = chordsOf(next);
    return {
      ...next,
      bass: generateBass(mood, chords, pattern.keyRoot, pattern.drums),
      chords: generateChords(mood, chords, pattern.keyRoot),
      melody: generateMelody(mood, chords, pattern.keyRoot),
    };
  }
  const chords = chordsOf(pattern);
  switch (part) {
    case 'drums': {
      const drums = generateDrums(mood);
      // Trap 808s follow the kick, so they change with the drums.
      const bass = mood.drums === 'trap' ? generateBass(mood, chords, pattern.keyRoot, drums) : pattern.bass;
      return { ...pattern, drums, bass };
    }
    case 'bass':
      return { ...pattern, bass: generateBass(mood, chords, pattern.keyRoot, pattern.drums) };
    case 'chords':
      return { ...pattern, chords: generateChords(mood, chords, pattern.keyRoot) };
    case 'melody':
      return { ...pattern, melody: generateMelody(mood, chords, pattern.keyRoot) };
  }
}

/** Moves the whole song to another key, keeping every note's relative position. */
export function transpose(pattern: Pattern, semitones: number): Pattern {
  // Keep the key root in 0-11 and pick the octave direction that stays closest.
  const shift = ((((semitones % 12) + 12) % 12) + 6) % 12 - 6;
  const move = (events: NoteEvent[]) => events.map((e) => ({ ...e, midi: e.midi + shift }));
  return {
    ...pattern,
    keyRoot: (pattern.keyRoot + shift + 12) % 12,
    bass: move(pattern.bass),
    chords: move(pattern.chords),
    melody: move(pattern.melody),
  };
}

export function randomKeyShift(): number {
  return pick([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6]);
}

export function toggleDrumStep(pattern: Pattern, lane: keyof DrumPattern, step: number): Pattern {
  const row = [...pattern.drums[lane]];
  row[step] = row[step] ? 0 : 1;
  const drums = { ...pattern.drums, [lane]: row };
  const mood = getMood(pattern.moodId);
  // Trap 808s follow the kick drum.
  const bass =
    mood.drums === 'trap' && lane === 'kick'
      ? generateBass(mood, chordsOf(pattern), pattern.keyRoot, drums)
      : pattern.bass;
  return { ...pattern, drums, bass };
}
