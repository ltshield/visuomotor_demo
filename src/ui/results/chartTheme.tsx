/**
 * chartTheme.tsx — colours and small shared pieces for every results chart.
 *
 * COLOUR IS BY ROLE, and a role keeps its colour everywhere on the page:
 *   move    (blue)   the participant's own movement on ordinary reaches
 *   catch   (orange) catch trials, always also marked by a diamond + label
 *   cursor  (aqua)   the displayed cursor, when shown beside the hand path
 *   context (gray)   reference lines and comparison reaches
 *
 * The three hues are the first three slots of a palette checked for
 * colour-vision-deficiency separation in every pairing; aqua is light on a
 * white surface, so it is never used without a text label beside it.
 * Text never takes a series colour: identity comes from the mark next to it.
 *
 * Key exports: `VIZ`, `ChartCard`, `LegendRow`, `SeriesDot`, `TooltipCard`.
 */

import type { ReactNode } from 'react';
import { InfoNotes, type MetricInfo } from './InfoNote';

export const VIZ = {
  surface: '#fcfcfb',
  ink: '#0b0b0b',
  ink2: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  /** Wash behind the rotation block. */
  band: '#f0efec',
  move: '#2a78d6',
  catchTrial: '#eb6834',
  cursor: '#1baf7a',
  context: '#898781',
} as const;

/** Axis tick styling shared by all Recharts axes. */
export const AXIS_TICK = { fill: VIZ.muted, fontSize: 12 } as const;

/** Points of a diamond centred on (cx, cy) with half-diagonal r. */
export function diamondPoints(cx: number, cy: number, r: number): string {
  return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
}

/**
 * A data marker: a circle for ordinary reaches, a diamond for catch trials.
 * Both carry a 2px ring in the surface colour so they stay legible where they
 * overlap a line or each other.
 */
export function SeriesDot({ cx, cy, isCatch, active = false }: { cx: number; cy: number; isCatch: boolean; active?: boolean }) {
  if (isCatch) {
    return (
      <polygon
        points={diamondPoints(cx, cy, active ? 8 : 6.5)}
        fill={VIZ.catchTrial}
        stroke={VIZ.surface}
        strokeWidth={2}
      />
    );
  }
  return <circle cx={cx} cy={cy} r={active ? 5.5 : 4} fill={VIZ.move} stroke={VIZ.surface} strokeWidth={2} />;
}

export type LegendKey = 'line' | 'dash' | 'dot' | 'diamond' | 'band';

export interface LegendItem {
  key: LegendKey;
  color: string;
  label: string;
}

/** The mark that identifies a series in a legend, mirroring how it is drawn in the chart. */
function LegendMark({ item }: { item: LegendItem }) {
  return (
    <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true" focusable="false">
      {item.key === 'line' && <line x1="1" y1="6" x2="21" y2="6" stroke={item.color} strokeWidth="2" strokeLinecap="round" />}
      {item.key === 'dash' && (
        <line x1="1" y1="6" x2="21" y2="6" stroke={item.color} strokeWidth="1.5" strokeDasharray="4 3" strokeLinecap="round" />
      )}
      {item.key === 'dot' && <circle cx="11" cy="6" r="4" fill={item.color} />}
      {item.key === 'diamond' && <polygon points={diamondPoints(11, 6, 5.5)} fill={item.color} />}
      {item.key === 'band' && <rect x="1" y="1" width="20" height="10" rx="2" fill={item.color} stroke={VIZ.axis} />}
    </svg>
  );
}

export function LegendRow({ items }: { items: LegendItem[] }) {
  return (
    <ul className="viz-legend">
      {items.map((item) => (
        <li key={item.label}>
          <LegendMark item={item} />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

interface ChartCardProps {
  title: string;
  /** One or two sentences on how to read the chart. */
  intro?: ReactNode;
  /** Collapsed "ⓘ" explanations of the metrics this card shows. */
  info?: readonly MetricInfo[];
  legend?: LegendItem[];
  children: ReactNode;
  footnote?: ReactNode;
  id?: string;
}

export function ChartCard({ title, intro, info, legend, children, footnote, id }: ChartCardProps) {
  return (
    <section className="card viz-card" id={id}>
      <h3>{title}</h3>
      {intro && <p className="viz-intro">{intro}</p>}
      {info && <InfoNotes items={info} />}
      {legend && legend.length > 0 && <LegendRow items={legend} />}
      {children}
      {footnote && <p className="viz-footnote">{footnote}</p>}
    </section>
  );
}

/** Tooltip body: a heading, then rows in which the VALUE leads and its label follows. */
export function TooltipCard({
  heading,
  rows,
  note,
}: {
  heading: string;
  rows: Array<{ value: string; label: string; color?: string }>;
  note?: string;
}) {
  return (
    <div className="viz-tooltip">
      <div className="viz-tooltip-heading">{heading}</div>
      {rows.map((row) => (
        <div className="viz-tooltip-row" key={row.label}>
          {row.color && <span className="viz-tooltip-key" style={{ background: row.color }} />}
          <strong>{row.value}</strong>
          <span>{row.label}</span>
        </div>
      ))}
      {note && <div className="viz-tooltip-note">{note}</div>}
    </div>
  );
}
