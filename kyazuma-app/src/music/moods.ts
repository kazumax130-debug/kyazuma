import type { ScaleType } from './theory';

export type MoodId = 'pop' | 'chill' | 'emo' | 'trap' | 'edm' | 'tropical';
export type DrumStyle = 'pop' | 'lofi' | 'ballad' | 'trap' | 'house' | 'dembow';
export type ChordSound = 'piano' | 'epiano' | 'pad' | 'pluck' | 'marimba';
export type LeadSound = 'square' | 'bell' | 'saw' | 'flute';
export type BassSound = 'finger' | 'sub' | '808' | 'synth';

export type Progression = {
  name: string;
  tip: string;
  /** One chord per bar, as scale degrees (0 = I). */
  degrees: number[];
};

export type Mood = {
  id: MoodId;
  label: string;
  emoji: string;
  description: string;
  color: string;
  bpm: [number, number];
  scale: ScaleType;
  sevenths: boolean;
  /** Swing amount for off-beat 16ths, 0 = straight. */
  swing: number;
  drums: DrumStyle;
  sounds: { chord: ChordSound; lead: LeadSound; bass: BassSound };
  progressions: Progression[];
};

const MAJOR_PROGRESSIONS: Record<string, Progression> = {
  axis: {
    name: 'アクシス進行',
    tip: '洋楽ポップで一番よく使われる、明るく前向きな進行です。',
    degrees: [0, 4, 5, 3],
  },
  royal: {
    name: '王道進行',
    tip: 'J-POPの定番。明るさの中に少し切なさがある響きです。',
    degrees: [3, 4, 2, 5],
  },
  komuro: {
    name: '小室進行',
    tip: '90年代J-POPでおなじみ。疾走感があって盛り上がります。',
    degrees: [5, 3, 4, 0],
  },
  oldies: {
    name: 'ドゥーワップ進行',
    tip: '50年代から愛される、なつかしくて温かい進行です。',
    degrees: [0, 5, 3, 4],
  },
  twoFive: {
    name: 'ツーファイブワン',
    tip: 'ジャズの基本形。おしゃれで落ち着いた雰囲気になります。',
    degrees: [1, 4, 0, 0],
  },
  stylish: {
    name: 'おしゃれ進行',
    tip: 'IVから始まる浮遊感のある進行。ローファイやシティポップで人気です。',
    degrees: [3, 2, 1, 0],
  },
};

const MINOR_PROGRESSIONS: Record<string, Progression> = {
  epic: {
    name: '泣きのマイナー進行',
    tip: '切ないロックやEDMの定番。エモーショナルに盛り上がります。',
    degrees: [0, 5, 2, 6],
  },
  dark: {
    name: 'ダーク進行',
    tip: 'Im → VII → VI の下降。暗くて力強い雰囲気です。',
    degrees: [0, 6, 5, 6],
  },
  rise: {
    name: '上昇マイナー進行',
    tip: 'VI → VII → Im と上がっていく、盛り上がりを作る進行です。',
    degrees: [5, 6, 0, 0],
  },
  sad: {
    name: 'しっとり進行',
    tip: 'Im → IVm の行き来で、しっとり哀愁のある響きです。',
    degrees: [0, 3, 6, 2],
  },
  loop: {
    name: '2コードループ',
    tip: 'たった2つのコードの繰り返し。トラップやヒップホップでよく使います。',
    degrees: [0, 0, 5, 5],
  },
};

export const MOODS: Mood[] = [
  {
    id: 'pop',
    label: '元気・ポップ',
    emoji: '☀️',
    description: '明るくてノリのいい曲',
    color: '#FBBF24',
    bpm: [116, 128],
    scale: 'major',
    sevenths: false,
    swing: 0,
    drums: 'pop',
    sounds: { chord: 'piano', lead: 'square', bass: 'finger' },
    progressions: [MAJOR_PROGRESSIONS.axis, MAJOR_PROGRESSIONS.royal, MAJOR_PROGRESSIONS.komuro, MAJOR_PROGRESSIONS.oldies],
  },
  {
    id: 'chill',
    label: 'チル・ローファイ',
    emoji: '☕',
    description: 'ゆったり作業用BGM',
    color: '#A78BFA',
    bpm: [72, 86],
    scale: 'major',
    sevenths: true,
    swing: 0.18,
    drums: 'lofi',
    sounds: { chord: 'epiano', lead: 'bell', bass: 'sub' },
    progressions: [MAJOR_PROGRESSIONS.stylish, MAJOR_PROGRESSIONS.twoFive, MAJOR_PROGRESSIONS.royal],
  },
  {
    id: 'emo',
    label: '切ない・エモ',
    emoji: '🌙',
    description: '夜に聴きたいバラード',
    color: '#60A5FA',
    bpm: [76, 92],
    scale: 'minor',
    sevenths: false,
    swing: 0,
    drums: 'ballad',
    sounds: { chord: 'piano', lead: 'flute', bass: 'sub' },
    progressions: [MINOR_PROGRESSIONS.epic, MINOR_PROGRESSIONS.sad, MINOR_PROGRESSIONS.rise],
  },
  {
    id: 'trap',
    label: 'ダーク・トラップ',
    emoji: '🔥',
    description: '重低音のヒップホップ',
    color: '#F87171',
    bpm: [132, 150],
    scale: 'minor',
    sevenths: false,
    swing: 0,
    drums: 'trap',
    sounds: { chord: 'pad', lead: 'bell', bass: '808' },
    progressions: [MINOR_PROGRESSIONS.loop, MINOR_PROGRESSIONS.dark, MINOR_PROGRESSIONS.epic],
  },
  {
    id: 'edm',
    label: 'ダンス・EDM',
    emoji: '🪩',
    description: '四つ打ちで踊れる曲',
    color: '#34D399',
    bpm: [122, 128],
    scale: 'minor',
    sevenths: false,
    swing: 0,
    drums: 'house',
    sounds: { chord: 'pluck', lead: 'saw', bass: 'synth' },
    progressions: [MINOR_PROGRESSIONS.epic, MINOR_PROGRESSIONS.rise, MINOR_PROGRESSIONS.dark],
  },
  {
    id: 'tropical',
    label: '夏・トロピカル',
    emoji: '🏝️',
    description: '南国っぽいゆるいノリ',
    color: '#FB923C',
    bpm: [96, 108],
    scale: 'major',
    sevenths: false,
    swing: 0,
    drums: 'dembow',
    sounds: { chord: 'marimba', lead: 'flute', bass: 'sub' },
    progressions: [MAJOR_PROGRESSIONS.axis, MAJOR_PROGRESSIONS.oldies, MAJOR_PROGRESSIONS.royal],
  },
];

export function getMood(id: MoodId): Mood {
  return MOODS.find((m) => m.id === id) ?? MOODS[0];
}
