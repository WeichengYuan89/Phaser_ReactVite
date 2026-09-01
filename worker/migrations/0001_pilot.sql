PRAGMA foreign_keys = ON;
CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  permitted_sitting INTEGER NOT NULL DEFAULT 1 CHECK(permitted_sitting IN (1,2)),
  blocks_completed INTEGER NOT NULL DEFAULT 0 CHECK(blocks_completed BETWEEN 0 AND 6),
  checkpoint_json TEXT,
  canonical_attempt TEXT,
  active_attempt TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id),
  expires_at INTEGER NOT NULL
);
CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id),
  block_number INTEGER NOT NULL CHECK(block_number BETWEEN 1 AND 6),
  sitting INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  start_checkpoint TEXT,
  start_checkpoint_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','complete','interrupted','invalid')),
  started_at TEXT NOT NULL,
  last_seen INTEGER NOT NULL,
  ended_at TEXT,
  interruption_reason TEXT,
  protocol_version TEXT NOT NULL,
  build_version TEXT NOT NULL,
  stimulus_version TEXT NOT NULL,
  audio_stalls INTEGER
);
CREATE UNIQUE INDEX one_complete_block ON attempts(participant_id,block_number) WHERE status='complete';
CREATE UNIQUE INDEX one_active_attempt ON attempts(participant_id) WHERE status='active';
CREATE TABLE trials (
  attempt_id TEXT NOT NULL REFERENCES attempts(id),
  presentation_idx INTEGER NOT NULL CHECK(presentation_idx BETWEEN 0 AND 63),
  record_json TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY(attempt_id,presentation_idx)
);
CREATE INDEX participant_attempts ON attempts(participant_id,started_at);
