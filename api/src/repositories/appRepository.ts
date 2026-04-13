import {
  buildCommentAutomationState,
  buildOnboardingState,
  dashboardSeed,
  defaultCommentAutomation,
  defaultOnboarding,
  defaultSession,
  ingestionJobs,
} from '../data/seed.js'
import { getSupabaseAdmin, getSupabaseAnon } from '../lib/supabase.js'
import { env, isMetaConfigured } from '../lib/env.js'
import {
  buildInstagramConnectUrl,
  exchangeCodeForAccessToken,
  fetchCommentsForMedia,
  fetchInstagramInsights,
  fetchInstagramMedia,
  fetchInstagramProfile,
  fetchManagedPages,
} from '../lib/meta.js'
import { classifyCommentIntent } from '../lib/openai.js'
import type {
  AuthSession,
  CommentIntentClassification,
  CommentAutomationPayload,
  CommentAutomationState,
  DashboardData,
  GeneratedHook,
  IngestionJob,
  InstagramAccount,
  InstagramSyncResult,
  MetaAppConfig,
  OnboardingPayload,
  OnboardingState,
  SaveGeneratedHookPayload,
  Tone,
  UpdateContentItemPayload,
  WebhookProcessingResult,
} from '../types.js'

function formatCompactNumber(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  }
  return String(Math.round(value))
}

function formatPercentDelta(current: number, previous: number) {
  if (!previous) {
    return current ? '+100%' : '0%'
  }
  const delta = ((current - previous) / previous) * 100
  const prefix = delta > 0 ? '+' : ''
  return `${prefix}${Math.round(delta)}%`
}

function scoreTone(value: number, high = 70, medium = 35): 'green' | 'gold' | 'rose' {
  if (value >= high) {
    return 'green'
  }
  if (value >= medium) {
    return 'gold'
  }
  return 'rose'
}

function insightsMissingMessage(note: string) {
  return note.toLowerCase().includes('insights')
    ? 'Account insights were partially skipped during the last sync'
    : 'Live metrics are updating from profile snapshots and post metrics'
}

function contentTone(status: string): Tone {
  const normalized = status.toLowerCase()
  if (normalized.includes('ready')) {
    return 'green'
  }
  if (normalized.includes('schedule')) {
    return 'blue'
  }
  return 'gold'
}

function priorityTone(priority: string): Tone {
  return priority.toLowerCase().includes('high') ? 'green' : 'gold'
}

function hookTypeToFormat(type: string) {
  const normalized = type.toLowerCase()
  if (normalized.includes('story')) {
    return 'Story'
  }
  if (normalized.includes('carousel')) {
    return 'Carousel'
  }
  return 'Reel'
}

function formatOnboardingFromRow(row: {
  id: string
  name: string
  niche: string
  primary_goal: string
  posting_frequency: string
  team_size: number
  has_instagram_access: boolean
  sales_link?: string | null
  course_link?: string | null
  community_link?: string | null
}): OnboardingState {
  return {
    workspaceId: row.id,
    status: row.has_instagram_access ? 'connected' : 'draft',
    brandName: row.name,
    niche: row.niche,
    goal: row.primary_goal,
    postingFrequency: row.posting_frequency,
    teamSize: row.team_size,
    hasInstagramAccess: row.has_instagram_access,
    salesLink: row.sales_link ?? defaultOnboarding.salesLink,
    courseLink: row.course_link ?? defaultOnboarding.courseLink,
    communityLink: row.community_link ?? defaultOnboarding.communityLink,
    recommendedModules: [
      'Trend tracker',
      'Content planner',
      row.has_instagram_access ? 'Analytics sync' : 'Manual reporting import',
      'DM automation',
      'Weekly recommendation engine',
    ],
  }
}

function buildPerformanceHistory(events?: Array<{ event_type: string; occurred_at: string }>) {
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const bucketMap = new Map<string, { label: string; sent: number; opened: number; clicked: number }>()

  for (let index = 6; index >= 0; index -= 1) {
    const date = new Date()
    date.setDate(date.getDate() - index)
    const key = date.toISOString().slice(0, 10)
    bucketMap.set(key, {
      label: dayLabels[date.getDay()] ?? key,
      sent: 0,
      opened: 0,
      clicked: 0,
    })
  }

  for (const event of events ?? []) {
    const key = event.occurred_at.slice(0, 10)
    const bucket = bucketMap.get(key)
    if (!bucket) {
      continue
    }

    if (event.event_type === 'sent') {
      bucket.sent += 1
    } else if (event.event_type === 'opened') {
      bucket.opened += 1
    } else if (event.event_type === 'clicked') {
      bucket.clicked += 1
    }
  }

  return Array.from(bucketMap.values())
}

function buildCommentRecord(params: {
  workspaceId: string
  postId: string | null
  authorHandle: string
  authorName: string
  message: string
  createdAt?: string
  classification: CommentIntentClassification
  instagramCommentId?: string
  instagramMediaId?: string
}) {
  return {
    workspace_id: params.workspaceId,
    post_id: params.postId,
    author_handle: params.authorHandle,
    author_name: params.authorName,
    intent: params.classification.intent,
    priority: params.classification.priority,
    message: params.message,
    recommended_reply: params.classification.recommendedReply,
    created_at: params.createdAt ?? new Date().toISOString(),
    instagram_comment_id: params.instagramCommentId ?? null,
    instagram_media_id: params.instagramMediaId ?? null,
    ai_confidence: params.classification.confidence,
    ai_rationale: params.classification.rationale,
    link_destination: params.classification.destination,
    classified_at: new Date().toISOString(),
    classification_source: params.classification.source,
  }
}

function getStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getObjectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function collectCandidateIds(value: unknown): string[] {
  const seen = new Set<string>()
  const queue: unknown[] = [value]

  while (queue.length) {
    const current = queue.shift()
    if (!current) {
      continue
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item)
      }
      continue
    }

    if (typeof current !== 'object') {
      continue
    }

    const objectValue = current as Record<string, unknown>
    for (const [key, nested] of Object.entries(objectValue)) {
      if (key === 'id') {
        const id = getStringValue(nested)
        if (id) {
          seen.add(id)
        }
      }

      queue.push(nested)
    }
  }

  return Array.from(seen)
}

function buildParticipantHandle(participantId?: string | null) {
  const tail = participantId?.slice(-6) ?? 'unknown'
  return `@ig-user-${tail}`
}

function buildParticipantName(participantId?: string | null) {
  const tail = participantId?.slice(-4) ?? 'user'
  return `Instagram user ${tail}`
}

function buildNextActionFromClassification(classification: CommentIntentClassification) {
  if (classification.intent === 'inquiry') {
    return 'Review pricing response and approve sales link DM'
  }

  if (classification.intent === 'collaboration') {
    return 'Review partnership response and route to founder inbox'
  }

  return 'Review educational reply and approve resource DM'
}

function getLinkForDestination(
  destination: CommentIntentClassification['destination'],
  links: { sales?: string | null; course?: string | null; community?: string | null },
) {
  if (destination === 'sales') {
    return links.sales ?? null
  }

  if (destination === 'community') {
    return links.community ?? null
  }

  return links.course ?? null
}

export async function getSessionFromAuthHeader(authHeader?: string): Promise<AuthSession> {
  const anon = getSupabaseAnon()
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim()

  if (!anon || !token) {
    return defaultSession
  }

  const { data, error } = await anon.auth.getUser(token)

  if (error || !data.user) {
    return defaultSession
  }

  return {
    userId: data.user.id,
    email: data.user.email ?? defaultSession.email,
    workspaceId: defaultSession.workspaceId,
    role: 'owner',
  }
}

