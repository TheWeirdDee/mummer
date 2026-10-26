import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/**
 * QR code rendered as a single SVG path (no innerHTML, no inline styles, nothing
 * the strict CSP would object to). Always rendered dark-on-white with a quiet
 * zone, because wallet scanners need contrast regardless of page theme.
 */
export function QR({ value, label }: { value: string; label: string }) {
  const { path, size } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 4;
    let d = '';
    for (let r = 0; r < n; r++) {
      let run = -1;
      for (let c = 0; c <= n; c++) {
        const dark = c < n && qr.isDark(r, c);
        if (dark && run < 0) run = c;
        if (!dark && run >= 0) {
          d += `M${run + quiet} ${r + quiet}h${c - run}v1h-${c - run}z`;
          run = -1;
        }
      }
    }
    return { path: d, size: n + quiet * 2 };
  }, [value]);

  return (
    <div className="qr-plate">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
        <rect width={size} height={size} fill="#ffffff" />
        <path d={path} fill="#000000" />
      </svg>
    </div>
  );
}
