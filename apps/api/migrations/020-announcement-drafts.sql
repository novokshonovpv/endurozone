-- Drafts of race announcements read from public Telegram channels. A moderator checks each
-- draft and publishes it as an announcement or dismisses it. Nothing is published automatically.
-- The post text is kept for the moderator only and is never shown publicly.
CREATE TABLE announcement_drafts (
  id uuid PRIMARY KEY,
  source_url text NOT NULL UNIQUE,
  post_text text NOT NULL,
  guess jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','dismissed')),
  announcement_id uuid REFERENCES event_announcements(id) ON DELETE SET NULL,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX announcement_drafts_pending_idx ON announcement_drafts(created_at) WHERE status = 'pending';
