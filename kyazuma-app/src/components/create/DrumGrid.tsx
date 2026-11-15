import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '@/components/theme';
import { STEPS_PER_BAR, type DrumLane, type DrumPattern } from '@/music/pattern';

const LANES: { id: DrumLane; label: string; color: string }[] = [
  { id: 'hat', label: 'ハイハット', color: '#FBBF24' },
  { id: 'snare', label: 'スネア', color: '#F472B6' },
  { id: 'kick', label: 'キック', color: '#60A5FA' },
];

type Props = {
  drums: DrumPattern;
  /** Step within the bar (0-15) currently playing, or null when stopped. */
  playhead: number | null;
  onToggle: (lane: DrumLane, step: number) => void;
};

export const DrumGrid = memo(function DrumGrid({ drums, playhead, onToggle }: Props) {
  return (
    <View style={styles.grid}>
      {LANES.map((lane) => (
        <View key={lane.id} style={styles.lane}>
          <Text style={styles.laneLabel}>{lane.label}</Text>
          <View style={styles.cells}>
            {Array.from({ length: STEPS_PER_BAR }, (_, step) => {
              const on = drums[lane.id][step] > 0;
              return (
                <Pressable
                  key={step}
                  onPress={() => onToggle(lane.id, step)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${lane.label} ${step + 1}`}
                  style={[
                    styles.cell,
                    step % 4 === 0 && styles.beatCell,
                    step > 0 && step % 4 === 0 && styles.beatGap,
                    on && { backgroundColor: lane.color, borderColor: lane.color },
                    playhead === step && styles.playhead,
                  ]}
                />
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  grid: {
    gap: spacing.sm,
  },
  lane: {
    gap: 4,
  },
  laneLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  cells: {
    flexDirection: 'row',
    gap: 3,
  },
  cell: {
    flex: 1,
    aspectRatio: 0.8,
    borderRadius: 4,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.surfaceRaised,
  },
  beatCell: {
    borderColor: colors.border,
  },
  beatGap: {
    marginLeft: 5,
  },
  playhead: {
    borderColor: colors.text,
    borderWidth: 2,
  },
});
