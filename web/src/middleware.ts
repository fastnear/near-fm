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

  // Rewrite /trending, /latest, /top to /?sort=...
  const { pathname } = request.nextUrl;
  const sortRoutes: Record<string, string> = {
    "/trending": "trending",
    "/latest": "latest",
    "/top": "top",
    "/following": "following",
  };
  if (sortRoutes[pathname]) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("sort", sortRoutes[pathname]);
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
