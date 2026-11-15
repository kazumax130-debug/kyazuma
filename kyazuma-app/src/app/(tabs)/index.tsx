import type { AudioPlayer } from 'expo-audio';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DrumGrid } from '@/components/create/DrumGrid';
import { colors, radius, spacing } from '@/components/theme';
import { useSongs } from '@/lib/store';
import { chordsOf, generatePattern, randomKeyShift, rerollPart, toggleDrumStep, transpose } from '@/music/generate';
import { getMood, MOODS, type Mood } from '@/music/moods';
import { STEPS_PER_BAR, type DrumLane, type PartId, type Pattern } from '@/music/pattern';
import { keyLabel, keyShort } from '@/music/theory';
import { useLoopPlayer, usePlayhead } from '@/music/useLoopPlayer';

const PARTS: { id: PartId; emoji: string; label: string; description: string }[] = [
  { id: 'drums', emoji: '🥁', label: 'ドラム', description: 'リズムの土台。曲のノリを決めます' },
  { id: 'bass', emoji: '🎸', label: 'ベース', description: '低い音で曲を下から支えます' },
  { id: 'chords', emoji: '🎹', label: 'コード', description: '和音で曲の雰囲気を決めます' },
  { id: 'melody', emoji: '🎤', label: 'メロディ', description: '口ずさめる、曲の主役です' },
];

const MIN_BPM = 60;
const MAX_BPM = 180;

