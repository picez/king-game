import { useLayoutEffect, useRef, useState } from 'react';

/** Rounded "nice" axis maximum (1, 2, 5 × 10^n) so gridlines land on round numbers. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export interface BarDatum { key: string; label: string; value: number }

/**
 * One-series vertical bar chart (single hue — the title names the series, no legend).
 * Thin bars with a 2px gap, rounded data end on the baseline side up, recessive grid,
 * a hover tooltip per bar with a hit target the full column height. A table view is
 * available through the <details> toggle under every chart.
 */
export function BarChart({ data, height = 160, unit = '' }: { data: BarDatum[]; height?: number; unit?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 32, padB = 22, padT = 8;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const innerW = width - padL - 4;
  const innerH = height - padB - padT;
  const step = data.length ? innerW / data.length : innerW;
  const barW = Math.max(1, Math.min(28, step - 2));
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(innerW / 46))));
  const h = hover != null ? data[hover] : null;
  return (
    <div className="adm-chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={data.map((d) => `${d.label}: ${d.value}`).join(', ')}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={width - 4} y1={y(t)} y2={y(t)} className="adm-chart__grid" />
            <text x={padL - 6} y={y(t)} className="adm-chart__tick" textAnchor="end" dominantBaseline="middle">{Math.round(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + i * step + (step - barW) / 2;
          const top = y(d.value);
          const bh = Math.max(0, padT + innerH - top);
          const r = Math.min(4, barW / 2, bh);
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + i * step} y={padT} width={step} height={innerH} fill="transparent" />
              {bh > 0 && (
                <path className={`adm-chart__bar${hover === i ? ' adm-chart__bar--on' : ''}`}
                  d={`M${x},${padT + innerH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${padT + innerH} Z`} />
              )}
              {i % labelEvery === 0 && (
                <text x={padL + i * step + step / 2} y={height - 6} className="adm-chart__tick" textAnchor="middle">{d.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      {h && hover != null && (
        <div className="adm-chart__tip" style={{ left: Math.min(width - 120, Math.max(0, padL + hover * step + step / 2 - 60)) }}>
          <strong>{h.value}{unit}</strong> <span>{h.label}</span>
        </div>
      )}
      <details className="adm-chart__table">
        <summary>Таблиця</summary>
        <table><tbody>{data.map((d) => <tr key={d.key}><td>{d.label}</td><td>{d.value}{unit}</td></tr>)}</tbody></table>
      </details>
    </div>
  );
}

/** Ranked horizontal bars with the value as a direct label (magnitude by length). */
export function HBarList({ rows }: { rows: { key: string; label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="adm-muted">Немає даних</p>;
  return (
    <ul className="adm-hbars">
      {rows.map((r) => (
        <li key={r.key} title={`${r.label}: ${r.value}`}>
          <span className="adm-hbars__label">{r.label}</span>
          <span className="adm-hbars__track"><span className="adm-hbars__bar" style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="adm-hbars__value">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** A headline number with an optional change versus the previous period. */
export function StatTile({ label, value, prev, hint }: { label: string; value: number | string; prev?: number; hint?: string }) {
  const n = typeof value === 'number' ? value : NaN;
  const delta = prev != null && Number.isFinite(n) ? n - prev : null;
  return (
    <div className="adm-tile" title={hint}>
      <span className="adm-tile__label">{label}</span>
      <span className="adm-tile__value">{value}</span>
      {delta != null && (
        <span className={`adm-tile__delta ${delta > 0 ? 'adm-tile__delta--up' : delta < 0 ? 'adm-tile__delta--down' : ''}`}>
          {delta > 0 ? '▲' : delta < 0 ? '▼' : '■'} {Math.abs(delta)} проти попереднього
        </span>
      )}
    </div>
  );
}
