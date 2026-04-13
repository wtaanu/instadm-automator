export type Tone = 'blue' | 'green' | 'gold' | 'rose'

export type SummaryMetric = {
  label: string
  value: string
  context: string
  delta: string
}

export type TrendSignal = {
  signal: string
  title: string
  detail: string
  recommendation: string
  lift: string
  tone: Tone
}

export type PlannerItem = {
  id: string
  title: string
  format: string
  slot: string
  publishingAt: string | null
  status: string
  goal: string
  contentCopy?: string
  tone: Tone
}

export type PriorityAction = {
  area: string
  title: string
  detail: string
  outcome: string
  tone: Tone
}

export type DmConversation = {
  id: string
  name: string
  handle: string
  intent: string
  preview: string
  nextAction: string
  sla: string
  tone: Tone
}

export type CommentItem = {
  id: string
  author: string
  postRef: string
  intent: string
  message: string
  recommendedReply: string
  priority: string
  tone: Tone
}

export type AnalyticsSnapshot = {
  label: string
  value: string | number
  detail: string
}

export type Recommendation = {
  category: string
  title: string
  detail: string
}

export type FlowStep = {
  index: string
  title: string
  detail: string
}

export type GeneratedHook = {
  type: string
  title: string
  copy: string
  caption: string
}

export type DashboardData = {
  hero: {
    title: string
    subtitle: string
    primaryGoal: string
    nextPush: string
  }
  account: {
    handle: string
    status: string
    followers: number
    mediaCount: number
    lastSyncedAt: string | null
  }
  health: {
    score: string
    summary: string
    flags: string[]
  }
  charts: {
    reachSeries: number[]
    followerSeries: number[]
    trafficSeries: number[]
    countryBars: Array<{ label: string; value: number }>
    audienceMix: Array<{ label: string; value: number; color: string }>
  }
  summaryMetrics: SummaryMetric[]
  priorityActions: PriorityAction[]
  trends: TrendSignal[]
  planner: PlannerItem[]
  generatedHooks: GeneratedHook[]
  dms: DmConversation[]
  comments: CommentItem[]
  analytics: AnalyticsSnapshot[]
  recommendations: Recommendation[]
  flow: FlowStep[]
}

export type OnboardingState = {
  workspaceId: string
  status: 'draft' | 'connected' | 'ready'
  brandName: string
  niche: string
  goal: string
  postingFrequency: string
  teamSize: number
  hasInstagramAccess: boolean
  salesLink: string
  courseLink: string
  communityLink: string
  recommendedModules: string[]
}

export type AuthSession = {
  userId: string
  email: string
  workspaceId: string
  role: 'owner' | 'manager'
}

export type IngestionJob = {
  id: string
  type: 'metrics-sync' | 'comments-sync' | 'dm-sync' | 'competitor-scan'
  status: 'queued' | 'running' | 'completed'
  source: string
  scheduledFor: string
  note: string
}

export type InstagramAccount = {
  id: string
  workspaceId: string
  handle: string
  accountType: string
  status: string
  connectedAt: string | null
  instagramUserId?: string | null
  facebookPageId?: string | null
  tokenLast4?: string | null
  lastSyncedAt?: string | null
}

export type MetaAppConfig = {
  configured: boolean
  appId: string
  redirectUri: string
  apiVersion: string
  scopes: string[]
}

export type IntentRoute = {
  id: string
  intent: 'question' | 'inquiry' | 'collaboration'
  triggerSummary: string
  responseTemplate: string
  destination: 'sales' | 'course' | 'community'
}

export type FanSegment = {
  id: string
  name: string
  description: string
  count: number
}

export type MessagePerformance = {
  sent: number
  opened: number
  clicked: number
  openRate: string
  clickRate: string
  history: Array<{
    label: string
    sent: number
    opened: number
    clicked: number
  }>
}

export type CommentAutomationState = {
  workspaceId: string
  autoDmEnabled: boolean
  links: {
    sales: string
    course: string
    community: string
  }
  intentRoutes: IntentRoute[]
  fanSegments: FanSegment[]
  performance: MessagePerformance
}

export type InstagramSyncResult = {
  synced: boolean
  reason?: string
  account?: {
    id: string
    handle: string
  }
  profile?: Record<string, unknown>
  mediaCount?: number
  insightsCount?: number
  commentsClassified?: number
}
