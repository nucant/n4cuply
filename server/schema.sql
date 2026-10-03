-- N4cuply family accounts (Cloudflare D1).
-- Passwords are never stored: only a PBKDF2 hash and its salt.

CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  username     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name         TEXT NOT NULL DEFAULT '',
  pass_hash    TEXT NOT NULL,
  salt         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'disabled')),
  ver          INTEGER NOT NULL DEFAULT 1,  -- bumped to sign the user out everywhere
  fails        INTEGER NOT NULL DEFAULT 0,  -- wrong passwords in a row
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  approved_at  INTEGER,
  last_login   INTEGER
);

-- drive_refresh_token, drive_email, root_folder
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
