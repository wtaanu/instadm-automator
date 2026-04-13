alter table public.instagram_accounts
  add column if not exists instagram_user_id text,
  add column if not exists facebook_page_id text,
  add column if not exists token_last4 text,
  add column if not exists token_obtained_at timestamptz,
  add column if not exists scopes text[];

create table if not exists public.integration_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null,
  account_id uuid references public.instagram_accounts(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.integration_tokens enable row level security;

create policy "members can manage integration tokens"
on public.integration_tokens for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));
