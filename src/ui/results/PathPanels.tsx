/**
 * PathPanels.tsx — small-multiple overlays of target-aligned movement paths.
 *
 * Every panel uses the SAME axes: the start is at the bottom, the target
 * straight above it, and the faint arc is the arrival radius, where every
 * outward path ends (the near edge of the target). Paths are rotated into this
 * frame so reaches to different targets can be laid over one another.
 *
 * ORIENTATION. The picture is a rotation of the real workspace, not a mirror
 * image: a path that went counterclockwise of its target appears to the LEFT of
 * the vertical axis, and clockwise to the right. (Lateral deviation is positive
 * counterclockwise, so screen x = −lateral.)
 *
 * Drawn directly in SVG (no chart library): these are geometry, not a chart.
 *
 * Key export: `PathPanels`.
 */

import { useState } from 'react';
import { formatSignedDeg } from '../presetText';
import { VIZ, diamondPoints, type LegendItem, LegendRow } from './chartTheme';
import type { NormPoint, PanelPath, PathKind, PathPanel, PathRole } from './model';

// Panel geometry in SVG pixels. One normalised unit = the target distance.
const SCALE = 112;
const WIDTH = 252;
const HEIGHT = 186;
const START_X = WIDTH / 2;
const START_Y = HEIGHT - 22; // leaves room above the target for its label

/** Normalised (progress, lateral) → SVG pixels. Counterclockwise (+lateral) is drawn to the left. */
const toSvg = (p: NormPoint) => ({ x: START_X - p.lateral * SCALE, y: START_Y - p.progress * SCALE });

const pointsAttr = (points: NormPoint[]) =>
  points
    .map(toSvg)
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');

const ROLE_COLOR: Record<PathRole, string> = {
  primary: VIZ.move,
  catch: VIZ.catchTrial,
  context: VIZ.context,
};

/** Draw gray context first, then the reaches the panel is about, so they sit on top. */
const DRAW_ORDER: Record<PathRole, number> = { context: 0, primary: 1, catch: 2 };

/**
 * The arc on which outward paths end: `radius` (a fraction of the target
 * distance) from the start, drawn ±78° either side of the target axis.
 */
function arrivalArc(radius: number): string {
  const a = (78 * Math.PI) / 180;
  const left = toSvg({ progress: radius * Math.cos(a), lateral: radius * Math.sin(a) });
  const right = toSvg({ progress: radius * Math.cos(a), lateral: -radius * Math.sin(a) });
  const r = (radius * SCALE).toFixed(1);
  return `M ${left.x.toFixed(1)} ${left.y.toFixed(1)} A ${r} ${r} 0 0 1 ${right.x.toFixed(1)} ${right.y.toFixed(1)}`;
}

interface PanelProps {
  panel: PathPanel;
  kind: PathKind;
  targetRadius: number;
  startRadius: number;
  arrivalRadius: number;
  onSelectTrial: (trialNumber: number) => void;
}

