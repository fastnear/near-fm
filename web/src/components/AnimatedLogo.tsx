export function AnimatedLogo({ className = "", variant = "page" }: { className?: string; variant?: "header" | "page" }) {
  const isHeader = variant === "header";
  const tower = isHeader ? "/basement-white.png" : "/basement.png";

  // Header: thicker strokes, wider spacing between waves
  const sw1 = isHeader ? 14 : 6;
  const sw2 = isHeader ? 12 : 5;
  const sw3 = isHeader ? 10 : 4.5;

  // Wave paths — header has more spacing between arcs
  const r1 = isHeader ? "M95 57 Q120 33 95 9"   : "M90 55 Q115 33 90 11";
  const r2 = isHeader ? "M115 72 Q158 33 115 -6" : "M105 67 Q145 33 105 -1";
  const r3 = isHeader ? "M135 87 Q200 33 135 -21" : "M120 79 Q178 33 120 -13";
  const l1 = isHeader ? "M55 57 Q30 33 55 9"     : "M60 55 Q35 33 60 11";
  const l2 = isHeader ? "M35 72 Q-8 33 35 -6"    : "M45 67 Q5 33 45 -1";
  const l3 = isHeader ? "M15 87 Q-50 33 15 -21"  : "M30 79 Q-28 33 30 -13";

  return (
    <svg viewBox="-40 -25 230 205" className={className} xmlns="http://www.w3.org/2000/svg">
      <style>{`
        @keyframes nf-wave {
          0%, 100% { opacity: 0; }
          20%, 45% { opacity: 0.85; }
          65% { opacity: 0; }
        }
        .nf-w1 { animation: nf-wave 2.8s ease-in-out infinite; }
        .nf-w2 { animation: nf-wave 2.8s ease-in-out 0.5s infinite; }
        .nf-w3 { animation: nf-wave 2.8s ease-in-out 1s infinite; }
      `}</style>

      {/* Tower from PNG */}
      <image href={tower} x="0" y="0" width="150" height="155" />

      {/* Circle at top of antenna */}
      <circle cx="75" cy="33" r="15" fill="#00b775" />

      {/* Right waves */}
      <path className="nf-w1" d={r1} stroke="#00b775" strokeWidth={sw1} fill="none" strokeLinecap="round" />
      <path className="nf-w2" d={r2} stroke="#00c882" strokeWidth={sw2} fill="none" strokeLinecap="round" />
      <path className="nf-w3" d={r3} stroke="#00ec97" strokeWidth={sw3} fill="none" strokeLinecap="round" />

      {/* Left waves */}
      <path className="nf-w1" d={l1} stroke="#00b775" strokeWidth={sw1} fill="none" strokeLinecap="round" />
      <path className="nf-w2" d={l2} stroke="#00c882" strokeWidth={sw2} fill="none" strokeLinecap="round" />
      <path className="nf-w3" d={l3} stroke="#00ec97" strokeWidth={sw3} fill="none" strokeLinecap="round" />
    </svg>
  );
}
