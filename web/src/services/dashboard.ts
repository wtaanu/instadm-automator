import {
  commentAutomationSeed,
  dashboardSeed,
  ingestionSeed,
  onboardingSeed,
  sessionSeed,
} from '../data/mockData'
import { supabase } from '../lib/supabase'
import type {
  AuthSession,
  CommentAutomationState,
  DashboardData,
  GeneratedHook,
  IngestionJob,
  InstagramAccount,
  InstagramSyncResult,
  MetaAppConfig,
  OnboardingState,
} from '../types'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000'

async function fetchJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const session = await supabase?.auth.getSession()
    const accessToken = session?.data.session?.access_token

    const response = await fetch(`${API_BASE}${path}`, {
      headers: accessToken
        ? {
            Authorization: `Bearer ${accessToken}`,
          }
        : undefined,
    })

    if (!response.ok) {
      throw new Error(`Request failed for ${path}`)
    }

    return (await response.json()) as T
  } catch {
    return fallback
  }
}

export async function getDashboardData(): Promise<DashboardData> {
  return fetchJson('/api/dashboard', dashboardSeed)
}

export async function getSession(): Promise<AuthSession> {
  return fetchJson('/api/session', sessionSeed)
}

export async function getOnboarding(): Promise<OnboardingState> {
  return fetchJson('/api/onboarding', onboardingSeed)
}

export async function getIngestionJobs(): Promise<IngestionJob[]> {
  return fetchJson('/api/ingestion-jobs', ingestionSeed)
}

export async function saveOnboarding(payload: {
  brandName: string
  niche: string
  goal: string
  postingFrequency: string
  teamSize: number
  hasInstagramAccess: boolean
  salesLink: string
  courseLink: string
  communityLink: string
}): Promise<OnboardingState> {
  try {
    const session = await supabase?.auth.getSession()
    const accessToken = session?.data.session?.access_token

    const response = await fetch(`${API_BASE}/api/onboarding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error('Failed onboarding save')
    }

    return (await response.json()) as OnboardingState
  } catch {
    return onboardingSeed
  }
}

export async function runIngestionJob(
  type: IngestionJob['type'],
  workspaceId?: string,
): Promise<IngestionJob> {
  try {
    const session = await supabase?.auth.getSession()
    const accessToken = session?.data.session?.access_token

    const response = await fetch(`${API_BASE}/api/ingestion-jobs/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ type, workspaceId }),
    })

    if (!response.ok) {
      throw new Error('Failed to run ingestion job')
    }

    return (await response.json()) as IngestionJob
  } catch {
    return {
      id: `job-${Date.now()}`,
      type,
      status: 'queued',
      source: type === 'competitor-scan' ? 'tracked-accounts' : 'instagram-api-placeholder',
      scheduledFor: new Date().toISOString(),
      note: `Manual run requested for ${type}.`,
    }
  }
}

export async function getInstagramAccounts(
  workspaceId?: string,
): Promise<InstagramAccount[]> {
  if (!workspaceId) {
    return []
  }

  return fetchJson(
    `/api/instagram-accounts?workspaceId=${encodeURIComponent(workspaceId)}`,
    [],
  )
}

export async function saveInstagramAccount(payload: {
  workspaceId: string
  handle: string
  accountType: string
  status: string
}): Promise<InstagramAccount> {
  const response = await fetch(`${API_BASE}/api/instagram-accounts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error('Failed to save Instagram account')
  }

  return (await response.json()) as InstagramAccount
}

export async function getMetaConfig(): Promise<MetaAppConfig> {
  return fetchJson('/api/meta/config', {
    configured: false,
    appId: '',
    redirectUri: '',
    apiVersion: 'v23.0',
    scopes: [],
  })
}

export async function getInstagramConnectUrl(workspaceId: string): Promise<string | null> {
  try {
    const response = await fetch(
      `${API_BASE}/api/instagram/connect-url?workspaceId=${encodeURIComponent(workspaceId)}`,
    )

    if (!response.ok) {
      throw new Error('Failed to fetch connect URL')
    }

    const payload = (await response.json()) as { url?: string }
    return payload.url ?? null
  } catch {
    return null
  }
}

export async function syncInstagramAccount(payload: {
  workspaceId: string
  accountId?: string
}): Promise<InstagramSyncResult> {
  const response = await fetch(`${API_BASE}/api/instagram/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error('Instagram sync failed')
  }

  return (await response.json()) as InstagramSyncResult
}

export async function classifyCommentPreview(payload: {
  workspaceId: string
  message: string
  author?: string
}) {
  const response = await fetch(`${API_BASE}/api/comments/classify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error('Comment classification failed')
  }

  return (await response.json()) as {
    intent: 'question' | 'inquiry' | 'collaboration'
    destination: 'sales' | 'course' | 'community'
    confidence: number
    recommendedReply: string
    fanSegment: string
    source: 'ai' | 'rules'
  }
}

export async function generateHooks(payload: {
  workspaceId: string
}): Promise<GeneratedHook[]> {
  try {
    const response = await fetch(`${API_BASE}/api/hooks/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error('Hook generation failed')
    }

    return (await response.json()) as GeneratedHook[]
  } catch {
    return dashboardSeed.generatedHooks
  }
}

export async function saveGeneratedHook(payload: {
  workspaceId: string
  hook: GeneratedHook
}) {
  const response = await fetch(`${API_BASE}/api/hooks/save`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error('Failed to save generated hook')
  }

  return (await response.json()) as {
    id: string
    title: string
    format: string
    status: string
    goal: string
  }
}

export async function updateContentItem(payload: {
  id: string
  title: string
  format: string
  status: string
  goal: string
  publishingAt: string | null
  contentCopy: string
}) {
  const response = await fetch(`${API_BASE}/api/content-items/update`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error('Failed to update content item')
  }

  return response.json()
}

export async function getCommentAutomation(
  workspaceId?: string,
): Promise<CommentAutomationState> {
  if (!workspaceId) {
    return commentAutomationSeed
  }

  return fetchJson(
    `/api/comment-automation?workspaceId=${encodeURIComponent(workspaceId)}`,
    { ...commentAutomationSeed, workspaceId },
  )
}

export async function saveCommentAutomation(payload: {
  workspaceId: string
  autoDmEnabled: boolean
  salesLink: string
  courseLink: string
  communityLink: string
  intentRoutes: CommentAutomationState['intentRoutes']
}): Promise<CommentAutomationState> {
  try {
    const session = await supabase?.auth.getSession()
    const accessToken = session?.data.session?.access_token

    const response = await fetch(`${API_BASE}/api/comment-automation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error('Failed comment automation save')
    }

    return (await response.json()) as CommentAutomationState
  } catch {
    return {
      ...commentAutomationSeed,
      workspaceId: payload.workspaceId,
      autoDmEnabled: payload.autoDmEnabled,
      links: {
        sales: payload.salesLink,
        course: payload.courseLink,
        community: payload.communityLink,
      },
      intentRoutes: payload.intentRoutes,
    }
  }
}
