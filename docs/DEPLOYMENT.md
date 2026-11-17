# Build and deployment

The activity itself is a static site: three files in `dist/` after a build (about 0.8 MB, 0.2 MB compressed). It needs no server, database or API key.

One optional feature needs more: **anonymous class sharing**, where students can add a summary of their results to a class view on the projector. It uses two small server routes (Cloudflare Pages Functions, in the `functions/` folder) and a Cloudflare D1 database. Without the database the rest of the site works normally; see [Class sharing](#class-sharing-optional-cloudflare-d1) below.

## Build and preview locally

```bash
npm ci               # install exact dependency versions (Node 22.12 or newer)
npm run build        # type-check, then build into dist/
npm run preview      # serve dist/ at http://localhost:4173/ (no class sharing)
```

`npm run dev` starts a development server with live reload at http://localhost:5173/. To try class sharing on your own computer, use `npm run preview:class` (see [Testing class sharing on your computer](#testing-class-sharing-on-your-computer)).

Before deploying a change, run `npm run verify` (type-check, unit tests, build, and a full simulated session in Chrome). See [TESTING.md](TESTING.md).

## Deploy to Cloudflare Pages

Dashboard labels below are as given in Cloudflare's documentation in November 2026. Cloudflare's documentation now suggests Workers for new projects but still documents and supports creating Pages projects.

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

Cloudflare also finds the `functions/` folder in the repository and deploys the two class-sharing routes with the site. There is nothing to configure for that; class sharing only needs the database described below.

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

Run the last command again after each new build to publish it. Run it from the repository's top folder, so that Wrangler also finds `functions/` and uploads the class-sharing routes.

### Option C: drag and drop

In **Workers & Pages** → **Create application**, choose the drag-and-drop upload, name the project, and drop in the `dist` folder. Later versions are uploaded with **Create a new deployment**.

The `functions/` folder is not inside `dist`, so a drag-and-drop site has no class sharing. The share button then says "Class sharing is not available on this site." Use Option A or B if you want class sharing.

### Free-plan limits for the static site

From Cloudflare's limits page in November 2026: 500 builds per month, up to 20,000 files per site and 25 MiB per file. That page lists no bandwidth cap for static assets. Limits for class sharing are [further down](#free-plan-limits-and-expected-usage).

## Class sharing (optional): Cloudflare D1

### How it works

| Address | Method | What it does | File |
|---|---|---|---|
| `/api/submit` | POST | Stores one anonymous session summary. | `functions/api/submit.ts` |
| `/api/class/<CODE>` | GET | Returns every summary stored for a class code. | `functions/api/class/[code].ts` |

The two files in `functions/` only pass requests on. The logic is in `src/server/classApi.ts`, and the database tables are defined in `db/schema.sql` (mirrored in `src/server/schema.ts`; a unit test checks the two match). The routes reach the database through a **binding** named `DB`.

The professor picks a class code (for example `NEURO451`) on the instructor page and opens the class view (`/class/NEURO451`) on the projector. Students type the code on their results page and press **Share anonymously**. Nothing has to be registered in advance: a code exists as soon as the first student shares with it.

**Without a database** everything else works as usual. The share button answers "Class sharing has not been set up on this site: no database is connected.", and the class view shows the same message and stops refreshing. (Its **Refresh now** button asks again, for example after you have attached the database.)

### 1. Create the database

Either:

- in the dashboard: **Workers & Pages** → **D1 SQL Database** → **Create**, and give it a name such as `visuomotor-class`; or
- on the command line (after `npx wrangler login`): `npx wrangler d1 create visuomotor-class`

The name is only a label for you. The rest of this page uses `visuomotor-class`; substitute your own if it differs.

### 2. Bind it to the Pages project

1. Open **Workers & Pages** → your Pages project → **Settings** → **Bindings**.
2. Select **Add** → **D1 database bindings**.
3. **Variable name:** `DB`, exactly (capital letters; the code looks for this name). **D1 database:** the database you created.
4. Add the binding for **both** the **Production** and the **Preview** environment.

### 3. Redeploy

A binding takes effect on the **next deployment**. Either open **Deployments**, choose the latest deployment and select **Retry deployment**, or push a commit (Option A). With Option B, run `npx wrangler pages deploy dist` again.

### 4. Tables: nothing to do

The API creates its tables itself on the first request (every statement is `CREATE TABLE IF NOT EXISTS`). It also adds the `pathErrorPct` column automatically to a database that was created from an earlier version of the schema.

If you want the tables to exist before anyone shares, you can create them by hand. Running this again is harmless:

```bash
npx wrangler d1 execute visuomotor-class --remote --file=./db/schema.sql
```

### 5. Check it works

1. Open `https://<your-site>/instructor`, select **I am an instructor: show the details**, type a test code such as `TEST1` under "See the whole class on the projector", and open the class view.
2. In another window, do a session (the 16-reach Quick Demo at `https://<your-site>/?c=demo` is fastest), and at the bottom of the results page share it with `TEST1`.
3. Within 15 seconds the session appears on the class view. (A Quick Demo session is listed under **Protocol shown**, separately from the standard versions.)
4. Delete the test data (next section).

### Deleting a class's data

Delete a class's data when you no longer need it. Class codes are stored in **upper case**, so write the code in capitals:

```bash
npx wrangler d1 execute visuomotor-class --remote --command "DELETE FROM trial_errors WHERE sessionId IN (SELECT id FROM sessions WHERE classCode = 'NEURO451'); DELETE FROM sessions WHERE classCode = 'NEURO451';"
```

Replace `NEURO451` (twice) with your code. You can also paste the same SQL into the dashboard: open the database under **D1 SQL Database** and use its **Console** tab. To see which class codes the database holds:

```sql
SELECT classCode, COUNT(*) AS sessions FROM sessions GROUP BY classCode;
```

### Optional: keep the binding in a `wrangler.toml` file

You do not need this; the dashboard route above needs no file. If you would rather keep the binding in the repository, copy `wrangler.example.toml` (in the repository's top folder) to `wrangler.toml`, set `name` to your Pages project name, and paste the database id (printed by `npx wrangler d1 create`, and shown on the database's page in the dashboard) into `database_id`. Leave `binding = "DB"` as it is.

Be aware that once a `wrangler.toml` containing `pages_build_output_dir` is in the repository, Cloudflare treats it as the source of truth for the project's settings, and the matching fields in the dashboard become read-only.

### Free-plan limits and expected usage

At the time of writing (November 2026; check Cloudflare's pricing page for current figures):

| Resource | Free allowance |
|---|---|
| D1 rows read | 5 million per day |
| D1 rows written | 100,000 per day |
| D1 storage | 5 GB |
| Pages Functions requests | Count toward the Workers free plan: 100,000 per day |

Only the `/api/*` addresses run Functions. Loading the site's pages and files does not count as a Function request.

Rough usage:

| Event | Database cost | Function requests |
|---|---|---|
| A student shares a standard 40-reach session | About 41 rows written (one session row and one row per reach). Sending it again also deletes the earlier copy. | 1 |
| The class view checks for news and nothing has changed | One small count query (answer "304 Not Modified"), reading about one row per stored session | 1 every 15 seconds, so 240 per hour for each open class view |
| The class view checks and something has changed | Re-reads every row of that class: about 1,300 rows for 30 standard sessions | 1 |

A class of 30 is far inside these limits. Over an hour with the class view on the projector, 30 shares write about 1,200 rows (about 1% of the daily allowance) and the class view reads a few tens of thousands of rows (under 1%). Even if every student also kept the class view open for the hour, it would stay within the free allowance: roughly a million rows read at most (against 5 million) and under 10,000 Function requests.

### Limits the API enforces

These are set in `src/core/classWire.ts`.

| Limit | Value |
|---|---|
| Class code | 1 to 20 letters and digits, no spaces or symbols. Case does not matter: `neuro451` and `NEURO451` are the same class (stored upper case). |
| Reaches per submission | 10 to 100 (the Quick, Standard and Extended lengths have 16, 40 and 64) |
| Size of one submission | 64 KB (a 64-reach submission is about 5 KB) |
| Sessions per class code | 500. Further shares are refused with a message asking for a new code; the class view returns at most 500. |
| The same session sent again | Replaces the earlier copy, so a double click does not count twice and a student who mistyped the code can resend to the right one. |

Only a student's first run in a visit can be shared. A second run was made after seeing the debrief, so it is not comparable.

### Addresses

`/instructor` and `/class/<CODE>` are real addresses served by the single-page app. Cloudflare Pages serves `index.html` for any address that is not a file, because the build has no top-level `404.html`. **Do not add one**, or these addresses stop working. (The older forms `#/instructors` and `#/class/<CODE>` also work.)

### Testing class sharing on your computer

```bash
npm run preview:class
```

This builds the site, then runs `npx wrangler@4 pages dev dist --d1 DB=classdb` at http://127.0.0.1:8788/ with a real local D1 database (kept in the `.wrangler` folder, which git ignores). Open http://127.0.0.1:8788/instructor to set up a class view.

To run a complete simulated session in the browser, including sharing it and checking the class view, leave that running and in a second terminal run:

```bash
node e2e/full-session.mjs --link sudden --url http://127.0.0.1:8788/ --class TEST1
```

### Privacy

- **Sharing is opt-in for each student.** Nothing is sent until the student types a class code and presses **Share anonymously**. The results page shows exactly what would be sent before they decide.
- **What is sent.** For each reach: its position in the session, block, catch-trial flag, the rotation applied, the initial direction error (`err`), the path error (`pe`) and whether the reach had a usable value. For the session: the preset id, the rotation size, the length (Quick, Standard or Extended) and the answer to the question about consciously adjusting their aim. Also a random session id, used only so that a second press replaces the first copy, and the time of sending, which the server checks and discards (it records its own receive time instead).
- **What is never sent:** names, accounts, movement traces, reach timings, free-text answers, or browser and device details. The tables in `db/schema.sql` have no column for anything else.
- **What the class view gets back.** The same numbers, without session ids and without times. Sessions come back in an order unrelated to when they arrived, so nobody can tell which line belongs to whom. The server stores its own receive time (for the "has anything changed" check) but never returns it; the version tag it sends (ETag) is an opaque hash.
- **A class code is not a password.** Anyone who knows it can share to it or open its view. The data is anonymous and holds nothing sensitive, but do not treat the code as private. Use a new code for each class or section.
- Delete a class's data when you no longer need it ([command above](#deleting-a-classs-data)).

### Checklist

- [ ] The site is deployed with Option A or B (not drag and drop).
- [ ] A D1 database exists (for example `visuomotor-class`).
- [ ] It is bound to the Pages project with the variable name `DB`, for both Production and Preview.
- [ ] The site has been redeployed since the binding was added.
- [ ] A test share appears on the class view within 15 seconds.
- [ ] The test code's data has been deleted.
- [ ] You have a reminder to delete each class's data when you no longer need it.

## After deploying

1. Open the site and complete a session yourself **with a physical mouse** (see the checklist in [TESTING.md](TESTING.md)).
2. On the start page choose **For instructors** (or go to `/instructor`). It shows the general link and the direct links for your address, each with a Copy button, and sets up class views.
3. If you set up class sharing, work through its [checklist](#checklist).
4. Put your address into [PROFESSOR_QUICKSTART.md](PROFESSOR_QUICKSTART.md) in place of `YOUR-SITE.pages.dev`.

## Hosting anywhere else

The activity runs on any static host (GitHub Pages, Netlify, a university web server, a shared folder served over HTTPS). Upload the contents of `dist/`. Things to know:

- **Serve it from the root of a domain or subdomain** (for example `https://lab.example.edu/`). The build loads its files from `/assets/` (`base: '/'` in `vite.config.ts`), and the instructor page builds its links from the root of the domain, so a sub-folder such as `https://example.edu/courses/lab/` does not work without code changes.
- **Addresses.** `/instructor` and `/class/<CODE>` work only if the host serves `index.html` for addresses that are not files. If yours does not, use `/#/instructor`; the participant links (`/?c=<code>`, `/?x=<code>`) work on any host.
- **No class sharing.** Other hosts do not run the `functions/` folder. The share button then says "Class sharing is not available on this site."; everything else works.
- **Use HTTPS.** Over plain HTTP the activity still runs, but the browser withholds the high-rate mouse samples and movement is recorded once per display frame instead.

## Updating

- **Text, styling, bug fixes:** change, run `npm run verify`, push (Option A) or redeploy (Options B and C).
- **Anything that changes a protocol:** add a new versioned preset rather than editing a released one. See [PRESETS.md](PRESETS.md).
- Published link codes (`k7m2`, `p4x9`, `demo`) must keep pointing at the same conditions, because links already handed to students rely on them.
- **Class database:** nothing to run after an update. The API adds any new column it needs by itself.
