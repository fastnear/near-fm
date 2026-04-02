"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ui/Toast";
import { getBlogPost, deleteBlogPost } from "@/lib/api";
import type { BlogPost } from "@/lib/api";
import { PostCard } from "@/components/post/PostCard";

export default function BlogPostDetail() {
  const params = useParams<{ accountId: string; postId: string }>();
  const accountId = params.accountId;
  const postId = Number(params.postId);
  const router = useRouter();
  const { user: authUser } = useAuth();
  const { showToast } = useToast();

  const [post, setPost] = useState<BlogPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId || isNaN(postId)) return;
    setLoading(true);
    setError(null);
    getBlogPost(accountId, postId)
      .then(setPost)
      .catch((e) => {
        console.error("Failed to load post:", e);
        setError("Post not found.");
      })
      .finally(() => setLoading(false));
  }, [accountId, postId]);

  const handleDelete = async (id: number) => {
    try {
      await deleteBlogPost(accountId, id);
      showToast({ message: "Post deleted.", type: "success", id: "blog-del", duration: 2000 });
      router.push(`/profile/${accountId}/blog`);
    } catch (e) {
      console.error("Failed to delete post:", e);
      showToast({ message: "Failed to delete post.", type: "error", id: "blog-del-err" });
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="glass-card rounded-xl p-6 animate-pulse">
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full skeleton" />
            <div className="flex-1 space-y-2">
              <div className="h-3 skeleton rounded w-32" />
              <div className="h-4 skeleton rounded w-full" />
              <div className="h-4 skeleton rounded w-3/4" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <p className="text-slate-400 text-lg">{error || "Post not found"}</p>
        <Link href={`/profile/${accountId}/blog`} className="text-purple-400 hover:underline text-sm mt-4 inline-block">
          ← Back to blog
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={`/profile/${accountId}/blog`}
          className="text-slate-500 hover:text-white transition-colors text-sm"
        >
          ← Blog
        </Link>
      </div>

      <div className="glass-card rounded-xl p-6">
        <PostCard
          id={post.id}
          body={post.body}
          created_at={post.created_at}
          author_account_id={post.author_account_id}
          author_display_name={post.author_display_name}
          author_avatar_url={post.author_avatar_url}
          author_is_premium={post.author_is_premium}
          author_is_agent={post.author_is_agent}
          reply_count={post.reply_count}
          parentType="blog_post"
          onDelete={handleDelete}
        />
      </div>
    </div>
  );
}
