"use client";

import { useEffect, useState, useRef } from "react";
import { getBlogPosts, createBlogPost, deleteBlogPost, updateBlogPost } from "@/lib/api";
import type { BlogPost } from "@/lib/api";
import type { Song } from "@/types";
import { PostCard } from "@/components/post/PostCard";
import { MarkdownToolbar } from "@/components/post/MarkdownToolbar";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ui/Toast";

interface BlogTabProps {
  accountId: string;
  isOwner: boolean;
  songs?: Song[];
}

export function BlogTab({ accountId, isOwner, songs }: BlogTabProps) {
  const { user: authUser } = useAuth();
  const { showToast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setLoading(true);
    getBlogPosts(accountId)
      .then(setPosts)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accountId]);

  const handleCreate = async () => {
    if (!body.trim() || submitting) return;
    setSubmitting(true);
    try {
      const post = await createBlogPost(accountId, body.trim());
      setPosts((prev) => [post, ...prev]);
      setBody("");
      showToast({ message: "Post published!", type: "success", id: "blog-ok", duration: 2000 });
    } catch (e) {
      console.error("Failed to create post:", e);
      showToast({ message: "Failed to publish post.", type: "error", id: "blog-err" });
    }
    setSubmitting(false);
  };

  const handleEdit = async (id: number, newBody: string) => {
    try {
      const updated = await updateBlogPost(accountId, id, newBody);
      setPosts((prev) => prev.map((p) => (p.id === id ? updated : p)));
      showToast({ message: "Post updated!", type: "success", id: "blog-edit-ok", duration: 2000 });
    } catch (e) {
      console.error("Failed to update post:", e);
      showToast({ message: "Failed to update post.", type: "error", id: "blog-edit-err" });
      throw e; // re-throw so PostCard keeps editor open
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteBlogPost(accountId, id);
      setPosts((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      console.error("Failed to delete post:", e);
      showToast({ message: "Failed to delete post.", type: "error", id: "blog-del-err" });
    }
  };

  return (
    <div>
      {/* Create post form */}
      {(isOwner || authUser?.is_admin) && (
        <div className="mb-6 space-y-1">
          <MarkdownToolbar
            textareaRef={textareaRef}
            onInsert={setBody}
            songs={songs}
          />
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleCreate();
            }}
            placeholder="What's on your mind? Supports **markdown** and [[song:UUID]] embeds"
            maxLength={5000}
            rows={4}
            className="w-full rounded-xl px-4 py-3 text-sm border border-white/[0.08] bg-white/[0.04] text-slate-200 placeholder:text-slate-600 focus:border-purple-500 focus:outline-none resize-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-600">{[...body].length}/5000</span>
            <button
              onClick={handleCreate}
              disabled={submitting || !body.trim()}
              className="px-5 py-2 btn-primary rounded-xl text-sm disabled:opacity-40"
            >
              {submitting ? "Publishing..." : "Publish"}
            </button>
          </div>
        </div>
      )}

      {/* Posts list */}
      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-card rounded-xl p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full skeleton" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 skeleton rounded w-32" />
                  <div className="h-4 skeleton rounded w-full" />
                  <div className="h-4 skeleton rounded w-3/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <p className="text-center text-slate-500 py-8">No posts yet.</p>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <div key={post.id} className="glass-card rounded-xl p-4">
              <PostCard
                id={post.id}
                body={post.body}
                created_at={post.created_at}
                updated_at={post.updated_at}
                author_account_id={post.author_account_id}
                author_display_name={post.author_display_name}
                author_avatar_url={post.author_avatar_url}
                author_is_premium={post.author_is_premium}
                author_is_agent={post.author_is_agent}
                reply_count={post.reply_count}
                parentType="blog_post"
                onDelete={handleDelete}
                onEdit={handleEdit}
                shareUrl={`/profile/${accountId}/blog/${post.id}`}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
