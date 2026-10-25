-- Mummer schema v1.
--
-- Privacy-by-schema notes (see docs/PRIVACY_ARCHITECTURE.md):
--  * Every sensitive column is either a sealed blob (only a browser can open it),
--    a hash, or group-visible by design (group title, display names).
--  * `assignments` is keyed by GIVER and `ack_commitments` by RECIPIENT, with NO
--    column linking one to the other. Both are WITHOUT ROWID so rows are stored in
--    primary-key order (random member ids), not insertion order, which would
--    otherwise follow the draw cycle.
--  * Timestamps on member-level rows are UTC DAY buckets only.
--  * `reveals` is the only table that stores a (giver, recipient) pair, and only
--    after the giver has explicitly consented and proven they held the assignment.

CREATE TABLE groups (
  id                   TEXT PRIMARY KEY CHECK (length(id) = 32),
  title                TEXT NOT NULL,
  budget_cents         INTEGER NOT NULL CHECK (budget_cents BETWEEN 500 AND 25000),
  join_deadline        TEXT NOT NULL,          -- YYYY-MM-DD in `timezone`
  reveal_date          TEXT NOT NULL,          -- YYYY-MM-DD in `timezone`
  timezone             TEXT NOT NULL,          -- IANA
  join_closes_at       TEXT NOT NULL,          -- UTC instant: start of the day after join_deadline
  reveal_at            TEXT NOT NULL,          -- UTC instant: start of reveal_date
  member_cap           INTEGER NOT NULL CHECK (member_cap BETWEEN 4 AND 50),
  host_plays           INTEGER NOT NULL CHECK (host_plays IN (0, 1)),
  host_public_key      TEXT NOT NULL,          -- X25519 public key (base64url)
  admin_token_hash     TEXT NOT NULL UNIQUE,   -- SHA-256 of the admin bearer token
  state                TEXT NOT NULL CHECK (state IN ('open', 'locked', 'drawn', 'active', 'needs_resolution', 'closed')),
  draw_version         INTEGER NOT NULL DEFAULT 0,
  draw_idempotency_key TEXT,
  created_day          TEXT NOT NULL,
  expires_at           TEXT NOT NULL           -- UTC instant: reveal_at + retention
);
CREATE INDEX groups_expires_at ON groups (expires_at);

CREATE TABLE members (
  group_id       TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  id             TEXT NOT NULL CHECK (length(id) = 32),
  pseudonym      TEXT NOT NULL,                -- group-visible by design
  pseudonym_key  TEXT NOT NULL,                -- normalised for uniqueness
  public_key     TEXT NOT NULL,                -- X25519 public key (base64url)
  sealed_profile TEXT NOT NULL,                -- sealed to the host key
  token_hash     TEXT NOT NULL,                -- SHA-256 of the member bearer token
  status         TEXT NOT NULL CHECK (status IN ('ready', 'assigned', 'removed', 'revoked')),
  sender_state   TEXT NOT NULL DEFAULT 'not_started' CHECK (sender_state IN ('not_started', 'user_reports_sent')),
  joined_day     TEXT NOT NULL,
  PRIMARY KEY (group_id, id),
  UNIQUE (group_id, pseudonym_key),
  UNIQUE (group_id, token_hash)
) WITHOUT ROWID;

CREATE TABLE assignments (
  group_id        TEXT NOT NULL,
  giver_member_id TEXT NOT NULL,
  draw_version    INTEGER NOT NULL,
  sealed_bundle   TEXT NOT NULL,               -- sealed to the giver's key
  PRIMARY KEY (group_id, giver_member_id),
  FOREIGN KEY (group_id, giver_member_id) REFERENCES members (group_id, id) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE TABLE ack_commitments (
  group_id            TEXT NOT NULL,
  recipient_member_id TEXT NOT NULL,
  draw_version        INTEGER NOT NULL,
  commitment          TEXT NOT NULL CHECK (length(commitment) = 64),
  state               TEXT NOT NULL DEFAULT 'not_acknowledged' CHECK (state IN ('not_acknowledged', 'recipient_acknowledged', 'disputed')),
  reference_matched   INTEGER NOT NULL DEFAULT 0 CHECK (reference_matched IN (0, 1)),
  state_day           TEXT,
  PRIMARY KEY (group_id, recipient_member_id),
  FOREIGN KEY (group_id, recipient_member_id) REFERENCES members (group_id, id) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE TABLE reveals (
  group_id                TEXT NOT NULL,
  giver_member_id         TEXT NOT NULL,
  recipient_member_id     TEXT NOT NULL,
  audience                TEXT NOT NULL CHECK (audience IN ('recipient', 'group')),
  declared_day            TEXT NOT NULL,
  recipient_confirmed_day TEXT,
  PRIMARY KEY (group_id, giver_member_id),
  UNIQUE (group_id, recipient_member_id),
  FOREIGN KEY (group_id, giver_member_id) REFERENCES members (group_id, id) ON DELETE CASCADE,
  FOREIGN KEY (group_id, recipient_member_id) REFERENCES members (group_id, id) ON DELETE CASCADE
) WITHOUT ROWID;

-- Group-level events only: no addresses, memos, IPs, secrets, assignment edges or per-member post-draw actions.
CREATE TABLE audit_events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  type     TEXT NOT NULL,
  day      TEXT NOT NULL,
  version  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX audit_events_group ON audit_events (group_id);

-- Aggregate counters only. Survive group deletion by design; they contain no group or member identifiers.
CREATE TABLE stats (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
INSERT INTO stats (key, value) VALUES ('groups_created', 0), ('members_joined', 0), ('gifts_acknowledged', 0);

-- Fixed-window rate limiting. Keys are salted hashes of (scope, client address); retained for at most two hours.
CREATE TABLE rate_limits (
  bucket       TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
) WITHOUT ROWID;

-- Single-use proofs that a human check passed (Cloudflare Turnstile), valid for ten minutes.
CREATE TABLE human_tickets (
  hash       TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