export async function getDashboard(): Promise<DashboardData> {
  const admin = getSupabaseAdmin()

  if (!admin) {
    return dashboardSeed
  }

  const { data: workspace } = await admin
    .from('workspaces')
    .select('id, name, niche, primary_goal, posting_frequency, team_size, has_instagram_access')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!workspace?.id) {
    return dashboardSeed
  }

  const [
    { data: accounts },
    { data: profileSnapshots },
    { data: posts },
    { data: metrics },
    { data: comments },
    { data: conversations },
    { data: jobs },
    { data: contentItems },
  ] = await Promise.all([
    admin
      .from('instagram_accounts')
      .select('id, handle, status, last_synced_at, connected_at')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false })
      .limit(3),
    admin
      .from('instagram_profile_snapshots')
      .select('followers_count, media_count, captured_at, username')
      .eq('workspace_id', workspace.id)
      .order('captured_at', { ascending: true })
      .limit(12),
    admin
      .from('posts')
      .select('id, instagram_post_id, format, caption, published_at')
      .eq('workspace_id', workspace.id)
      .order('published_at', { ascending: false })
      .limit(12),
    admin
      .from('post_metrics')
      .select('post_id, reach, likes, comments, saves, shares, followers_gained, captured_at')
      .order('captured_at', { ascending: true })
      .limit(120),
    admin
      .from('comments')
      .select('id, author_handle, author_name, intent, priority, message, recommended_reply, created_at')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false })
      .limit(12),
    admin
      .from('dm_conversations')
      .select('id, participant_name, participant_handle, intent, priority, status, last_message_preview, next_action, updated_at')
      .eq('workspace_id', workspace.id)
      .order('updated_at', { ascending: false })
      .limit(12),
    admin
      .from('ingestion_jobs')
      .select('id, job_type, source, status, scheduled_for, note')
      .eq('workspace_id', workspace.id)
      .order('scheduled_for', { ascending: false })
      .limit(12),
    admin
      .from('content_items')
      .select('id, title, format, status, publishing_slot, goal, content_copy')
      .eq('workspace_id', workspace.id)
      .order('publishing_slot', { ascending: true })
      .limit(8),
  ])

  const connectedAccount = accounts?.find((account) => account.status === 'connected') ?? accounts?.[0]
  const latestProfile = profileSnapshots?.at(-1)
  const previousProfile = profileSnapshots && profileSnapshots.length > 1 ? profileSnapshots.at(-2) : null
  const latestSync = connectedAccount?.last_synced_at ?? connectedAccount?.connected_at ?? null

  const postMetricsByPostId = new Map<
    string,
    Array<{
      post_id: string
      reach: number
      likes: number
      comments: number
      saves: number
      shares: number
      followers_gained: number
      captured_at: string
    }>
  >()
  for (const metric of metrics ?? []) {
    const current = postMetricsByPostId.get(metric.post_id) ?? []
    current.push(metric)
    postMetricsByPostId.set(metric.post_id, current)
  }

  const recentPosts = (posts ?? []).slice(0, 8)
  const recentPostMetrics = recentPosts.flatMap((post) => postMetricsByPostId.get(post.id) ?? [])
  const totalReach = recentPostMetrics.reduce((sum, item) => sum + Number(item.reach ?? 0), 0)
  const totalFollowersGained = recentPostMetrics.reduce((sum, item) => sum + Number(item.followers_gained ?? 0), 0)
  const totalSaves = recentPostMetrics.reduce((sum, item) => sum + Number(item.saves ?? 0), 0)
  const totalShares = recentPostMetrics.reduce((sum, item) => sum + Number(item.shares ?? 0), 0)

  const reachSeries = (profileSnapshots ?? []).map((_item, index) => Number(recentPostMetrics[index]?.reach ?? 0))
  const followerSeries = (profileSnapshots ?? []).map((item) => Number(item.followers_count ?? 0))
  const trafficSeries = recentPosts
    .map((post) => {
      const metricSet = postMetricsByPostId.get(post.id) ?? []
      return metricSet.reduce((sum, item) => sum + Number(item.saves ?? 0) + Number(item.shares ?? 0), 0)
    })
    .reverse()

  const planner =
    contentItems?.length
      ? contentItems.map((item) => ({
          id: item.id,
          title: item.title,
        format: item.format,
        slot: item.publishing_slot
          ? new Date(item.publishing_slot).toLocaleString('en-IN', {
                day: '2-digit',
                month: 'short',
                hour: 'numeric',
              minute: '2-digit',
            })
          : 'TBD',
        publishingAt: item.publishing_slot ?? null,
        status: item.status,
        goal: item.goal,
        contentCopy: item.content_copy ?? '',
        tone: contentTone(item.status),
      }))
      : dashboardSeed.planner

  const recentComments =
    comments?.length
      ? comments.map((comment) => ({
          id: comment.id,
          author: comment.author_name || comment.author_handle,
          postRef: 'Recent Instagram post',
          intent: comment.intent,
          message: comment.message,
          recommendedReply: comment.recommended_reply ?? 'Review and respond.',
          priority: comment.priority,
          tone: priorityTone(comment.priority),
        }))
      : dashboardSeed.comments

  const recentDms =
    conversations?.length
      ? conversations.map((conversation) => ({
          id: conversation.id,
          name: conversation.participant_name,
          handle: conversation.participant_handle,
          intent: conversation.intent,
          preview: conversation.last_message_preview,
          nextAction: conversation.next_action ?? 'Review conversation',
          sla: conversation.status,
          tone: conversation.priority === 'high' ? ('green' as Tone) : ('blue' as Tone),
        }))
      : dashboardSeed.dms

  const topFormat = recentPosts.reduce<Record<string, number>>((acc, post) => {
    acc[post.format] = (acc[post.format] ?? 0) + 1
    return acc
  }, {})
  const dominantFormat = Object.entries(topFormat).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Mixed'
  const followersCurrent = Number(latestProfile?.followers_count ?? 0)
  const followersPrevious = Number(previousProfile?.followers_count ?? Math.max(1, followersCurrent - 40))
  const mediaCurrent = Number(latestProfile?.media_count ?? recentPosts.length)
  const latestJobNote = jobs?.[0]?.note ?? 'No sync jobs have run yet.'

  return {
    hero: {
      title: connectedAccount?.handle
        ? `${connectedAccount.handle} live command center`
        : `${workspace.name} growth command center`,
      subtitle: connectedAccount?.handle
        ? `Live dashboard for ${connectedAccount.handle}. Synced profile snapshots, posts, jobs, and routed comments now drive this view.`
        : dashboardSeed.hero.subtitle,
      primaryGoal: workspace.primary_goal,
      nextPush: recentPosts[0]?.caption ? 'Review latest synced post performance' : `${workspace.posting_frequency} workflow in motion`,
    },
    account: {
      handle: connectedAccount?.handle ?? '@not-connected',
      status: connectedAccount?.status ?? 'draft',
      followers: followersCurrent,
      mediaCount: mediaCurrent,
      lastSyncedAt: latestSync,
    },
    health: {
      score: `${Math.min(100, 48 + recentPosts.length * 2 + Math.min(20, comments?.length ?? 0))}/100`,
      summary: connectedAccount?.handle
        ? `Connected to ${connectedAccount.handle}. This dashboard is now reading live synced data from Supabase.`
        : dashboardSeed.health.summary,
      flags: [
        connectedAccount?.handle
          ? `${connectedAccount.handle} is connected and ready for repeat syncs`
          : 'Instagram account access still needs connection',
        `${recentPosts.length} media items and ${comments?.length ?? 0} recent classified comments are stored`,
        `Latest sync note: ${latestJobNote}`,
      ],
    },
    charts: {
      reachSeries: reachSeries.some((value) => value > 0) ? reachSeries : dashboardSeed.charts.reachSeries,
      followerSeries: followerSeries.some((value) => value > 0) ? followerSeries : dashboardSeed.charts.followerSeries,
      trafficSeries: trafficSeries.some((value) => value > 0) ? trafficSeries : dashboardSeed.charts.trafficSeries,
      countryBars: dashboardSeed.charts.countryBars,
      audienceMix: dashboardSeed.charts.audienceMix,
    },
    summaryMetrics: [
      {
        label: 'Reach',
        value: formatCompactNumber(totalReach),
        context: 'Reach from synced post metrics',
        delta: formatPercentDelta(totalReach, Math.max(1, Math.round(totalReach * 0.82))),
      },
      {
        label: 'Followers',
        value: formatCompactNumber(followersCurrent),
        context: 'Latest follower count from synced profile snapshot',
        delta: formatPercentDelta(followersCurrent, followersPrevious),
      },
      {
        label: 'Media Synced',
        value: String(recentPosts.length),
        context: 'Instagram posts currently stored in Supabase',
        delta: connectedAccount?.last_synced_at ? '+live' : '0',
      },
      {
        label: 'Comments Classified',
        value: String(comments?.length ?? 0),
        context: 'Comments stored with intent and suggested reply',
        delta: comments?.length ? '+active' : '0',
      },
    ],
    priorityActions: [
      {
        area: 'Sync',
        title: connectedAccount?.last_synced_at ? 'Keep live sync running daily' : 'Run another sync to deepen account data',
        detail: connectedAccount?.last_synced_at
          ? `Last synced at ${connectedAccount.last_synced_at}. Continue syncing so new posts and comments appear here automatically.`
          : 'The handle is connected. Another sync will enrich the dashboard with more live profile and media history.',
        outcome: 'Keeps real dashboard data current',
        tone: 'blue',
      },
      {
        area: 'Content',
        title: `Lean into ${dominantFormat}`,
        detail: `${dominantFormat} is the most common format across the currently synced posts.`,
        outcome: 'Better consistency in what is already publishing',
        tone: scoreTone(totalSaves + totalShares, 30, 8),
      },
      {
        area: 'Comments',
        title: comments?.length ? 'Work the newest high-priority comments first' : 'Use comment-based CTAs to generate routable conversations',
        detail: comments?.length
          ? `${comments.filter((item) => item.priority === 'High priority').length} recent comments are marked high priority.`
          : 'No comments were imported during the last sync, so the comment-to-DM flow still needs fresh examples from live posts.',
        outcome: 'Improve response speed and comment-to-DM conversion',
        tone: comments?.length ? 'green' : 'gold',
      },
    ],
    trends: dashboardSeed.trends,
    planner,
    generatedHooks: dashboardSeed.generatedHooks,
    dms: recentDms,
    comments: recentComments,
    analytics: [
      {
        label: 'Top Format',
        value: dominantFormat,
        detail: 'Based on synced posts in your Supabase workspace.',
      },
      {
        label: 'Follower Delta',
        value: totalFollowersGained || followersCurrent - followersPrevious,
        detail: 'Follower gain from recent synced metrics or latest profile delta.',
      },
      {
        label: 'Saves + Shares',
        value: formatCompactNumber(totalSaves + totalShares),
        detail: 'Recent interaction actions from synced post metrics.',
      },
      {
        label: 'Comments Routed',
        value: comments?.length ?? 0,
        detail: 'Recent comments saved with intent and suggested replies.',
      },
    ],
    recommendations: [
      {
        category: 'Live data',
        title: connectedAccount?.handle
          ? `Dashboard is now tied to ${connectedAccount.handle}`
          : 'Connect Instagram to replace remaining placeholders',
        detail: connectedAccount?.handle
          ? 'Profile snapshots and synced posts now drive the metrics. Audience demographics still depend on deeper Meta insight access.'
          : 'A connected business account is required before the dashboard can switch into fully live mode.',
      },
      {
        category: 'Engagement',
        title: comments?.length ? 'Turn fresh comments into routed DMs quickly' : 'Increase live comment volume with keyword prompts',
        detail: comments?.length
          ? 'The reply desk is now using actual synced comments from your handle instead of demo examples.'
          : 'No live comments were pulled yet, so comment automation still has limited recent input from this handle.',
      },
      {
        category: 'Insights',
        title: insightsMissingMessage(latestJobNote),
        detail: 'If a Meta insight block is unavailable, the dashboard still continues with profile snapshots and post metrics.',
      },
    ],
    flow: dashboardSeed.flow,
  }
}

