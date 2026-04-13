create unique index if not exists posts_instagram_post_id_idx
on public.posts(instagram_post_id)
where instagram_post_id is not null;
