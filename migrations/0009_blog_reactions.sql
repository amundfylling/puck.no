-- One anonymous browser token can choose one reaction per blog post.
-- The stored voter key is a SHA-256 digest scoped to this post.
CREATE TABLE IF NOT EXISTS blog_reactions (
  post_key TEXT NOT NULL,
  voter_key TEXT NOT NULL,
  emoji TEXT NOT NULL CHECK (emoji IN ('heart', 'fire', 'laugh', 'wow', 'clap')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (post_key, voter_key)
);

CREATE INDEX IF NOT EXISTS blog_reactions_counts
  ON blog_reactions (post_key, emoji);
