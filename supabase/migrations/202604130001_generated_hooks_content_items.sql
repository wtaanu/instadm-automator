alter table if exists public.content_items
add column if not exists content_copy text;

alter table if exists public.content_items
add column if not exists source text not null default 'manual';