export async function getOnboarding(): Promise<OnboardingState> {
  const admin = getSupabaseAdmin()

  if (!admin) {
    return defaultOnboarding
  }

  const { data } = await admin
    .from('workspaces')
    .select('id, name, niche, primary_goal, posting_frequency, team_size, has_instagram_access, sales_link, course_link, community_link')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!data) {
    return defaultOnboarding
  }

  return formatOnboardingFromRow(data)
}

export async function saveGeneratedHookToPlanner(
  payload: SaveGeneratedHookPayload,
): Promise<{
  id: string
  title: string
  format: string
  status: string
  goal: string
}> {
  const admin = getSupabaseAdmin()
  const fallback = {
    id: `content-${Date.now()}`,
    title: payload.hook.title,
    format: hookTypeToFormat(payload.hook.type),
    status: 'Draft',
    goal: defaultOnboarding.goal,
  }

  if (!admin) {
    return fallback
  }

  const { data: workspace } = await admin
    .from('workspaces')
    .select('primary_goal')
    .eq('id', payload.workspaceId)
    .maybeSingle()

  const goal = workspace?.primary_goal ?? defaultOnboarding.goal

  const { data, error } = await admin
    .from('content_items')
    .insert({
      workspace_id: payload.workspaceId,
      title: payload.hook.title,
      format: hookTypeToFormat(payload.hook.type),
      status: 'Draft',
      publishing_slot: null,
      goal,
      hook_family: payload.hook.type,
      cta_type: payload.hook.type,
      content_copy: payload.hook.copy,
      source: 'generated_hook',
    })
      .select('id, title, format, status, goal')
      .single()

  if (error || !data) {
    return fallback
  }

  return {
    id: data.id,
    title: data.title,
    format: data.format,
    status: data.status,
    goal: data.goal,
  }
}

export async function updateContentItem(
  payload: UpdateContentItemPayload,
): Promise<{
  id: string
  title: string
  format: string
  status: string
  goal: string
  publishingAt: string | null
  contentCopy: string
}> {
  const admin = getSupabaseAdmin()
  const fallback = {
    id: payload.id,
    title: payload.title,
    format: payload.format,
    status: payload.status,
    goal: payload.goal,
    publishingAt: payload.publishingAt,
    contentCopy: payload.contentCopy,
  }

  if (!admin) {
    return fallback
  }

  const { data, error } = await admin
    .from('content_items')
    .update({
      title: payload.title,
      format: payload.format,
      status: payload.status,
      goal: payload.goal,
      publishing_slot: payload.publishingAt,
      content_copy: payload.contentCopy,
    })
    .eq('id', payload.id)
    .select('id, title, format, status, goal, publishing_slot, content_copy')
    .single()

  if (error || !data) {
    return fallback
  }

  return {
    id: data.id,
    title: data.title,
    format: data.format,
    status: data.status,
    goal: data.goal,
    publishingAt: data.publishing_slot,
    contentCopy: data.content_copy ?? '',
  }
}

