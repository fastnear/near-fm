"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import type { Language, Category } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { useNearWallet } from "@/contexts/NearWalletContext";
import {
  sunoGenerate,
  sunoStatus,
  sunoGenerateLyrics,
  sunoLyricsStatus,
  createSong,
  getSongs,
  getLanguages,
  getCategories,
  type SunoSongVariant,
} from "@/lib/api";
import { GenrePicker } from "@/components/song/GenrePicker";
import {
  prepareFastFSUpload,
  uploadToFastFS,
  computeFileHash,
  getFastFSUrl,
  getRelativePath,
} from "@/lib/near/fastfs";

type Step = "form" | "generating" | "choose" | "publish";

const MODELS = [
  { value: "V4", label: "Suno V4" },
  { value: "V4_5", label: "Suno V4.5" },
  { value: "V4_5_PLUS", label: "Suno V4.5 Plus" },
  { value: "V4_5_ALL", label: "Suno V4.5 All" },
  { value: "V5", label: "Suno V5" },
];

export default function CreatePage() {
  const { user, isAuthenticated, signInWithGoogle } = useAuth();
  const { accountId, connectAndSignIn, linkWallet, callFunction } = useNearWallet();

  const [step, setStep] = useState<Step>("form");
  const [customMode, setCustomMode] = useState(false);

  // Form fields
  const [prompt, setPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [style, setStyle] = useState("");
  const [songTitle, setSongTitle] = useState("");
  const [instrumental, setInstrumental] = useState(false);
  const [model, setModel] = useState("V5");

  // Generation state
  const [taskId, setTaskId] = useState("");
  const [statusText, setStatusText] = useState("Starting generation...");
  const [songs, setSongs] = useState<SunoSongVariant[]>([]);
  const [selectedSong, setSelectedSong] = useState<SunoSongVariant | null>(null);

  // Lyrics generation
  const [lyricsPrompt, setLyricsPrompt] = useState("");
  const [generatingLyrics, setGeneratingLyrics] = useState(false);

  // Publish form
  const [pubTitle, setPubTitle] = useState("");
  const [pubDescription, setPubDescription] = useState("");
  const [pubLyrics, setPubLyrics] = useState("");
  const [pubAiModel, setPubAiModel] = useState("");
  const [languageId, setLanguageId] = useState<number | undefined>();
  const [categoryId, setCategoryId] = useState<number | undefined>();
  const [genreIds, setGenreIds] = useState<number[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  // Custom cover image
  const [customCover, setCustomCover] = useState<File | null>(null);
  const [customCoverPreview, setCustomCoverPreview] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // Upload state
  const [publishing, setPublishing] = useState(false);
  const [publishProgress, setPublishProgress] = useState("");
  const [error, setError] = useState("");

  // Audio players
  const audioRefs = useRef<(HTMLAudioElement | null)[]>([]);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const savedTimeRef = useRef<{ idx: number; time: number } | null>(null);
  const [audioProgress, setAudioProgress] = useState<Record<number, { current: number; duration: number }>>({});

  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lyricsPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lyricsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getLanguages()
      .then((langs) => {
        setLanguages(langs);
        if (!languageId) {
          const english = langs.find((l) => l.code === "en");
          if (english) setLanguageId(english.id);
        }
      })
      .catch(console.error);
    getCategories().then(setCategories).catch(console.error);
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearTimeout(pollingRef.current);
      if (lyricsPollingRef.current) clearInterval(lyricsPollingRef.current);
      if (lyricsTimeoutRef.current) clearTimeout(lyricsTimeoutRef.current);
    };
  }, []);

  // Resume playback after transitioning to "choose" step
  useEffect(() => {
    if (step === "choose" && savedTimeRef.current) {
      const { idx, time } = savedTimeRef.current;
      savedTimeRef.current = null;
      // Wait for audio elements to mount
      const timer = setTimeout(() => {
        const audio = audioRefs.current[idx];
        if (audio) {
          audio.currentTime = time;
          audio.play().catch(() => {});
          setPlayingIdx(idx);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [step]);

  const setupAudioListeners = useCallback((audio: HTMLAudioElement, idx: number) => {
    const onTimeUpdate = () => {
      setAudioProgress((prev) => ({
        ...prev,
        [idx]: { current: audio.currentTime, duration: audio.duration || 0 },
      }));
    };
    audio.addEventListener("timeupdate", onTimeUpdate);
    return () => audio.removeEventListener("timeupdate", onTimeUpdate);
  }, []);

  const togglePlay = (idx: number) => {
    const audio = audioRefs.current[idx];
    if (!audio) return;

    if (playingIdx === idx) {
      audio.pause();
      setPlayingIdx(null);
    } else {
      // Pause other
      audioRefs.current.forEach((a, i) => {
        if (a && i !== idx) a.pause();
      });
      setupAudioListeners(audio, idx);
      audio.play().catch(() => {});
      setPlayingIdx(idx);
    }
  };

  const seekAudio = (idx: number, time: number) => {
    const audio = audioRefs.current[idx];
    if (audio) audio.currentTime = time;
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  // Not authenticated
  if (!isAuthenticated) {
    return (
      <div className="px-4 py-16 text-center">
        <div className="glass-card rounded-3xl p-12 max-w-md mx-auto">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-purple-500/20 to-cyan-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">AI Music Studio</h1>
          <p className="text-slate-400 mb-8">
            Sign in to create music with AI.
          </p>
          <div className="flex flex-col gap-3">
            <button onClick={connectAndSignIn} className="btn-primary px-8 py-3 rounded-xl text-sm">
              Sign in with NEAR Wallet
            </button>
            <button onClick={signInWithGoogle} className="px-8 py-3 rounded-xl text-sm text-slate-300 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] transition-all">
              Sign in with Google
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Credit check (form still visible but blocked)
  const totalCredits = (user?.credit_balance ?? 0) + (user?.daily_credits_remaining ?? 0);
  const hasCredits = user?.is_admin || totalCredits >= 1;

  // ── Handlers ──

  const handleGenerate = async () => {
    setError("");

    if (!hasCredits) return;

    if (customMode) {
      if (!lyrics.trim() && !instrumental) {
        setError("Lyrics are required for custom mode (unless instrumental)");
        return;
      }
    } else {
      if (!prompt.trim()) {
        setError("Please describe the song you want to create");
        return;
      }
    }

    setStep("generating");
    setStatusText("Sending request to AI...");

    try {
      const result = await sunoGenerate({
        customMode,
        prompt: customMode ? undefined : prompt,
        lyrics: customMode ? lyrics : undefined,
        style: customMode ? style : undefined,
        title: customMode ? songTitle : undefined,
        instrumental,
        model,
      });

      setTaskId(result.task_id);
      setStatusText("Generating music...");

      // Start polling with recursive setTimeout to avoid overlapping requests
      const poll = async () => {
        try {
          const status = await sunoStatus(result.task_id);

          if (status.status === "TEXT_SUCCESS") {
            setStatusText(customMode ? "Composing music..." : "Lyrics created, composing music...");
          } else if (status.status === "FIRST_SUCCESS") {
            setStatusText("Almost ready...");
          }

          // Show songs with stream URLs as soon as available
          if (status.songs && status.songs.length > 0) {
            setSongs(status.songs);
          }

          if (status.status === "SUCCESS") {
            pollingRef.current = null;
            // Save current playback position before transitioning
            if (playingIdx !== null && audioRefs.current[playingIdx]) {
              const audio = audioRefs.current[playingIdx];
              if (audio && !audio.paused) {
                savedTimeRef.current = { idx: playingIdx, time: audio.currentTime };
              }
            }
            setSongs(status.songs);
            setStep("choose");
            return;
          }

          // Handle error from Suno (e.g. content policy violation)
          if (status.status.startsWith("ERROR")) {
            pollingRef.current = null;
            const errMsg = status.status.replace("ERROR: ", "");
            setError(errMsg || "Generation failed. Please try different parameters.");
            setStep("form");
            return;
          }
        } catch (e) {
          console.error("Polling error:", e);
        }
        pollingRef.current = setTimeout(poll, 5000);
      };
      pollingRef.current = setTimeout(poll, 5000);
    } catch (e) {
      setStep("form");
      setError(e instanceof Error ? e.message : "Generation failed");
    }
  };

  const handleGenerateLyrics = async () => {
    if (!lyricsPrompt.trim()) return;
    setGeneratingLyrics(true);
    setError("");

    try {
      const result = await sunoGenerateLyrics(lyricsPrompt);
      const lyricsTaskId = result.task_id;

      // Poll for lyrics (stored in refs for cleanup)
      if (lyricsPollingRef.current) clearInterval(lyricsPollingRef.current);
      if (lyricsTimeoutRef.current) clearTimeout(lyricsTimeoutRef.current);

      lyricsPollingRef.current = setInterval(async () => {
        try {
          const status = await sunoLyricsStatus(lyricsTaskId);
          if (status.status === "SUCCESS" || status.text) {
            if (lyricsPollingRef.current) clearInterval(lyricsPollingRef.current);
            if (lyricsTimeoutRef.current) clearTimeout(lyricsTimeoutRef.current);
            lyricsPollingRef.current = null;
            lyricsTimeoutRef.current = null;
            if (status.text) setLyrics(status.text);
            if (status.title && !songTitle) setSongTitle(status.title);
            setGeneratingLyrics(false);
          }
        } catch {
          // keep polling
        }
      }, 3000);

      // Timeout after 60s
      lyricsTimeoutRef.current = setTimeout(() => {
        if (lyricsPollingRef.current) clearInterval(lyricsPollingRef.current);
        lyricsPollingRef.current = null;
        lyricsTimeoutRef.current = null;
        setGeneratingLyrics(false);
      }, 60000);
    } catch (e) {
      setGeneratingLyrics(false);
      setError(e instanceof Error ? e.message : "Lyrics generation failed");
    }
  };

  const handleSelect = (song: SunoSongVariant) => {
    setSelectedSong(song);
    setPubTitle(song.title || songTitle || "");
    setPubLyrics(song.lyrics || lyrics || "");
    setPubAiModel(MODELS.find((m) => m.value === model)?.label || `Suno ${model}`);
    setStep("publish");
  };

  const handlePublish = async () => {
    if (!selectedSong) return;
    if (!accountId) {
      linkWallet();
      return;
    }
    if (!pubTitle.trim()) {
      setError("Title is required");
      return;
    }

    setPublishing(true);
    setError("");

    try {
      const audioSourceUrl = selectedSong.audio_url || selectedSong.stream_audio_url;
      if (!audioSourceUrl) {
        throw new Error("No audio URL available");
      }

      // Download audio via server proxy (uses cached task data, no arbitrary URLs)
      setPublishProgress("Downloading audio...");
      const selectedIdx = songs.findIndex((s) => s.id === selectedSong.id);
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "https://api.near.fm";
      const audioResp = await fetch(
        `${apiBase}/api/suno/download?taskId=${encodeURIComponent(taskId)}&songIndex=${selectedIdx >= 0 ? selectedIdx : 0}&type=audio`,
        { credentials: "include" }
      );
      if (!audioResp.ok) throw new Error("Failed to download audio");
      const audioBlob = await audioResp.blob();
      const audioBytes = new Uint8Array(await audioBlob.arrayBuffer());

      // Compute hash and check for duplicates
      setPublishProgress("Checking for duplicates...");
      const audioHash = await computeFileHash(audioBytes);
      const audioMime = audioBlob.type || "audio/mpeg";
      try {
        await getSongs({ audio_hash: audioHash });
      } catch (e: unknown) {
        if (e instanceof Error && e.message.includes("already uploaded")) {
          setError("This audio has already been uploaded to near.fm");
          setPublishing(false);
          return;
        }
      }

      setPublishProgress("Preparing upload...");
      const audioRelPath = getRelativePath(audioHash, audioMime);
      const audioParts = prepareFastFSUpload(audioRelPath, audioMime, audioBytes);

      // Upload cover if available
      let coverUrl: string | undefined;
      // Upload cover image (custom or from AI)
      if (customCover || selectedSong.image_url) {
        setPublishProgress("Uploading cover image...");
        try {
          let coverBytes: Uint8Array;
          let coverMime: string;

          if (customCover) {
            // User provided custom cover
            coverBytes = new Uint8Array(await customCover.arrayBuffer());
            coverMime = customCover.type || "image/jpeg";
          } else {
            // Download AI-generated cover via server proxy
            const coverIdx = songs.findIndex((s) => s.id === selectedSong.id);
            const coverResp = await fetch(
              `${apiBase}/api/suno/download?taskId=${encodeURIComponent(taskId)}&songIndex=${coverIdx >= 0 ? coverIdx : 0}&type=image`,
              { credentials: "include" }
            );
            if (!coverResp.ok) throw new Error("Failed to download cover");
            const coverBlob = await coverResp.blob();
            coverBytes = new Uint8Array(await coverBlob.arrayBuffer());
            coverMime = coverBlob.type || "image/jpeg";
          }

          const coverHash = await computeFileHash(coverBytes);
          const coverRelPath = getRelativePath(coverHash, coverMime);
          const coverParts = prepareFastFSUpload(coverRelPath, coverMime, coverBytes);

          await uploadToFastFS(
            (params) =>
              callFunction({
                contractId: params.contractId,
                method: params.method,
                args: params.args,
                gas: params.gas,
              }),
            coverParts
          );

          coverUrl = getFastFSUrl(accountId, coverRelPath);
        } catch (e) {
          console.warn("Cover upload failed, continuing without cover:", e);
        }
      }

      // Upload audio
      setPublishProgress(`Uploading audio (0/${audioParts.length} chunks)...`);
      await uploadToFastFS(
        (params) =>
          callFunction({
            contractId: params.contractId,
            method: params.method,
            args: params.args,
            gas: params.gas,
          }),
        audioParts,
        (done, total) =>
          setPublishProgress(`Uploading audio (${done}/${total} chunks)...`)
      );

      const audioUrl = getFastFSUrl(accountId, audioRelPath);

      // Create song
      setPublishProgress("Saving song...");
      const song = await createSong({
        title: pubTitle.trim(),
        description: pubDescription.trim() || undefined,
        lyrics: pubLyrics.trim() || undefined,
        ai_model: pubAiModel.trim() || undefined,
        audio_url: audioUrl,
        audio_hash: audioHash,
        audio_duration_seconds: selectedSong.duration ? Math.round(selectedSong.duration) : undefined,
        audio_mime_type: audioMime,
        cover_image_url: coverUrl,
        language_id: languageId,
        category_id: categoryId,
        genre_ids: genreIds.length > 0 ? genreIds : undefined,
        suno_task_id: taskId || undefined,
      });

      window.location.href = `https://near.fm/song/${song.uuid}`;
    } catch (e) {
      console.error("Publish failed:", e);
      setError(e instanceof Error ? e.message : "Publish failed");
      setPublishing(false);
    }
  };

  const inputClass =
    "w-full rounded-xl px-4 py-3 border border-white/[0.08] bg-white/[0.04] text-slate-200 placeholder:text-slate-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500/20 focus:outline-none transition-all";

  // ── STEP 1: Form ──
  if (step === "form") {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-white mb-2">AI Music Studio</h1>
        <p className="text-slate-500 text-sm mb-4">Create music with AI, then publish on near.fm</p>

        {/* Credit balance */}
        {!user?.is_admin && (
          <div className="flex items-center gap-3 mb-8 text-sm">
            <span className="text-slate-400">
              Credits: <span className="text-white font-medium">{user?.credit_balance?.toLocaleString() ?? 0}</span>
            </span>
            {(user?.daily_credits_remaining ?? 0) > 0 && (
              <span className="text-cyan-400">
                + {user?.daily_credits_remaining} daily
              </span>
            )}
            <span className="text-slate-600">|</span>
            <span className="text-slate-500">Song = 12 credits</span>
            <Link href="/credits" className="text-purple-400 hover:text-purple-300 transition-colors ml-auto">
              Buy more
            </Link>
          </div>
        )}

        {/* No credits banner */}
        {!hasCredits && (
          <div className="glass-card rounded-2xl p-6 mb-8 border border-amber-500/20">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-purple-500/20 to-amber-500/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-slate-300 text-sm mb-3">
                  You need credits to generate music. Each song costs 12 credits.
                </p>
                <div className="flex gap-2">
                  <Link href="/credits" className="btn-primary px-5 py-2 rounded-lg text-xs inline-block">
                    Buy Credits
                  </Link>
                  <Link href="/premium" className="px-5 py-2 rounded-lg text-xs text-slate-300 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] transition-all inline-block">
                    Get Premium for 40 daily credits
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Mode toggle */}
        <div className={`flex gap-2 mb-8 ${!hasCredits ? "opacity-50 pointer-events-none" : ""}`}>
          <button
            onClick={() => setCustomMode(false)}
            className={`px-4 py-2 rounded-xl text-sm transition-all ${
              !customMode
                ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                : "text-slate-400 bg-white/[0.04] border border-white/[0.06] hover:border-white/[0.12]"
            }`}
          >
            Simple Mode
          </button>
          <button
            onClick={() => setCustomMode(true)}
            className={`px-4 py-2 rounded-xl text-sm transition-all ${
              customMode
                ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                : "text-slate-400 bg-white/[0.04] border border-white/[0.06] hover:border-white/[0.12]"
            }`}
          >
            Custom Mode
          </button>
        </div>

        <div className={`space-y-6 ${!hasCredits ? "opacity-50 pointer-events-none" : ""}`}>
          {!customMode ? (
            /* Simple mode */
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">
                Describe your song
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. A dreamy indie pop song about walking through a rainy city at night..."
                rows={4}
                maxLength={500}
                className={`${inputClass} resize-none`}
              />
              <p className="text-xs text-slate-500 mt-1">{prompt.length}/500</p>
            </div>
          ) : (
            /* Custom mode */
            <>
              {/* Lyrics */}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">
                  Lyrics {!instrumental && <span className="text-rose-400">*</span>}
                </label>
                <textarea
                  value={lyrics}
                  onChange={(e) => setLyrics(e.target.value)}
                  placeholder="Write or generate lyrics..."
                  rows={8}
                  maxLength={5000}
                  disabled={instrumental}
                  className={`${inputClass} resize-none font-mono text-sm ${instrumental ? "opacity-50" : ""}`}
                />
                <div className="flex items-center justify-between mt-2">
                  <p className="text-xs text-slate-500">{lyrics.length}/5000</p>
                  {!instrumental && (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={lyricsPrompt}
                        onChange={(e) => setLyricsPrompt(e.target.value)}
                        placeholder="Describe lyrics to generate..."
                        className="rounded-lg px-3 py-1.5 text-xs border border-white/[0.08] bg-white/[0.04] text-slate-300 placeholder:text-slate-500 focus:border-purple-500 focus:outline-none w-full sm:w-56"
                      />
                      <button
                        onClick={handleGenerateLyrics}
                        disabled={generatingLyrics || !lyricsPrompt.trim()}
                        className="px-3 py-1.5 text-xs rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30 transition-all disabled:opacity-50"
                      >
                        {generatingLyrics ? (
                          <span className="flex items-center gap-1.5">
                            <div className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                            Generating...
                          </span>
                        ) : (
                          "Generate with AI"
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Title</label>
                <input
                  type="text"
                  value={songTitle}
                  onChange={(e) => setSongTitle(e.target.value)}
                  placeholder="Song title"
                  maxLength={200}
                  className={inputClass}
                />
              </div>

              {/* Style */}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Style / Tags</label>
                <input
                  type="text"
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  placeholder="e.g. Indie Pop, Dreamy, Female Vocals"
                  className={inputClass}
                />
              </div>

              {/* Instrumental toggle */}
              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  className={`w-10 h-6 rounded-full transition-colors relative ${
                    instrumental ? "bg-purple-500" : "bg-white/[0.1]"
                  }`}
                  onClick={() => setInstrumental(!instrumental)}
                >
                  <div
                    className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                      instrumental ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </div>
                <span className="text-sm text-slate-300">Instrumental (no vocals)</span>
              </label>
            </>
          )}

          {/* Model select */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">AI Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={inputClass}
            >
              {MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-rose-400 text-sm bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              {error}
            </div>
          )}

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            className="w-full py-3.5 btn-primary rounded-xl"
          >
            Generate Music
          </button>

          <p className="text-xs text-slate-600 text-center">
            Want to fulfill a bounty request? You can select one later when uploading your song.
          </p>
        </div>
      </div>
    );
  }

  // ── STEP 2: Generating (polling) ──
  if (step === "generating") {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="glass-card rounded-3xl p-12">
          <div className="w-20 h-20 mx-auto mb-8 rounded-full bg-gradient-to-br from-purple-500/20 to-cyan-500/20 flex items-center justify-center">
            <div className="w-10 h-10 border-[3px] border-purple-500 border-t-transparent rounded-full animate-spin" />
          </div>
          <h2 className="text-xl font-bold text-white mb-3">{statusText}</h2>
          <p className="text-slate-500 text-sm mb-3">
            This usually takes 30-90 seconds.
          </p>
          <p className="text-slate-500 text-sm mb-8">
            2 variants will be generated for you to choose from.
          </p>

          {/* Show early stream players if available */}
          {songs.length > 0 && songs.some((s) => s.stream_audio_url || s.audio_url) && (
            <div className="space-y-4 mt-8">
              <p className="text-sm text-slate-400">Preview (still generating...):</p>
              {songs.map((song, idx) => (
                <div key={idx} className="glass-card rounded-xl p-4 text-left">
                  <div className="flex items-center gap-3">
                    {song.image_url && (
                      <img src={song.image_url} alt="" className="w-12 h-12 rounded-lg object-cover" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{song.title || `Variant ${idx + 1}`}</p>
                      <p className="text-slate-500 text-xs truncate">{song.tags}</p>
                    </div>
                    {(song.stream_audio_url || song.audio_url) && (
                      <button
                        onClick={() => togglePlay(idx)}
                        className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 hover:bg-purple-500/30 transition-colors"
                      >
                        {playingIdx === idx ? (
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        )}
                      </button>
                    )}
                  </div>
                  <audio
                    ref={(el) => { audioRefs.current[idx] = el; }}
                    src={song.stream_audio_url || song.audio_url || undefined}
                    onEnded={() => setPlayingIdx(null)}
                  />
                  {/* Seekbar */}
                  {audioProgress[idx] && audioProgress[idx].duration > 0 && isFinite(audioProgress[idx].duration) && (
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[10px] text-slate-500 tabular-nums w-8 text-right">{formatTime(audioProgress[idx].current)}</span>
                      <input
                        type="range"
                        min={0}
                        max={audioProgress[idx].duration}
                        step={0.1}
                        value={audioProgress[idx].current}
                        onChange={(e) => seekAudio(idx, Number(e.target.value))}
                        className="flex-1 h-1 accent-purple-500 cursor-pointer"
                      />
                      <span className="text-[10px] text-slate-500 tabular-nums w-8">{formatTime(audioProgress[idx].duration)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => {
              if (pollingRef.current) clearTimeout(pollingRef.current);
              pollingRef.current = null;
              setStep("form");
              setSongs([]);
              setTaskId("");
            }}
            className="mt-8 text-sm text-slate-500 hover:text-slate-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── STEP 3: Choose variant ──
  if (step === "choose") {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <h2 className="text-2xl font-bold text-white mb-2">Choose Your Track</h2>
        <p className="text-slate-500 text-sm mb-8">
          {songs.length} variant{songs.length !== 1 ? "s" : ""} generated. Listen and pick your favorite.
        </p>

        <div className="grid gap-6 md:grid-cols-2">
          {songs.map((song, idx) => (
            <div
              key={idx}
              className="glass-card rounded-2xl overflow-hidden hover:border-purple-500/30 transition-all"
            >
              {/* Cover */}
              {song.image_url && (
                <div className="relative aspect-square">
                  <img
                    src={song.image_url}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                  {/* Play overlay — always semi-visible */}
                  <button
                    onClick={() => togglePlay(idx)}
                    className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/40 transition-colors"
                  >
                    <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                      {playingIdx === idx ? (
                        <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                        </svg>
                      ) : (
                        <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </div>
                  </button>
                </div>
              )}

              <div className="p-5">
                <h3 className="text-white font-semibold mb-1 truncate">
                  {song.title || `Variant ${idx + 1}`}
                </h3>
                <p className="text-slate-500 text-xs mb-3 truncate">{song.tags}</p>
                {song.duration && (
                  <p className="text-slate-600 text-xs mb-4">
                    {Math.floor(song.duration / 60)}:{String(Math.floor(song.duration % 60)).padStart(2, "0")}
                  </p>
                )}

                {/* Mini player */}
                {!song.image_url && (
                  <button
                    onClick={() => togglePlay(idx)}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white/[0.04] text-slate-300 hover:bg-white/[0.08] transition-all mb-4"
                  >
                    {playingIdx === idx ? (
                      <>
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                        </svg>
                        Pause
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                        Play
                      </>
                    )}
                  </button>
                )}

                <audio
                  ref={(el) => { audioRefs.current[idx] = el; }}
                  src={song.audio_url || song.stream_audio_url || undefined}
                  onEnded={() => setPlayingIdx(null)}
                />

                {/* Seekbar — always visible for consistent height */}
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-[10px] text-slate-500 tabular-nums w-8 text-right">
                    {audioProgress[idx] ? formatTime(audioProgress[idx].current) : "0:00"}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={audioProgress[idx]?.duration && isFinite(audioProgress[idx].duration) ? audioProgress[idx].duration : song.duration || 100}
                    step={0.1}
                    value={audioProgress[idx]?.current || 0}
                    onChange={(e) => seekAudio(idx, Number(e.target.value))}
                    className="flex-1 h-1 accent-purple-500 cursor-pointer"
                  />
                  <span className="text-[10px] text-slate-500 tabular-nums w-8">
                    {audioProgress[idx]?.duration && isFinite(audioProgress[idx].duration)
                      ? formatTime(audioProgress[idx].duration)
                      : song.duration ? formatTime(song.duration) : "0:00"}
                  </span>
                </div>

                {/* Lyrics */}
                {song.lyrics && (
                  <pre className="text-xs text-slate-500 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto mb-4 leading-relaxed">{song.lyrics}</pre>
                )}

                <button
                  onClick={() => handleSelect(song)}
                  className="w-full py-3 btn-primary rounded-xl text-sm"
                >
                  Use This Track
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() => setStep("form")}
          className="mt-8 text-sm text-slate-500 hover:text-slate-300 transition-colors"
        >
          Start over
        </button>
      </div>
    );
  }

  // ── STEP 4: Publish ──
  if (step === "publish" && selectedSong) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <h2 className="text-2xl font-bold text-white mb-2">Publish on near.fm</h2>
        <p className="text-slate-500 text-sm mb-8">
          Review and edit details before publishing your AI-generated track.
        </p>

        {/* Preview card */}
        <div className="glass-card rounded-2xl overflow-hidden mb-8">
          <div className="flex">
            {/* Cover — large, clickable */}
            <div
              className="relative w-36 h-36 shrink-0 cursor-pointer group bg-white/[0.06]"
              onClick={() => coverInputRef.current?.click()}
            >
              {(customCoverPreview || selectedSong.image_url) ? (
                <img src={customCoverPreview || selectedSong.image_url!} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a2.25 2.25 0 002.25-2.25V5.25a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 003.75 21z" />
                  </svg>
                </div>
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setCustomCover(file);
                    setCustomCoverPreview(URL.createObjectURL(file));
                  }
                }}
              />
            </div>

            {/* Info + player */}
            <div className="flex-1 min-w-0 p-4 flex flex-col justify-between">
              <div>
                <p className="text-white font-semibold truncate">{selectedSong.title}</p>
                <p className="text-slate-500 text-xs truncate mt-0.5">{selectedSong.tags}</p>
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  className="text-xs text-purple-400/70 hover:text-purple-400 transition-colors mt-1"
                >
                  Change cover
                </button>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => togglePlay(0)}
                  className="w-9 h-9 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 hover:bg-purple-500/30 transition-colors shrink-0"
                >
                  {playingIdx === 0 ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>
                <span className="text-[10px] text-slate-500 tabular-nums">
                  {selectedSong.duration ? formatTime(selectedSong.duration) : ""}
                </span>
              </div>
            </div>
          </div>
          <audio
            ref={(el) => { audioRefs.current[0] = el; }}
            src={selectedSong.audio_url || selectedSong.stream_audio_url || undefined}
            onEnded={() => setPlayingIdx(null)}
          />
        </div>

        {/* No wallet connected */}
        {!accountId && (
          <div className="glass-card rounded-2xl p-6 mb-8 text-center">
            <p className="text-slate-400 mb-4">Connect a NEAR wallet to publish (files are stored on-chain via FastFS).</p>
            <button onClick={linkWallet} className="btn-primary px-6 py-2.5 rounded-xl text-sm">
              Connect NEAR Wallet
            </button>
          </div>
        )}

        <div className="space-y-6">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">Title *</label>
            <input
              type="text"
              value={pubTitle}
              onChange={(e) => setPubTitle(e.target.value)}
              maxLength={200}
              className={inputClass}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">Description</label>
            <textarea
              value={pubDescription}
              onChange={(e) => setPubDescription(e.target.value)}
              placeholder="What is this song about?"
              rows={3}
              className={`${inputClass} resize-none`}
            />
          </div>

          {/* Lyrics */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">Lyrics</label>
            <textarea
              value={pubLyrics}
              onChange={(e) => setPubLyrics(e.target.value)}
              rows={6}
              className={`${inputClass} resize-none font-mono text-sm`}
            />
          </div>

          {/* AI Model */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">AI Model</label>
            <input
              type="text"
              value={pubAiModel}
              onChange={(e) => setPubAiModel(e.target.value)}
              className={inputClass}
            />
          </div>

          {/* Language */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">Language</label>
            <select
              value={languageId ?? ""}
              onChange={(e) => setLanguageId(e.target.value ? Number(e.target.value) : undefined)}
              className={inputClass}
            >
              <option value="">Select language</option>
              {languages.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          {/* Category */}
          {categories.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">Category</label>
              <select
                value={categoryId ?? ""}
                onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : undefined)}
                className={inputClass}
              >
                <option value="">Select category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Genres */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">Genres (up to 3)</label>
            <GenrePicker selectedIds={genreIds} onChange={setGenreIds} />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-rose-400 text-sm bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              {error}
            </div>
          )}

          {/* Progress */}
          {publishing && (
            <div className="flex items-center gap-3 text-purple-400 text-sm bg-purple-500/10 border border-purple-500/20 rounded-xl px-4 py-3">
              <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              {publishProgress}
            </div>
          )}

          {/* Publish button */}
          <div className="flex gap-3">
            <button
              onClick={() => setStep("choose")}
              disabled={publishing}
              className="px-6 py-3.5 rounded-xl text-sm text-slate-400 bg-white/[0.04] border border-white/[0.06] hover:border-white/[0.12] transition-all disabled:opacity-50"
            >
              Back
            </button>
            <button
              onClick={handlePublish}
              disabled={publishing || !pubTitle.trim() || !accountId}
              className="flex-1 py-3.5 btn-primary rounded-xl disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {publishing ? "Publishing..." : "Publish Song"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
