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

interface AudioPlayerContextType {
  currentSong: Song | null;
  isPlaying: boolean;
  progress: number;     // 0-100
  currentTime: number;  // seconds
  duration: number;     // seconds
  volume: number;       // 0-1
  queue: Song[];
  radioMode: boolean;
  play: (song: Song) => void;
  pause: () => void;
  resume: () => void;
  togglePlay: (song: Song) => void;
  next: () => void;
  previous: () => void;
  seek: (percent: number) => void;
  setVolume: (vol: number) => void;
  setQueue: (songs: Song[]) => void;
  addToQueue: (song: Song) => void;
  toggleRadioMode: () => void;
}

const AudioPlayerContext = createContext<AudioPlayerContextType>({
  currentSong: null,
  isPlaying: false,
  progress: 0,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
  queue: [],
  radioMode: false,
  play: () => {},
  pause: () => {},
  resume: () => {},
  togglePlay: () => {},
  next: () => {},
  previous: () => {},
  seek: () => {},
  setVolume: () => {},
  setQueue: () => {},
  addToQueue: () => {},
  toggleRadioMode: () => {},
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
  const [radioMode, setRadioMode] = useState(false);
  const [history, setHistory] = useState<Song[]>([]);

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
        setIsPlaying(false);
        // Auto-play next in queue
        if (queue.length > 0) {
          const nextSong = queue[0];
          setQueue((q) => q.slice(1));
          playSong(nextSong);
        }
      });
    }
  }, []);

  // Update ended handler when queue changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleEnded = () => {
      setIsPlaying(false);
      if (queue.length > 0) {
        const nextSong = queue[0];
        setQueue((q) => q.slice(1));
        playSong(nextSong);
      }
    };

    audio.removeEventListener("ended", handleEnded);
    audio.addEventListener("ended", handleEnded);
    return () => audio.removeEventListener("ended", handleEnded);
  }, [queue]);

  const playSong = useCallback(
    (song: Song) => {
      const audio = audioRef.current;
      if (!audio) return;

      if (currentSong) {
        setHistory((h) => [currentSong, ...h.slice(0, 49)]);
      }

      audio.src = song.audio_url;
      audio.play().catch(console.error);
      setCurrentSong(song);
      setIsPlaying(true);

      // Track play count
      incrementPlay(song.uuid).catch(() => {});
    },
    [currentSong]
  );

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
      if (currentSong?.uuid === song.uuid) {
        if (isPlaying) pause();
        else resume();
      } else {
        playSong(song);
      }
    },
    [currentSong, isPlaying, pause, resume, playSong]
  );

  const next = useCallback(() => {
    if (queue.length > 0) {
      const nextSong = queue[0];
      setQueue((q) => q.slice(1));
      playSong(nextSong);
    }
  }, [queue, playSong]);

  const previous = useCallback(() => {
    if (history.length > 0) {
      const prevSong = history[0];
      setHistory((h) => h.slice(1));
      if (currentSong) {
        setQueue((q) => [currentSong, ...q]);
      }
      playSong(prevSong);
    }
  }, [history, currentSong, playSong]);

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

  const toggleRadioMode = useCallback(() => {
    setRadioMode((r) => !r);
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
        radioMode,
        play: playSong,
        pause,
        resume,
        togglePlay,
        next,
        previous,
        seek,
        setVolume,
        setQueue,
        addToQueue,
        toggleRadioMode,
      }}
    >
      {children}
    </AudioPlayerContext.Provider>
  );
}

export function useAudioPlayer() {
  return useContext(AudioPlayerContext);
}
