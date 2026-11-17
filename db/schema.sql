-- Visuomotor Learning Lab: anonymous class data (Cloudflare D1 / SQLite).
--
-- Two tables. `sessions` has one row per shared session; `trial_errors` has one
-- row per reach of that session. Nothing here identifies a person: there are no
-- names, accounts, addresses, device details, movement traces or free text.
--
-- The API creates these tables itself the first time it runs (see
-- src/server/schema.ts, which must stay identical to this file; a unit test
-- checks that). You only need to run this file by hand if you want the tables
-- to exist before the first submission:
--
--   npx wrangler d1 execute visuomotor-class --remote --file=./db/schema.sql
--
-- Every statement is IF NOT EXISTS, so running it again is harmless.

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,          -- random session id generated in the browser; never returned by the API
  classCode TEXT NOT NULL,      -- upper-case letters and digits, max 20
  presetId TEXT NOT NULL,       -- e.g. rotation-sudden-45-v2
  rotationDeg INTEGER NOT NULL, -- full size of the rotation in the protocol
  trialTier TEXT NOT NULL,      -- 'quick' | 'standard' | 'extended'
  submittedAt TEXT NOT NULL,    -- ISO timestamp set by the server on receipt
  consciousAdjustment TEXT      -- reflection answer: 'yes' | 'somewhat' | 'no' | 'unsure', or NULL
);

CREATE TABLE IF NOT EXISTS trial_errors (
  sessionId TEXT NOT NULL,
  trialIndex INTEGER NOT NULL,  -- 0-based position of the reach in the session
  phase TEXT NOT NULL,          -- 'baseline' | 'adaptation' | 'aftereffect'
  isCatch INTEGER NOT NULL,     -- 0 or 1
  rotationApplied REAL NOT NULL,
  initialDirErrorDeg REAL,      -- NULL if the reach had no usable value
  valid INTEGER NOT NULL,       -- 0 or 1
  pathErrorPct REAL,            -- whole-path error of the path the student saw (the cursor's; the hand's on
                                -- hidden-cursor reaches, where there was no rotation), % of the target distance; NULL if none
  PRIMARY KEY (sessionId, trialIndex)
);

CREATE INDEX IF NOT EXISTS idx_sessions_class ON sessions(classCode);
