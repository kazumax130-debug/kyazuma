import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, radius, spacing } from './theme';

type Props = TextInputProps & {
  label: string;
  hint?: string | null;
  hintColor?: string;
};

export function Field({ label, hint, hintColor, style, ...inputProps }: Props) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textMuted}
        style={[styles.input, inputProps.multiline && styles.multiline, style]}
        {...inputProps}
      />
      {hint ? <Text style={[styles.hint, hintColor ? { color: hintColor } : null]}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.xs,
  },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  multiline: {
    minHeight: 240,
    textAlignVertical: 'top',
    lineHeight: 24,
  },
  hint: {
    color: colors.textMuted,
    fontSize: 12,
  },
});
