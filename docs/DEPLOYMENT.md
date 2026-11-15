# Build and deployment

The app is a static site: three files in `dist/` after a build. There is no server, database or API key.

## Build and preview locally

```bash
npm ci               # install exact dependency versions (Node 22.12 or newer)
npm run build        # type-check, then build into dist/
npm run preview      # serve dist/ at http://localhost:4173/
```

`npm run dev` starts a development server with live reload at http://localhost:5173/.

Before deploying a change, run `npm run verify` (type-check, unit tests, build, and a full simulated session in Chrome). See [TESTING.md](TESTING.md).

## Deploy to Cloudflare Pages

Dashboard labels below are as given in Cloudflare's documentation on 14 November 2026. Cloudflare's documentation now suggests Workers for new projects but still documents and supports creating Pages projects. Because this app is plain static files, it can move to Workers static assets, or any other static host, later without code changes.

### Option A: connect the GitHub repository (recommended)

Every push to `main` then rebuilds and redeploys the site.

1. In the Cloudflare dashboard, open **Workers & Pages**.
2. Select **Create application** → **Pages** → **Connect to Git**.
3. Choose **GitHub**, sign in if asked, and select this repository. Select **Install & Authorize**, then **Begin setup**.
4. Under **Set up builds and deployments**:

   | Setting | Value |
   |---|---|
   | Production branch | `main` |
   | Framework preset | `React (Vite)` |
   | Build command | `npm run build` |
   | Build output directory | `dist` |

5. Select **Save and Deploy**. When the build finishes the site is at `https://<project-name>.pages.dev/`.

**Node version.** The repository's `.nvmrc` pins Node 22.13.0, which Pages reads. The current build image's default (Node 22.23.4) also works; the app needs 22.12 or newer.

**Note.** A project created through the Git integration cannot later be switched to Direct Upload, and the reverse is also true.

### Option B: upload a build from your computer

```bash
npm ci
npm run build
npx wrangler login
npx wrangler pages project create      # first time only: asks for a project name and production branch
npx wrangler pages deploy dist
```

Run the last command again after each new build to publish it.

### Option C: drag and drop

In **Workers & Pages** → **Create application**, choose the drag-and-drop upload, name the project, and drop in the `dist` folder. Later versions are uploaded with **Create a new deployment**.

### Free-plan limits

From Cloudflare's limits page on the same date: 500 builds per month, up to 20,000 files per site and 25 MiB per file. This site is three small files (about 0.7 MB in total, 0.2 MB compressed). That page lists no bandwidth cap for static assets.

## After deploying

1. Open the site and complete a session yourself **with a physical mouse** (see the checklist in [TESTING.md](TESTING.md)).
2. On the start page choose **For instructors**. It shows the general link and the direct links for your address, each with a Copy button.
3. Put your address into [PROFESSOR_QUICKSTART.md](PROFESSOR_QUICKSTART.md) in place of `YOUR-SITE.pages.dev`.

## Hosting anywhere else

Any static host works (GitHub Pages, Netlify, a university web server, a shared folder served over HTTPS). Upload the contents of `dist/`.

- Asset paths are relative, so the site also works from a sub-folder such as `https://example.edu/courses/lab/`.
- No rewrite or redirect rules are needed. The only "pages" are `#/instructors` (a hash) and `?c=<code>` (a query string), both handled inside the single `index.html`.
- **Use HTTPS.** Over plain HTTP the activity still runs, but the browser withholds the high-rate mouse samples and movement is recorded once per display frame instead.

## Updating

- **Text, styling, bug fixes:** change, run `npm run verify`, push (Option A) or redeploy (Options B and C).
- **Anything that changes a protocol:** add a new versioned preset rather than editing a released one. See [PRESETS.md](PRESETS.md).
- Published link codes (`k7m2`, `p4x9`, `demo`) must keep pointing at the same presets, because links already handed to students rely on them.
