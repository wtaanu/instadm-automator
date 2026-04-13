alter table public.instagram_accounts
  add column if not exists last_synced_at timestamptz;

alter table public.comments
  add column if not exists instagram_comment_id text,
  add column if not exists instagram_media_id text,
  add column if not exists ai_confidence numeric(5,4),
  add column if not exists ai_rationale text,
  add column if not exists link_destination text,
  add column if not exists classified_at timestamptz,
  add column if not exists classification_source text;

create unique index if not exists comments_instagram_comment_id_idx
on public.comments(instagram_comment_id)
where instagram_comment_id is not null;

create table if not exists public.instagram_profile_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  instagram_account_id uuid not null references public.instagram_accounts(id) on delete cascade,
  instagram_user_id text not null,
  username text,
  display_name text,
  followers_count integer not null default 0,
  follows_count integer not null default 0,
  media_count integer not null default 0,
  profile_picture_url text,
  captured_at timestamptz not null default now()
);

create table if not exists public.instagram_account_insights (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  instagram_account_id uuid not null references public.instagram_accounts(id) on delete cascade,
  metric text not null,
  period text not null default 'day',
  end_time timestamptz,
  value_json jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now()
);

create unique index if not exists fan_segments_workspace_name_idx
on public.fan_segments(workspace_id, name);

alter table public.instagram_profile_snapshots enable row level security;
alter table public.instagram_account_insights enable row level security;

create policy "members can manage instagram profile snapshots"
on public.instagram_profile_snapshots for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "members can manage instagram account insights"
on public.instagram_account_insights for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create index if not exists instagram_profile_snapshots_account_captured_idx
on public.instagram_profile_snapshots(instagram_account_id, captured_at desc);

create index if not exists instagram_account_insights_account_metric_idx
on public.instagram_account_insights(instagram_account_id, metric, captured_at desc);
