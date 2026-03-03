"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { getUserProfile, getFollowers, updateUserProfile } from "@/lib/api";
import type { FollowerEntry } from "@/lib/api";
import Link from "next/link";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { SongCard } from "@/components/song/SongCard";
import { FollowButton } from "@/components/song/FollowButton";
import type { Song } from "@/types";
import {
  prepareFastFSUpload,
  uploadToFastFS,
  computeFileHash,
  getFastFSUrl,
  getRelativePath,
} from "@/lib/near/fastfs";

function formatNear(yocto: string): string {
  const n = Number(yocto) / 1e24;
  if (n === 0) return "0";
  if (n >= 10 || n === Math.floor(n)) return Math.round(n).toString();
  return n.toFixed(1).replace(/\.0$/, "");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function ProfilePage() {
  const params = useParams<{ accountId: string }>();
  const accountId = params.accountId;
  const { accountId: currentUser, signOut, callFunction } = useNearWallet();
  const isOwnProfile = currentUser === accountId;

  const [user, setUser] = useState<Record<string, unknown> | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [followers, setFollowers] = useState<FollowerEntry[]>([]);

  // Edit profile state
  const [editing, setEditing] = useState(false);
  const [editBio, setEditBio] = useState("");
  const [editTwitter, setEditTwitter] = useState("");
  const [editAvatarPreview, setEditAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!accountId) return;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data: any = await getUserProfile(accountId);
        const { songs: userSongs, ...userData } = data;
        setUser(userData);
        setSongs(userSongs ?? []);
      } catch (e) {
        console.error("Failed to load profile:", e);
        setError("User not found or failed to load profile.");
      }
      setLoading(false);
    };

    load();
  }, [accountId]);

  // Load followers
  useEffect(() => {
    if (accountId) {
      getFollowers(accountId).then(setFollowers).catch(console.error);
    }
  }, [accountId]);

  const startEditing = () => {
    setEditBio((user?.bio as string) || "");
    setEditTwitter((user?.twitter_handle as string) || "");
    setEditAvatarPreview(null);
    setAvatarFile(null);
    setEditing(true);
  };

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert("Image must be under 2MB");
      return;
    }
    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = () => setEditAvatarPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const saveProfile = async () => {
    if (!currentUser) return;
    setSaving(true);
    try {
      let avatarUrl: string | undefined;

      // Upload avatar to FastFS if selected
      if (avatarFile) {
        setUploadProgress("Uploading avatar...");
        const buffer = await avatarFile.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const hash = await computeFileHash(bytes);
        const relPath = getRelativePath(hash, avatarFile.type || "image/jpeg");
        const parts = prepareFastFSUpload(relPath, avatarFile.type, bytes);

        await uploadToFastFS(
          (params) => callFunction({ contractId: params.contractId, method: params.method, args: params.args, gas: params.gas }),
          parts,
          (done, total) => setUploadProgress(`Uploading avatar ${done}/${total}...`)
        );

        avatarUrl = getFastFSUrl(currentUser, relPath);
      }

      setUploadProgress("Saving profile...");
      await updateUserProfile(currentUser, {
        avatar_url: avatarUrl,
        bio: editBio.trim(),
        twitter_handle: editTwitter.trim(),
      });

      // Refresh profile data
      const data: any = await getUserProfile(accountId);
      const { songs: userSongs, ...userData } = data;
      setUser(userData);
      setSongs(userSongs ?? []);
      setEditing(false);
    } catch (e) {
      console.error("Save profile failed:", e);
      alert("Failed to save profile. Please try again.");
    }
    setSaving(false);
    setUploadProgress("");
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-10">
        {/* Skeleton header */}
        <div className="glass-card rounded-2xl p-8 mb-8 animate-pulse">
          <div className="flex items-center gap-6">
            <div className="w-20 h-20 rounded-full skeleton" />
            <div className="space-y-3 flex-1">
              <div className="h-6 skeleton rounded w-48" />
              <div className="h-4 skeleton rounded w-32" />
            </div>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 mt-8">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 skeleton rounded-xl" />
            ))}
          </div>
        </div>
        {/* Skeleton grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass-card rounded-2xl animate-pulse">
              <div className="aspect-square skeleton rounded-t-xl" />
              <div className="p-3 space-y-2">
                <div className="h-4 skeleton rounded w-3/4" />
                <div className="h-3 skeleton rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center">
        <div className="text-5xl mb-4 opacity-30">&#128100;</div>
        <p className="text-slate-400 text-lg">{error || "User not found"}</p>
      </div>
    );
  }

  const displayName = user.display_name as string | null;
  const avatarUrl = user.avatar_url as string | null;
  const bio = user.bio as string | null;
  const twitterHandle = user.twitter_handle as string | null;
  const reputationRaw = parseFloat(user.reputation_score as string);
  const reputationScore = Number.isFinite(reputationRaw) ? Math.round(reputationRaw * 100) / 100 : 0;
  const totalTipsYocto = user.total_tips_received_yocto as string;
  const totalLikesGiven = (user.total_likes_given as number) ?? 0;
  const totalDislikesGiven = (user.total_dislikes_given as number) ?? 0;
  const followersCount = (user.followers_count as number) ?? 0;
  const memberSince = user.created_at as string;

  return (
    <div className="max-w-7xl mx-auto px-4 py-10">
      {/* Profile header */}
      <div className="glass-card rounded-2xl p-8 mb-8">
        <div className="flex items-center gap-6">
          {/* Avatar */}
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName || accountId}
              className="w-20 h-20 rounded-full object-cover ring-2 ring-white/[0.08] shrink-0"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-600 to-cyan-600 flex items-center justify-center text-3xl font-bold text-white shrink-0">
              {(displayName || accountId).charAt(0).toUpperCase()}
            </div>
          )}

          <div className="min-w-0 flex-1">
            {displayName && (
              <h1 className="text-2xl font-bold text-white truncate">
                {displayName}
              </h1>
            )}
            <p className={`${displayName ? "text-slate-400 text-sm" : "text-2xl font-bold text-white"} truncate`}>
              {accountId}
            </p>
            {bio && (
              <p className="text-slate-300 text-sm mt-1.5 line-clamp-2">{bio}</p>
            )}
            <div className="flex items-center gap-3 mt-1">
              <p className="text-slate-500 text-xs">
                Member since {formatDate(memberSince)}
              </p>
              {twitterHandle && (
                <a
                  href={`https://x.com/${twitterHandle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  @{twitterHandle}
                </a>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {!isOwnProfile && (
              <FollowButton accountId={accountId} currentUser={currentUser} />
            )}
            {isOwnProfile && (
              <>
                <button
                  onClick={startEditing}
                  className="px-4 py-2 text-sm text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] rounded-xl transition-all"
                >
                  Edit Profile
                </button>
                <button
                  onClick={signOut}
                  className="px-4 py-2 text-sm text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] rounded-xl transition-all"
                >
                  Sign out
                </button>
              </>
            )}
          </div>
        </div>

        {/* Edit Profile Form */}
        {editing && (
          <div className="mt-6 pt-6 border-t border-white/[0.06] space-y-4">
            <div className="flex items-start gap-6">
              {/* Avatar upload */}
              <div className="shrink-0">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="relative w-20 h-20 rounded-full overflow-hidden group cursor-pointer"
                >
                  {editAvatarPreview ? (
                    <img src={editAvatarPreview} alt="" className="w-full h-full object-cover" />
                  ) : avatarUrl ? (
                    <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-purple-600 to-cyan-600 flex items-center justify-center text-3xl font-bold text-white">
                      {(displayName || accountId).charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarSelect}
                  className="hidden"
                />
                <p className="text-[10px] text-slate-500 text-center mt-1">Max 2MB</p>
              </div>

              <div className="flex-1 space-y-3">
                {/* Bio */}
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Bio</label>
                  <textarea
                    value={editBio}
                    onChange={(e) => setEditBio(e.target.value)}
                    maxLength={256}
                    rows={3}
                    placeholder="Tell about yourself..."
                    className="w-full rounded-xl px-4 py-2 text-sm border border-white/[0.08] bg-white/[0.04] text-slate-200 placeholder:text-slate-600 focus:border-purple-500 focus:outline-none resize-none"
                  />
                  <p className="text-[10px] text-slate-600 text-right">{editBio.length}/256</p>
                </div>

                {/* Twitter */}
                <div>
                  <label className="block text-xs text-slate-500 mb-1">X (Twitter)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">@</span>
                    <input
                      type="text"
                      value={editTwitter}
                      onChange={(e) => setEditTwitter(e.target.value.replace(/^@/, ""))}
                      maxLength={50}
                      placeholder="username"
                      className="w-full rounded-xl pl-8 pr-4 py-2 text-sm border border-white/[0.08] bg-white/[0.04] text-slate-200 placeholder:text-slate-600 focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Save / Cancel */}
            <div className="flex items-center gap-3">
              <button
                onClick={saveProfile}
                disabled={saving}
                className="px-5 py-2 btn-primary rounded-xl text-sm disabled:opacity-50"
              >
                {saving ? (uploadProgress || "Saving...") : "Save"}
              </button>
              <button
                onClick={() => setEditing(false)}
                disabled={saving}
                className="px-5 py-2 btn-ghost rounded-xl text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="flex flex-wrap gap-4 mt-8 [&>div]:flex-1 [&>div]:min-w-[100px]">
          <div className="bg-white/[0.04] rounded-xl p-4 border border-white/[0.04] text-center">
            <p className="text-2xl font-bold text-white">{reputationScore}</p>
            <p className="text-xs text-slate-400 mt-1">Reputation</p>
          </div>
          <div className="bg-white/[0.04] rounded-xl p-4 border border-white/[0.04] text-center">
            <p className="text-2xl font-bold text-white">{songs.length}</p>
            <p className="text-xs text-slate-400 mt-1">Songs</p>
          </div>
          <div className="bg-white/[0.04] rounded-xl p-4 border border-white/[0.04] text-center">
            <p className="text-2xl font-bold text-white">{formatNear(totalTipsYocto)}</p>
            <p className="text-xs text-slate-400 mt-1">NEAR Received</p>
          </div>
          <div className="bg-white/[0.04] rounded-xl p-4 border border-white/[0.04] text-center">
            <p className="text-2xl font-bold text-[#00ec97]">{totalLikesGiven}</p>
            <p className="text-xs text-slate-400 mt-1">Likes Given</p>
          </div>
          <div className="bg-white/[0.04] rounded-xl p-4 border border-white/[0.04] text-center">
            <p className="text-2xl font-bold text-rose-400">{totalDislikesGiven}</p>
            <p className="text-xs text-slate-400 mt-1">Dislikes Given</p>
          </div>
          {followersCount > 0 && (
            <div className="bg-white/[0.04] rounded-xl p-4 border border-white/[0.04] text-center">
              <p className="text-2xl font-bold text-purple-400">{followersCount}</p>
              <p className="text-xs text-slate-400 mt-1">Followers</p>
            </div>
          )}
        </div>
      </div>

      {/* Songs section */}
      <h2 className="text-lg font-semibold text-white mb-4">Songs</h2>

      {songs.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-slate-500 text-lg">No songs uploaded yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {songs.map((song) => (
            <SongCard key={song.uuid} song={song} />
          ))}
        </div>
      )}

      {/* Followers */}
      {followers.length > 0 && (
        <div className="mt-10">
          <h2 className="text-lg font-semibold text-white mb-4">
            Followers
            <span className="text-sm font-normal text-slate-500 ml-2">{followers.length}</span>
          </h2>
          <div className="flex flex-wrap gap-2">
            {followers.map((f) => (
              <Link
                key={f.account_id}
                href={`/profile/${f.account_id}`}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] hover:border-white/[0.12] transition-all"
              >
                {f.avatar_url ? (
                  <img src={f.avatar_url} alt="" className="w-6 h-6 rounded-full" />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-600 to-cyan-600 flex items-center justify-center text-[10px] font-bold text-white">
                    {(f.display_name || f.account_id).charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="text-sm text-slate-300">
                  {f.display_name || (f.account_id.length > 24 ? `${f.account_id.slice(0, 12)}...${f.account_id.slice(-8)}` : f.account_id)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
