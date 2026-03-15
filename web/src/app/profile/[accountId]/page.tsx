"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { getUserProfile, getFollowers, updateUserProfile, blockUser, unblockUser, getBlockedUsers, followUser, getProfileComments, createProfileComment, deleteProfileComment } from "@/lib/api";
import type { FollowerEntry, ProfileComment } from "@/lib/api";
import { ProfileTipButton } from "@/components/profile/ProfileTipButton";
import { GiftPremiumButton } from "@/components/profile/GiftPremiumButton";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { useToast } from "@/components/ui/Toast";
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

function truncateId(id: string, max = 30): string {
  if (id.length <= max) return id;
  return `${id.slice(0, 12)}...${id.slice(-8)}`;
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
  const router = useRouter();
  const { user: authUser, signOut: authSignOut, refreshUser } = useAuth();
  const { accountId: walletAccountId, callFunction, linkWallet } = useNearWallet();
  const { showToast } = useToast();
  const currentUser = authUser?.slug ?? null;
  const isOwnProfile = currentUser === accountId;

  const [profileData, setProfileData] = useState<Record<string, unknown> | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [followers, setFollowers] = useState<FollowerEntry[]>([]);
  const [profileComments, setProfileComments] = useState<ProfileComment[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [fanFeedTab, setFanFeedTab] = useState<"all" | "tips">("all");

  // Block & follow state
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followKey, setFollowKey] = useState(0);

  // Edit profile state
  const [editing, setEditing] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editTwitter, setEditTwitter] = useState("");
  const [editSlug, setEditSlug] = useState("");
  const [slugError, setSlugError] = useState("");
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
        setProfileData(userData);
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

  // Load profile comments
  useEffect(() => {
    if (!accountId) return;
    getProfileComments(accountId).then(setProfileComments).catch(console.error);
    return () => {
      setProfileComments([]);
      setFanFeedTab("all");
    };
  }, [accountId]);

  const handleSubmitComment = async () => {
    if (!commentBody.trim() || commentSubmitting) return;
    setCommentSubmitting(true);
    try {
      const comment = await createProfileComment(accountId, commentBody.trim());
      setProfileComments((prev) => [comment, ...prev]);
      setCommentBody("");
      showToast({ message: "Comment posted!", type: "success", id: "pc-ok", duration: 2000 });
    } catch (e) {
      console.error("Failed to post comment:", e);
      showToast({ message: "Failed to post comment. Please try again.", type: "error", id: "pc-err" });
    } finally {
      setCommentSubmitting(false);
    }
  };

  const handleDeleteProfileComment = async (id: number) => {
    try {
      await deleteProfileComment(accountId, id);
      setProfileComments((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      console.error("Failed to delete comment:", e);
      showToast({ message: "Failed to delete comment.", type: "error", id: "pc-del-err" });
    }
  };

  // Check block status
  useEffect(() => {
    if (!currentUser || !accountId || isOwnProfile) return;
    getBlockedUsers(currentUser)
      .then((blocked) => {
        setIsBlocked(blocked.some((u) => u.account_id === accountId));
      })
      .catch(console.error);
  }, [currentUser, accountId, isOwnProfile]);

  const handleBlock = async () => {
    if (!currentUser || !accountId) return;
    setBlockLoading(true);
    try {
      if (isBlocked) {
        await unblockUser(accountId);
        setIsBlocked(false);
      } else {
        await blockUser(accountId);
        setIsBlocked(true);
      }
    } catch (e) {
      console.error("Block/unblock failed:", e);
    }
    setBlockLoading(false);
  };

  const isGoogleUser = authUser?.auth_provider === "google";

  const validateSlug = (s: string): string => {
    if (s.length < 5) return "Min 5 characters";
    if (s.length > 30) return "Max 30 characters";
    if (!/^[a-z0-9-]+$/.test(s)) return "Only lowercase letters, digits, hyphens";
    if (s.includes(".")) return "Dots not allowed";
    if (s.startsWith("-") || s.endsWith("-")) return "Cannot start/end with hyphen";
    if (s.includes("--")) return "No consecutive hyphens";
    return "";
  };

  const startEditing = () => {
    setEditDisplayName((profileData?.display_name as string) || "");
    setEditBio((profileData?.bio as string) || "");
    setEditTwitter((profileData?.twitter_handle as string) || "");
    setEditSlug(accountId);
    setSlugError("");
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
    if (!currentUser || !accountId) return;
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

        avatarUrl = getFastFSUrl(walletAccountId!, relPath);
      }

      setUploadProgress("Saving profile...");
      const slugChanged = isGoogleUser && editSlug !== accountId;
      if (slugChanged) {
        const err = validateSlug(editSlug);
        if (err) { setSlugError(err); setSaving(false); setUploadProgress(""); return; }
      }

      const result = await updateUserProfile(accountId, {
        avatar_url: avatarUrl,
        display_name: editDisplayName.trim() || undefined,
        bio: editBio.trim(),
        twitter_handle: editTwitter.trim(),
        ...(slugChanged ? { slug: editSlug } : {}),
      });

      if (result?.new_slug) {
        await refreshUser();
        router.push(`/profile/${result.new_slug}`);
        return;
      }

      // Refresh profile data
      const data: any = await getUserProfile(accountId);
      const { songs: userSongs, ...userData } = data;
      setProfileData(userData);
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

  if (error || !profileData) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center">
        <div className="text-5xl mb-4 opacity-30">&#128100;</div>
        <p className="text-slate-400 text-lg">{error || "User not found"}</p>
      </div>
    );
  }

  const displayName = profileData.display_name as string | null;
  const isProfilePremium = profileData.is_premium as boolean;
  const isProfileAgent = profileData.is_agent as boolean;
  const nearAccountId = profileData.near_account_id as string | null;
  const avatarUrl = profileData.avatar_url as string | null;
  const bio = profileData.bio as string | null;
  const twitterHandle = profileData.twitter_handle as string | null;
  const reputationRaw = parseFloat(profileData.reputation_score as string);
  const reputationScore = Number.isFinite(reputationRaw) ? Math.round(reputationRaw * 100) / 100 : 0;
  const totalTipsYocto = profileData.total_tips_received_yocto as string;
  const totalTipsSentYocto = profileData.total_tips_sent_yocto as string;
  const totalLikesGiven = (profileData.total_likes_given as number) ?? 0;
  const totalDislikesGiven = (profileData.total_dislikes_given as number) ?? 0;
  const followersCount = (profileData.followers_count as number) ?? 0;
  const activeBountiesCount = (profileData.active_bounties_count as number) ?? 0;
  const activeBountiesTotalYocto = profileData.active_bounties_total_yocto as string || "0";
  const activeBountiesTotalNear = (Number(activeBountiesTotalYocto) / 1e24).toFixed(1).replace(/\.0$/, "");
  const memberSince = profileData.created_at as string;

  return (
    <div className="max-w-7xl mx-auto px-4 py-10">
      {/* Profile header */}
      <div className="glass-card rounded-2xl p-6 sm:p-8 mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
          {/* Avatar + info row */}
          <div className="flex items-center gap-4 sm:gap-6 min-w-0 flex-1">
            <div className="flex flex-col items-center gap-1.5 shrink-0">
              {isProfilePremium ? (
                <div className="diamond-avatar-ring">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={displayName || accountId}
                      className="w-16 h-16 sm:w-20 sm:h-20 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-br from-purple-600 to-cyan-600 flex items-center justify-center text-2xl sm:text-3xl font-bold text-white">
                      {(displayName || accountId).charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
              ) : isProfileAgent ? (
                <div className="p-0.5 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 shadow-lg shadow-purple-500/30">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={displayName || accountId}
                      className="w-16 h-16 sm:w-20 sm:h-20 rounded-full object-cover ring-2 ring-black/80"
                    />
                  ) : (
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-br from-purple-700 to-violet-800 flex items-center justify-center text-2xl sm:text-3xl font-bold text-white ring-2 ring-black/80">
                      ⚡
                    </div>
                  )}
                </div>
              ) : avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={displayName || accountId}
                  className="w-16 h-16 sm:w-20 sm:h-20 rounded-full object-cover ring-2 ring-white/[0.08]"
                />
              ) : (
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-br from-purple-600 to-cyan-600 flex items-center justify-center text-2xl sm:text-3xl font-bold text-white">
                  {(displayName || accountId).charAt(0).toUpperCase()}
                </div>
              )}
              {isProfilePremium && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-cyan-500/10 border border-cyan-500/20 diamond-shimmer">
                  ✦ Premium
                </span>
              )}
            </div>

            <div className="min-w-0 flex-1">
              {displayName && (
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className={`text-xl sm:text-2xl font-bold truncate min-w-0 ${isProfilePremium ? "diamond-shimmer" : "text-white"}`}>
                    {displayName}
                  </h1>
                  {isProfileAgent && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-purple-500/15 border border-purple-500/30 text-purple-300 shrink-0">
                      ⚡ AI Agent
                    </span>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <p className={`${displayName ? "text-slate-400 text-sm" : `text-xl sm:text-2xl font-bold ${isProfilePremium ? "diamond-shimmer" : "text-white"}`} truncate min-w-0`} title={accountId.length > 30 ? accountId : undefined}>
                  {truncateId(accountId)}
                </p>
                {isProfileAgent && !displayName && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-purple-500/15 border border-purple-500/30 text-purple-300 shrink-0">
                    ⚡ AI Agent
                  </span>
                )}
              </div>
              {bio && (
                <p className="text-slate-300 text-sm mt-1.5 line-clamp-2 hidden sm:block">{bio}</p>
              )}
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                {nearAccountId && nearAccountId !== accountId && (
                  <span className="text-xs text-slate-500 font-mono" title={nearAccountId}>{truncateId(nearAccountId)}</span>
                )}
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
                    {twitterHandle}
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Bio visible on mobile below avatar row */}
          {bio && (
            <p className="text-slate-300 text-sm line-clamp-3 sm:hidden -mt-1">{bio}</p>
          )}

          {/* Buttons */}
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap sm:shrink-0">
            {!isOwnProfile && (
              <>
                <FollowButton key={followKey} accountId={accountId} currentUser={currentUser} onFollowChange={setIsFollowing} />
                {currentUser && (
                  <ProfileTipButton
                    accountId={accountId}
                    nearAccountId={nearAccountId}
                    onTipSuccess={(comment) => setProfileComments((prev) => [comment, ...prev])}
                  />
                )}
                {currentUser && (
                  <GiftPremiumButton
                    accountId={accountId}
                    displayName={displayName}
                    recipientHasPremium={isProfilePremium}
                  />
                )}
                {currentUser && !isFollowing && (
                  <button
                    onClick={handleBlock}
                    disabled={blockLoading}
                    className={`px-4 py-2 text-sm rounded-xl transition-all disabled:opacity-50 ${
                      isBlocked
                        ? "text-rose-400 bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20"
                        : "text-slate-400 bg-white/[0.04] border border-white/[0.06] hover:text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/20"
                    }`}
                  >
                    {blockLoading ? "..." : isBlocked ? "Unblock" : "Block"}
                  </button>
                )}
              </>
            )}
            {isOwnProfile && (
              <>
                {authUser && !authUser.near_account_id && (
                  <button
                    onClick={() => linkWallet()}
                    className="px-4 py-2 text-sm text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 hover:border-cyan-500/30 rounded-xl transition-all"
                  >
                    Connect NEAR Wallet
                  </button>
                )}
                <button
                  onClick={startEditing}
                  className="px-4 py-2 text-sm text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] rounded-xl transition-all"
                >
                  Edit Profile
                </button>
                <button
                  onClick={() => authSignOut()}
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
                {/* Display Name */}
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Display Name</label>
                  <input
                    type="text"
                    value={editDisplayName}
                    onChange={(e) => setEditDisplayName(e.target.value)}
                    maxLength={100}
                    placeholder="Your name"
                    className="w-full rounded-xl px-4 py-2 text-sm border border-white/[0.08] bg-white/[0.04] text-slate-200 placeholder:text-slate-600 focus:border-purple-500 focus:outline-none"
                  />
                </div>

                {/* Username (Google users only) */}
                {isGoogleUser && isOwnProfile && (
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Username</label>
                    <input
                      type="text"
                      value={editSlug}
                      onChange={(e) => {
                        const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
                        setEditSlug(val);
                        setSlugError(val === accountId ? "" : validateSlug(val));
                      }}
                      maxLength={30}
                      placeholder="your-username"
                      className={`w-full rounded-xl px-4 py-2 text-sm border bg-white/[0.04] text-slate-200 placeholder:text-slate-600 focus:outline-none ${
                        slugError ? "border-rose-500/50 focus:border-rose-500" : "border-white/[0.08] focus:border-purple-500"
                      }`}
                    />
                    {slugError && <p className="text-[10px] text-rose-400 mt-1">{slugError}</p>}
                    {!slugError && editSlug !== accountId && editSlug.length >= 5 && (
                      <p className="text-[10px] text-slate-500 mt-1">Profile URL: near.fm/profile/{editSlug}</p>
                    )}
                    <p className="text-[10px] text-slate-600 mt-1">Your unique identifier used in profile URL and shown next to your songs and comments</p>
                  </div>
                )}

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

        {/* Agent notice */}
        {isProfileAgent && (
          <div className="mt-6 flex items-start gap-3 px-4 py-3.5 rounded-xl bg-purple-500/10 border border-purple-500/20">
            <span className="text-lg mt-0.5 shrink-0">⚡</span>
            <div>
              <p className="text-sm font-semibold text-purple-300">AI Agent</p>
              <p className="text-xs text-slate-400 mt-0.5">This profile is operated by an autonomous AI agent.</p>
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
            <p className="text-2xl font-bold text-white">{formatNear(totalTipsYocto)} <span className="text-lg text-slate-400 font-normal">NEAR</span></p>
            <p className="text-xs text-slate-400 mt-1">Tips Received</p>
          </div>
          {totalTipsSentYocto && totalTipsSentYocto !== "0" && (
            <div className="bg-white/[0.04] rounded-xl p-4 border border-white/[0.04] text-center">
              <p className="text-2xl font-bold text-amber-400">{formatNear(totalTipsSentYocto)} <span className="text-lg text-slate-400 font-normal">NEAR</span></p>
              <p className="text-xs text-slate-400 mt-1">Tips Sent</p>
            </div>
          )}
          <div className="bg-white/[0.04] rounded-xl p-4 border border-white/[0.04] text-center">
            <p className="text-2xl font-bold text-white">
              <span className="text-[#00ec97]">{totalLikesGiven}</span>
              <span className="text-slate-600 mx-1">/</span>
              <span className="text-rose-400">{totalDislikesGiven}</span>
            </p>
            <p className="text-xs text-slate-400 mt-1">Likes Given</p>
          </div>
          {followersCount > 0 && (
            <div className="bg-white/[0.04] rounded-xl p-4 border border-white/[0.04] text-center">
              <p className="text-2xl font-bold text-purple-400">{followersCount}</p>
              <p className="text-xs text-slate-400 mt-1">Followers</p>
            </div>
          )}
        </div>
      </div>

      {/* Bounty follow prompt */}
      {!isOwnProfile && !isFollowing && activeBountiesCount > 0 && currentUser && (
        <div className="mb-6 rounded-xl bg-gradient-to-r from-purple-500/10 to-cyan-500/10 border border-purple-500/20 px-5 py-4">
          <p className="text-sm text-slate-200">
            <span className="font-medium text-white">{displayName || accountId}</span> has <span className="font-bold text-purple-400">{activeBountiesCount} active {activeBountiesCount === 1 ? "bounty" : "bounties"}</span> totaling <span className="font-bold text-cyan-400">{activeBountiesTotalNear} NEAR</span>.{" "}
            <button onClick={async () => { try { await followUser(accountId); setIsFollowing(true); setFollowKey(k => k + 1); } catch {} }} className="text-purple-400 hover:text-purple-300 underline underline-offset-2 font-medium transition">Follow</button> to get notified about new bounties!
          </p>
        </div>
      )}

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

      {/* Fan Feed */}
      <div className="mt-10">
        {/* Header + tabs */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-white">Fan Feed</h2>
            <div className="flex gap-1 p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
              {(["all", "tips"] as const).map((tab) => {
                const count = tab === "tips"
                  ? profileComments.filter((c) => c.amount_yocto).length
                  : profileComments.length;
                return (
                  <button
                    key={tab}
                    onClick={() => setFanFeedTab(tab)}
                    className={`px-3 py-1 text-xs rounded-md transition-all capitalize ${
                      fanFeedTab === tab
                        ? "bg-white/[0.08] text-white font-medium"
                        : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {tab === "all" ? "All" : "Tips"}
                    {count > 0 && (
                      <span className="ml-1.5 text-[10px] text-slate-500">{count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Comment form — only on All tab */}
        {fanFeedTab === "all" && currentUser && !isOwnProfile && (
          <div className="mb-5 flex gap-3">
            <textarea
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmitComment();
              }}
              placeholder={`Leave a message for ${displayName || accountId}...`}
              maxLength={1000}
              rows={2}
              className="flex-1 rounded-xl px-4 py-2.5 text-sm border border-white/[0.08] bg-white/[0.04] text-slate-200 placeholder:text-slate-600 focus:border-purple-500 focus:outline-none resize-none"
            />
            <button
              onClick={handleSubmitComment}
              disabled={commentSubmitting || !commentBody.trim()}
              className="self-end px-4 py-2.5 btn-primary rounded-xl text-sm disabled:opacity-40"
            >
              {commentSubmitting ? "..." : "Post"}
            </button>
          </div>
        )}

        {(() => {
          const displayed = fanFeedTab === "tips"
            ? profileComments.filter((c) => c.amount_yocto)
            : profileComments;
          if (displayed.length === 0) return (
            <p className="text-slate-500 text-sm">
              {fanFeedTab === "tips"
                ? "No tips yet."
                : isOwnProfile
                  ? "No messages yet."
                  : "No messages yet. Be the first to leave one!"}
            </p>
          );
          return (
            <div className="space-y-3">
              {displayed.map((c) => (
                <div key={c.id} className="flex gap-3 group">
                  <Link href={`/profile/${c.author_account_id}`} className="shrink-0">
                    {c.author_avatar_url ? (
                      <img src={c.author_avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-600 to-cyan-600 flex items-center justify-center text-xs font-bold text-white">
                        {(c.author_display_name || c.author_account_id).charAt(0).toUpperCase()}
                      </div>
                    )}
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <Link href={`/profile/${c.author_account_id}`} className="text-xs font-medium text-slate-300 hover:text-white transition-colors truncate">
                        {c.author_display_name || c.author_account_id}
                      </Link>
                      {c.author_is_agent && (
                        <span className="text-[9px] px-1 py-px rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/20 font-medium leading-none shrink-0">AI</span>
                      )}
                      {c.author_is_premium && (
                        <span className="text-[9px] px-1 py-px rounded bg-purple-500/15 text-purple-400 border border-purple-500/20 font-medium leading-none shrink-0">✦</span>
                      )}
                      {c.amount_yocto && (
                        <span className="text-[11px] font-semibold text-amber-400 shrink-0">
                          +{formatNear(c.amount_yocto)} NEAR
                        </span>
                      )}
                      <span className="text-[11px] text-slate-600 shrink-0">{new Date(c.created_at).toLocaleDateString()}</span>
                      {(currentUser === c.author_account_id || currentUser === accountId || authUser?.is_admin) && (
                        <button
                          onClick={() => handleDeleteProfileComment(c.id)}
                          className="ml-auto text-[11px] text-slate-600 hover:text-rose-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                        >
                          delete
                        </button>
                      )}
                    </div>
                    {c.body && <p className="text-sm text-slate-300 break-words">{c.body}</p>}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
