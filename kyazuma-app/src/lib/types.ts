import type { Pattern } from '@/music/pattern';

export type StageId =
  | 'idea'
  | 'compose'
  | 'arrange'
  | 'record'
  | 'mix'
  | 'master'
  | 'done';

export type Task = {
  id: string;
  title: string;
  done: boolean;
};

export type Song = {
  id: string;
  title: string;
  artist: string;
  stage: StageId;
  bpm: number | null;
  key: string;
  /** Deadline as YYYY-MM-DD, or empty when not set. */
  deadline: string;
  tasks: Task[];
  lyrics: string;
  notes: string;
  /** The loop made on the create screen, if the song started there. */
  pattern?: Pattern;
  createdAt: number;
  updatedAt: number;
};
