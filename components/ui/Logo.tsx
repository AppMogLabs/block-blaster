export function Logo({ size = 56 }: { size?: number }) {
  // A stylised cube mark — all CSS-driven, no external SVG asset required.
  const s = size;
  const depth = s * 0.2;
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} className="drop-shadow-[0_0_16px_rgba(247,134,198,0.4)]">
      <defs>
        <linearGradient id="face-front" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FF8AA8" />
          <stop offset="1" stopColor="#F786C6" />
        </linearGradient>
        <linearGradient id="face-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFC1D4" />
          <stop offset="1" stopColor="#FF8AA8" />
        </linearGradient>
        <linearGradient id="face-right" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#C96891" />
          <stop offset="1" stopColor="#9C4E74" />
        </linearGradient>
      </defs>
      {/* Top */}
      <polygon
        fill="url(#face-top)"
        points={`${depth},${depth} ${s - 4},${depth} ${s - 4 - depth},0 ${0},0`.replace(
          /,/g,
          " "
        )}
        transform={`translate(2 2)`}
      />
      {/* Right */}
      <polygon
        fill="url(#face-right)"
        points={`${s - 4},${depth} ${s - 4},${s - 4} ${s - 4 - depth},${s - 4 - depth} ${s - 4 - depth},0`.replace(
          /,/g,
          " "
        )}
        transform={`translate(2 2)`}
      />
      {/* Front */}
      <rect
        x="2"
        y={depth + 2}
        width={s - 4 - depth}
        height={s - 4 - depth}
        rx="6"
        fill="url(#face-front)"
      />
    </svg>
  );
}
