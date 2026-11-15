import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { daysUntil, deadlineLabel } from '@/lib/format';
import { getStage, stageProgress } from '@/lib/stages';
import type { Song } from '@/lib/types';

import { StageChip } from './StageChip';
import { colors, radius, spacing } from './theme';

export function SongCard({ song }: { song: Song }) {
  const stage = getStage(song.stage);
  const doneTasks = song.tasks.filter((t) => t.done).length;
  const deadline = song.stage === 'done' ? null : deadlineLabel(song.deadline);
  const days = daysUntil(song.deadline);
  const urgent = days !== null && days <= 3;
  const meta = [song.bpm ? `${song.bpm} BPM` : null, song.key || null]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/song/[id]', params: { id: song.id } })}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={1}>
            {song.title}
          </Text>
          {song.artist ? (
            <Text style={styles.artist} numberOfLines={1}>
              {song.artist}
            </Text>
          ) : null}
        </View>
        <StageChip label={stage.label} color={stage.color} />
      </View>

      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${stageProgress(song.stage) * 100}%`, backgroundColor: stage.color },
          ]}
        />
      </View>

      <View style={styles.footer}>
        <Text style={styles.meta}>{meta || 'BPM・キー未設定'}</Text>
        <View style={styles.footerRight}>
          {song.tasks.length > 0 ? (
            <Text style={styles.meta}>
              ✓ {doneTasks}/{song.tasks.length}
            </Text>
          ) : null}
          {deadline ? (
            <Text style={[styles.meta, urgent && styles.urgent]}>{deadline}</Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  pressed: {
    backgroundColor: colors.surfaceRaised,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  artist: {
    color: colors.textMuted,
    fontSize: 13,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerRight: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 12,
  },
  urgent: {
    color: colors.danger,
    fontWeight: '700',
  },
});
