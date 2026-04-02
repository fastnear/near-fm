"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ui/Toast";
import { getReplies, createReply, deleteReply } from "@/lib/api";
import type { PostReply } from "@/lib/api";

interface ReplyListProps {
  parentType: "blog_post" | "profile_comment";
  parentId: number;
  replyCount: number;
  /** Slug of the parent content author (can delete replies on their content) */
  parentAuthorSlug?: string;
}

export function ReplyList({ parentType, parentId, replyCount, parentAuthorSlug }: ReplyListProps) {
  const { user: authUser } = useAuth();
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [replies, setReplies] = useState<PostReply[]>([]);
  const [loading, setLoading] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localCount, setLocalCount] = useState(replyCount);

  const loadReplies = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const data = await getReplies(parentType, parentId);
      setReplies(data);
      setLocalCount(data.length);
    } catch (e) {
      console.error("Failed to load replies:", e);
    }
    setLoading(false);
  };

  const toggleExpand = () => {
    if (!expanded) {
      loadReplies();
    }
    setExpanded(!expanded);
  };

  const handleSubmit = async () => {
    if (!replyBody.trim() || submitting) return;
    setSubmitting(true);
    try {
      const reply = await createReply(parentType, parentId, replyBody.trim());
      setReplies((prev) => [...prev, reply]);
      setLocalCount((c) => c + 1);
      setReplyBody("");
      if (!expanded) setExpanded(true);
    } catch (e) {
      console.error("Failed to post reply:", e);
      showToast({ message: "Failed to post reply.", type: "error", id: `reply-err-${parentType}-${parentId}` });
    }
    setSubmitting(false);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteReply(id);
      setReplies((prev) => prev.filter((r) => r.id !== id));
      setLocalCount((c) => Math.max(0, c - 1));
    } catch (e) {
      console.error("Failed to delete reply:", e);
    }
  };

  return (
    <div className="mt-1.5">
      {/* Toggle / reply count button */}
      <div className="flex items-center gap-2">
        {localCount > 0 && (
          <button
            onClick={toggleExpand}
            className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
          >
            {expanded ? "Hide replies" : `${localCount} ${localCount === 1 ? "reply" : "replies"}`}
          </button>
        )}
        {authUser && !expanded && (
          <button
            onClick={() => { setExpanded(true); if (localCount > 0 && replies.length === 0) loadReplies(); }}
            className="text-[11px] text-slate-500 hover:text-purple-400 transition-colors"
          >
            Reply
          </button>
        )}
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className="mt-2 ml-4 pl-3 border-l border-white/[0.06] space-y-2">
          {loading && replies.length === 0 && (
            <p className="text-[11px] text-slate-600">Loading...</p>
          )}
          {replies.map((r) => (
            <div key={r.id} className="flex gap-2 group/reply">
              <Link href={`/profile/${r.author_account_id}`} className="shrink-0">
                {r.author_avatar_url ? (
                  <img src={r.author_avatar_url} alt="" className="w-6 h-6 rounded-full object-cover" />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-600 to-cyan-600 flex items-center justify-center text-[9px] font-bold text-white">
                    {(r.author_display_name || r.author_account_id).charAt(0).toUpperCase()}
                  </div>
                )}
              </Link>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Link href={`/profile/${r.author_account_id}`} className="text-[11px] font-medium text-slate-400 hover:text-white transition-colors">
                    {r.author_display_name || r.author_account_id}
                  </Link>
                  {r.author_is_agent && (
                    <span className="text-[8px] px-1 py-px rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/20 font-medium leading-none">AI</span>
                  )}
                  {r.author_is_premium && (
                    <span className="text-[8px] px-1 py-px rounded bg-purple-500/15 text-purple-400 border border-purple-500/20 font-medium leading-none">✦</span>
                  )}
                  <span className="text-[10px] text-slate-600">{new Date(r.created_at).toLocaleDateString()}</span>
                  {(authUser?.slug === r.author_account_id || (parentAuthorSlug && authUser?.slug === parentAuthorSlug) || authUser?.is_admin) && (
                    <button
                      onClick={() => handleDelete(r.id)}
                      className="text-[10px] text-slate-600 hover:text-rose-400 transition-colors opacity-0 group-hover/reply:opacity-100"
                    >
                      delete
                    </button>
                  )}
                </div>
                <p className="text-[13px] text-slate-300 break-words">{r.body}</p>
              </div>
            </div>
          ))}

          {/* Reply input */}
          {authUser && (
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                placeholder="Write a reply..."
                maxLength={1000}
                className="flex-1 rounded-lg px-3 py-1.5 text-[12px] border border-white/[0.08] bg-white/[0.04] text-slate-200 placeholder:text-slate-600 focus:border-purple-500 focus:outline-none"
              />
              <button
                onClick={handleSubmit}
                disabled={submitting || !replyBody.trim()}
                className="px-3 py-1.5 text-[11px] font-medium rounded-lg bg-purple-500/15 text-purple-400 border border-purple-500/25 hover:bg-purple-500/25 transition-all disabled:opacity-40"
              >
                {submitting ? "..." : "Reply"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
