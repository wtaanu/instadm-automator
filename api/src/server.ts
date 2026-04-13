import cors from 'cors'
import express from 'express'
import crypto from 'node:crypto'
import { z } from 'zod'
import { env } from './lib/env.js'
import { generateHooksAndCtas } from './lib/openai.js'
import type { IngestionJob } from './types.js'
import {
  createIngestionJob,
  getCommentAutomation,
  getDashboard,
  getIngestionJobs,
  getInstagramAccounts,
  getInstagramConnectUrl,
  getMetaConfig,
  getOnboarding,
  getSessionFromAuthHeader,
  classifyCommentPreview,
  completeMetaConnection,
  recordMetaWebhookEvent,
  saveInstagramAccount,
  saveCommentAutomation,
  saveGeneratedHookToPlanner,
  saveOnboarding,
  syncInstagramAccountData,
  updateContentItem,
} from './repositories/appRepository.js'

const app = express()
const port = env.port

function verifyMetaSignature(rawBody: Buffer, signatureHeader?: string) {
  if (!signatureHeader || !env.metaAppSecret) {
    return false
  }

  const [algorithm, receivedSignature] = signatureHeader.split('=')
  if (algorithm !== 'sha256' || !receivedSignature) {
    return false
  }

  const expectedSignature = crypto
    .createHmac('sha256', env.metaAppSecret)
    .update(rawBody)
    .digest('hex')

  return crypto.timingSafeEqual(Buffer.from(receivedSignature), Buffer.from(expectedSignature))
}

const onboardingSchema = z.object({
  brandName: z.string().min(2),
  niche: z.string().min(3),
  goal: z.string().min(5),
  postingFrequency: z.string().min(2),
  teamSize: z.coerce.number().int().min(1).max(100),
  hasInstagramAccess: z.coerce.boolean(),
  salesLink: z.string().url(),
  courseLink: z.string().url(),
  communityLink: z.string().url(),
})

const instagramAccountSchema = z.object({
  workspaceId: z.string().min(1),
  handle: z.string().min(2),
  accountType: z.string().min(2),
  status: z.string().min(2),
})

const commentAutomationSchema = z.object({
  workspaceId: z.string().min(1),
  autoDmEnabled: z.coerce.boolean(),
  salesLink: z.string().url(),
  courseLink: z.string().url(),
  communityLink: z.string().url(),
  intentRoutes: z.array(
    z.object({
      id: z.string(),
      intent: z.enum(['question', 'inquiry', 'collaboration']),
      triggerSummary: z.string().min(3),
      responseTemplate: z.string().min(5),
      destination: z.enum(['sales', 'course', 'community']),
    }),
  ),
})

const classifyCommentSchema = z.object({
  workspaceId: z.string().min(1),
  message: z.string().min(2),
  author: z.string().optional(),
})

const generateHooksSchema = z.object({
  workspaceId: z.string().min(1),
})

const saveHookSchema = z.object({
  workspaceId: z.string().min(1),
  hook: z.object({
    type: z.string().min(2),
    title: z.string().min(4),
    copy: z.string().min(8),
    caption: z.string().min(8),
  }),
})

const updateContentItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(4),
  format: z.string().min(2),
  status: z.string().min(2),
  goal: z.string().min(3),
  publishingAt: z.string().nullable(),
  contentCopy: z.string().min(8),
})

app.use(cors())
app.get('/api/meta/webhook', (req, res) => {
  const mode = String(req.query['hub.mode'] ?? '')
  const verifyToken = String(req.query['hub.verify_token'] ?? '')
  const challenge = String(req.query['hub.challenge'] ?? '')

  if (mode === 'subscribe' && verifyToken === env.metaWebhookVerifyToken) {
    res.status(200).send(challenge)
    return
  }

  res.status(403).send('Webhook verification failed')
})

