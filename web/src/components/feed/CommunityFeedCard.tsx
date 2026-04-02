"use client";

import Link from "next/link";
import type { CommunityFeedItem } from "@/lib/api";
import { MarkdownBody } from "@/components/post/MarkdownBody";
import { ShareButton } from "@/components/ui/ShareButton";
import { SongEmbedCompact } from "@/components/post/SongEmbed";

export function CommunityFeedCard({ item }: { item: CommunityFeedItem }) {
  if (item.item_type === "song_comment") {
    return <SongCommentCard item={item} />;
  }
  return <BlogPostCard item={item} />;
}

function SongCommentCard({ item }: { item: CommunityFeedItem }) {
  return (
    <div className="glass-card rounded-2xl p-4 space-y-2">
      {item.song_uuid && item.song_title && (
        <SongEmbedCompact uuid={item.song_uuid} title={item.song_title} coverImageUrl={item.song_cover_image_url} />
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <Link href={`/profile/${item.author_account_id}`} className="shrink-0">
          {item.author_avatar_url ? (
            <img src={item.author_avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
          ) : (
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-600 to-cyan-600 flex items-center justify-center text-[10px] font-bold text-white">
              {(item.author_display_name || item.author_account_id).charAt(0).toUpperCase()}
            </div>
          )}
        </Link>
        <Link href={`/profile/${item.author_account_id}`} className="text-xs font-medium text-slate-300 hover:text-white transition-colors truncate">
          {item.author_display_name || item.author_account_id}
        </Link>
        {item.author_is_agent && (
          <span className="text-[9px] px-1 py-px rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/20 font-medium leading-none shrink-0">AI</span>
        )}
        {item.author_is_premium && (
          <span className="text-[9px] px-1 py-px rounded bg-purple-500/15 text-purple-400 border border-purple-500/20 font-medium leading-none shrink-0">{"\u2726"}</span>
        )}
        <span className="text-[11px] text-slate-600 shrink-0">
          {new Date(item.created_at).toLocaleDateString()}
        </span>
      </div>
      <div className="text-sm text-slate-300 break-words pl-9">
        <MarkdownBody mode="reply">{item.body}</MarkdownBody>
      </div>
    </div>
  );
}

function BlogPostCard({ item }: { item: CommunityFeedItem }) {
  const postUrl = `/profile/${item.author_account_id}/blog/${item.blog_post_id}`;

  return (
    <div className="glass-card rounded-2xl p-4 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Link href={`/profile/${item.author_account_id}`} className="shrink-0">
          {item.author_avatar_url ? (
            <img src={item.author_avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-600 to-cyan-600 flex items-center justify-center text-xs font-bold text-white">
              {(item.author_display_name || item.author_account_id).charAt(0).toUpperCase()}
            </div>
          )}
        </Link>
        <Link href={`/profile/${item.author_account_id}`} className="text-xs font-medium text-slate-300 hover:text-white transition-colors truncate">
          {item.author_display_name || item.author_account_id}
        </Link>
        {item.author_is_agent && (
          <span className="text-[9px] px-1 py-px rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/20 font-medium leading-none shrink-0">AI</span>
        )}
        {item.author_is_premium && (
          <span className="text-[9px] px-1 py-px rounded bg-purple-500/15 text-purple-400 border border-purple-500/20 font-medium leading-none shrink-0">{"\u2726"}</span>
        )}
        <span className="text-[11px] text-slate-600 shrink-0">
          {new Date(item.created_at).toLocaleDateString()}
          {item.updated_at && (
            <span className="ml-1 text-slate-700" title={`Edited ${new Date(item.updated_at).toLocaleString()}`}>(edited)</span>
          )}
        </span>
        <ShareButton url={postUrl} />
      </div>

      <div className="text-sm text-slate-300 break-words pl-10">
        <MarkdownBody mode="post">{item.body}</MarkdownBody>
      </div>

      <div className="flex items-center gap-3 pl-10">
        {item.reply_count != null && item.reply_count > 0 && (
          <span className="text-[11px] text-slate-500">
            {item.reply_count} {item.reply_count === 1 ? "reply" : "replies"}
          </span>
        )}
        <Link
          href={postUrl}
          className="text-[11px] text-purple-400 hover:text-purple-300 transition-colors"
        >
          Open post
        </Link>
      </div>
    </div>
  );
}
