insert into public.workspaces (
  id,
  name,
  niche,
  primary_goal,
  posting_frequency,
  team_size,
  has_instagram_access,
  sales_link,
  course_link,
  community_link
)
values (
  '11111111-1111-1111-1111-111111111111',
  'Anutechlabs Social',
  'Instagram automation for agencies and service businesses',
  'Increase reach, followers, and qualified inbound leads',
  '4 posts per week',
  3,
  true,
  'https://anutechlabs.com/book-demo',
  'https://anutechlabs.com/instagram-course',
  'https://anutechlabs.com/community'
)
on conflict (id) do update
set
  name = excluded.name,
  niche = excluded.niche,
  primary_goal = excluded.primary_goal,
  posting_frequency = excluded.posting_frequency,
  team_size = excluded.team_size,
  has_instagram_access = excluded.has_instagram_access,
  sales_link = excluded.sales_link,
  course_link = excluded.course_link,
  community_link = excluded.community_link;

insert into public.instagram_accounts (
  workspace_id,
  handle,
  account_type,
  status,
  connected_at
)
values (
  '11111111-1111-1111-1111-111111111111',
  '@anutechlabs',
  'business',
  'connected',
  now()
)
on conflict (workspace_id, handle) do update
set
  account_type = excluded.account_type,
  status = excluded.status,
  connected_at = excluded.connected_at;

insert into public.ingestion_jobs (
  workspace_id,
  job_type,
  source,
  status,
  note,
  scheduled_for
)
values
  (
    '11111111-1111-1111-1111-111111111111',
    'metrics-sync',
    'instagram-insights',
    'completed',
    'Pulled post metrics and refreshed leaderboard.',
    now() - interval '4 hours'
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'comments-sync',
    'owned-posts',
    'running',
    'Classifying inbound comments by intent.',
    now()
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'competitor-scan',
    'tracked-accounts',
    'queued',
    'Checking top niche accounts for new hook patterns.',
    now() + interval '12 hours'
  );

insert into public.comment_intent_routes (
  workspace_id,
  intent,
  trigger_summary,
  response_template,
  destination
)
values
  (
    '11111111-1111-1111-1111-111111111111',
    'question',
    'How, what, setup, process',
    'Answer briefly, then share the course link for the full workflow.',
    'course'
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'inquiry',
    'Price, demo, interested, details',
    'Acknowledge intent, offer a short answer, then send the sales link.',
    'sales'
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'collaboration',
    'Collab, partnership, agency, white-label',
    'Share the community link or partner intro path and keep them warm for outreach.',
    'community'
  );

insert into public.fan_segments (
  workspace_id,
  name,
  description,
  member_count
)
values
  (
    '11111111-1111-1111-1111-111111111111',
    'Hot buyers',
    'Pricing and setup inquiries ready for sales follow-up.',
    24
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'Education seekers',
    'Users who engage with tutorials, process, and workflows.',
    57
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'Potential collaborators',
    'Creators, agencies, and partners worth future campaigns.',
    11
  );

insert into public.dm_link_events (
  workspace_id,
  event_type,
  link_type
)
values
  ('11111111-1111-1111-1111-111111111111', 'sent', 'sales'),
  ('11111111-1111-1111-1111-111111111111', 'sent', 'sales'),
  ('11111111-1111-1111-1111-111111111111', 'opened', 'sales'),
  ('11111111-1111-1111-1111-111111111111', 'clicked', 'sales'),
  ('11111111-1111-1111-1111-111111111111', 'sent', 'course'),
  ('11111111-1111-1111-1111-111111111111', 'opened', 'course'),
  ('11111111-1111-1111-1111-111111111111', 'sent', 'community');
