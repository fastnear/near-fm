import type { Metadata } from "next";
import BlogPostDetail from "./BlogPostDetail";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

async function fetchBlogPost(slug: string, postId: string) {
  try {
    const res = await fetch(`${API_URL}/api/users/${slug}/blog/${postId}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ accountId: string; postId: string }>;
}): Promise<Metadata> {
  const { accountId, postId } = await params;
  const post = await fetchBlogPost(accountId, postId);
  if (!post) {
    return { title: "Post not found — near.fm" };
  }

  const authorName = post.author_display_name || post.author_account_id;
  const cleanBody = post.body
    .replace(/\[\[song:[a-f0-9-]{36}\]\]/gi, "")
    .replace(/[#*_~`>\[\]()!]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const preview = cleanBody.length > 200 ? cleanBody.slice(0, 200) + "..." : cleanBody;

  return {
    title: `${authorName} on near.fm`,
    description: preview,
    openGraph: {
      title: `${authorName} on near.fm`,
      description: preview,
      type: "article",
      siteName: "near.fm",
      ...(post.author_avatar_url && { images: [{ url: post.author_avatar_url }] }),
    },
    twitter: {
      card: "summary",
      title: `${authorName} on near.fm`,
      description: preview,
      ...(post.author_avatar_url && { images: [post.author_avatar_url] }),
    },
  };
}

export default function BlogPostPage() {
  return <BlogPostDetail />;
}
