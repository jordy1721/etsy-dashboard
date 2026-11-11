// ---------------------------------------------------------------------------
// BACKGROUND ARTWORK
// A quiet ink-wash scene drawn in code (SVG): misty mountains, a cherry
// blossom branch and a small pagoda. It sits behind everything, is purely
// decoration, and uses the theme colours so it also works in dark mode.
// No image files and nothing downloaded.
// ---------------------------------------------------------------------------

/** One five-petal blossom. */
function Blossom({ x, y, r, o = 1 }: { x: number; y: number; r: number; o?: number }) {
  const petals = [0, 72, 144, 216, 288];
  return (
    <g transform={`translate(${x} ${y})`} opacity={o}>
      {petals.map((angle) => (
        <ellipse key={angle} cx="0" cy={-r * 0.62} rx={r * 0.5} ry={r * 0.62} fill="var(--blossom)" transform={`rotate(${angle})`} />
      ))}
      <circle r={r * 0.22} fill="var(--blossom-deep)" />
    </g>
  );
}

/** Blossom positions along the branch: [x, y, size, opacity]. */
const BLOSSOMS: [number, number, number, number][] = [
  [392, 58, 11, 1], [356, 76, 9, 0.95], [318, 62, 10, 1], [300, 96, 8, 0.9], [262, 84, 10, 1], [236, 112, 8, 0.9],
  [206, 96, 9, 0.95], [178, 124, 7, 0.85], [150, 110, 8, 0.9], [118, 132, 6, 0.8], [372, 118, 9, 0.95], [336, 140, 8, 0.9],
  [298, 158, 7, 0.85], [404, 152, 10, 1], [384, 196, 8, 0.9], [352, 214, 7, 0.85], [412, 240, 9, 0.9], [270, 128, 6, 0.8],
  [226, 62, 7, 0.85], [330, 28, 8, 0.9], [284, 36, 6, 0.8], [400, 96, 7, 0.9], [92, 118, 5, 0.7], [320, 190, 6, 0.75],
];

/** Loose petals drifting down. */
const PETALS: [number, number, number][] = [[250, 190, 20], [190, 230, -30], [300, 260, 50], [130, 180, 10], [360, 300, -15], [220, 300, 70]];

export function Scenery() {
  return (
    <div class="scenery" aria-hidden="true">
      {/* Mountains in the mist, top centre */}
      <svg class="scene-mountain" viewBox="0 0 900 420" preserveAspectRatio="xMidYMin slice">
        <defs>
          <linearGradient id="mist" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="var(--ink)" stop-opacity="0.34" />
            <stop offset="0.55" stop-color="var(--ink)" stop-opacity="0.12" />
            <stop offset="1" stop-color="var(--ink)" stop-opacity="0" />
          </linearGradient>
          <linearGradient id="mist-far" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="var(--ink)" stop-opacity="0.16" />
            <stop offset="1" stop-color="var(--ink)" stop-opacity="0" />
          </linearGradient>
        </defs>
        {/* far ridge */}
        <path d="M0 300 C90 250 150 262 230 222 C300 188 350 226 420 196 C500 162 560 214 640 190 C720 166 800 214 900 186 L900 420 L0 420Z" fill="url(#mist-far)" />
        {/* main peak */}
        <path d="M60 420 C190 392 330 258 420 118 C436 94 452 70 470 62 C490 54 506 84 524 108 C610 250 740 388 880 420Z" fill="url(#mist)" />
        {/* snow cap */}
        <path d="M420 118 C436 94 452 70 470 62 C490 54 506 84 524 108 C512 104 504 122 494 112 C484 102 478 128 466 116 C456 106 446 126 436 116 C430 110 424 120 420 118Z" fill="var(--snow)" opacity="0.85" />
        {/* near hills */}
        <path d="M0 360 C80 318 140 340 210 316 C290 292 360 372 470 420 L0 420Z" fill="url(#mist-far)" />
        <path d="M470 420 C560 372 640 318 720 336 C790 350 850 318 900 322 L900 420Z" fill="url(#mist-far)" />
      </svg>

      {/* Cherry blossom branch, top right */}
      <svg class="scene-branch" viewBox="0 0 440 340" preserveAspectRatio="xMaxYMin meet">
        <g fill="none" stroke="var(--bark)" stroke-linecap="round">
          <path d="M440 22 C400 34 372 40 332 46 C286 54 250 76 206 92 C168 106 130 118 86 124" stroke-width="7" />
          <path d="M332 46 C318 30 304 26 282 30" stroke-width="3.5" />
          <path d="M250 76 C240 60 232 56 222 58" stroke-width="3" />
          <path d="M392 36 C396 80 388 120 404 158 C412 190 404 218 414 246" stroke-width="4.5" />
          <path d="M394 100 C372 116 352 130 334 144 C318 156 306 160 296 162" stroke-width="3" />
          <path d="M404 158 C390 178 380 190 384 200 C374 208 360 212 350 216" stroke-width="2.5" />
          <path d="M206 92 C196 104 186 116 176 126" stroke-width="2.5" />
        </g>
        {BLOSSOMS.map(([x, y, r, o], i) => (
          <Blossom key={i} x={x} y={y} r={r} o={o} />
        ))}
        {PETALS.map(([x, y, angle], i) => (
          <ellipse key={i} cx={x} cy={y} rx="5" ry="2.6" fill="var(--blossom)" opacity="0.7" transform={`rotate(${angle} ${x} ${y})`} />
        ))}
      </svg>

      {/* Pagoda on a hill, bottom left (desktop only) */}
      <svg class="scene-pagoda" viewBox="0 0 320 300" preserveAspectRatio="xMinYMax meet">
        <path d="M0 250 C50 214 96 232 150 214 C210 194 260 226 320 214 L320 300 L0 300Z" fill="var(--ink)" opacity="0.12" />
        <g fill="var(--ink)" opacity="0.42">
          <rect x="118" y="78" width="3" height="20" />
          <path d="M92 104 C104 100 112 96 119.500 90 C127 96 135 100 147 104 C138 106 132 106 119.500 106 C107 106 101 106 92 104Z" />
          <rect x="106" y="106" width="27" height="20" />
          <path d="M80 134 C96 130 108 126 119.500 120 C131 126 143 130 159 134 C146 137 136 137 119.500 137 C103 137 93 137 80 134Z" />
          <rect x="100" y="137" width="39" height="22" />
          <path d="M68 168 C88 164 104 160 119.500 153 C135 160 151 164 171 168 C154 172 140 172 119.500 172 C99 172 85 172 68 168Z" />
          <rect x="94" y="172" width="51" height="26" />
          <path d="M56 208 C80 204 100 200 119.500 192 C139 200 159 204 183 208 C162 213 144 213 119.500 213 C95 213 77 213 56 208Z" />
          <rect x="88" y="213" width="63" height="20" />
        </g>
        <path d="M0 270 C60 244 120 262 180 246 C240 230 280 252 320 244 L320 300 L0 300Z" fill="var(--ink)" opacity="0.1" />
      </svg>
    </div>
  );
}
