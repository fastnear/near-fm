"use client";

import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import type { Song } from "@/types";
import { incrementPlay } from "@/lib/api";

type PlayMode = "radio" | "repeat" | "none";

interface AudioPlayerContextType {
  currentSong: Song | null;
  isPlaying: boolean;
  progress: number;     // 0-100
  currentTime: number;  // seconds
  duration: number;     // seconds
  volume: number;       // 0-1
  queue: Song[];
  playMode: PlayMode;
  play: (song: Song) => void;
  pause: () => void;
  resume: () => void;
  togglePlay: (song: Song) => void;
  playFromFeed: (song: Song, allSongs: Song[]) => void;
  next: () => void;
  previous: () => void;
  seek: (percent: number) => void;
  setVolume: (vol: number) => void;
  setQueue: (songs: Song[]) => void;
  addToQueue: (song: Song) => void;
  setPlayMode: (mode: PlayMode) => void;
  setFeedSongs: (songs: Song[]) => void;
}

const AudioPlayerContext = createContext<AudioPlayerContextType>({
  currentSong: null,
  isPlaying: false,
  progress: 0,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
  queue: [],
  playMode: "radio",
  play: () => {},
  pause: () => {},
  resume: () => {},
  togglePlay: () => {},
  playFromFeed: () => {},
  next: () => {},
  previous: () => {},
  seek: () => {},
  setVolume: () => {},
  setQueue: () => {},
  addToQueue: () => {},
  setPlayMode: () => {},
  setFeedSongs: () => {},
});

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [queue, setQueue] = useState<Song[]>([]);
  const [playMode, setPlayMode] = useState<PlayMode>("radio");
  const [history, setHistory] = useState<Song[]>([]);
  const feedSongsRef = useRef<Song[]>([]);

  // Refs for latest values (used in event handlers)
  const queueRef = useRef(queue);
  const playModeRef = useRef(playMode);
  const currentSongRef = useRef(currentSong);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { playModeRef.current = playMode; }, [playMode]);
  useEffect(() => { currentSongRef.current = currentSong; }, [currentSong]);

  const playSong = useCallback(
    (song: Song) => {
      const audio = audioRef.current;
      if (!audio) return;

      const cur = currentSongRef.current;
      if (cur) {
        setHistory((h) => [cur, ...h.slice(0, 49)]);
      }

      audio.src = song.audio_url;
      audio.play().catch(console.error);
      setCurrentSong(song);
      setIsPlaying(true);

      // Track play count
      incrementPlay(song.uuid).catch(() => {});
    },
    []
  );

  // Initialize audio element
  useEffect(() => {
    if (typeof window !== "undefined" && !audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.volume = 0.8;

      audioRef.current.addEventListener("timeupdate", () => {
        const a = audioRef.current!;
        if (a.duration) {
          setCurrentTime(a.currentTime);
          setProgress((a.currentTime / a.duration) * 100);
        }
      });

      audioRef.current.addEventListener("loadedmetadata", () => {
        setDuration(audioRef.current!.duration);
      });

      audioRef.current.addEventListener("ended", () => {
        const mode = playModeRef.current;
        const q = queueRef.current;
        const audio = audioRef.current!;

        if (mode === "repeat") {
          audio.currentTime = 0;
          audio.play().catch(console.error);
          return;
        }

        if (mode === "none") {
          setIsPlaying(false);
          return;
        }

        // Radio mode
        if (q.length > 0) {
          const nextSong = q[0];
          setQueue((prev) => prev.slice(1));
          playSong(nextSong);
        } else if (feedSongsRef.current.length > 0) {
          // Refill queue from feed songs and play first
          const feed = feedSongsRef.current;
          setQueue(feed.slice(1));
          playSong(feed[0]);
        } else {
          setIsPlaying(false);
        }
      });
    }
  }, [playSong]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setIsPlaying(false);
  }, []);

  const resume = useCallback(() => {
    audioRef.current?.play().catch(console.error);
    setIsPlaying(true);
  }, []);

  const togglePlay = useCallback(
    (song: Song) => {
      if (currentSongRef.current?.uuid === song.uuid) {
        if (isPlaying) pause();
        else resume();
      } else {
        playSong(song);
      }
    },
    [isPlaying, pause, resume, playSong]
  );

  const playFromFeed = useCallback(
    (song: Song, allSongs: Song[]) => {
      // Store all songs for looping
      feedSongsRef.current = allSongs;
      // Set queue to songs after the clicked one
      const idx = allSongs.findIndex((s) => s.uuid === song.uuid);
      const remaining = idx >= 0 ? allSongs.slice(idx + 1) : allSongs;
      setQueue(remaining);
      playSong(song);
    },
    [playSong]
  );

  const next = useCallback(() => {
    if (queue.length > 0) {
      const nextSong = queue[0];
      setQueue((q) => q.slice(1));
      playSong(nextSong);
    } else if (playMode === "radio" && feedSongsRef.current.length > 0) {
      const feed = feedSongsRef.current;
      setQueue(feed.slice(1));
      playSong(feed[0]);
    }
  }, [queue, playMode, playSong]);

  const previous = useCallback(() => {
    if (history.length > 0) {
      const prevSong = history[0];
      setHistory((h) => h.slice(1));
      const cur = currentSongRef.current;
      if (cur) {
        setQueue((q) => [cur, ...q]);
      }
      playSong(prevSong);
    }
  }, [history, playSong]);

  const seek = useCallback((percent: number) => {
    const audio = audioRef.current;
    if (audio && audio.duration) {
      audio.currentTime = (percent / 100) * audio.duration;
    }
  }, []);

  const setVolume = useCallback((vol: number) => {
    setVolumeState(vol);
    if (audioRef.current) {
      audioRef.current.volume = vol;
    }
  }, []);

  const addToQueue = useCallback((song: Song) => {
    setQueue((q) => [...q, song]);
  }, []);

  const setFeedSongs = useCallback((songs: Song[]) => {
    feedSongsRef.current = songs;
  }, []);

  return (
    <AudioPlayerContext.Provider
      value={{
        currentSong,
        isPlaying,
        progress,
        currentTime,
        duration,
        volume,
        queue,
        playMode,
        play: playSong,
        pause,
        resume,
        togglePlay,
        playFromFeed,
        next,
        previous,
        seek,
        setVolume,
        setQueue,
        addToQueue,
        setPlayMode,
        setFeedSongs,
      }}
    >
      {children}
    </AudioPlayerContext.Provider>
  );
}

export function useAudioPlayer() {
  return useContext(AudioPlayerContext);
}
