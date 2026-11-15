import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Field } from '@/components/Field';
import { colors, radius, spacing } from '@/components/theme';
import { useSongs } from '@/lib/store';

export default function NewSongScreen() {
  const { addSong } = useSongs();
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const canSave = title.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    const song = addSong({ title: title.trim(), artist: artist.trim() });
    router.replace({ pathname: '/song/[id]', params: { id: song.id } });
  };

  return (
    <View style={styles.container}>
      <Field
        label="曲名"
        value={title}
        onChangeText={setTitle}
        placeholder="例: Midnight Drive"
        autoFocus
        returnKeyType="next"
      />
      <Field
        label="アーティスト / 依頼元（任意）"
        value={artist}
        onChangeText={setArtist}
        placeholder="例: 自分名義、〇〇さん提供曲"
        returnKeyType="done"
        onSubmitEditing={save}
      />
      <Pressable
        onPress={save}
        disabled={!canSave}
        style={({ pressed }) => [
          styles.button,
          !canSave && styles.buttonDisabled,
          pressed && { opacity: 0.8 },
        ]}
      >
        <Text style={styles.buttonText}>作成する</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: colors.accentText,
    fontSize: 16,
    fontWeight: '700',
  },
});