app.post('/api/meta/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from([])
  const signatureHeader = req.header('x-hub-signature-256') ?? undefined

  if (!verifyMetaSignature(rawBody, signatureHeader)) {
    res.status(401).json({ message: 'Invalid Meta webhook signature' })
    return
  }

  const payload = JSON.parse(rawBody.toString('utf8')) as {
    object?: string
    entry?: Array<Record<string, unknown>>
  }

  const queuedJobs = new Set<IngestionJob['type']>()

  for (const entry of payload.entry ?? []) {
    const entryId = typeof entry.id === 'string' ? entry.id : undefined
    const changes = Array.isArray(entry.changes) ? entry.changes : []
    const messaging = Array.isArray(entry.messaging) ? entry.messaging : []

    for (const change of changes) {
      const field = typeof change.field === 'string' ? change.field : 'unknown'
      const eventFamily = field.toLowerCase().includes('comment') ? 'comments' : 'unknown'
      const result = await recordMetaWebhookEvent({
        object: payload.object ?? 'unknown',
        entryId,
        eventFamily,
        eventType: field,
        payload: change,
      })

      for (const job of result.queuedJobs) {
        queuedJobs.add(job)
      }
    }

    for (const messageEvent of messaging) {
      const eventType =
        typeof (messageEvent as { message?: unknown }).message !== 'undefined'
          ? 'message'
          : typeof (messageEvent as { read?: unknown }).read !== 'undefined'
            ? 'read'
            : typeof (messageEvent as { delivery?: unknown }).delivery !== 'undefined'
              ? 'delivery'
              : 'messaging'

      const result = await recordMetaWebhookEvent({
        object: payload.object ?? 'unknown',
        entryId,
        eventFamily: 'messages',
        eventType,
        payload: messageEvent,
      })

      for (const job of result.queuedJobs) {
        queuedJobs.add(job)
      }
    }
  }

  res.status(200).json({
    received: true,
    queuedJobs: Array.from(queuedJobs),
  })
})

app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'instagram-automation-api',
    supabaseConfigured: Boolean(env.supabaseUrl && env.supabaseServiceRoleKey),
    now: new Date().toISOString(),
  })
})

app.get('/api/session', async (req, res) => {
  res.json(await getSessionFromAuthHeader(req.header('authorization')))
})

app.get('/api/meta/config', (_req, res) => {
  res.json(getMetaConfig())
})

app.get('/api/instagram/connect-url', (req, res) => {
  const workspaceId = String(req.query.workspaceId ?? '')

  if (!workspaceId) {
    res.status(400).json({ message: 'workspaceId is required' })
    return
  }

  const url = getInstagramConnectUrl(workspaceId)

  if (!url) {
    res.status(400).json({ message: 'Meta app config is missing' })
    return
  }

  res.json({ url })
})

app.get('/api/instagram/callback', async (req, res) => {
  const code = String(req.query.code ?? '')
  const state = String(req.query.state ?? '')

  if (!code || !state) {
    res.status(400).json({ message: 'Missing code or state from Meta callback' })
    return
  }

  try {
    const account = await completeMetaConnection({
      workspaceId: state,
      code,
    })

    const redirectUrl = new URL(env.appWebUrl)
    redirectUrl.searchParams.set('meta_connect', 'success')
    if (account?.handle) {
      redirectUrl.searchParams.set('handle', account.handle)
    }

    res.redirect(redirectUrl.toString())
  } catch (error) {
    const redirectUrl = new URL(env.appWebUrl)
    redirectUrl.searchParams.set('meta_connect', 'error')
    redirectUrl.searchParams.set(
      'message',
      error instanceof Error ? error.message : 'Meta connection failed',
    )
    res.redirect(redirectUrl.toString())
  }
})

app.get('/api/dashboard', async (_req, res) => {
  res.json(await getDashboard())
})

app.get('/api/onboarding', async (_req, res) => {
  res.json(await getOnboarding())
})

app.post('/api/onboarding', async (req, res) => {
  const parsed = onboardingSchema.safeParse(req.body)

  if (!parsed.success) {
    res.status(400).json({
      message: 'Invalid onboarding payload',
      errors: parsed.error.flatten(),
    })
    return
  }

  res.status(201).json(await saveOnboarding(parsed.data))
})

app.get('/api/comment-automation', async (req, res) => {
  const workspaceId = String(req.query.workspaceId ?? '')

  if (!workspaceId) {
    res.status(400).json({ message: 'workspaceId is required' })
    return
  }

  res.json(await getCommentAutomation(workspaceId))
})