export async function saveOnboarding(payload: OnboardingPayload): Promise<OnboardingState> {
  const admin = getSupabaseAdmin()
  const computed = buildOnboardingState(payload)

  if (!admin) {
    return computed
  }

  const existing = await admin
    .from('workspaces')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  const workspaceId = existing.data?.id

  const { data, error } = await admin
    .from('workspaces')
    .upsert(
      {
        id: workspaceId,
        name: payload.brandName,
        niche: payload.niche,
        primary_goal: payload.goal,
        posting_frequency: payload.postingFrequency,
        team_size: payload.teamSize,
        has_instagram_access: payload.hasInstagramAccess,
        sales_link: payload.salesLink,
        course_link: payload.courseLink,
        community_link: payload.communityLink,
      },
      { onConflict: 'id' },
    )
    .select('id, name, niche, primary_goal, posting_frequency, team_size, has_instagram_access, sales_link, course_link, community_link')
    .single()

  if (error || !data) {
    return computed
  }

  return formatOnboardingFromRow(data)
}

export async function getIngestionJobs(): Promise<IngestionJob[]> {
  const admin = getSupabaseAdmin()

  if (!admin) {
    return ingestionJobs
  }

  const { data } = await admin
    .from('ingestion_jobs')
    .select('id, job_type, source, status, scheduled_for, note')
    .order('scheduled_for', { ascending: false })
    .limit(12)

  if (!data?.length) {
    return ingestionJobs
  }

  return data.map((row) => ({
    id: row.id,
    type: row.job_type as IngestionJob['type'],
    status: row.status as IngestionJob['status'],
    source: row.source,
    scheduledFor: row.scheduled_for,
    note: row.note ?? '',
  }))
}

export async function createIngestionJob(
  type: IngestionJob['type'],
  workspaceId: string,
): Promise<IngestionJob> {
  const admin = getSupabaseAdmin()
  const fallback: IngestionJob = {
    id: `job-${Date.now()}`,
    type,
    status: 'queued',
    source: type === 'competitor-scan' ? 'tracked-accounts' : 'instagram-api-placeholder',
    scheduledFor: new Date().toISOString(),
    note: `Manual run requested for ${type}. Replace this with a live worker.`,
  }

  if (!admin) {
    return fallback
  }

  const { data, error } = await admin
    .from('ingestion_jobs')
    .insert({
      workspace_id: workspaceId,
      job_type: type,
      status: 'queued',
      source: fallback.source,
      scheduled_for: fallback.scheduledFor,
      note: fallback.note,
    })
    .select('id, job_type, source, status, scheduled_for, note')
    .single()

  if (error || !data) {
    return fallback
  }

  return {
    id: data.id,
    type: data.job_type as IngestionJob['type'],
    status: data.status as IngestionJob['status'],
    source: data.source,
    scheduledFor: data.scheduled_for,
    note: data.note ?? '',
  }
}

async function getWorkspaceAutomationContext(workspaceId: string) {
  const admin = getSupabaseAdmin()

  if (!admin) {
    return {
      links: {
        sales: defaultOnboarding.salesLink,
        course: defaultOnboarding.courseLink,
        community: defaultOnboarding.communityLink,
      },
      routeMap: new Map<string, { destination: 'sales' | 'course' | 'community'; responseTemplate: string }>(),
    }
  }

  const [{ data: workspace }, { data: routes }] = await Promise.all([
    admin
      .from('workspaces')
      .select('sales_link, course_link, community_link')
      .eq('id', workspaceId)
      .maybeSingle(),
    admin
      .from('comment_intent_routes')
      .select('intent, destination, response_template')
      .eq('workspace_id', workspaceId),
  ])

  return {
    links: {
      sales: workspace?.sales_link ?? defaultOnboarding.salesLink,
      course: workspace?.course_link ?? defaultOnboarding.courseLink,
      community: workspace?.community_link ?? defaultOnboarding.communityLink,
    },
    routeMap: new Map(
      (routes ?? []).map((route) => [
        route.intent,
        {
          destination: route.destination as 'sales' | 'course' | 'community',
          responseTemplate: route.response_template,
        },
      ]),
    ),
  }
}

async function resolveAccountFromCandidates(candidateIds: string[]) {
  const admin = getSupabaseAdmin()

  if (!admin || !candidateIds.length) {
    return null
  }

  for (const candidateId of candidateIds) {
    const { data } = await admin
      .from('instagram_accounts')
      .select('id, workspace_id, instagram_user_id, facebook_page_id')
      .or(`instagram_user_id.eq.${candidateId},facebook_page_id.eq.${candidateId}`)
      .limit(1)
      .maybeSingle()

    if (data?.id) {
      return data
    }
  }

  return null
}

async function createReplyWorkflowRecord(params: {
  workspaceId: string
  instagramAccountId?: string | null
  sourceEventId: string
  sourceType: 'comment' | 'dm'
  sourceRecordId?: string | null
  channel: 'dm' | 'comment'
  classification: CommentIntentClassification
  routeTemplate?: string | null
  links: {
    sales?: string | null
    course?: string | null
    community?: string | null
  }
  triggerReason: string
}) {
  const admin = getSupabaseAdmin()

  if (!admin) {
    return false
  }

  const { data: existing } = await admin
    .from('reply_workflows')
    .select('id')
    .eq('source_event_id', params.sourceEventId)
    .eq('channel', params.channel)
    .limit(1)
    .maybeSingle()

  if (existing?.id) {
    return false
  }

  const linkUrl = getLinkForDestination(params.classification.destination, params.links)
  await admin.from('reply_workflows').insert({
    workspace_id: params.workspaceId,
    instagram_account_id: params.instagramAccountId ?? null,
    source_event_id: params.sourceEventId,
    source_type: params.sourceType,
    source_record_id: params.sourceRecordId ?? null,
    channel: params.channel,
    intent: params.classification.intent,
    priority: params.classification.priority,
    destination: params.classification.destination,
    proposed_reply: params.routeTemplate ?? params.classification.recommendedReply,
    link_url: linkUrl,
    automation_mode: 'safe_review',
    status: 'queued',
    trigger_reason: params.triggerReason,
  })

  return true
}

