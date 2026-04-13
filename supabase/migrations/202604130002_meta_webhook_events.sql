create table if not exists public.meta_webhook_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  instagram_account_id uuid references public.instagram_accounts(id) on delete cascade,
  object text not null,
  entry_id text,
  event_family text not null,
  event_type text not null,
  payload_json jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists meta_webhook_events_received_at_idx
on public.meta_webhook_events(received_at desc);

create index if not exists meta_webhook_events_workspace_idx
on public.meta_webhook_events(workspace_id, instagram_account_id);

alter table public.meta_webhook_events enable row level security;

create policy "members can manage meta webhook events"
on public.meta_webhook_events for all
using (workspace_id is null or public.is_workspace_member(workspace_id))
with check (workspace_id is null or public.is_workspace_member(workspace_id));
