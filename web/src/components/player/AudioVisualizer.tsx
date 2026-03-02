"use client";

export function AudioVisualizer() {
  // Generate bars to fill full width; flex-1 stretches them evenly
  const bars = Array.from({ length: 200 }, (_, i) => {
    const ratio = i / 200;
    const r = Math.round(168 - ratio * 134);
    const g = Math.round(85 + ratio * 126);
    const b = Math.round(247 - ratio * 9);
    const dur = 0.4 + Math.sin(i * 0.7) * 0.25 + Math.cos(i * 1.3) * 0.15;
    const delay = -(i * 0.05 + Math.sin(i * 0.9) * 0.1);

    return (
      <span
        key={i}
        className="flex-1 rounded-t-[1px]"
        style={{
          backgroundColor: `rgb(${r}, ${g}, ${b})`,
          animation: `eqBounce ${dur}s ease-in-out ${delay}s infinite alternate`,
          minHeight: "2px",
        }}
      />
    );
  });

  return (
    <div className="w-full hidden sm:flex items-end h-[16px] opacity-60" style={{ gap: "1px" }}>
      {bars}
      <style jsx>{`
        @keyframes eqBounce {
          0% { height: 2px; }
          100% { height: 14px; }
        }
      `}</style>
    </div>
  );
}