async function processMessageWebhookEvent(event: {
  id: string
  workspace_id: string
  instagram_account_id: string | null
  entry_id: string | null
  event_type: string
  payload_json: Record<string, unknown>
  received_at: string
}) {
  const admin = getSupabaseAdmin()

  if (!admin) {
    return {
      conversationsUpdated: 0,
      replyWorkflowsCreated: 0,
    }
  }

  const payload = event.payload_json
  const sender = getObjectValue(payload.sender)
  const recipient = getObjectValue(payload.recipient)
  const messageObject = getObjectValue(payload.message)
  const senderId = getStringValue(sender?.id)
  const recipientId = getStringValue(recipient?.id)
  const participantId =
    [senderId, recipientId].find((value) => value && value !== event.entry_id) ?? senderId ?? recipientId
  const isEcho = Boolean(messageObject?.is_echo) || senderId === event.entry_id
  const messageText =
    getStringValue(messageObject?.text) ??
    (event.event_type === 'read'
      ? 'Meta read event received.'
      : event.event_type === 'delivery'
        ? 'Meta delivery event received.'
        : 'Meta messaging event received.')

  const context = await getWorkspaceAutomationContext(event.workspace_id)
  const classification =
    event.event_type === 'message' && !isEcho
      ? await classifyCommentIntent({
          author: buildParticipantHandle(participantId),
          message: messageText,
          salesLink: context.links.sales ?? undefined,
          courseLink: context.links.course ?? undefined,
          communityLink: context.links.community ?? undefined,
        })
      : ({
          intent: 'question',
          priority: 'Normal',
          tone: 'blue',
          destination: 'course',
          fanSegment: 'Education seekers',
          recommendedReply: 'Review this DM thread and respond with the matching resource or next step.',
          confidence: 0.58,
          rationale: 'System-generated fallback for a non-message or echo webhook event.',
          source: 'rules',
        } satisfies CommentIntentClassification)

  const threadId = participantId ?? `event-${event.id}`
  const route = context.routeMap.get(classification.intent)
  const participantHandle = buildParticipantHandle(participantId)
  const participantName = buildParticipantName(participantId)
  const nextAction = buildNextActionFromClassification(classification)

  const { data: existingConversation } = await admin
    .from('dm_conversations')
    .select('id')
    .eq('workspace_id', event.workspace_id)
    .or(
      participantId
        ? `instagram_thread_id.eq.${threadId},instagram_participant_id.eq.${participantId}`
        : `instagram_thread_id.eq.${threadId}`,
    )
    .limit(1)
    .maybeSingle()

  let conversationId = existingConversation?.id ?? null

  if (conversationId) {
    const { data: updatedConversation } = await admin
      .from('dm_conversations')
      .update({
        instagram_thread_id: threadId,
        instagram_participant_id: participantId,
        participant_handle: participantHandle,
        participant_name: participantName,
        intent: classification.intent,
        priority: classification.priority,
        status:
          event.event_type === 'read' ? 'read' : event.event_type === 'delivery' ? 'delivered' : 'open',
        last_message_preview: messageText,
        next_action: nextAction,
        updated_at: event.received_at,
        last_message_at: event.received_at,
        source: 'meta_webhook',
      })
      .eq('id', conversationId)
      .select('id')
      .maybeSingle()

    conversationId = updatedConversation?.id ?? conversationId
  } else {
    const { data: insertedConversation } = await admin
      .from('dm_conversations')
      .insert({
        workspace_id: event.workspace_id,
        instagram_thread_id: threadId,
        instagram_participant_id: participantId,
        participant_handle: participantHandle,
        participant_name: participantName,
        intent: classification.intent,
        priority: classification.priority,
        status:
          event.event_type === 'read' ? 'read' : event.event_type === 'delivery' ? 'delivered' : 'open',
        last_message_preview: messageText,
        next_action: nextAction,
        updated_at: event.received_at,
        last_message_at: event.received_at,
        source: 'meta_webhook',
      })
      .select('id')
      .single()

    conversationId = insertedConversation?.id ?? null
  }

  if (event.event_type === 'read') {
    await admin.from('dm_link_events').insert({
      workspace_id: event.workspace_id,
      event_type: 'opened',
      link_type: 'dm',
      occurred_at: event.received_at,
    })
  }

  if (event.event_type === 'message' && isEcho) {
    await admin.from('dm_link_events').insert({
      workspace_id: event.workspace_id,
      event_type: 'sent',
      link_type: 'dm',
      occurred_at: event.received_at,
    })
  }

  const replyWorkflowsCreated =
    event.event_type === 'message' && !isEcho
      ? Number(
          await createReplyWorkflowRecord({
            workspaceId: event.workspace_id,
            instagramAccountId: event.instagram_account_id,
            sourceEventId: event.id,
            sourceType: 'dm',
            sourceRecordId: conversationId,
            channel: 'dm',
            classification: {
              ...classification,
              destination: route?.destination ?? classification.destination,
            },
            routeTemplate: route?.responseTemplate ?? null,
            links: context.links,
            triggerReason: `Inbound DM detected from ${participantHandle}`,
          }),
        )
      : 0

  return {
    conversationsUpdated: conversationId ? 1 : 0,
    replyWorkflowsCreated,
  }
}

async function processCommentWebhookEvent(event: {
  id: string
  workspace_id: string
  instagram_account_id: string | null
  event_type: string
  payload_json: Record<string, unknown>
  received_at: string
}) {
  const admin = getSupabaseAdmin()

  if (!admin) {
    return {
      commentsUpserted: 0,
      replyWorkflowsCreated: 0,
    }
  }

  const payload = event.payload_json
  const value = getObjectValue(payload.value) ?? payload
  const item = getStringValue(value.item)?.toLowerCase()

  if (item && item !== 'comment') {
    return {
      commentsUpserted: 0,
      replyWorkflowsCreated: 0,
    }
  }

  const message =
    getStringValue(value.message) ??
    getStringValue(value.comment_text) ??
    getStringValue(value.text)

  if (!message) {
    return {
      commentsUpserted: 0,
      replyWorkflowsCreated: 0,
    }
  }

  const context = await getWorkspaceAutomationContext(event.workspace_id)
  const author = getObjectValue(value.from)
  const authorId = getStringValue(author?.id) ?? getStringValue(value.sender_id)
  const authorName = getStringValue(author?.name) ?? buildParticipantName(authorId)
  const authorHandle = buildParticipantHandle(authorId)
  const classification = await classifyCommentIntent({
    author: authorName,
    message,
    salesLink: context.links.sales ?? undefined,
    courseLink: context.links.course ?? undefined,
    communityLink: context.links.community ?? undefined,
  })
  const route = context.routeMap.get(classification.intent)
  const instagramPostId =
    getStringValue(value.post_id) ??
    getStringValue(value.media_id) ??
    getStringValue(getObjectValue(value.post)?.id)
  const instagramCommentId = getStringValue(value.comment_id) ?? getStringValue(value.id)

  let postId: string | null = null
  if (instagramPostId) {
    const { data: post } = await admin
      .from('posts')
      .select('id')
      .eq('instagram_post_id', instagramPostId)
      .limit(1)
      .maybeSingle()

    postId = post?.id ?? null
  }

  const record = buildCommentRecord({
    workspaceId: event.workspace_id,
    postId,
    authorHandle,
    authorName,
    message,
    createdAt: event.received_at,
    classification: {
      ...classification,
      destination: route?.destination ?? classification.destination,
    },
    instagramCommentId: instagramCommentId ?? undefined,
    instagramMediaId: instagramPostId ?? undefined,
  })

  let commentId: string | null = null
  if (instagramCommentId) {
    const { data: comment } = await admin
      .from('comments')
      .upsert(record, { onConflict: 'instagram_comment_id' })
      .select('id')
      .single()

    commentId = comment?.id ?? null
  } else {
    const { data: comment } = await admin
      .from('comments')
      .insert(record)
      .select('id')
      .single()

    commentId = comment?.id ?? null
  }

  const replyWorkflowsCreated = Number(
    await createReplyWorkflowRecord({
      workspaceId: event.workspace_id,
      instagramAccountId: event.instagram_account_id,
      sourceEventId: event.id,
      sourceType: 'comment',
      sourceRecordId: commentId,
      channel: 'dm',
      classification: {
        ...classification,
        destination: route?.destination ?? classification.destination,
      },
      routeTemplate: route?.responseTemplate ?? null,
      links: context.links,
      triggerReason: `Comment intent ${classification.intent} detected from ${authorHandle}`,
    }),
  )

  return {
    commentsUpserted: commentId ? 1 : 0,
    replyWorkflowsCreated,
  }
}

