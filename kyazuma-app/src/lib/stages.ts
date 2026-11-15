import type { StageId } from './types';

export type Stage = {
  id: StageId;
  label: string;
  color: string;
};

export const STAGES: Stage[] = [
  { id: 'idea', label: 'アイデア', color: '#9CA3AF' },
  { id: 'compose', label: '作曲', color: '#60A5FA' },
  { id: 'arrange', label: '編曲', color: '#818CF8' },
  { id: 'record', label: '録音', color: '#F472B6' },
  { id: 'mix', label: 'ミックス', color: '#FBBF24' },
  { id: 'master', label: 'マスタリング', color: '#FB923C' },
  { id: 'done', label: '完成', color: '#34D399' },
];

/** Common tasks per stage, offered as one-tap suggestions on the task tab. */
export const STAGE_TASK_TEMPLATES: Record<StageId, string[]> = {
  idea: ['リファレンス曲を集める', 'コンセプトを決める', 'ボイスメモを整理'],
  compose: ['コード進行を決める', 'メロディを作る', 'サビを固める', '歌詞を書く'],
  arrange: ['構成を決める', 'ドラムを打ち込む', 'ベースライン', '上モノ・シンセ', 'デモを書き出す'],
  record: ['ボーカル録り', 'ギター録り', 'テイク選び・編集', 'ピッチ・タイミング補正'],
  mix: ['ゲインステージング', 'ボーカル処理', '空間系（リバーブ・ディレイ）', 'オートメーション', 'リファレンスと比較'],
  master: ['ラウドネス調整', '書き出し（WAV / MP3）', '各デバイスで試聴'],
  done: ['配信登録', 'ジャケット', 'SNS告知'],
};

export function getStage(id: StageId): Stage {
  return STAGES.find((s) => s.id === id) ?? STAGES[0];
}

/** Overall progress of a song from 0 to 1, based on its stage. */
export function stageProgress(id: StageId): number {
  const index = STAGES.findIndex((s) => s.id === id);
  return Math.max(index, 0) / (STAGES.length - 1);
}
