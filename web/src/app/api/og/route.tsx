import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const title = searchParams.get("title") || "near.fm";
  const subtitle = searchParams.get("subtitle") || "";
  const author = searchParams.get("author") || "";
  const type = searchParams.get("type") || "default";
  const cover = searchParams.get("cover") || "";

  const bgUrl = cover || "https://near.fm/near-fm-hor.png";
  const headers = { "Cache-Control": "public, max-age=86400, s-maxage=86400" };

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200",
          height: "630",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          fontFamily: "sans-serif",
          background: "#0a0a0a",
        }}
      >
        {/* Background: cover or default image, stretched to fill */}
        <img
          src={bgUrl}
          width="1200"
          height="630"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "1200px",
            height: "630px",
            objectFit: "cover",
          }}
        />

        {/* Dark gradient overlay — heavier at bottom for text */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: cover
              ? "linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.3) 40%, rgba(0,0,0,0.85) 100%)"
              : "linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.6) 40%, rgba(0,0,0,0.8) 100%)",
          }}
        />

        {/* Top: NEAR FM branding */}
        <div
          style={{
            position: "absolute",
            top: "30px",
            left: "40px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            zIndex: 1,
          }}
        >
          <div
            style={{
              fontSize: "22px",
              fontWeight: "bold",
              background: "linear-gradient(135deg, #a855f7, #06b6d4)",
              backgroundClip: "text",
              color: "transparent",
              textShadow: "0 1px 8px rgba(0,0,0,0.5)",
            }}
          >
            NEAR FM
          </div>
          <div style={{ fontSize: "15px", color: "rgba(255,255,255,0.6)", textShadow: "0 1px 4px rgba(0,0,0,0.5)" }}>
            AI Music Platform
          </div>
        </div>

        {/* Type badge — top right for requests */}
        {type === "request" && (
          <div
            style={{
              position: "absolute",
              top: "30px",
              right: "40px",
              display: "flex",
              alignItems: "center",
              padding: "8px 20px",
              borderRadius: "20px",
              background: "rgba(168, 85, 247, 0.3)",
              border: "1px solid rgba(168, 85, 247, 0.5)",
              color: "#d8b4fe",
              fontSize: "16px",
              letterSpacing: "2px",
              fontWeight: "600",
              zIndex: 1,
            }}
          >
            SONG REQUEST
          </div>
        )}

        {/* Bottom: title + subtitle + author */}
        <div
          style={{
            position: "absolute",
            bottom: "40px",
            left: "40px",
            right: "40px",
            display: "flex",
            flexDirection: "column",
            zIndex: 1,
          }}
        >
          {/* Title */}
          <div
            style={{
              display: "flex",
              fontSize: title.length > 40 ? "42px" : title.length > 25 ? "50px" : "58px",
              fontWeight: "bold",
              color: "white",
              lineHeight: 1.2,
              textShadow: "0 2px 16px rgba(0,0,0,0.7)",
              maxWidth: "1000px",
            }}
          >
            {title}
          </div>

          {/* Subtitle + Author row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
              marginTop: "12px",
            }}
          >
            {subtitle && (
              <div
                style={{
                  fontSize: "24px",
                  fontWeight: "600",
                  color: "#c4b5fd",
                  textShadow: "0 2px 8px rgba(0,0,0,0.6)",
                }}
              >
                {subtitle}
              </div>
            )}
            {subtitle && author && (
              <div style={{ width: "2px", height: "20px", background: "rgba(255,255,255,0.2)" }} />
            )}
            {author && (
              <div
                style={{
                  fontSize: "20px",
                  color: "rgba(255,255,255,0.6)",
                  textShadow: "0 2px 8px rgba(0,0,0,0.6)",
                }}
              >
                by {author}
              </div>
            )}
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers,
    }
  );
}