export async function processPendingMetaWebhookEvents(limit = 25): Promise<WebhookProcessingResult> {
  const admin = getSupabaseAdmin()

  if (!admin) {
    return {
      processed: 0,
      commentEvents: 0,
      messageEvents: 0,
      replyWorkflowsCreated: 0,
      conversationsUpdated: 0,
      commentsUpserted: 0,
      skipped: 0,
      errors: [],
    }
  }

  const { data: events } = await admin
    .from('meta_webhook_events')
    .select(
      'id, workspace_id, instagram_account_id, object, entry_id, event_family, event_type, payload_json, received_at',
    )
    .is('processed_at', null)
    .order('received_at', { ascending: true })
    .limit(limit)

  const result: WebhookProcessingResult = {
    processed: 0,
    commentEvents: 0,
    messageEvents: 0,
    replyWorkflowsCreated: 0,
    conversationsUpdated: 0,
    commentsUpserted: 0,
    skipped: 0,
    errors: [],
  }

  for (const event of events ?? []) {
    try {
      let resolvedWorkspaceId = event.workspace_id
      let resolvedInstagramAccountId = event.instagram_account_id

      if (!resolvedWorkspaceId) {
        const candidateIds = collectCandidateIds(event.payload_json)
        if (event.entry_id) {
          candidateIds.unshift(event.entry_id)
        }

        const resolvedAccount = await resolveAccountFromCandidates(candidateIds)
        if (resolvedAccount?.workspace_id) {
          resolvedWorkspaceId = resolvedAccount.workspace_id
          resolvedInstagramAccountId = resolvedAccount.id

          await admin
            .from('meta_webhook_events')
            .update({
              workspace_id: resolvedWorkspaceId,
              instagram_account_id: resolvedInstagramAccountId,
            })
            .eq('id', event.id)
        }
      }

      if (!resolvedWorkspaceId) {
        result.skipped += 1
        await admin
          .from('meta_webhook_events')
          .update({ processed_at: new Date().toISOString() })
          .eq('id', event.id)
        continue
      }

      const payload = getObjectValue(event.payload_json) ?? {}
      const value = getObjectValue(payload.value)
      const isCommentEvent =
        event.event_family === 'comments' ||
        event.event_type.toLowerCase().includes('comment') ||
        getStringValue(value?.item)?.toLowerCase() === 'comment'

      if (event.event_family === 'messages') {
        const processed = await processMessageWebhookEvent({
          id: event.id,
          workspace_id: resolvedWorkspaceId,
          instagram_account_id: resolvedInstagramAccountId,
          entry_id: event.entry_id,
          event_type: event.event_type,
          payload_json: payload,
          received_at: event.received_at,
        })

        result.processed += 1
        result.messageEvents += 1
        result.conversationsUpdated += processed.conversationsUpdated
        result.replyWorkflowsCreated += processed.replyWorkflowsCreated
      } else if (isCommentEvent) {
        const processed = await processCommentWebhookEvent({
          id: event.id,
          workspace_id: resolvedWorkspaceId,
          instagram_account_id: resolvedInstagramAccountId,
          event_type: event.event_type,
          payload_json: payload,
          received_at: event.received_at,
        })

        result.processed += 1
        result.commentEvents += 1
        result.commentsUpserted += processed.commentsUpserted
        result.replyWorkflowsCreated += processed.replyWorkflowsCreated
      } else {
        result.skipped += 1
      }

      await admin
        .from('meta_webhook_events')
        .update({ processed_at: new Date().toISOString() })
        .eq('id', event.id)
    } catch (error) {
      result.errors.push({
        eventId: event.id,
        message: error instanceof Error ? error.message : 'Webhook processing failed',
      })
    }
  }

  return result
}

export async function recordMetaWebhookEvent(params: {
  object: string
  entryId?: string
  eventFamily: 'messages' | 'comments' | 'unknown'
  eventType: string
  payload: Record<string, unknown>
}) {
  const admin = getSupabaseAdmin()

  if (!admin) {
    return { queuedJobs: [] as IngestionJob['type'][] }
  }

  let matchedAccount:
    | {
        id: string
        workspace_id: string
      }
    | null = null

  if (params.entryId) {
    const { data } = await admin
      .from('instagram_accounts')
      .select('id, workspace_id')
      .or(`instagram_user_id.eq.${params.entryId},facebook_page_id.eq.${params.entryId}`)
      .limit(1)
      .maybeSingle()

    matchedAccount = data ?? null
  }

  await admin.from('meta_webhook_events').insert({
    workspace_id: matchedAccount?.workspace_id ?? null,
    instagram_account_id: matchedAccount?.id ?? null,
    object: params.object,
    entry_id: params.entryId ?? null,
    event_family: params.eventFamily,
    event_type: params.eventType,
    payload_json: params.payload,
  })

  const queuedJobs: IngestionJob['type'][] = []
  if (matchedAccount?.workspace_id) {
    if (params.eventFamily === 'comments') {
      await createIngestionJob('comments-sync', matchedAccount.workspace_id)
      queuedJobs.push('comments-sync')
    }

    if (params.eventFamily === 'messages') {
      await createIngestionJob('dm-sync', matchedAccount.workspace_id)
      queuedJobs.push('dm-sync')
    }
  }

  return {
    workspaceId: matchedAccount?.workspace_id ?? null,
    instagramAccountId: matchedAccount?.id ?? null,
    queuedJobs,
  }
}

export async function getCommentAutomation(
  workspaceId: string,
): Promise<CommentAutomationState> {
  const admin = getSupabaseAdmin()

  if (!admin) {
    return { ...defaultCommentAutomation, workspaceId }
  }

  try {
    const [{ data: workspace }, { data: routes }, { data: segments }, { data: events }] =
      await Promise.all([
        admin
          .from('workspaces')
          .select('id, sales_link, course_link, community_link')
          .eq('id', workspaceId)
          .maybeSingle(),
        admin
          .from('comment_intent_routes')
          .select('id, intent, trigger_summary, response_template, destination')
          .eq('workspace_id', workspaceId),
        admin
          .from('fan_segments')
          .select('id, name, description, member_count')
          .eq('workspace_id', workspaceId),
        admin
          .from('dm_link_events')
          .select('event_type, link_type, occurred_at')
          .eq('workspace_id', workspaceId),
      ])

    const sent = events?.filter((event) => event.event_type === 'sent').length ?? 0
    const opened = events?.filter((event) => event.event_type === 'opened').length ?? 0
    const clicked = events?.filter((event) => event.event_type === 'clicked').length ?? 0

    return {
      workspaceId,
      autoDmEnabled: true,
      links: {
        sales: workspace?.sales_link ?? defaultCommentAutomation.links.sales,
        course: workspace?.course_link ?? defaultCommentAutomation.links.course,
        community: workspace?.community_link ?? defaultCommentAutomation.links.community,
      },
      intentRoutes:
        routes?.map((route) => ({
          id: route.id,
          intent: route.intent as CommentAutomationState['intentRoutes'][number]['intent'],
          triggerSummary: route.trigger_summary,
          responseTemplate: route.response_template,
          destination: route.destination as CommentAutomationState['intentRoutes'][number]['destination'],
        })) ?? defaultCommentAutomation.intentRoutes,
      fanSegments:
        segments?.map((segment) => ({
          id: segment.id,
          name: segment.name,
          description: segment.description,
          count: segment.member_count,
        })) ?? defaultCommentAutomation.fanSegments,
      performance: {
        sent,
        opened,
        clicked,
        openRate: sent ? `${((opened / sent) * 100).toFixed(1)}%` : defaultCommentAutomation.performance.openRate,
        clickRate: sent ? `${((clicked / sent) * 100).toFixed(1)}%` : defaultCommentAutomation.performance.clickRate,
        history: buildPerformanceHistory(events ?? []),
      },
    }
  } catch {
    return { ...defaultCommentAutomation, workspaceId }
  }
}

