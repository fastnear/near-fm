"use client";

import { Suspense, useState, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import type { Language, Category, SongRequest } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { createSong, getSongs, getLanguages, getCategories, getRequest, getRequests } from "@/lib/api";
import { GenrePicker } from "@/components/song/GenrePicker";
import {
  prepareFastFSUpload,
  uploadToFastFS,
  uploadToFastFSViaRelayer,
  computeFileHash,
  getFastFSUrl,
  getRelativePath,
} from "@/lib/near/fastfs";

function formatNear(yocto: string): string {
  const near = Number(yocto) / 1e24;
  return near % 1 === 0 ? near.toFixed(0) : near.toFixed(2);
}

export default function UploadPageWrapper() {
  return (
    <Suspense fallback={<div className="max-w-2xl mx-auto px-4 py-10"><div className="h-8 skeleton rounded w-1/3 mb-8" /></div>}>
      <UploadPage />
    </Suspense>
  );
}

function UploadPage() {
  const { user, isAuthenticated, promptSignIn } = useAuth();
  const { accountId, connectAndSignIn, completeSignIn, linkWallet, callFunction } = useNearWallet();
  const searchParams = useSearchParams();
  const fulfillsRequestId = searchParams.get("fulfills_request_id");
  const requestUuid = searchParams.get("request_uuid");

  const [bountyRequest, setBountyRequest] = useState<SongRequest | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [languageId, setLanguageId] = useState<number | undefined>();
  const [categoryId, setCategoryId] = useState<number | undefined>();
  const [genreIds, setGenreIds] = useState<number[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [error, setError] = useState("");
  const [signing, setSigning] = useState(false);

  // Bounty picker
  const [bountyPickerOpen, setBountyPickerOpen] = useState(false);
  const [openRequests, setOpenRequests] = useState<SongRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [pickedRequest, setPickedRequest] = useState<SongRequest | null>(null);

  const audioInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

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
    getCategories()
      .then(setCategories)
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!requestUuid) return;
    getRequest(requestUuid)
      .then((data) => setBountyRequest((data as any).request ?? data as any))
      .catch(console.error);
  }, [requestUuid]);

  // Fetch open requests when bounty picker is expanded
  useEffect(() => {
    if (!bountyPickerOpen || openRequests.length > 0) return;
    setLoadingRequests(true);
    getRequests({ status: "open", sort: "latest", limit: 50 })
      .then((data) => setOpenRequests(data.requests))
      .catch(console.error)
      .finally(() => setLoadingRequests(false));
  }, [bountyPickerOpen]);

  // Not logged in at all → sign in first
  if (!isAuthenticated) {
    return (
      <div className="px-4 py-16 text-center">
        <div className="glass-card rounded-3xl p-12 max-w-md mx-auto">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-purple-500/20 to-cyan-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15m0-3l-3-3m0 0l-3 3m3-3V15" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">Upload a Song</h1>
          <p className="text-slate-400 mb-8">
            Sign in to upload AI-generated music.
          </p>
          <button
            onClick={promptSignIn}
            className="btn-primary px-8 py-3 rounded-xl text-sm"
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  // Logged in but no NEAR wallet and no Solana → need to connect a wallet
  if (!accountId && !user?.solana_address) {
    return (
      <div className="px-4 py-16 text-center">
        <div className="glass-card rounded-3xl p-12 max-w-md mx-auto">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-purple-500/20 to-cyan-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 9m18 0V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v3" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">Connect NEAR Wallet</h1>
          <p className="text-slate-400 mb-8">
            A NEAR wallet is required to upload songs. Your files are stored on-chain via FastFS.
          </p>
          <button
            onClick={linkWallet}
            className="btn-primary px-8 py-3 rounded-xl text-sm"
          >
            Connect NEAR Wallet
          </button>
        </div>
      </div>
    );
  }

  const handleCoverSelect = (file: File) => {
    setCoverFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setCoverPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSign = async () => {
    setSigning(true);
    await completeSignIn();
    setSigning(false);
  };

  // Upload bytes to FastFS — uses relayer if no NEAR wallet
  const uploadBytes = async (bytes: Uint8Array, mime: string): Promise<{ url: string; hash: string }> => {
    const hash = await computeFileHash(bytes);
    const relPath = getRelativePath(hash, mime);

    if (accountId) {
      const parts = prepareFastFSUpload(relPath, mime, bytes);
      await uploadToFastFS(
        (params) => callFunction({ contractId: params.contractId, method: params.method, args: params.args, gas: params.gas }),
        parts,
        (done, total) => setUploadProgress(`Uploading (${done}/${total} chunks)...`),
      );
      return { url: getFastFSUrl(accountId, relPath), hash };
    } else {
      const blob = new Blob([bytes as BlobPart], { type: mime });
      const file = new File([blob], relPath, { type: mime });
      const result = await uploadToFastFSViaRelayer(file);
      return { url: result.url, hash: result.hash };
    }
  };

  const handleUpload = async () => {
    if (!isAuthenticated) { promptSignIn(); return; }

    if (!audioFile || !title.trim() || !lyrics.trim()) {
      setError("Title, lyrics, and audio file are required");
      return;
    }

    setUploading(true);
    setError("");

    try {
      let coverUrl: string | undefined;
      if (coverFile) {
        setUploadProgress("Uploading cover image...");
        const coverBytes = new Uint8Array(await coverFile.arrayBuffer());
        const coverResult = await uploadBytes(coverBytes, coverFile.type || "image/jpeg");
        coverUrl = coverResult.url;
      }

      setUploadProgress("Checking for duplicates...");
      const audioBytes = new Uint8Array(await audioFile.arrayBuffer());
      const audioHash = await computeFileHash(audioBytes);
      try {
        await getSongs({ audio_hash: audioHash });
      } catch (e: unknown) {
        if (e instanceof Error && e.message.includes("already uploaded")) {
          setError("This audio file has already been uploaded");
          setUploading(false);
          return;
        }
      }

      setUploadProgress("Uploading audio...");
      const audioResult = await uploadBytes(audioBytes, audioFile.type || "audio/mpeg");
      const audioUrl = audioResult.url;

      setUploadProgress("Saving song...");
      const song = await createSong({
        title: title.trim(),
        description: description.trim() || undefined,
        lyrics: lyrics.trim() || undefined,
        ai_model: aiModel.trim() || undefined,
        audio_url: audioUrl,
        audio_hash: audioHash,
        audio_duration_seconds: audioDuration ?? undefined,
        audio_mime_type: audioFile.type || "audio/mpeg",
        cover_image_url: coverUrl,
        language_id: languageId,
        category_id: categoryId,
        fulfills_request_id: fulfillsRequestId ? Number(fulfillsRequestId) : pickedRequest ? pickedRequest.id : undefined,
        genre_ids: genreIds.length > 0 ? genreIds : undefined,
      });

      // Redirect to song page on near.fm
      window.location.href = `https://near.fm/song/${song.uuid}`;
    } catch (e) {
      console.error("Upload failed:", e);
      setError(e instanceof Error ? e.message : "Upload failed");
    }
    setUploading(false);
  };

  const inputClass =
    "w-full rounded-xl px-4 py-3 border border-white/[0.08] bg-white/[0.04] text-slate-200 placeholder:text-slate-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500/20 focus:outline-none transition-all";

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-white mb-2">Upload a Song</h1>
      <p className="text-slate-500 text-sm mb-8">Share your AI-generated music with the world</p>

      {bountyRequest && (
        <div className="glass-card rounded-2xl p-5 mb-6 border-l-4 border-l-purple-500">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs text-purple-400 font-medium uppercase tracking-wide mb-1">Fulfilling bounty request</p>
              <p className="text-white font-semibold">{bountyRequest.title}</p>
              {bountyRequest.description && (
                <p className="text-slate-400 text-sm mt-1 line-clamp-2">{bountyRequest.description}</p>
              )}
            </div>
            <div className="text-right shrink-0">
              <div className="text-lg font-bold text-purple-400">{bountyRequest.bounty_usd_cents ? `$${(bountyRequest.bounty_usd_cents / 100).toFixed(2)}` : `${formatNear(bountyRequest.bounty_amount_yocto)} NEAR`}</div>
              <div className="text-xs text-slate-500">bounty</div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* Audio file */}
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-2">
            Audio file (MP3, WAV, OGG) *
          </label>
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*"
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              setAudioFile(f);
              if (f) {
                const audio = new Audio();
                audio.src = URL.createObjectURL(f);
                audio.addEventListener("loadedmetadata", () => {
                  setAudioDuration(Math.round(audio.duration));
                  URL.revokeObjectURL(audio.src);
                });
              } else {
                setAudioDuration(null);
              }
            }}
            className="hidden"
          />
          <button
            onClick={() => audioInputRef.current?.click()}
            className="w-full border-2 border-dashed border-white/[0.1] rounded-2xl p-8 text-center hover:border-purple-500/50 hover:bg-purple-500/[0.03] transition-all group"
          >
            {audioFile ? (
              <div className="flex items-center justify-center gap-3">
                <svg className="w-6 h-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
                <span className="text-purple-400 font-medium">{audioFile.name}</span>
              </div>
            ) : (
              <div className="space-y-2">
                <svg className="w-10 h-10 mx-auto text-slate-600 group-hover:text-purple-500/50 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <p className="text-slate-500 text-sm">Click to select audio file (max 32MB)</p>
              </div>
            )}
          </button>
        </div>

        {/* Cover image */}
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-2">
            Cover image (optional)
          </label>
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleCoverSelect(f);
            }}
            className="hidden"
          />
          <button
            onClick={() => coverInputRef.current?.click()}
            className="w-24 h-24 border-2 border-dashed border-white/[0.1] rounded-2xl flex items-center justify-center hover:border-purple-500/50 transition-all overflow-hidden group"
          >
            {coverPreview ? (
              <img src={coverPreview} alt="" className="w-full h-full object-cover" />
            ) : (
              <svg className="w-6 h-6 text-slate-600 group-hover:text-purple-500/50 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a2.25 2.25 0 002.25-2.25V5.25a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 003.75 21z" />
              </svg>
            )}
          </button>
        </div>

        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-2">Title *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Song title"
            maxLength={200}
            className={inputClass}
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-2">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this song about?"
            rows={3}
            className={`${inputClass} resize-none`}
          />
        </div>

        {/* Lyrics */}
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-2">Lyrics <span className="text-rose-400">*</span></label>
          <textarea
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            placeholder="Paste lyrics here"
            rows={6}
            className={`${inputClass} resize-none font-mono text-sm`}
          />
        </div>

        {/* AI Model */}
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-2">AI Model</label>
          <input
            type="text"
            value={aiModel}
            onChange={(e) => setAiModel(e.target.value)}
            placeholder="e.g., Suno v4, Udio"
            className={inputClass}
          />
        </div>

        {/* Language */}
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-2">Language</label>
          <select
            value={languageId ?? ""}
            onChange={(e) =>
              setLanguageId(e.target.value ? Number(e.target.value) : undefined)
            }
            className={inputClass}
          >
            <option value="">Select language</option>
            {languages.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        {/* Category */}
        {categories.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">Category</label>
            <select
              value={categoryId ?? ""}
              onChange={(e) =>
                setCategoryId(e.target.value ? Number(e.target.value) : undefined)
              }
              className={inputClass}
            >
              <option value="">Select category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Genres */}
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-2">Genres (up to 3)</label>
          <GenrePicker selectedIds={genreIds} onChange={setGenreIds} />
          <p className="text-xs text-slate-500 mt-2">
            Songs with genres, correct language, and cover image get higher visibility in trending feed.
          </p>
        </div>

        {/* Bounty request picker (collapsible) — hidden when already fulfilling via query param */}
        {!fulfillsRequestId && (
          <div className="border border-white/[0.06] rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setBountyPickerOpen(!bountyPickerOpen)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm text-slate-500 hover:text-slate-300 transition-colors"
            >
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {pickedRequest ? (
                  <span className="text-purple-400">
                    Fulfilling: {pickedRequest.title} ({pickedRequest.bounty_usd_cents ? `$${(pickedRequest.bounty_usd_cents / 100).toFixed(2)}` : `${formatNear(pickedRequest.bounty_amount_yocto)} NEAR`})
                  </span>
                ) : (
                  "Submit for a bounty request"
                )}
              </span>
              <svg className={`w-4 h-4 transition-transform ${bountyPickerOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {bountyPickerOpen && (
              <div className="px-4 pb-4 border-t border-white/[0.06]">
                {loadingRequests ? (
                  <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
                    <div className="w-3.5 h-3.5 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
                    Loading open requests...
                  </div>
                ) : openRequests.length === 0 ? (
                  <p className="text-sm text-slate-500 py-4">No open bounty requests at the moment.</p>
                ) : (
                  <div className="space-y-2 pt-3 max-h-64 overflow-y-auto">
                    {pickedRequest && (
                      <button
                        type="button"
                        onClick={() => setPickedRequest(null)}
                        className="w-full text-left px-3 py-2 rounded-lg text-xs text-slate-500 hover:bg-white/[0.04] transition-colors"
                      >
                        Clear selection
                      </button>
                    )}
                    {openRequests.map((req) => (
                      <button
                        key={req.id}
                        type="button"
                        onClick={() => {
                          setPickedRequest(pickedRequest?.id === req.id ? null : req);
                        }}
                        className={`w-full text-left px-3 py-2.5 rounded-lg transition-all ${
                          pickedRequest?.id === req.id
                            ? "bg-purple-500/10 border border-purple-500/30"
                            : "bg-white/[0.02] border border-transparent hover:bg-white/[0.04]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm text-slate-300 truncate">{req.title}</span>
                          <span className="text-xs text-purple-400 font-medium shrink-0">{req.bounty_usd_cents ? `$${(req.bounty_usd_cents / 100).toFixed(2)}` : `${formatNear(req.bounty_amount_yocto)} NEAR`}</span>
                        </div>
                        {req.description && (
                          <p className="text-xs text-slate-500 mt-1 line-clamp-1">{req.description}</p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-rose-400 text-sm bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            {error}
          </div>
        )}

        {/* Upload progress */}
        {uploading && (
          <div className="flex items-center gap-3 text-purple-400 text-sm bg-purple-500/10 border border-purple-500/20 rounded-xl px-4 py-3">
            <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            {uploadProgress}
          </div>
        )}

        {/* Auth + Submit */}
        {!isAuthenticated ? (
          <div className="space-y-3">
            <button
              onClick={handleSign}
              disabled={signing}
              className="w-full py-3.5 btn-primary rounded-xl disabled:opacity-50"
            >
              {signing ? "Waiting for signature..." : "Sign message to authorize"}
            </button>
            <p className="text-xs text-slate-500 text-center">
              One-time signature to verify your wallet. After signing you can upload.
            </p>
          </div>
        ) : (
          <button
            onClick={handleUpload}
            disabled={uploading || !audioFile || !title.trim() || !lyrics.trim()}
            className="w-full py-3.5 btn-primary rounded-xl disabled:opacity-30 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
          >
            {uploading ? "Uploading..." : "Upload Song"}
          </button>
        )}
      </div>
    </div>
  );
}
