CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  niche TEXT NOT NULL,
  primary_goal TEXT NOT NULL,
  posting_frequency TEXT NOT NULL,
  team_size INTEGER NOT NULL,
  has_instagram_access INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE instagram_accounts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  handle TEXT NOT NULL,
  account_type TEXT NOT NULL,
  status TEXT NOT NULL,
  connected_at TEXT,
  access_token_ref TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE competitors (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  handle TEXT NOT NULL,
  display_name TEXT NOT NULL,
  niche_segment TEXT NOT NULL,
  tracking_status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE content_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  title TEXT NOT NULL,
  format TEXT NOT NULL,
  status TEXT NOT NULL,
  publishing_slot TEXT,
  goal TEXT NOT NULL,
  hook_family TEXT,
  cta_type TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  content_item_id TEXT REFERENCES content_items(id),
  instagram_post_id TEXT,
  format TEXT NOT NULL,
  caption TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE post_metrics (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id),
  reach INTEGER NOT NULL DEFAULT 0,
  non_follower_reach INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  saves INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  profile_visits INTEGER NOT NULL DEFAULT 0,
  followers_gained INTEGER NOT NULL DEFAULT 0,
  captured_at TEXT NOT NULL
);

CREATE TABLE dm_conversations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  instagram_thread_id TEXT,
  participant_handle TEXT NOT NULL,
  participant_name TEXT NOT NULL,
  intent TEXT NOT NULL,
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  last_message_preview TEXT NOT NULL,
  next_action TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  post_id TEXT REFERENCES posts(id),
  author_handle TEXT NOT NULL,
  author_name TEXT NOT NULL,
  intent TEXT NOT NULL,
  priority TEXT NOT NULL,
  message TEXT NOT NULL,
  recommended_reply TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE reply_templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  channel TEXT NOT NULL,
  intent TEXT NOT NULL,
  template_name TEXT NOT NULL,
  body TEXT NOT NULL,
  approval_mode TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE ingestion_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  job_type TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  scheduled_for TEXT NOT NULL,
  completed_at TEXT
);
