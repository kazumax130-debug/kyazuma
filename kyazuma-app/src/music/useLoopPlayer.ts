import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, type AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import { writeLoopFile } from './audioFile';
import { loopSeconds, TOTAL_STEPS, type Pattern } from './pattern';
import { createRenderer, encodeWav } from './render';

/** Swaps in new audio and keeps it looping. Kept outside the hook since it mutates the player. */
function loadLoop(player: AudioPlayer, uri: string) {
  player.replace({ uri });
  player.loop = true;
}

/**
 * Renders patterns to audio and plays them as a seamless loop. When the
 * pattern changes during playback, the new audio picks up at the same point
 * in the loop so edits are heard without restarting.
 */
export function useLoopPlayer() {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const renderer = useRef(createRenderer());
  const loaded = useRef<{ key: string; bpm: number } | null>(null);
  const generation = useRef(0);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);

  const load = useCallback(
    async (pattern: Pattern, options: { play?: boolean } = {}) => {
      const key = JSON.stringify(pattern);
      if (loaded.current?.key === key) {
        if (options.play) player.play();
        return;
      }
      const current = ++generation.current;
      setRendering(true);
      // Give the UI a frame to show the loading state before the synchronous render.
      await new Promise((resolve) => setTimeout(resolve, 16));
      if (current !== generation.current) return;

      const wasPlaying = player.playing;
      const previous = loaded.current;
      const progress =
        wasPlaying && previous ? (player.currentTime % loopSeconds(previous.bpm)) / loopSeconds(previous.bpm) : 0;

      const uri = writeLoopFile(encodeWav(renderer.current(pattern)));
      loaded.current = { key, bpm: pattern.bpm };
      loadLoop(player, uri);
      if (wasPlaying || options.play) {
        if (progress > 0) player.seekTo(progress * loopSeconds(pattern.bpm)).catch(() => {});
        player.play();
      }
      setRendering(false);
    },
    [player],
  );

  const stop = useCallback(() => {
    player.pause();
    player.seekTo(0).catch(() => {});
  }, [player]);

  return { player, load, stop, rendering, playing: status.playing };
}

/** Current 16th-note step (0-63) of a playing loop, or null when stopped. */
export function usePlayhead(player: AudioPlayer, bpm: number, playing: boolean): number | null {
  const [step, setStep] = useState<number | null>(null);
  useEffect(() => {
    if (!playing) return;
    const seconds = loopSeconds(bpm);
    const id = setInterval(() => {
      const position = (player.currentTime % seconds) / seconds;
      setStep(Math.floor(position * TOTAL_STEPS) % TOTAL_STEPS);
    }, 50);
    return () => clearInterval(id);
  }, [player, bpm, playing]);
  return playing ? step : null;
}
