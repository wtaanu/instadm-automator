create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  niche text not null,
  primary_goal text not null,
  posting_frequency text not null,
  team_size integer not null check (team_size > 0),
  has_instagram_access boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'analyst')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.instagram_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  handle text not null,
  account_type text not null,
  status text not null,
  connected_at timestamptz,
  access_token_ref text,
  created_at timestamptz not null default now()
);

create unique index if not exists instagram_accounts_workspace_handle_idx
on public.instagram_accounts(workspace_id, handle);

create table if not exists public.competitors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  handle text not null,
  display_name text not null,
  niche_segment text not null,
  tracking_status text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  format text not null,
  status text not null,
  publishing_slot timestamptz,
  goal text not null,
  hook_family text,
  cta_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_item_id uuid references public.content_items(id) on delete set null,
  instagram_post_id text,
  format text not null,
  caption text,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.post_metrics (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  reach integer not null default 0,
  non_follower_reach integer not null default 0,
  likes integer not null default 0,
  comments integer not null default 0,
  saves integer not null default 0,
  shares integer not null default 0,
  profile_visits integer not null default 0,
  followers_gained integer not null default 0,
  captured_at timestamptz not null default now()
);

create table if not exists public.dm_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  instagram_thread_id text,
  participant_handle text not null,
  participant_name text not null,
  intent text not null,
  priority text not null,
  status text not null,
  last_message_preview text not null,
  next_action text,
  updated_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  post_id uuid references public.posts(id) on delete set null,
  author_handle text not null,
  author_name text not null,
  intent text not null,
  priority text not null,
  message text not null,
  recommended_reply text,
  created_at timestamptz not null default now()
);

create table if not exists public.reply_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel text not null,
  intent text not null,
  template_name text not null,
  body text not null,
  approval_mode text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_type text not null,
  source text not null,
  status text not null,
  note text,
  scheduled_for timestamptz not null default now(),
  completed_at timestamptz
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at
before update on public.workspaces
for each row execute function public.set_updated_at();

drop trigger if exists content_items_set_updated_at on public.content_items;
create trigger content_items_set_updated_at
before update on public.content_items
for each row execute function public.set_updated_at();

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
  );
$$;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.instagram_accounts enable row level security;
alter table public.competitors enable row level security;
alter table public.content_items enable row level security;
alter table public.posts enable row level security;
alter table public.post_metrics enable row level security;
alter table public.dm_conversations enable row level security;
alter table public.comments enable row level security;
alter table public.reply_templates enable row level security;
alter table public.ingestion_jobs enable row level security;

create policy "profiles can read own profile"
on public.profiles for select
using (id = auth.uid());

create policy "profiles can update own profile"
on public.profiles for update
using (id = auth.uid());

create policy "members can view workspaces"
on public.workspaces for select
using (public.is_workspace_member(id));

create policy "members can view workspace members"
on public.workspace_members for select
using (public.is_workspace_member(workspace_id));

create policy "members can view instagram accounts"
on public.instagram_accounts for select
using (public.is_workspace_member(workspace_id));

create policy "members can manage instagram accounts"
on public.instagram_accounts for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "members can manage competitors"
on public.competitors for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "members can manage content items"
on public.content_items for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "members can manage posts"
on public.posts for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "members can read post metrics"
on public.post_metrics for select
using (
  exists (
    select 1
    from public.posts p
    where p.id = post_metrics.post_id
      and public.is_workspace_member(p.workspace_id)
  )
);

create policy "members can manage dm conversations"
on public.dm_conversations for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "members can manage comments"
on public.comments for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "members can manage reply templates"
on public.reply_templates for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "members can manage ingestion jobs"
on public.ingestion_jobs for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));
