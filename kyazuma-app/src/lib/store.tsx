import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { newId } from './format';
import type { Song } from './types';

const STORAGE_KEY = 'kyazuma/songs/v1';

type NewSong = Pick<Song, 'title' | 'artist'> & Partial<Pick<Song, 'bpm' | 'key' | 'notes' | 'pattern'>>;

type SongsContextValue = {
  songs: Song[];
  loaded: boolean;
  addSong: (input: NewSong) => Song;
  updateSong: (id: string, patch: Partial<Omit<Song, 'id' | 'createdAt'>>) => void;
  deleteSong: (id: string) => void;
};

const SongsContext = createContext<SongsContextValue | null>(null);

export function SongsProvider({ children }: { children: ReactNode }) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loaded, setLoaded] = useState(false);
  const skipNextSave = useRef(true);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) setSongs(JSON.parse(raw) as Song[]);
      })
      .catch((error) => console.warn('Failed to load songs', error))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    // The first change after loading is the loaded data itself; don't write it back.
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(songs)).catch((error) =>
      console.warn('Failed to save songs', error),
    );
  }, [songs, loaded]);

  const addSong = useCallback((input: NewSong) => {
    const now = Date.now();
    const song: Song = {
      id: newId(),
      stage: 'idea',
      bpm: null,
      key: '',
      deadline: '',
      tasks: [],
      lyrics: '',
      notes: '',
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    setSongs((prev) => [song, ...prev]);
    return song;
  }, []);

  const updateSong = useCallback<SongsContextValue['updateSong']>((id, patch) => {
    setSongs((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s)),
    );
  }, []);

  const deleteSong = useCallback((id: string) => {
    setSongs((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const value = useMemo(
    () => ({ songs, loaded, addSong, updateSong, deleteSong }),
    [songs, loaded, addSong, updateSong, deleteSong],
  );

  return <SongsContext.Provider value={value}>{children}</SongsContext.Provider>;
}

export function useSongs(): SongsContextValue {
  const ctx = useContext(SongsContext);
  if (!ctx) throw new Error('useSongs must be used inside SongsProvider');
  return ctx;
}

export function useSong(id: string | undefined): Song | undefined {
  const { songs } = useSongs();
  return songs.find((s) => s.id === id);
}
