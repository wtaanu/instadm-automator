import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({
  path: path.resolve(__dirname, '../../.env'),
})

export const env = {
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  metaAppId: process.env.META_APP_ID ?? '',
  metaAppSecret: process.env.META_APP_SECRET ?? '',
  metaWebhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? 'replace-with-meta-webhook-verify-token',
  metaRedirectUri: process.env.META_REDIRECT_URI ?? 'http://localhost:4000/api/instagram/callback',
  metaApiVersion: process.env.META_API_VERSION ?? 'v23.0',
  metaScopes:
    process.env.META_SCOPES ??
    'instagram_basic,instagram_manage_messages,instagram_manage_comments,instagram_manage_insights,pages_show_list,pages_read_engagement,business_management',
  openAiApiKey: process.env.OPENAI_API_KEY ?? '',
  openAiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  appWebUrl: process.env.APP_WEB_URL ?? 'http://127.0.0.1:5173',
  port: Number(process.env.PORT ?? 4000),
}

export function isSupabaseConfigured() {
  return Boolean(env.supabaseUrl && env.supabaseServiceRoleKey)
}

export function isMetaConfigured() {
  return Boolean(env.metaAppId && env.metaAppSecret && env.metaRedirectUri)
}

export function isOpenAiConfigured() {
  return Boolean(env.openAiApiKey)
}
