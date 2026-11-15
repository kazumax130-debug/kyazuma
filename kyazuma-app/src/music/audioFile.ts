import { File, Paths } from 'expo-file-system';

// Each render gets a new file name so the player never reuses a stale source.
// The previous file is still playing while the next one loads, so keep two.
const recent: File[] = [];
let counter = 0;

/** Saves WAV bytes to a temporary file and returns a URI the audio player can load. */
export function writeLoopFile(wav: Uint8Array): string {
  const file = new File(Paths.cache, `kyazuma-loop-${Date.now()}-${counter++}.wav`);
  file.create({ overwrite: true });
  file.write(wav);
  recent.push(file);
  while (recent.length > 2) {
    const old = recent.shift();
    try {
      old?.delete();
    } catch {
      // Already gone; nothing to clean up.
    }
  }
  return file.uri;
}
