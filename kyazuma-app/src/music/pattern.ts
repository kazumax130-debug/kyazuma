import type { MoodId, Progression } from './moods';

export const STEPS_PER_BAR = 16;
export const BARS = 4;
export const TOTAL_STEPS = STEPS_PER_BAR * BARS;

export type PartId = 'drums' | 'bass' | 'chords' | 'melody';

export type NoteEvent = {
  /** Start position in 16th-note steps from the loop start (0-63). */
  step: number;
  /** Length in 16th-note steps. */
  length: number;
  midi: number;
};

/** One bar of 16 steps, repeated every bar. 0 = off, 1 = hit, 2 = roll (hi-hat only). */
export type DrumPattern = {
  kick: number[];
  snare: number[];
  hat: number[];
};

export type DrumLane = keyof DrumPattern;

export type Pattern = {
  version: 1;
  moodId: MoodId;
  bpm: number;
  keyRoot: number;
  progression: Progression;
  drums: DrumPattern;
  bass: NoteEvent[];
  chords: NoteEvent[];
  melody: NoteEvent[];
  muted: Record<PartId, boolean>;
};

export function loopSeconds(bpm: number): number {
  return (TOTAL_STEPS * 60) / bpm / 4;
}
