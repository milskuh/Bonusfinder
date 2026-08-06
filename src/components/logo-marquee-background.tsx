import styles from "./logo-marquee-background.module.css";

// Ambient, faded carousel of supermarket logos rendered behind every page
// (mounted once in app/layout.tsx). It drifts down the left & right gutters; a
// centre mask (see the CSS) keeps the deals / filters column clear. Purely
// decorative: the wrapper is aria-hidden, every <img> has an empty alt and
// draggable disabled, and the whole layer sits at z-index -10 with pointer-events
// off. Plain <img> tags (not next/image) keep this a zero-JS Server Component.

type Logo = { src: string; alt: string };

// The six brand logos (files already in /public/logos). `alt` is a human label
// kept for provenance and React keys; the rendered <img> uses alt="" because the
// layer is decorative.
const LOGOS: Logo[] = [
  { src: "/logos/ah.svg", alt: "Albert Heijn" },
  { src: "/logos/jumbo.png", alt: "Jumbo" },
  { src: "/logos/lidl.svg", alt: "Lidl" },
  { src: "/logos/aldi.svg", alt: "Aldi" },
  { src: "/logos/dirk.svg", alt: "Dirk" },
  { src: "/logos/hoogvliet.png", alt: "Hoogvliet" },
];

type Row = { offset: number; reverse: boolean; duration: number };

// Five drifting lanes. `offset` rotates each row's logo order so the same logo
// never lines up vertically between rows; `reverse` alternates drift direction;
// `duration` (seconds, ~34–52) varies the speed so the rows never march in
// lockstep — the effect is organic drift, not a synchronised march.
const ROWS: Row[] = [
  { offset: 0, reverse: false, duration: 46 },
  { offset: 2, reverse: true, duration: 38 },
  { offset: 4, reverse: false, duration: 52 },
  { offset: 1, reverse: true, duration: 34 },
  { offset: 3, reverse: false, duration: 42 },
];

// How many copies of the 6-logo set make up each track. Must be EVEN: the track
// is two identical halves and the CSS scrolls it by -50% (one half), so the loop
// is seamless. One half must be wider than the viewport or the gutters go bare as
// the track drifts — one set is ~860px wide, so 4 sets/half (~3400px) covers
// every realistic screen. Total = COPIES/2 sets per half.
const COPIES = 8;

// Rotate a copy of `items` left by `by` positions.
function rotate<T>(items: T[], by: number): T[] {
  const n = ((by % items.length) + items.length) % items.length;
  return [...items.slice(n), ...items.slice(0, n)];
}

export function LogoMarqueeBackground() {
  return (
    <div className={styles.layer} aria-hidden="true">
      {/* Inner carrier holds the tilt so the layer's centre mask stays vertical. */}
      <div className={styles.rotor}>
        {ROWS.map((row, i) => {
          const logos = rotate(LOGOS, row.offset);
          // COPIES identical sets => two identical halves => seamless -50% loop,
          // wide enough that both gutters stay covered as the track scrolls.
          const sequence = Array.from({ length: COPIES }, () => logos).flat();
          return (
            <div key={i} className={styles.row}>
              <div
                className={row.reverse ? `${styles.track} ${styles.reverse}` : styles.track}
                style={{ animationDuration: `${row.duration}s` }}
              >
                {sequence.map((logo, j) => (
                  // eslint-disable-next-line @next/next/no-img-element -- decorative background, intentionally not next/image
                  <img
                    key={j}
                    src={logo.src}
                    alt=""
                    draggable={false}
                    className={styles.logo}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
