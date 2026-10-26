import { useId, useMemo } from 'react';

/**
 * Mummer's only motif: an original, hand-built half mask (a "domino"), the kind a
 * mummer wore so their host had to guess who they were. Pure SVG, no external art.
 */

export const MASK_OUTLINE =
  'M6 30C6 12 36 4 60 4s54 8 54 26c0 22-18 36-32 32-10-3-14-12-22-12s-12 9-22 12C24 66 6 52 6 30Z';
export const MASK_EYES = 'M22 32c4-10 22-10 28 1-6 10-24 10-28-1Zm76 0c-4-10-22-10-28 1 6 10 24 10 28-1Z';

interface MaskProps {
  fill?: string;
  accent?: string;
  className?: string;
  title?: string;
}

export function MaskIcon({ fill = 'currentColor', accent = 'var(--wax)', className, title }: MaskProps) {
  return (
    <svg viewBox="0 0 120 68" className={className} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      <path d={`${MASK_OUTLINE}${MASK_EYES}`} fill={fill} fillRule="evenodd" />
      <path d="M60 9l5 6-5 6-5-6 5-6Z" fill={accent} />
      <path d="M14 22c10-8 24-9 32-6M106 22c-10-8-24-9-32-6" fill="none" stroke={accent} strokeWidth="1.6" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

/** Logo: the mask in ink on paper. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="12" fill="var(--paper)" stroke="var(--ink)" strokeWidth="3" />
      <g transform="translate(5 14) scale(0.4167)">
        <path d={`${MASK_OUTLINE}${MASK_EYES}`} fill="var(--ink)" fillRule="evenodd" />
        <path d="M60 9l5 6-5 6-5-6 5-6Z" fill="var(--wax)" />
      </g>
    </svg>
  );
}

function scallopedPath(cx: number, cy: number, r: number, lobes: number, amp: number): string {
  const pts: string[] = [];
  const steps = lobes * 8;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const rr = r + amp * Math.sin(t * lobes);
    pts.push(`${(cx + rr * Math.cos(t)).toFixed(2)} ${(cy + rr * Math.sin(t)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

/** A wax seal with the mask pressed into it. `stamp` plays the one-time stamp-down animation (reduced-motion safe). */
export function Seal({ size = '5rem', stamp = false, label }: { size?: string; stamp?: boolean; label?: string }) {
  const outer = useMemo(() => scallopedPath(50, 50, 41, 13, 2.6), []);
  const id = useId();
  return (
    <svg
      viewBox="0 0 100 100"
      className="seal"
      data-stamp={stamp}
      style={{ ['--seal-size' as string]: size }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <defs>
        <radialGradient id={`${id}-g`} cx="38%" cy="32%" r="75%">
          <stop offset="0" stopColor="#c0453d" />
          <stop offset="0.6" stopColor="#9e2b25" />
          <stop offset="1" stopColor="#6e1a16" />
        </radialGradient>
      </defs>
      <path d={outer} fill={`url(#${id}-g)`} stroke="#4d100d" strokeWidth="1.5" />
      <circle cx="50" cy="50" r="30" fill="none" stroke="#e7b9b3" strokeOpacity="0.55" strokeWidth="1.5" />
      <g transform="translate(26 35) scale(0.4)">
        <path d={`${MASK_OUTLINE}${MASK_EYES}`} fill="#f2ecdf" fillRule="evenodd" />
      </g>
    </svg>
  );
}

const RING_FILLS = ['var(--ink)', 'var(--pine)', 'var(--gold)', 'var(--wax)'];

/**
 * Hero illustration: eight mummers in one circle, each giving to the next, which is
 * how the draw works (one cycle: nobody draws themselves, and nobody draws each other).
 */
export function MaskRing({ className }: { className?: string }) {
  const n = 8;
  const R = 132;
  const cx = 200;
  const cy = 200;
  const masks = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), a, i };
  });
  const arrows = Array.from({ length: n }, (_, i) => {
    const a = ((i + 0.5) / n) * Math.PI * 2 - Math.PI / 2;
    const x = cx + R * Math.cos(a);
    const y = cy + R * Math.sin(a);
    const deg = (a * 180) / Math.PI + 90;
    return { x, y, deg };
  });
  return (
    <svg viewBox="0 0 400 400" className={`mask-ring ${className ?? ''}`} role="img" aria-label="Eight masked people standing in a circle, each giving a gift to the next person in the circle">
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeDasharray="3 9" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={R + 46} fill="none" stroke="var(--line)" strokeWidth="1.5" />
      <circle cx={cx} cy={cy} r={R - 46} fill="var(--card)" stroke="var(--ink)" strokeWidth="2.5" />
      <g className="mask-ring__orbit">
        {arrows.map((a, i) => (
          <g key={`ar${i}`} transform={`translate(${a.x.toFixed(1)} ${a.y.toFixed(1)}) rotate(${a.deg.toFixed(1)})`}>
            <path d="M-9 8 0 -8 9 8 0 3Z" fill="var(--ink)" />
          </g>
        ))}
        {masks.map((m) => (
          <g key={m.i} transform={`translate(${(m.x - 30).toFixed(1)} ${(m.y - 17).toFixed(1)})`}>
            <g className="mask-ring__counter">
              <g transform="scale(0.5)">
                <rect x="-6" y="-6" width="132" height="80" rx="40" fill="var(--paper)" />
                <path d={`${MASK_OUTLINE}${MASK_EYES}`} fill={RING_FILLS[m.i % RING_FILLS.length]} stroke="var(--ink)" strokeWidth="3" fillRule="evenodd" />
                <path d="M60 9l5 6-5 6-5-6 5-6Z" fill={m.i % 4 === 3 ? 'var(--paper)' : 'var(--wax)'} />
              </g>
            </g>
          </g>
        ))}
      </g>
      <text x={cx} y={cy - 6} textAnchor="middle" className="mask-ring__title">
        ONE CIRCLE
      </text>
      <text x={cx} y={cy + 24} textAnchor="middle" className="mask-ring__sub">
        you only see
      </text>
      <text x={cx} y={cy + 44} textAnchor="middle" className="mask-ring__sub">
        your own gift
      </text>
    </svg>
  );
}
