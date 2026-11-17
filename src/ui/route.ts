/**
 * route.ts — which page an address refers to.
 *
 * The app has three addresses besides the student activity itself:
 *
 *   /instructor        the instructor controls panel
 *   /class/<CODE>      the anonymous class view for one class code
 *   /                  the activity (with optional ?c= / ?x= link codes)
 *
 * These are real paths, so a professor can type or project
 * `https://site/class/NEURO451`. Cloudflare Pages serves `index.html` for any
 * path that is not a file, which is what makes that work; the same is true of
 * `npm run dev` and `npm run preview`.
 *
 * The older hash forms (`#/instructors`, `#/class/<CODE>`) are accepted as
 * well. They need no server support at all, and links to `#/instructors`
 * printed for the first release keep working.
 *
 * Key exports: `Route`, `parseRoute`, `useRoute`, `INSTRUCTOR_PATH`, `classPath`.
 */

import { useEffect, useState } from 'react';

export type Route = { name: 'home' } | { name: 'instructor' } | { name: 'class'; code: string };

export const INSTRUCTOR_PATH = '/instructor';

/** The class-view address for a class code. */
export function classPath(code: string): string {
  return `/class/${encodeURIComponent(code)}`;
}

/** Split "/class/NEURO451/" or "#/class/NEURO451" into its non-empty segments. */
function segments(text: string): string[] {
  return text
    .replace(/^#/, '')
    .split('/')
    .filter((s) => s.length > 0);
}

function match(parts: string[]): Route | null {
  if (parts.length === 1 && (parts[0] === 'instructor' || parts[0] === 'instructors')) return { name: 'instructor' };
  if (parts.length === 2 && parts[0] === 'class') {
    let code = parts[1];
    try {
      code = decodeURIComponent(code);
    } catch {
      // A malformed escape: keep the raw text; the class page will reject it as an invalid code.
    }
    return { name: 'class', code };
  }
  return null;
}

/** Pure: the route for a location's pathname and hash. The hash form wins when both are present. */
export function parseRoute(pathname: string, hash: string): Route {
  return match(segments(hash)) ?? match(segments(pathname)) ?? { name: 'home' };
}

/** The current route, kept up to date when the hash changes or the user goes back/forward. */
export function useRoute(): Route {
  const read = () => parseRoute(window.location.pathname, window.location.hash);
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
    };
  }, []);
  return route;
}
