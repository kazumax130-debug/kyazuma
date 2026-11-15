import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SongCard } from '@/components/SongCard';
import { StageChip } from '@/components/StageChip';
import { colors, radius, spacing } from '@/components/theme';
import { daysUntil, parseDate } from '@/lib/format';
import { STAGES } from '@/lib/stages';
import { useSongs } from '@/lib/store';
import type { Song, StageId } from '@/lib/types';

/** Songs with a deadline come first (earliest first), then most recently updated. */
function compareSongs(a: Song, b: Song): number {
  const da = parseDate(a.deadline)?.getTime() ?? Infinity;
  const db = parseDate(b.deadline)?.getTime() ?? Infinity;
  if (da !== db) return da - db;
  return b.updatedAt - a.updatedAt;
}

export default function SongsScreen() {
  const { songs, loaded } = useSongs();
  const [filter, setFilter] = useState<StageId | 'all'>('all');
  const insets = useSafeAreaInsets();

  const visible = useMemo(
    () => songs.filter((s) => filter === 'all' || s.stage === filter).sort(compareSongs),
    [songs, filter],
  );

  const inProgress = songs.filter((s) => s.stage !== 'done').length;
  const done = songs.length - inProgress;
  const dueSoon = songs.filter((s) => {
    const days = daysUntil(s.deadline);
    return s.stage !== 'done' && days !== null && days <= 7;
  }).length;

  return (
    <View style={styles.container}>
      <View style={styles.stats}>
        <Stat label="制作中" value={inProgress} />
        <Stat label="完成" value={done} />
        <Stat label="締切7日以内" value={dueSoon} highlight={dueSoon > 0} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterBar}
        contentContainerStyle={styles.filters}
      >
        <StageChip
          label="すべて"
          color={colors.accent}
          selected={filter === 'all'}
          onPress={() => setFilter('all')}
        />
        {STAGES.map((stage) => (
          <StageChip
            key={stage.id}
            label={stage.label}
            color={stage.color}
            selected={filter === stage.id}
            onPress={() => setFilter(stage.id)}
          />
        ))}
      </ScrollView>

      <FlatList
        data={visible}
        keyExtractor={(song) => song.id}
        renderItem={({ item }) => <SongCard song={item} />}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 96 }]}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListEmptyComponent={
          loaded ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>
                {songs.length === 0 ? 'まだ曲がありません' : 'このステージの曲はありません'}
              </Text>
              {songs.length === 0 ? (
                <Text style={styles.emptyText}>「つくる」タブで曲のタネを作ってみましょう</Text>
              ) : null}
            </View>
          ) : null
        }
      />

      <Pressable
        accessibilityLabel="曲を追加"
        onPress={() => router.push('/new')}
        style={({ pressed }) => [
          styles.fab,
          { bottom: insets.bottom + spacing.xl },
          pressed && { opacity: 0.8 },
        ]}
      >
        <Text style={styles.fabIcon}>＋</Text>
      </Pressable>
    </View>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, highlight && { color: colors.danger }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  stats: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 11,
  },
  filterBar: {
    flexGrow: 0,
  },
  filters: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  list: {
    paddingHorizontal: spacing.lg,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 64,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  fab: {
    position: 'absolute',
    right: spacing.xl,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 8px rgba(0, 0, 0, 0.3)',
  },
  fabIcon: {
    color: colors.accentText,
    fontSize: 28,
    fontWeight: '700',
  },
});