export default function CreateScreen() {
  const { songId } = useLocalSearchParams<{ songId?: string }>();
  const { songs, addSong, updateSong } = useSongs();
  const editingSong = songs.find((s) => s.id === songId && s.pattern);
  const [pattern, setPattern] = useState<Pattern | null>(null);
  const { player, load, stop, rendering, playing } = useLoopPlayer();

  // Opened from a saved song: continue editing its loop. Only when switching
  // songs, not on every save of the same song.
  const [openedSongId, setOpenedSongId] = useState<string | undefined>();
  if (editingSong?.pattern && editingSong.id !== openedSongId) {
    setOpenedSongId(editingSong.id);
    setPattern(editingSong.pattern);
  }

  // Stop the music when leaving the tab.
  useFocusEffect(
    useCallback(() => {
      return () => stop();
    }, [stop]),
  );

  const change = useCallback(
    (next: Pattern, options?: { play?: boolean }) => {
      setPattern(next);
      load(next, options);
    },
    [load],
  );

  const pickMood = (mood: Mood) => {
    // A brand-new idea: stop editing the saved song (if any) so saving creates a new one.
    if (songId) router.setParams({ songId: undefined });
    change(generatePattern(mood.id), { play: true });
  };

  const togglePlay = () => {
    if (!pattern) return;
    if (playing) stop();
    else load(pattern, { play: true });
  };

  const toggleDrum = useCallback(
    (lane: DrumLane, step: number) => {
      if (pattern) change(toggleDrumStep(pattern, lane, step));
    },
    [pattern, change],
  );

  const save = () => {
    if (!pattern) return;
    const mood = getMood(pattern.moodId);
    const chordNames = chordsOf(pattern).map((c) => c.name).join(' → ');
    const info = {
      bpm: pattern.bpm,
      key: keyShort(pattern.keyRoot, mood.scale),
      pattern,
    };
    stop();
    if (editingSong) {
      updateSong(editingSong.id, info);
      router.push({ pathname: '/song/[id]', params: { id: editingSong.id } });
      return;
    }
    const song = addSong({
      title: `${mood.label}のアイデア`,
      artist: '',
      notes: `コード進行: ${chordNames}（${pattern.progression.name}）`,
      ...info,
    });
    router.push({ pathname: '/song/[id]', params: { id: song.id } });
  };

  const mood = pattern ? getMood(pattern.moodId) : null;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>
          {pattern ? 'イメージを変える' : 'どんな曲をつくりたい？'}
        </Text>
        {!pattern ? (
          <Text style={styles.lead}>
            イメージを選ぶだけで、ドラム・ベース・コード・メロディが自動でできあがります。
          </Text>
        ) : null}
        <View style={styles.moodGrid}>
          {MOODS.map((m) => {
            const selected = pattern?.moodId === m.id;
            return (
              <Pressable
                key={m.id}
                onPress={() => pickMood(m)}
                accessibilityRole="button"
                accessibilityLabel={m.label}
                style={({ pressed }) => [
                  styles.moodCard,
                  pattern && styles.moodCardCompact,
                  selected && { borderColor: m.color, backgroundColor: colors.surfaceRaised },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text style={pattern ? styles.moodEmojiSmall : styles.moodEmoji}>{m.emoji}</Text>
                <Text
                  style={[
                    styles.moodLabel,
                    pattern && styles.moodLabelCompact,
                    selected && { color: m.color },
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {m.label}
                </Text>
                {!pattern ? <Text style={styles.moodDescription}>{m.description}</Text> : null}
              </Pressable>
            );
          })}
        </View>

        {pattern && mood ? (
          <>
            <Text style={styles.hint}>
              💡 気に入らないところは 🎲 を押すと、別のパターンに変わります
            </Text>

            <Section title="テンポとキー">
              <View style={styles.row}>
                <View style={styles.flex}>
                  <Text style={styles.label}>テンポ（1分間の拍の数）</Text>
                  <View style={styles.stepper}>
                    <SmallButton
                      label="−"
                      accessibilityLabel="テンポを遅く"
                      onPress={() => change({ ...pattern, bpm: Math.max(MIN_BPM, pattern.bpm - 5) })}
                    />
                    <Text style={styles.bigValue}>{pattern.bpm}</Text>
                    <SmallButton
                      label="＋"
                      accessibilityLabel="テンポを速く"
                      onPress={() => change({ ...pattern, bpm: Math.min(MAX_BPM, pattern.bpm + 5) })}
                    />
                  </View>
                </View>
                <View style={styles.flex}>
                  <Text style={styles.label}>キー（曲の音の高さ）</Text>
                  <View style={styles.stepper}>
                    <Text style={styles.keyValue}>{keyLabel(pattern.keyRoot, mood.scale)}</Text>
                    <SmallButton
                      label="🎲"
                      accessibilityLabel="キーを変える"
                      onPress={() => change(transpose(pattern, randomKeyShift()))}
                    />
                  </View>
                </View>
              </View>
              <Text style={styles.note}>
                {mood.scale === 'major'
                  ? 'メジャーキーは明るく元気な響きになります。'
                  : 'マイナーキーは切なく、クールな響きになります。'}
              </Text>
            </Section>

            <Section
              title="コード進行"
              action={
                <SmallButton
                  label="🎲 別の進行"
                  accessibilityLabel="別のコード進行にする"
                  onPress={() => change(rerollPart(pattern, 'progression'))}
                />
              }
            >
              <View style={styles.chords}>
                {chordsOf(pattern).map((chord, i) => (
                  <View key={i} style={[styles.chordChip, { borderColor: mood.color }]}>
                    <Text style={styles.chordName}>{chord.name}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.progressionName}>{pattern.progression.name}</Text>
              <Text style={styles.note}>{pattern.progression.tip}</Text>
            </Section>

            <Section title="パート">
              {PARTS.map((part) => {
                const on = !pattern.muted[part.id];
                return (
                  <View key={part.id} style={styles.partRow}>
                    <Pressable
                      onPress={() =>
                        change({ ...pattern, muted: { ...pattern.muted, [part.id]: on } })
                      }
                      accessibilityRole="switch"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`${part.label}のオンオフ`}
                      style={[styles.partToggle, !on && styles.partOff]}
                    >
                      <Text style={styles.partEmoji}>{part.emoji}</Text>
                      <View style={styles.flex}>
                        <Text style={styles.partLabel}>
                          {part.label}
                          <Text style={styles.partState}>{on ? '  ON' : '  OFF'}</Text>
                        </Text>
                        <Text style={styles.partDescription}>{part.description}</Text>
                      </View>
                    </Pressable>
                    <SmallButton
                      label="🎲"
                      accessibilityLabel={`${part.label}を別のパターンにする`}
                      onPress={() => change(rerollPart(pattern, part.id))}
                    />
                  </View>
                );
              })}
            </Section>

            <Section title="ビートを自分でいじる">
              <Text style={styles.note}>マスをタップすると、その場所で音が鳴るようになります。</Text>
              <LiveDrumGrid
                pattern={pattern}
                player={player}
                playing={playing}
                onToggle={toggleDrum}
              />
            </Section>
          </>
        ) : null}
      </ScrollView>

      {pattern ? (
        <View style={styles.transport}>
          <Pressable
            onPress={togglePlay}
            accessibilityLabel={playing ? '停止' : '再生'}
            style={({ pressed }) => [styles.playButton, pressed && { opacity: 0.8 }]}
          >
            {rendering ? (
              <ActivityIndicator color={colors.accentText} />
            ) : (
              <Text style={styles.playIcon}>{playing ? '■' : '▶'}</Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => change(generatePattern(pattern.moodId), { play: true })}
            style={({ pressed }) => [styles.transportButton, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.transportText}>🎲 まるごと作り直す</Text>
          </Pressable>
          <Pressable
            onPress={save}
            style={({ pressed }) => [styles.saveButton, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.saveText}>{editingSong ? '上書き保存' : '保存'}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** Drum grid with a moving playhead; isolated so only it re-renders while playing. */
function LiveDrumGrid({
  pattern,
  player,
  playing,
  onToggle,
}: {
  pattern: Pattern;
  player: AudioPlayer;
  playing: boolean;
  onToggle: (lane: DrumLane, step: number) => void;
}) {
  const step = usePlayhead(player, pattern.bpm, playing);
  return (
    <DrumGrid
      drums={pattern.drums}
      playhead={step === null ? null : step % STEPS_PER_BAR}
      onToggle={onToggle}
    />
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

function SmallButton({
  label,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={6}
      style={({ pressed }) => [styles.smallButton, pressed && { backgroundColor: colors.border }]}
    >
      <Text style={styles.smallButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 120,
    gap: spacing.lg,
  },
  heading: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
  },
  lead: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: -spacing.sm,
  },
  moodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  moodCard: {
    width: '48.5%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    padding: spacing.md,
    gap: 2,
  },
  moodCardCompact: {
    width: '31%',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  moodEmoji: {
    fontSize: 30,
    marginBottom: spacing.xs,
  },
  moodEmojiSmall: {
    fontSize: 20,
  },
  moodLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  moodLabelCompact: {
    fontSize: 11,
    textAlign: 'center',
  },
  moodDescription: {
    color: colors.textMuted,
    fontSize: 12,
  },
  hint: {
    color: colors.textMuted,
    fontSize: 13,
  },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  flex: {
    flex: 1,
  },
  label: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  bigValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
    minWidth: 44,
    textAlign: 'center',
  },
  keyValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  note: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  chords: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chordChip: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  chordName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  progressionName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  partRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  partToggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  partOff: {
    opacity: 0.4,
  },
  partEmoji: {
    fontSize: 22,
  },
  partLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  partState: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '800',
  },
  partDescription: {
    color: colors.textMuted,
    fontSize: 12,
  },
  smallButton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 40,
    alignItems: 'center',
  },
  smallButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  transport: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.background,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: {
    color: colors.accentText,
    fontSize: 22,
    fontWeight: '800',
  },
  transportButton: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transportText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  saveButton: {
    height: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '700',
  },
});
