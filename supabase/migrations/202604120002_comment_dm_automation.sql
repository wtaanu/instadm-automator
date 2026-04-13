alter table public.workspaces
  add column if not exists sales_link text default '',
  add column if not exists course_link text default '',
  add column if not exists community_link text default '';

create table if not exists public.comment_intent_routes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  intent text not null,
  trigger_summary text not null,
  response_template text not null,
  destination text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.fan_segments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text not null,
  member_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.dm_link_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_type text not null,
  link_type text not null,
  occurred_at timestamptz not null default now()
);

alter table public.comment_intent_routes enable row level security;
alter table public.fan_segments enable row level security;
alter table public.dm_link_events enable row level security;

create policy "members can manage comment intent routes"
on public.comment_intent_routes for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "members can manage fan segments"
on public.fan_segments for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "members can manage dm link events"
on public.dm_link_events for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));