app.post('/api/comment-automation', async (req, res) => {
  const parsed = commentAutomationSchema.safeParse(req.body)

  if (!parsed.success) {
    res.status(400).json({
      message: 'Invalid comment automation payload',
      errors: parsed.error.flatten(),
    })
    return
  }

  res.status(201).json(await saveCommentAutomation(parsed.data))
})

app.post('/api/comments/classify', async (req, res) => {
  const parsed = classifyCommentSchema.safeParse(req.body)

  if (!parsed.success) {
    res.status(400).json({
      message: 'Invalid classify payload',
      errors: parsed.error.flatten(),
    })
    return
  }

  res.json(await classifyCommentPreview(parsed.data))
})

app.post('/api/hooks/generate', async (req, res) => {
  const parsed = generateHooksSchema.safeParse(req.body)

  if (!parsed.success) {
    res.status(400).json({
      message: 'Invalid hook generation payload',
      errors: parsed.error.flatten(),
    })
    return
  }

  const onboarding = await getOnboarding()

  res.json(
    await generateHooksAndCtas({
      brandName: onboarding.brandName,
      niche: onboarding.niche,
      goal: onboarding.goal,
      salesLink: onboarding.salesLink,
      courseLink: onboarding.courseLink,
      communityLink: onboarding.communityLink,
    }),
  )
})

app.post('/api/hooks/save', async (req, res) => {
  const parsed = saveHookSchema.safeParse(req.body)

  if (!parsed.success) {
    res.status(400).json({
      message: 'Invalid save hook payload',
      errors: parsed.error.flatten(),
    })
    return
  }

  res.status(201).json(await saveGeneratedHookToPlanner(parsed.data))
})

app.post('/api/content-items/update', async (req, res) => {
  const parsed = updateContentItemSchema.safeParse(req.body)

  if (!parsed.success) {
    res.status(400).json({
      message: 'Invalid content update payload',
      errors: parsed.error.flatten(),
    })
    return
  }

  res.json(await updateContentItem(parsed.data))
})

app.get('/api/ingestion-jobs', async (_req, res) => {
  res.json(await getIngestionJobs())
})

app.get('/api/instagram-accounts', async (req, res) => {
  const workspaceId = String(req.query.workspaceId ?? '')

  if (!workspaceId) {
    res.json([])
    return
  }

  res.json(await getInstagramAccounts(workspaceId))
})

app.post('/api/instagram-accounts', async (req, res) => {
  const parsed = instagramAccountSchema.safeParse(req.body)

  if (!parsed.success) {
    res.status(400).json({
      message: 'Invalid Instagram account payload',
      errors: parsed.error.flatten(),
    })
    return
  }

  res.status(201).json(await saveInstagramAccount(parsed.data))
})

app.post('/api/instagram/sync', async (req, res) => {
  const schema = z.object({
    workspaceId: z.string().min(1),
    accountId: z.string().optional(),
  })

  const parsed = schema.safeParse(req.body)

  if (!parsed.success) {
    res.status(400).json({
      message: 'Invalid sync payload',
      errors: parsed.error.flatten(),
    })
    return
  }

  try {
    res.json(await syncInstagramAccountData(parsed.data.workspaceId, parsed.data.accountId))
  } catch (error) {
    res.status(502).json({
      synced: false,
      reason: error instanceof Error ? error.message : 'Instagram sync failed',
    })
  }
})

app.post('/api/ingestion-jobs/run', async (req, res) => {
  const typeSchema = z.object({
    type: z.enum(['metrics-sync', 'comments-sync', 'dm-sync', 'competitor-scan']),
    workspaceId: z.string().optional(),
  })

  const parsed = typeSchema.safeParse(req.body)

  if (!parsed.success) {
    res.status(400).json({
      message: 'Missing or invalid ingestion job type',
      errors: parsed.error.flatten(),
    })
    return
  }

  const onboarding = await getOnboarding()
  const newJob = await createIngestionJob(
    parsed.data.type,
    parsed.data.workspaceId ?? onboarding.workspaceId,
  )

  res.status(202).json(newJob)
})

app.use((req, res) => {
  res.status(404).json({
    message: `Route not found: ${req.method} ${req.path}`,
  })
})

app.listen(port, () => {
  console.log(`Instagram automation API running on http://localhost:${port}`)
})