export async function saveCommentAutomation(
  payload: CommentAutomationPayload,
): Promise<CommentAutomationState> {
  const admin = getSupabaseAdmin()
  const fallback = buildCommentAutomationState(payload)

  if (!admin) {
    return fallback
  }

  try {
    await admin
      .from('workspaces')
      .update({
        sales_link: payload.salesLink,
        course_link: payload.courseLink,
        community_link: payload.communityLink,
      })
      .eq('id', payload.workspaceId)

    await admin.from('comment_intent_routes').delete().eq('workspace_id', payload.workspaceId)

    if (payload.intentRoutes.length) {
      await admin.from('comment_intent_routes').insert(
        payload.intentRoutes.map((route) => ({
          workspace_id: payload.workspaceId,
          intent: route.intent,
          trigger_summary: route.triggerSummary,
          response_template: route.responseTemplate,
          destination: route.destination,
        })),
      )
    }

    return getCommentAutomation(payload.workspaceId)
  } catch {
    return fallback
  }
}

export async function getInstagramAccounts(workspaceId: string): Promise<InstagramAccount[]> {
  const admin = getSupabaseAdmin()

  if (!admin) {
    return []
  }

  const { data } = await admin
    .from('instagram_accounts')
    .select('id, workspace_id, handle, account_type, status, connected_at, instagram_user_id, facebook_page_id, token_last4, last_synced_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  return (
    data?.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      handle: row.handle,
      accountType: row.account_type,
      status: row.status,
      connectedAt: row.connected_at,
      instagramUserId: row.instagram_user_id,
      facebookPageId: row.facebook_page_id,
      tokenLast4: row.token_last4,
      lastSyncedAt: row.last_synced_at,
    })) ?? []
  )
}

export async function saveInstagramAccount(input: {
  workspaceId: string
  handle: string
  accountType: string
  status: string
}): Promise<InstagramAccount> {
  const admin = getSupabaseAdmin()
  const fallback: InstagramAccount = {
    id: `ig-${Date.now()}`,
    workspaceId: input.workspaceId,
    handle: input.handle,
    accountType: input.accountType,
    status: input.status,
    connectedAt: input.status === 'connected' ? new Date().toISOString() : null,
    instagramUserId: null,
    facebookPageId: null,
  }

  if (!admin) {
    return fallback
  }

  const { data, error } = await admin
    .from('instagram_accounts')
    .upsert(
      {
        workspace_id: input.workspaceId,
        handle: input.handle,
        account_type: input.accountType,
      status: input.status,
      connected_at: input.status === 'connected' ? new Date().toISOString() : null,
    },
      { onConflict: 'workspace_id,handle' },
    )
    .select('id, workspace_id, handle, account_type, status, connected_at, instagram_user_id, facebook_page_id, token_last4, last_synced_at')
    .single()

  if (error || !data) {
    return fallback
  }

  return {
    id: data.id,
    workspaceId: data.workspace_id,
    handle: data.handle,
    accountType: data.account_type,
    status: data.status,
    connectedAt: data.connected_at,
    instagramUserId: data.instagram_user_id,
    facebookPageId: data.facebook_page_id,
    tokenLast4: data.token_last4,
    lastSyncedAt: data.last_synced_at,
  }
}

export function getMetaConfig(): MetaAppConfig {
  return {
    configured: isMetaConfigured(),
    appId: env.metaAppId,
    redirectUri: env.metaRedirectUri,
    apiVersion: env.metaApiVersion,
    scopes: env.metaScopes.split(',').map((scope) => scope.trim()).filter(Boolean),
  }
}

export function getInstagramConnectUrl(workspaceId: string) {
  return buildInstagramConnectUrl(workspaceId)
}

export async function saveMetaConnection(input: {
  workspaceId: string
  handle: string
  instagramUserId: string
  facebookPageId: string
  accessToken: string
  scopes: string[]
}): Promise<InstagramAccount | null> {
  const admin = getSupabaseAdmin()

  if (!admin) {
    return null
  }

  const tokenLast4 = input.accessToken.slice(-4)
  const connectedAt = new Date().toISOString()

  const { data: account, error: accountError } = await admin
    .from('instagram_accounts')
    .upsert(
      {
        workspace_id: input.workspaceId,
        handle: input.handle,
        account_type: 'business',
        status: 'connected',
        connected_at: connectedAt,
        instagram_user_id: input.instagramUserId,
        facebook_page_id: input.facebookPageId,
        token_last4: tokenLast4,
        token_obtained_at: connectedAt,
        scopes: input.scopes,
      },
      { onConflict: 'workspace_id,handle' },
    )
    .select('id, workspace_id, handle, account_type, status, connected_at, instagram_user_id, facebook_page_id, token_last4, last_synced_at')
    .single()

  if (accountError || !account) {
    return null
  }

  await admin.from('integration_tokens').insert({
    workspace_id: input.workspaceId,
    provider: 'meta_instagram',
    account_id: account.id,
    access_token: input.accessToken,
  })

  return {
    id: account.id,
    workspaceId: account.workspace_id,
    handle: account.handle,
    accountType: account.account_type,
    status: account.status,
    connectedAt: account.connected_at,
    instagramUserId: account.instagram_user_id,
    facebookPageId: account.facebook_page_id,
    tokenLast4: account.token_last4,
    lastSyncedAt: account.last_synced_at,
  }
}

export async function completeMetaConnection(params: {
  workspaceId: string
  code: string
}) {
  if (!isMetaConfigured()) {
    throw new Error('Meta app config is missing')
  }

  const tokenPayload = await exchangeCodeForAccessToken(params.code)
  const userAccessToken = tokenPayload.access_token

  if (!userAccessToken) {
    throw new Error('Meta token exchange did not return an access token')
  }

  const pages = await fetchManagedPages(userAccessToken)
  const primaryPage = pages.find((page) => page.instagram_business_account?.id && page.access_token)

  if (!primaryPage?.instagram_business_account?.id || !primaryPage.access_token) {
    throw new Error('No Instagram business account found on the connected Meta page')
  }

  const handle = primaryPage.instagram_business_account.username ?? primaryPage.name ?? '@connected-account'

  const account = await saveMetaConnection({
    workspaceId: params.workspaceId,
    handle: handle.startsWith('@') ? handle : `@${handle}`,
    instagramUserId: primaryPage.instagram_business_account.id,
    facebookPageId: primaryPage.id,
    accessToken: primaryPage.access_token,
    scopes: env.metaScopes.split(',').map((scope) => scope.trim()).filter(Boolean),
  })

  return account
}

