import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") || "";

  if (hostname.startsWith("upload.")) {
    const { pathname } = request.nextUrl;
    // Let static assets and API pass through
    if (pathname.startsWith("/_next/") || pathname.startsWith("/favicon")) {
      return NextResponse.next();
    }
    // Allow /upload through as-is
    if (pathname === "/upload") {
      return NextResponse.next();
    }
    // Rewrite / to /upload (so upload.near.fm/ serves the upload page)
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/upload";
      return NextResponse.rewrite(url);
    }
    // Redirect everything else back to near.fm
    return NextResponse.redirect(`https://near.fm${pathname}`);
  }

  // Rewrite /profile/:slug/songs|blog|feed|tips → /profile/:slug?tab=...
  const { pathname } = request.nextUrl;
  const profileTabMatch = pathname.match(/^\/profile\/([^/]+)\/(songs|feed|tips)$/);
  if (profileTabMatch) {
    const url = request.nextUrl.clone();
    url.pathname = `/profile/${profileTabMatch[1]}`;
    url.searchParams.set("tab", profileTabMatch[2]);
    return NextResponse.rewrite(url);
  }
  // /profile/:slug/blog (exact, no further segments) → ?tab=blog
  const blogTabMatch = pathname.match(/^\/profile\/([^/]+)\/blog$/);
  if (blogTabMatch) {
    const url = request.nextUrl.clone();
    url.pathname = `/profile/${blogTabMatch[1]}`;
    url.searchParams.set("tab", "blog");
    return NextResponse.rewrite(url);
  }
  // /profile/:slug/blog/123 falls through to Next.js file routing (has generateMetadata)

  // Rewrite /trending, /latest, /top to /?sort=...
  const sortRoutes: Record<string, string> = {
    "/trending": "trending",
    "/latest": "latest",
    "/top": "top",
    "/following": "following",
    "/community": "community",
  };
  if (sortRoutes[pathname]) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("sort", sortRoutes[pathname]);
    return NextResponse.rewrite(url);
  }

  // Rewrite /category/:slug to /?category_slug=slug (e.g. /category/solana)
  const categoryMatch = pathname.match(/^\/category\/([^/]+)$/);
  if (categoryMatch) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("category_slug", categoryMatch[1]);
    return NextResponse.rewrite(url);
  }

  // Top-level category slugs (e.g. /near, /solana, /ethereum)
  const categoryShortcuts: Record<string, string> = {
    "/near": "near",
    "/solana": "solana",
    "/ethereum": "ethereum",
    "/crypto": "crypto",
    "/fun": "fun",
    "/other": "other",
  };
  if (categoryShortcuts[pathname]) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("category_slug", categoryShortcuts[pathname]);
    return NextResponse.rewrite(url);
  }

  // Rewrite /genre/:slug to /?genre=slug
  const genreMatch = pathname.match(/^\/genre\/([^/]+)$/);
  if (genreMatch) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("genre", genreMatch[1]);
    return NextResponse.rewrite(url);
  }

  // Rewrite /language/:code to /?lang_code=code
  const langMatch = pathname.match(/^\/language\/([^/]+)$/);
  if (langMatch) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("lang_code", langMatch[1]);
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}
