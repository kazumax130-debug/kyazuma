import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Field } from '@/components/Field';
import { StageChip } from '@/components/StageChip';
import { colors, radius, spacing } from '@/components/theme';
import { daysUntil, deadlineLabel, newId, parseDate } from '@/lib/format';
import { getStage, STAGE_TASK_TEMPLATES, STAGES } from '@/lib/stages';
import { useSong, useSongs } from '@/lib/store';
import type { Song } from '@/lib/types';
import { chordsOf } from '@/music/generate';
import { getMood } from '@/music/moods';
import type { Pattern } from '@/music/pattern';
import { useLoopPlayer } from '@/music/useLoopPlayer';

type Tab = 'overview' | 'tasks' | 'lyrics' | 'notes';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: '概要' },
  { id: 'tasks', label: 'タスク' },
  { id: 'lyrics', label: '歌詞' },
  { id: 'notes', label: 'メモ' },
];

type Update = (patch: Partial<Song>) => void;

export default function SongScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const song = useSong(id);
  const { updateSong, deleteSong, loaded } = useSongs();
  const [tab, setTab] = useState<Tab>('overview');

  if (!song) {
    return (
      <View style={styles.missing}>
        <Text style={styles.muted}>{loaded ? '曲が見つかりません' : '読み込み中…'}</Text>
      </View>
    );
  }

  const update: Update = (patch) => updateSong(song.id, patch);

  const confirmDelete = () => {
    const remove = () => {
      deleteSong(song.id);
      router.back();
    };
    const message = `「${song.title}」を削除しますか？この操作は取り消せません。`;
    if (Platform.OS === 'web') {
      if (window.confirm(message)) remove();
      return;
    }
    Alert.alert('曲を削除', message, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: remove },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}
    >
      <Stack.Screen
        options={{
          title: song.title,
          headerRight: () => (
            <Pressable onPress={confirmDelete} hitSlop={8}>
              <Text style={styles.deleteText}>削除</Text>
            </Pressable>
          ),
        }}
      />

      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable
            key={t.id}
            onPress={() => setTab(t.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.id }}
            style={[styles.tab, tab === t.id && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === t.id && styles.tabTextActive]}>
              {t.label}
              {t.id === 'tasks' && song.tasks.length > 0
                ? ` ${song.tasks.filter((x) => x.done).length}/${song.tasks.length}`
                : ''}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {tab === 'overview' && <Overview song={song} update={update} />}
        {tab === 'tasks' && <Tasks song={song} update={update} />}
        {tab === 'lyrics' && (
          <Field
            label="歌詞"
            value={song.lyrics}
            onChangeText={(lyrics) => update({ lyrics })}
            placeholder={'[Verse 1]\n…\n\n[Chorus]\n…'}
            multiline
          />
        )}
        {tab === 'notes' && (
          <Field
            label="メモ"
            value={song.notes}
            onChangeText={(notes) => update({ notes })}
            placeholder="使った音源・プラグイン、リファレンス曲、フィードバックなど"
            multiline
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Overview({ song, update }: { song: Song; update: Update }) {
  // BPM is edited as text so partial input (e.g. "1") doesn't get normalized away.
  const [bpmText, setBpmText] = useState(song.bpm ? String(song.bpm) : '');

  const onBpmChange = (text: string) => {
    const digits = text.replace(/[^0-9.]/g, '');
    setBpmText(digits);
    const value = Number(digits);
    update({ bpm: digits && Number.isFinite(value) && value > 0 ? value : null });
  };

  const deadlineValid = song.deadline === '' || parseDate(song.deadline) !== null;
  const days = daysUntil(song.deadline);
  const deadlineHint = !deadlineValid
    ? 'YYYY-MM-DD の形式で入力してください'
    : deadlineLabel(song.deadline);

  return (
    <View style={styles.section}>
      {song.pattern ? <LoopCard songId={song.id} pattern={song.pattern} /> : null}
      <Field
        label="曲名"
        value={song.title}
        onChangeText={(title) => update({ title })}
        placeholder="曲名"
      />
      <Field
        label="アーティスト / 依頼元"
        value={song.artist}
        onChangeText={(artist) => update({ artist })}
        placeholder="任意"
      />

      <View style={styles.fieldGroup}>
        <Text style={styles.groupLabel}>ステージ</Text>
        <View style={styles.stageGrid}>
          {STAGES.map((stage) => (
            <StageChip
              key={stage.id}
              label={stage.label}
              color={stage.color}
              selected={song.stage === stage.id}
              onPress={() => update({ stage: stage.id })}
            />
          ))}
        </View>
      </View>

      <View style={styles.row}>
        <View style={styles.rowItem}>
          <Field
            label="BPM"
            value={bpmText}
            onChangeText={onBpmChange}
            placeholder="120"
            keyboardType="decimal-pad"
          />
        </View>
        <View style={styles.rowItem}>
          <Field
            label="キー"
            value={song.key}
            onChangeText={(key) => update({ key })}
            placeholder="例: C#m"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </View>

      <Field
        label="締め切り"
        value={song.deadline}
        onChangeText={(deadline) => update({ deadline })}
        placeholder="2026-12-31"
        keyboardType="numbers-and-punctuation"
        hint={deadlineHint}
        hintColor={!deadlineValid || (days !== null && days <= 3) ? colors.danger : undefined}
      />

      <Text style={styles.muted}>
        作成 {new Date(song.createdAt).toLocaleDateString('ja-JP')} ・ 更新{' '}
        {new Date(song.updatedAt).toLocaleString('ja-JP')}
      </Text>
    </View>
  );
}

function LoopCard({ songId, pattern }: { songId: string; pattern: Pattern }) {
  const { load, stop, playing, rendering } = useLoopPlayer();
  const mood = getMood(pattern.moodId);

  useFocusEffect(useCallback(() => () => stop(), [stop]));

  return (
    <View style={[styles.loopCard, { borderColor: mood.color }]}>
      <Pressable
        onPress={() => (playing ? stop() : load(pattern, { play: true }))}
        accessibilityLabel={playing ? '停止' : '再生'}
        style={[styles.loopPlay, { backgroundColor: mood.color }]}
      >
        <Text style={styles.loopPlayIcon}>{rendering ? '…' : playing ? '■' : '▶'}</Text>
      </Pressable>
      <View style={styles.loopInfo}>
        <Text style={styles.loopTitle}>
          {mood.emoji} {mood.label}のループ
        </Text>
        <Text style={styles.muted}>{chordsOf(pattern).map((c) => c.name).join(' → ')}</Text>
      </View>
      <Pressable
        onPress={() => {
          stop();
          router.navigate({ pathname: '/', params: { songId } });
        }}
        style={styles.loopEdit}
      >
        <Text style={styles.loopEditText}>編集</Text>
      </Pressable>
    </View>
  );
}

function Tasks({ song, update }: { song: Song; update: Update }) {
  const [draft, setDraft] = useState('');
  const stage = getStage(song.stage);
  const existing = new Set(song.tasks.map((t) => t.title));
  const suggestions = STAGE_TASK_TEMPLATES[song.stage].filter((t) => !existing.has(t));

  const addTask = (title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    update({ tasks: [...song.tasks, { id: newId(), title: trimmed, done: false }] });
  };

  const submitDraft = () => {
    addTask(draft);
    setDraft('');
  };

  return (
    <View style={styles.section}>
      <View style={styles.addRow}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submitDraft}
          placeholder="タスクを追加"
          placeholderTextColor={colors.textMuted}
          returnKeyType="done"
          submitBehavior="submit"
          style={styles.addInput}
        />
        <Pressable onPress={submitDraft} style={styles.addButton}>
          <Text style={styles.addButtonText}>追加</Text>
        </Pressable>
      </View>

      {song.tasks.length === 0 ? (
        <Text style={styles.muted}>まだタスクがありません</Text>
      ) : (
        <View style={styles.taskList}>
          {song.tasks.map((task) => (
            <View key={task.id} style={styles.taskRow}>
              <Pressable
                onPress={() =>
                  update({
                    tasks: song.tasks.map((t) =>
                      t.id === task.id ? { ...t, done: !t.done } : t,
                    ),
                  })
                }
                accessibilityRole="checkbox"
                accessibilityState={{ checked: task.done }}
                style={styles.taskToggle}
              >
                <View style={[styles.checkbox, task.done && styles.checkboxDone]}>
                  {task.done ? <Text style={styles.checkmark}>✓</Text> : null}
                </View>
                <Text style={[styles.taskTitle, task.done && styles.taskTitleDone]}>
                  {task.title}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => update({ tasks: song.tasks.filter((t) => t.id !== task.id) })}
                accessibilityLabel={`${task.title}を削除`}
                hitSlop={8}
              >
                <Text style={styles.removeText}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {suggestions.length > 0 ? (
        <View style={styles.fieldGroup}>
          <Text style={styles.groupLabel}>「{stage.label}」の定番タスク</Text>
          <View style={styles.stageGrid}>
            {suggestions.map((title) => (
              <Pressable
                key={title}
                onPress={() => addTask(title)}
                style={[styles.suggestion, { borderColor: stage.color }]}
              >
                <Text style={[styles.suggestionText, { color: stage.color }]}>＋ {title}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  deleteText: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: '600',
  },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.xs,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  tabActive: {
    backgroundColor: colors.surfaceRaised,
  },
  tabText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: colors.text,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 64,
  },
  section: {
    gap: spacing.lg,
  },
  fieldGroup: {
    gap: spacing.sm,
  },
  groupLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  stageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowItem: {
    flex: 1,
  },
  muted: {
    color: colors.textMuted,
    fontSize: 12,
  },
  addRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  addInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  addButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  addButtonText: {
    color: colors.accentText,
    fontWeight: '700',
  },
  taskList: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  taskToggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkmark: {
    color: colors.accentText,
    fontSize: 13,
    fontWeight: '800',
  },
  taskTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
  },
  taskTitleDone: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  removeText: {
    color: colors.textMuted,
    fontSize: 20,
    paddingHorizontal: spacing.sm,
  },
  loopCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  loopPlay: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loopPlayIcon: {
    color: colors.accentText,
    fontSize: 18,
    fontWeight: '800',
  },
  loopInfo: {
    flex: 1,
    gap: 2,
  },
  loopTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  loopEdit: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  loopEditText: {
    color: colors.text,
    fontWeight: '700',
  },
  suggestion: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  suggestionText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
