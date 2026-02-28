"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getUserProfile } from "@/lib/api";
import { SongCard } from "@/components/song/SongCard";
import type { Song } from "@/types";

function formatNear(yocto: string): string {
  const whole = yocto.padStart(25, "0");
  const intPart = whole.slice(0, whole.length - 24) || "0";
  const fracPart = whole.slice(whole.length - 24, whole.length - 20);
  return `${intPart}.${fracPart}`;
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

  const [user, setUser] = useState<Record<string, unknown> | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8">
            {Array.from({ length: 4 }).map((_, i) => (
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
  const reputationScore = user.reputation_score as string;
  const totalUploads = user.total_uploads as number;
  const totalTipsYocto = user.total_tips_received_yocto as string;
  const memberSince = user.created_at as string;

  return (
    <div className="max-w-7xl mx-auto px-4 py-10">
      {/* Profile header */}
      <div className="glass-card rounded-2xl p-8 mb-8">
        <div className="flex items-center gap-6">
          {/* Avatar placeholder */}
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-600 to-cyan-600 flex items-center justify-center text-3xl font-bold text-white shrink-0">
            {(displayName || accountId).charAt(0).toUpperCase()}
          </div>

          <div className="min-w-0">
            {displayName && (
              <h1 className="text-2xl font-bold text-white truncate">
                {displayName}
              </h1>
            )}
            <p className={`${displayName ? "text-slate-400 text-sm" : "text-2xl font-bold text-white"} truncate`}>
              {accountId}
            </p>
            <p className="text-slate-500 text-xs mt-1">
              Member since {formatDate(memberSince)}
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8">
          <div className="bg-white/[0.04] rounded-xl p-4 border border-white/[0.04] text-center">
            <p className="text-2xl font-bold text-white">{reputationScore}</p>
            <p className="text-xs text-slate-400 mt-1">Reputation</p>
          </div>
          <div className="bg-white/[0.04] rounded-xl p-4 border border-white/[0.04] text-center">
            <p className="text-2xl font-bold text-white">{totalUploads}</p>
            <p className="text-xs text-slate-400 mt-1">Uploads</p>
          </div>
          <div className="bg-white/[0.04] rounded-xl p-4 border border-white/[0.04] text-center">
            <p className="text-2xl font-bold text-white">{formatNear(totalTipsYocto)}</p>
            <p className="text-xs text-slate-400 mt-1">NEAR Received</p>
          </div>
          <div className="bg-white/[0.04] rounded-xl p-4 border border-white/[0.04] text-center">
            <p className="text-2xl font-bold text-white">{songs.length}</p>
            <p className="text-xs text-slate-400 mt-1">Songs</p>
          </div>
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
    </div>
  );
}