function Panel({ panel, kind, targetRadius, startRadius, arrivalRadius, onSelectTrial }: PanelProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const ordered = panel.paths.slice().sort((a, b) => DRAW_ORDER[a.role] - DRAW_ORDER[b.role]);
  const active = ordered.find((p) => p.trialNumber === hovered) ?? null;
  const target = toSvg({ progress: 1, lateral: 0 });
  const clipId = `clip-${panel.key}`;

  const describe = (p: PanelPath) =>
    `${p.description}${p.initialErrorDeg !== null ? ` · initial ${kind} direction ${formatSignedDeg(p.initialErrorDeg)}` : ''}`;

  return (
    <figure className="path-panel">
      <figcaption>
        <strong>{panel.title}</strong>
        <span>{panel.caption}</span>
      </figcaption>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="group" aria-label={`${panel.title}: ${panel.caption}`}>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={WIDTH} height={HEIGHT} />
        </clipPath>

        {/* Frame of reference: the arrival arc, the straight line to the target, start and target. */}
        <path d={arrivalArc(arrivalRadius)} fill="none" stroke={VIZ.grid} strokeWidth={1} />
        <line x1={START_X} y1={START_Y} x2={target.x} y2={target.y} stroke={VIZ.axis} strokeWidth={1} />
        <circle cx={target.x} cy={target.y} r={targetRadius * SCALE} fill={VIZ.surface} stroke={VIZ.muted} strokeWidth={1.5} />
        <circle cx={START_X} cy={START_Y} r={startRadius * SCALE} fill={VIZ.surface} stroke={VIZ.muted} strokeWidth={1.5} />
        {/* Above the target, clear of where path ends land on the arc below it. */}
        <text x={target.x} y={target.y - targetRadius * SCALE - 7} fontSize={10} fill={VIZ.muted} textAnchor="middle">
          target
        </text>
        <text x={START_X + startRadius * SCALE + 6} y={START_Y + 4} fontSize={10} fill={VIZ.muted}>
          start
        </text>
        <text x={6} y={HEIGHT - 6} fontSize={10} fill={VIZ.muted}>
          ← counterclockwise
        </text>
        <text x={WIDTH - 6} y={HEIGHT - 6} fontSize={10} fill={VIZ.muted} textAnchor="end">
          clockwise →
        </text>

        <g clipPath={`url(#${clipId})`}>
          {ordered.map((p) => {
            const isActive = p.trialNumber === hovered;
            const dimmed = hovered !== null && !isActive;
            const end = toSvg(p.points[p.points.length - 1]);
            const color = ROLE_COLOR[p.role];
            return (
              <g key={p.trialNumber} opacity={dimmed ? 0.3 : 1}>
                <polyline
                  points={pointsAttr(p.points)}
                  fill="none"
                  stroke={color}
                  strokeWidth={isActive ? 3 : 2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {p.role === 'catch' ? (
                  <polygon points={diamondPoints(end.x, end.y, 6)} fill={color} stroke={VIZ.surface} strokeWidth={2} />
                ) : (
                  <circle cx={end.x} cy={end.y} r={4} fill={color} stroke={VIZ.surface} strokeWidth={2} />
                )}
              </g>
            );
          })}

          {/* Wide invisible strokes on top: generous hover / focus / click targets for each path. */}
          {ordered.map((p) => (
            <polyline
              key={`hit-${p.trialNumber}`}
              className="path-hit"
              points={pointsAttr(p.points)}
              fill="none"
              stroke="transparent"
              strokeWidth={18}
              strokeLinejoin="round"
              strokeLinecap="round"
              pointerEvents="stroke"
              tabIndex={0}
              role="button"
              aria-label={`${describe(p)}. Press Enter to inspect.`}
              onPointerEnter={() => setHovered(p.trialNumber)}
              onPointerLeave={() => setHovered((h) => (h === p.trialNumber ? null : h))}
              onFocus={() => setHovered(p.trialNumber)}
              onBlur={() => setHovered((h) => (h === p.trialNumber ? null : h))}
              onClick={() => onSelectTrial(p.trialNumber)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectTrial(p.trialNumber);
                }
              }}
            />
          ))}
        </g>

        {panel.paths.length === 0 && (
          <text x={WIDTH / 2} y={HEIGHT / 2 - 8} textAnchor="middle" fontSize={12} fill={VIZ.ink2}>
            {kind === 'cursor' ? 'The cursor was hidden on these reaches' : 'No completed reach to show'}
          </text>
        )}
      </svg>

      {/* Details for the hovered / focused path: the same information a tooltip would carry. */}
      <p className="path-panel-readout" aria-live="polite">
        {active ? describe(active) : ' '}
      </p>
      {panel.unavailable.length > 0 && panel.paths.length > 0 && (
        <p className="path-panel-missing">
          Not shown: {panel.unavailable.map((u) => `trial ${u.trialNumber} (${u.reason})`).join(', ')}
        </p>
      )}
    </figure>
  );
}

interface PathPanelsProps {
  panels: PathPanel[];
  kind: PathKind;
  /** Target and start radii as fractions of the target distance, so they are drawn to scale. */
  targetRadius: number;
  startRadius: number;
  /** Where outward paths end, as a fraction of the target distance. */
  arrivalRadius: number;
  onSelectTrial: (trialNumber: number) => void;
}

export function PathPanels({ panels, kind, targetRadius, startRadius, arrivalRadius, onSelectTrial }: PathPanelsProps) {
  const legend: LegendItem[] = [
    { key: 'line', color: VIZ.move, label: `Your ${kind === 'hand' ? 'hand (mouse)' : 'cursor'} path on the reaches named in the panel title` },
    { key: 'line', color: VIZ.catchTrial, label: 'Catch trial (rotation off)' },
    { key: 'line', color: VIZ.context, label: 'Other reaches, for comparison' },
  ];
  return (
    <>
      <LegendRow items={legend} />
      <div className="path-panel-grid">
        {panels.map((panel) => (
          <Panel
            key={panel.key}
            panel={panel}
            kind={kind}
            targetRadius={targetRadius}
            startRadius={startRadius}
            arrivalRadius={arrivalRadius}
            onSelectTrial={onSelectTrial}
          />
        ))}
      </div>
    </>
  );
}
