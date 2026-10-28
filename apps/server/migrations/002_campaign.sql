-- Additive reference migration; identical idempotent DDL runs on startup.
-- Existing profiles, results, squads and signing secrets remain untouched.
CREATE TABLE IF NOT EXISTS campaign_progress (
  player_id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
