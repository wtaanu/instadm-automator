alter table public.dm_conversations
  add column if not exists instagram_participant_id text,
  add column if not exists last_message_at timestamptz,
  add column if not exists source text not null default 'manual';

create unique index if not exists dm_conversations_workspace_thread_idx
on public.dm_conversations(workspace_id, instagram_thread_id)
where instagram_thread_id is not null;

create unique index if not exists dm_conversations_workspace_participant_idx
on public.dm_conversations(workspace_id, instagram_participant_id)
where instagram_participant_id is not null;

create table if not exists public.reply_workflows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  instagram_account_id uuid references public.instagram_accounts(id) on delete cascade,
  source_event_id uuid references public.meta_webhook_events(id) on delete set null,
  source_type text not null,
  source_record_id uuid,
  channel text not null,
  intent text not null,
  priority text not null,
  destination text,
  proposed_reply text,
  link_url text,
  automation_mode text not null default 'safe_review',
  status text not null default 'queued',
  trigger_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);

create unique index if not exists reply_workflows_source_event_channel_idx
on public.reply_workflows(source_event_id, channel)
where source_event_id is not null;

create index if not exists reply_workflows_workspace_status_idx
on public.reply_workflows(workspace_id, status, created_at desc);

alter table public.reply_workflows enable row level security;

create policy "members can manage reply workflows"
on public.reply_workflows for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop trigger if exists reply_workflows_set_updated_at on public.reply_workflows;
create trigger reply_workflows_set_updated_at
before update on public.reply_workflows
for each row execute function public.set_updated_at();
