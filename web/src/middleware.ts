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

  return NextResponse.next();
}