export async function syncInstagramAccountData(
  workspaceId: string,
  accountId?: string,
): Promise<InstagramSyncResult> {
  const admin = getSupabaseAdmin()

  if (!admin) {
    return {
      synced: false,
      reason: 'Supabase admin client not configured',
    }
  }

  let accountQuery = admin
    .from('instagram_accounts')
    .select('id, workspace_id, handle, instagram_user_id, facebook_page_id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'connected')
    .limit(1)

  if (accountId) {
    accountQuery = accountQuery.eq('id', accountId)
  }

  const { data: account } = await accountQuery.maybeSingle()

  if (!account?.instagram_user_id) {
    return {
      synced: false,
      reason: 'No connected Instagram account found',
    }
  }

  const { data: tokenRow } = await admin
    .from('integration_tokens')
    .select('access_token')
    .eq('workspace_id', workspaceId)
    .eq('provider', 'meta_instagram')
    .eq('account_id', account.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!tokenRow?.access_token) {
    return {
      synced: false,
      reason: 'No stored Meta page token found for the connected account',
    }
  }

  const { data: workspaceLinks } = await admin
    .from('workspaces')
    .select('sales_link, course_link, community_link')
    .eq('id', workspaceId)
    .maybeSingle()

  const [profile, media, insightsResult] = await Promise.allSettled([
    fetchInstagramProfile(account.instagram_user_id, tokenRow.access_token),
    fetchInstagramMedia(account.instagram_user_id, tokenRow.access_token),
    fetchInstagramInsights(account.instagram_user_id, tokenRow.access_token),
  ])

  if (profile.status !== 'fulfilled') {
    return {
      synced: false,
      reason: profile.reason instanceof Error ? profile.reason.message : 'Instagram profile sync failed',
    }
  }

  if (media.status !== 'fulfilled') {
    return {
      synced: false,
      reason: media.reason instanceof Error ? media.reason.message : 'Instagram media sync failed',
    }
  }

  const profileData = profile.value
  const mediaItems = media.value
  const insights = insightsResult.status === 'fulfilled' ? insightsResult.value : []

  await admin
    .from('instagram_accounts')
    .update({
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', account.id)

  await admin.from('instagram_profile_snapshots').insert({
    workspace_id: workspaceId,
    instagram_account_id: account.id,
    instagram_user_id: account.instagram_user_id,
    username: String(profileData.username ?? account.handle.replace(/^@/, '')),
    display_name: String(profileData.name ?? ''),
    followers_count: Number(profileData.followers_count ?? 0),
    follows_count: Number(profileData.follows_count ?? 0),
    media_count: Number(profileData.media_count ?? 0),
    profile_picture_url: String(profileData.profile_picture_url ?? ''),
  })

  if (insights.length) {
    await admin.from('instagram_account_insights').insert(
      insights.map((insight) => ({
        workspace_id: workspaceId,
        instagram_account_id: account.id,
        metric: String(insight.name ?? insight.title ?? 'unknown_metric'),
        period: String(insight.period ?? 'day'),
        end_time: insight.period === 'lifetime' ? null : (Array.isArray((insight as { values?: Array<{ end_time?: string }> }).values) ? (insight as { values?: Array<{ end_time?: string }> }).values?.[0]?.end_time ?? null : null),
        value_json: insight,
      })),
    )
  }

  let commentsClassified = 0
  for (const mediaItem of mediaItems) {
    const instagramPostId = String(mediaItem.id ?? '')

    if (!instagramPostId) {
      continue
    }

    const { data: post } = await admin
      .from('posts')
      .upsert(
        {
          workspace_id: workspaceId,
          instagram_post_id: instagramPostId,
          format: String(mediaItem.media_type ?? 'IMAGE'),
          caption: String(mediaItem.caption ?? ''),
          published_at: String(mediaItem.timestamp ?? new Date().toISOString()),
        },
        { onConflict: 'instagram_post_id' },
      )
      .select('id')
      .single()

    if (post?.id) {
      await admin.from('post_metrics').insert({
        post_id: post.id,
        likes: Number(mediaItem.like_count ?? 0),
        comments: Number(mediaItem.comments_count ?? 0),
        captured_at: new Date().toISOString(),
      })

      const comments = await fetchCommentsForMedia(instagramPostId, tokenRow.access_token)
      for (const comment of comments) {
        const message = String(comment.text ?? '').trim()
        if (!message) {
          continue
        }

        const classification = await classifyCommentIntent({
          author: String(comment.username ?? ''),
          message,
          salesLink: workspaceLinks?.sales_link ?? defaultOnboarding.salesLink,
          courseLink: workspaceLinks?.course_link ?? defaultOnboarding.courseLink,
          communityLink: workspaceLinks?.community_link ?? defaultOnboarding.communityLink,
        })

        const record = buildCommentRecord({
          workspaceId,
          postId: post.id,
          authorHandle: comment.username ? `@${String(comment.username).replace(/^@/, '')}` : '@unknown',
          authorName: String(comment.username ?? 'Instagram user'),
          message,
          createdAt: String(comment.timestamp ?? new Date().toISOString()),
          classification,
          instagramCommentId: String(comment.id ?? ''),
          instagramMediaId: instagramPostId,
        })

        await admin
          .from('comments')
          .upsert(record, { onConflict: 'instagram_comment_id' })

        commentsClassified += 1
      }
    }
  }

  const { data: segmentRows } = await admin
    .from('comments')
    .select('link_destination')
    .eq('workspace_id', workspaceId)

  const segmentCounts = {
    'Hot buyers': segmentRows?.filter((row) => row.link_destination === 'sales').length ?? 0,
    'Education seekers': segmentRows?.filter((row) => row.link_destination === 'course').length ?? 0,
    'Potential collaborators': segmentRows?.filter((row) => row.link_destination === 'community').length ?? 0,
  }

  await admin.from('fan_segments').upsert(
    Object.entries(segmentCounts).map(([name, count]) => ({
      workspace_id: workspaceId,
      name,
      description:
        name === 'Hot buyers'
          ? 'Users who asked for pricing, demos, or direct setup help.'
          : name === 'Education seekers'
            ? 'Users asking how the workflow works or requesting tutorials.'
            : 'Agencies, creators, and partners showing collaboration intent.',
      member_count: count,
    })),
    { onConflict: 'workspace_id,name' },
  )

  await createIngestionJob('metrics-sync', workspaceId)
  if (commentsClassified > 0) {
    await createIngestionJob('comments-sync', workspaceId)
  }

  return {
    synced: true,
    account: {
      id: account.id,
      handle: account.handle,
    },
    profile: profileData,
    mediaCount: mediaItems.length,
    insightsCount: insights.length,
    commentsClassified,
    reason:
      insightsResult.status === 'rejected'
        ? insightsResult.reason instanceof Error
          ? `Insights skipped: ${insightsResult.reason.message}`
          : 'Insights skipped during sync'
        : undefined,
  }
}

export async function classifyCommentPreview(params: {
  workspaceId: string
  message: string
  author?: string
}) {
  const admin = getSupabaseAdmin()
  const workspaceLinks = admin
    ? await admin
        .from('workspaces')
        .select('sales_link, course_link, community_link')
        .eq('id', params.workspaceId)
        .maybeSingle()
    : { data: null }

  return classifyCommentIntent({
    author: params.author,
    message: params.message,
    salesLink: workspaceLinks.data?.sales_link ?? defaultOnboarding.salesLink,
    courseLink: workspaceLinks.data?.course_link ?? defaultOnboarding.courseLink,
    communityLink: workspaceLinks.data?.community_link ?? defaultOnboarding.communityLink,
  })
}
