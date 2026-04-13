import { env, isMetaConfigured } from './env.js'

type TokenExchangeResponse = {
  access_token?: string
  token_type?: string
}

type PageRecord = {
  id: string
  name?: string
  access_token?: string
  instagram_business_account?: {
    id: string
    username?: string
  }
}

type MediaRecord = {
  id?: string
  caption?: string
  media_type?: string
  media_url?: string
  permalink?: string
  timestamp?: string
  like_count?: number
  comments_count?: number
}

type CommentRecord = {
  id?: string
  text?: string
  username?: string
  timestamp?: string
}

async function fetchMetaJson<T>(url: string) {
  const response = await fetch(url)

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Meta request failed: ${response.status} ${body}`)
  }

  return (await response.json()) as T
}

export function buildInstagramConnectUrl(workspaceId: string, state?: string) {
  if (!isMetaConfigured()) {
    return null
  }

  const params = new URLSearchParams({
    client_id: env.metaAppId,
    redirect_uri: env.metaRedirectUri,
    scope: env.metaScopes,
    response_type: 'code',
    state: state ?? workspaceId,
  })

  return `https://www.facebook.com/${env.metaApiVersion}/dialog/oauth?${params.toString()}`
}

export async function exchangeCodeForAccessToken(code: string) {
  const params = new URLSearchParams({
    client_id: env.metaAppId,
    client_secret: env.metaAppSecret,
    redirect_uri: env.metaRedirectUri,
    code,
  })

  return fetchMetaJson<TokenExchangeResponse>(
    `https://graph.facebook.com/${env.metaApiVersion}/oauth/access_token?${params.toString()}`,
  )
}

export async function fetchManagedPages(userAccessToken: string) {
  const params = new URLSearchParams({
    fields: 'id,name,access_token,instagram_business_account{id,username}',
    access_token: userAccessToken,
  })

  const payload = await fetchMetaJson<{ data?: PageRecord[] }>(
    `https://graph.facebook.com/${env.metaApiVersion}/me/accounts?${params.toString()}`,
  )

  return payload.data ?? []
}

export async function fetchInstagramProfile(instagramUserId: string, pageAccessToken: string) {
  const params = new URLSearchParams({
    fields: 'id,username,name,followers_count,follows_count,media_count,profile_picture_url',
    access_token: pageAccessToken,
  })

  return fetchMetaJson<Record<string, unknown>>(
    `https://graph.facebook.com/${env.metaApiVersion}/${instagramUserId}?${params.toString()}`,
  )
}

export async function fetchInstagramMedia(instagramUserId: string, pageAccessToken: string) {
  const params = new URLSearchParams({
    fields: 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count',
    access_token: pageAccessToken,
  })

  const payload = await fetchMetaJson<{ data?: MediaRecord[] }>(
    `https://graph.facebook.com/${env.metaApiVersion}/${instagramUserId}/media?${params.toString()}`,
  )

  return payload.data ?? []
}

export async function fetchCommentsForMedia(mediaId: string, pageAccessToken: string) {
  const params = new URLSearchParams({
    fields: 'id,text,username,timestamp',
    access_token: pageAccessToken,
  })

  const payload = await fetchMetaJson<{ data?: CommentRecord[] }>(
    `https://graph.facebook.com/${env.metaApiVersion}/${mediaId}/comments?${params.toString()}`,
  )

  return payload.data ?? []
}

export async function fetchInstagramInsights(instagramUserId: string, pageAccessToken: string) {
  const metricSets = [
    'accounts_engaged,total_interactions',
    'impressions,reach,profile_views',
  ]

  for (const metricSet of metricSets) {
    try {
      const params = new URLSearchParams({
        metric: metricSet,
        period: 'day',
        access_token: pageAccessToken,
      })

      const payload = await fetchMetaJson<{ data?: Record<string, unknown>[] }>(
        `https://graph.facebook.com/${env.metaApiVersion}/${instagramUserId}/insights?${params.toString()}`,
      )

      return payload.data ?? []
    } catch (error) {
      if (metricSet === metricSets[metricSets.length - 1]) {
        throw error
      }
    }
  }

  return []
}
