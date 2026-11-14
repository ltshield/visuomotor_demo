/**
 * geometry.ts — 2D vector maths and the cursor transformation.
 *
 * COORDINATE SYSTEM (used by every module in `src/core`):
 *   - Units are "workspace units" (wu). One wu equals one CSS pixel of mouse
 *     travel at the default input gain, and one CSS pixel on screen when the
 *     workspace is drawn at scale 1.
 *   - The origin is the central start position.
 *   - +x points right and **+y points up** (mathematical convention). The
 *     browser's y-down screen axis is flipped exactly once on input
 *     (see `input/pointerLock.ts`) and once on output (the SVG workspace).
 *   - Angles are in degrees, measured **counterclockwise (CCW) from +x**.
 *
 * SIGN CONVENTION (shared by rotations and every error metric):
 *   positive = counterclockwise, negative = clockwise, as seen on screen.
 *
 * Key exports: Vec2 helpers, `rotate`, `applyCursorTransform`,
 * `signedAngleDeg`, `targetPosition`, `segmentCircleCrossing`.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export const ZERO: Vec2 = Object.freeze({ x: 0, y: 0 });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const norm = (a: Vec2): number => Math.hypot(a.x, a.y);

/**
 * z-component of the 3D cross product a × b. Positive when `b` lies
 * counterclockwise of `a`. With `a = u` (target unit vector) and `b = r`
 * (hand displacement) this is the signed lateral error `u_x*r_y - u_y*r_x`.
 */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

export const degToRad = (deg: number): number => (deg * Math.PI) / 180;
export const radToDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Unit vector pointing along `angleDeg` (CCW from +x). */
export function unitFromAngleDeg(angleDeg: number): Vec2 {
  const a = degToRad(angleDeg);
  return { x: Math.cos(a), y: Math.sin(a) };
}

/**
 * Rotate `v` by `thetaDeg` about the origin using the standard rotation matrix
 *
 *   R(θ) = | cos θ  −sin θ |
 *          | sin θ   cos θ |
 *
 * In our y-up frame a positive θ is a counterclockwise rotation. Rotation is
 * rigid, so |R(θ)v| = |v|: a rotated cursor is always exactly as far from the
 * start as the hand is. The reach-completion rule relies on that.
 */
export function rotate(v: Vec2, thetaDeg: number): Vec2 {
  if (thetaDeg === 0) return { x: v.x, y: v.y }; // exact identity, no float noise
  const t = degToRad(thetaDeg);
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: c * v.x - s * v.y, y: s * v.x + c * v.y };
}

/**
 * The visuomotor transformation applied during an outward reach:
 *
 *   cursor = start + R(θ) · (hand − start)
 *
 * `hand` is the virtual *unperturbed* hand position reconstructed from mouse
 * deltas; the return value is where the cursor is drawn. Because the rotation
 * is about `start`, hand and cursor coincide at the start of every reach and
 * no offset can accumulate from one trial to the next.
 */
export function applyCursorTransform(hand: Vec2, start: Vec2, rotationDeg: number): Vec2 {
  return add(start, rotate(sub(hand, start), rotationDeg));
}

/**
 * Signed angle in degrees from `from` to `to`, in (−180, 180].
 * Positive when `to` is counterclockwise of `from`. Computed as
 * atan2(cross, dot), which is well behaved in all four quadrants and needs no
 * normalisation of either vector. Returns null if either vector has zero length.
 */
export function signedAngleDeg(from: Vec2, to: Vec2): number | null {
  if (norm(from) === 0 || norm(to) === 0) return null;
  return radToDeg(Math.atan2(cross(from, to), dot(from, to)));
}

/** Position of a target at `angleDeg` and `distance` from the start (origin). */
export function targetPosition(angleDeg: number, distance: number): Vec2 {
  return scale(unitFromAngleDeg(angleDeg), distance);
}

/** Clamp a point to the square [−half, +half]². */
export function clampToSquare(p: Vec2, half: number): Vec2 {
  return {
    x: Math.min(half, Math.max(-half, p.x)),
    y: Math.min(half, Math.max(-half, p.y)),
  };
}

/**
 * Where does the segment a→b first reach distance `radius` from the origin?
 *
 * Returns the fraction f in [0, 1] along the segment such that
 * |a + f·(b − a)| = radius, or null when the segment does not cross outward
 * (i.e. `a` is already at/outside the radius, or `b` is still inside it).
 *
 * Used to find the exact point and time at which a reach crossed the target
 * radius (or an early-movement radius) *between* two mouse samples, so results
 * do not depend on how fast the mouse happens to report.
 */
export function segmentCircleCrossing(a: Vec2, b: Vec2, radius: number): number | null {
  const ra = norm(a);
  const rb = norm(b);
  if (ra >= radius || rb < radius) return null;
  const d = sub(b, a);
  // Solve |a + f d|² = radius² for f: (d·d) f² + 2(a·d) f + (a·a − radius²) = 0.
  const qa = dot(d, d);
  const qb = 2 * dot(a, d);
  const qc = dot(a, a) - radius * radius; // negative: `a` is inside the circle
  const disc = qb * qb - 4 * qa * qc; // positive because qa > 0 and qc < 0
  const f = (-qb + Math.sqrt(disc)) / (2 * qa); // the outward (positive) root
  return Math.min(1, Math.max(0, f));
}

/** Linear interpolation between two points. */
export function lerp(a: Vec2, b: Vec2, f: number): Vec2 {
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}
