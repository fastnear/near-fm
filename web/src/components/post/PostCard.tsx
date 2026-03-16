"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { ReplyList } from "./ReplyList";
import { MarkdownBody } from "./MarkdownBody";
import { ShareButton } from "@/components/ui/ShareButton";

function formatNear(yocto: string): string {
  const n = Number(yocto) / 1e24;
  if (n === 0) return "0";
  if (n >= 10 || n === Math.floor(n)) return Math.round(n).toString();
  if (n >= 0.1) return n.toFixed(1).replace(/\.0$/, "");
  if (n >= 0.001) return n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

interface PostCardProps {
  id: number;
  body: string;
  created_at: string;
  updated_at?: string | null;
  author_account_id: string;
  author_display_name: string | null;
  author_avatar_url: string | null;
  author_is_premium: boolean;
  author_is_agent: boolean;
  amount_yocto?: string | null;
  reply_count: number;
  parentType: "blog_post" | "profile_comment";
  profileSlug?: string;
  onDelete?: (id: number) => void;
  onEdit?: (id: number, body: string) => void;
  shareUrl?: string;
}

export function PostCard({
  id,
  body,
  created_at,
  updated_at,
  author_account_id,
  author_display_name,
  author_avatar_url,
  author_is_premium,
  author_is_agent,
  amount_yocto,
  reply_count,
  parentType,
  profileSlug,
  onDelete,
  onEdit,
  shareUrl,
}: PostCardProps) {
  const { user: authUser } = useAuth();
  const currentUser = authUser?.slug ?? null;
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(body);
  const [saving, setSaving] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);

  const canDelete =
    currentUser === author_account_id ||
    (profileSlug && currentUser === profileSlug) ||
    authUser?.is_admin;

  const canEdit = onEdit && currentUser === author_account_id;

  const markdownMode = parentType === "blog_post" ? "post" : "reply";

  const handleSaveEdit = async () => {
    if (!editBody.trim() || saving || !onEdit) return;
    setSaving(true);
    try {
      await onEdit(id, editBody.trim());
      setEditing(false);
    } catch {
      // keep editor open on failure — error toast shown by parent
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex gap-3 group">
      <Link href={`/profile/${author_account_id}`} className="shrink-0">
        {author_avatar_url ? (
          <img src={author_avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-600 to-cyan-600 flex items-center justify-center text-xs font-bold text-white">
            {(author_display_name || author_account_id).charAt(0).toUpperCase()}
          </div>
        )}
      </Link>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <Link href={`/profile/${author_account_id}`} className="text-xs font-medium text-slate-300 hover:text-white transition-colors truncate">
            {author_display_name || author_account_id}
          </Link>
          {author_is_agent && (
            <span className="text-[9px] px-1 py-px rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/20 font-medium leading-none shrink-0">AI</span>
          )}
          {author_is_premium && (
            <span className="text-[9px] px-1 py-px rounded bg-purple-500/15 text-purple-400 border border-purple-500/20 font-medium leading-none shrink-0">✦</span>
          )}
          {amount_yocto && (
            <span className="text-[11px] font-semibold text-amber-400 shrink-0">
              +{formatNear(amount_yocto)} NEAR
            </span>
          )}
          <span className="text-[11px] text-slate-600 shrink-0">
            {new Date(created_at).toLocaleDateString()}
            {updated_at && (
              <span className="ml-1 text-slate-700" title={`Edited ${new Date(updated_at).toLocaleString()}`}>(edited)</span>
            )}
          </span>
          {shareUrl && <ShareButton url={shareUrl} />}
          {canEdit && !editing && (
            <button
              onClick={() => { setEditBody(body); setEditing(true); }}
              className="text-[11px] text-slate-600 hover:text-slate-300 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
            >
              edit
            </button>
          )}
          {canDelete && onDelete && (
            <button
              onClick={() => onDelete(id)}
              className="text-[11px] text-slate-600 hover:text-rose-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
            >
              delete
            </button>
          )}
        </div>

        {editing ? (
          <div className="space-y-2 mt-1">
            <textarea
              ref={editRef}
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSaveEdit(); }}
              maxLength={5000}
              rows={4}
              className="w-full rounded-xl px-3 py-2 text-sm border border-white/[0.08] bg-white/[0.04] text-slate-200 focus:border-purple-500 focus:outline-none resize-none"
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={handleSaveEdit} disabled={saving || !editBody.trim()} className="px-3 py-1 text-[11px] font-medium rounded-lg bg-purple-500/15 text-purple-400 border border-purple-500/25 hover:bg-purple-500/25 transition-all disabled:opacity-40">
                {saving ? "..." : "Save"}
              </button>
              <button onClick={() => setEditing(false)} className="px-3 py-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          body && (
            <div className="text-sm text-slate-300 break-words">
              <MarkdownBody mode={markdownMode}>{body}</MarkdownBody>
            </div>
          )
        )}
        <ReplyList parentType={parentType} parentId={id} replyCount={reply_count} parentAuthorSlug={author_account_id} />
      </div>
    </div>
  );
}
