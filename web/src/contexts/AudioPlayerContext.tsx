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
import { incrementPlay, radioSkip, getRadioPlaylist } from "@/lib/api";

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
  startRadio: (songs: Song[]) => void;
  isRadioActive: boolean;
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
  startRadio: () => {},
  isRadioActive: false,
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
  const [isRadioActive, setIsRadioActive] = useState(false);

  // Cross-tab sync: pause other tabs when this one starts playing
  const channelRef = useRef<BroadcastChannel | null>(null);
  const tabIdRef = useRef<string>("");
  const ignoreBroadcastRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    tabIdRef.current = Math.random().toString(36).slice(2);
    const ch = new BroadcastChannel("nearfm_audio");
    channelRef.current = ch;
    ch.onmessage = (e) => {
      if (e.data?.type === "playing" && e.data.tabId !== tabIdRef.current) {
        // Another tab started playing — pause this one
        audioRef.current?.pause();
        setIsPlaying(false);
      }
    };
    return () => ch.close();
  }, []);

  // Refs for latest values (used in event handlers)
  const queueRef = useRef(queue);
  const playModeRef = useRef(playMode);
  const currentSongRef = useRef(currentSong);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { playModeRef.current = playMode; }, [playMode]);
  useEffect(() => { currentSongRef.current = currentSong; }, [currentSong]);

  // Update Media Session metadata (CarPlay, lock screen, Bluetooth, AirPlay)
  const updateMediaSession = useCallback((song: Song) => {
    if (!("mediaSession" in navigator)) return;
    const artwork: MediaImage[] = [];
    if (song.cover_image_url) {
      artwork.push({ src: song.cover_image_url, sizes: "512x512", type: "image/jpeg" });
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.uploader_display_name || song.uploader_account_id,
      album: "NEAR FM",
      artwork,
    });
  }, []);

  // Update Media Session position state
  const updatePositionState = useCallback(() => {
    if (!("mediaSession" in navigator) || !audioRef.current) return;
    const audio = audioRef.current;
    if (audio.duration && isFinite(audio.duration)) {
      try {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate,
          position: Math.min(audio.currentTime, audio.duration),
        });
      } catch { /* ignore */ }
    }
  }, []);

  const playSong = useCallback(
    (song: Song, { skipHistory = false }: { skipHistory?: boolean } = {}) => {
      const audio = audioRef.current;
      if (!audio) return;

      if (!skipHistory) {
        const cur = currentSongRef.current;
        if (cur) {
          setHistory((h) => [cur, ...h.slice(0, 49)]);
        }
      }

      audio.src = song.audio_url;
      audio.play().catch(console.error);
      setCurrentSong(song);
      setIsPlaying(true);
      updateMediaSession(song);

      // Notify other tabs to pause
      channelRef.current?.postMessage({ type: "playing", tabId: tabIdRef.current });

      // Track play count
      incrementPlay(song.uuid).catch(() => {});
    },
    [updateMediaSession]
  );

  // Initialize audio element
  useEffect(() => {
    if (typeof window !== "undefined" && !audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.volume = 0.8;

      audioRef.current.addEventListener("timeupdate", () => {
        const a = audioRef.current!;
        const dur = isFinite(a.duration) && a.duration > 0
          ? a.duration
          : currentSongRef.current?.audio_duration_seconds || 0;
        if (dur > 0) {
          setCurrentTime(a.currentTime);
          setProgress((a.currentTime / dur) * 100);
          updatePositionState();
        }
      });

      audioRef.current.addEventListener("loadedmetadata", () => {
        const d = audioRef.current!.duration;
        if (isFinite(d) && d > 0) {
          setDuration(d);
        } else if (currentSongRef.current?.audio_duration_seconds) {
          setDuration(currentSongRef.current.audio_duration_seconds);
        }
        updatePositionState();
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
          // Refill queue from feed songs, skip current song to avoid repeat
          const currentUuid = currentSongRef.current?.uuid;
          const feed = feedSongsRef.current.filter(s => s.uuid !== currentUuid);
          if (feed.length > 0) {
            setQueue(feed.slice(1));
            playSong(feed[0]);
          } else {
            setIsPlaying(false);
          }
        } else {
          // No queue and no feed — fetch radio playlist from API
          getRadioPlaylist().then((songs) => {
            if (songs.length > 0) {
              // Shuffle
              for (let i = songs.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [songs[i], songs[j]] = [songs[j], songs[i]];
              }
              feedSongsRef.current = songs;
              setQueue(songs.slice(1));
              setIsRadioActive(true);
              playSong(songs[0]);
            } else {
              setIsPlaying(false);
            }
          }).catch(() => {
            setIsPlaying(false);
          });
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
    channelRef.current?.postMessage({ type: "playing", tabId: tabIdRef.current });
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
      setIsRadioActive(false);
      playSong(song);
    },
    [playSong]
  );

  const next = useCallback(() => {
    // Detect skip: if in radio mode and listened less than 33%, report as skip
    if (playModeRef.current === "radio" && currentSongRef.current && audioRef.current) {
      const audio = audioRef.current;
      if (audio.duration > 0 && audio.currentTime / audio.duration < 0.33) {
        radioSkip(currentSongRef.current.uuid).catch(() => {});
      }
    }

    if (queue.length > 0) {
      const nextSong = queue[0];
      setQueue((q) => q.slice(1));
      playSong(nextSong);
    } else if (playMode === "radio" && feedSongsRef.current.length > 0) {
      const currentUuid = currentSongRef.current?.uuid;
      const feed = feedSongsRef.current.filter(s => s.uuid !== currentUuid);
      if (feed.length > 0) {
        setQueue(feed.slice(1));
        playSong(feed[0]);
      }
    } else if (playMode === "radio") {
      // Fetch radio playlist from API
      getRadioPlaylist().then((songs) => {
        if (songs.length > 0) {
          for (let i = songs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [songs[i], songs[j]] = [songs[j], songs[i]];
          }
          feedSongsRef.current = songs;
          setQueue(songs.slice(1));
          setIsRadioActive(true);
          playSong(songs[0]);
        }
      }).catch(() => {});
    }
  }, [queue, playMode, playSong]);

  const previous = useCallback(() => {
    // Apple Music behavior: if >3s into song, restart; otherwise go to previous
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    if (history.length > 0) {
      const prevSong = history[0];
      setHistory((h) => h.slice(1));
      const cur = currentSongRef.current;
      if (cur) {
        setQueue((q) => [cur, ...q]);
      }
      playSong(prevSong, { skipHistory: true });
    } else if (audio) {
      audio.currentTime = 0;
    }
  }, [history, playSong]);

  const seek = useCallback((percent: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const dur = isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : currentSongRef.current?.audio_duration_seconds || 0;
    if (dur > 0) {
      audio.currentTime = (percent / 100) * dur;
    }
  }, []);

  const setVolume = useCallback((vol: number) => {
    setVolumeState(vol);
    if (audioRef.current) {
      audioRef.current.volume = vol;
    }
  }, []);

  // Register Media Session action handlers (CarPlay, Bluetooth, lock screen)
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => { resume(); });
    ms.setActionHandler("pause", () => { pause(); });
    ms.setActionHandler("nexttrack", () => { next(); });
    ms.setActionHandler("previoustrack", () => { previous(); });
    ms.setActionHandler("seekto", (details) => {
      const audio = audioRef.current;
      if (audio && details.seekTime != null) {
        audio.currentTime = details.seekTime;
        updatePositionState();
      }
    });
    ms.setActionHandler("seekbackward", (details) => {
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 10));
        updatePositionState();
      }
    });
    ms.setActionHandler("seekforward", (details) => {
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (details.seekOffset || 10));
        updatePositionState();
      }
    });
  }, [pause, resume, next, previous, updatePositionState]);

  const addToQueue = useCallback((song: Song) => {
    setQueue((q) => [...q, song]);
  }, []);

  const setFeedSongs = useCallback((songs: Song[]) => {
    feedSongsRef.current = songs;
  }, []);

  const startRadio = useCallback((songs: Song[]) => {
    if (songs.length === 0) return;
    // Fisher-Yates shuffle
    const shuffled = [...songs];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    feedSongsRef.current = shuffled;
    setQueue(shuffled.slice(1));
    setPlayMode("radio");
    setIsRadioActive(true);
    playSong(shuffled[0]);
  }, [playSong]);

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
        startRadio,
        isRadioActive,
      }}
    >
      {children}
    </AudioPlayerContext.Provider>
  );
}

export function useAudioPlayer() {
  return useContext(AudioPlayerContext);
}
