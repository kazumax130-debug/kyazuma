export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export type ScaleType = 'major' | 'minor';

export const SCALES: Record<ScaleType, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function keyLabel(root: number, scale: ScaleType): string {
  return `${NOTE_NAMES[root]} ${scale === 'major' ? 'メジャー' : 'マイナー'}`;
}

/** Short key notation for storage, e.g. "C" or "F#m". */
export function keyShort(root: number, scale: ScaleType): string {
  return `${NOTE_NAMES[root]}${scale === 'minor' ? 'm' : ''}`;
}

/**
 * MIDI note of a scale degree. Degrees may exceed 0-6 or go negative; they
 * wrap into neighbouring octaves. `baseMidi` is the MIDI note of degree 0.
 */
export function degreeToMidi(degree: number, baseMidi: number, scale: ScaleType): number {
  const steps = SCALES[scale];
  const octave = Math.floor(degree / 7);
  const index = ((degree % 7) + 7) % 7;
  return baseMidi + octave * 12 + steps[index];
}

export type Chord = {
  /** Scale degree of the chord root (0 = I). */
  degree: number;
  name: string;
  /** Chord tones as scale degrees relative to the key (root, 3rd, 5th[, 7th]). */
  tones: number[];
};

const QUALITY_NAMES: Record<string, string> = {
  '4,7': '',
  '3,7': 'm',
  '3,6': 'dim',
  '4,7,11': 'M7',
  '3,7,10': 'm7',
  '4,7,10': '7',
  '3,6,10': 'm7-5',
};

export function buildChord(
  degree: number,
  keyRoot: number,
  scale: ScaleType,
  sevenths: boolean,
): Chord {
  const tones = sevenths ? [degree, degree + 2, degree + 4, degree + 6] : [degree, degree + 2, degree + 4];
  const root = degreeToMidi(degree, 0, scale);
  const intervals = tones.slice(1).map((t) => degreeToMidi(t, 0, scale) - root);
  const quality = QUALITY_NAMES[intervals.join(',')] ?? '';
  return { degree, tones, name: NOTE_NAMES[(keyRoot + root) % 12] + quality };
}
