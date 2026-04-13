import { env, isOpenAiConfigured } from './env.js'
import type { CommentIntentClassification, GeneratedHook } from '../types.js'

type ResponsesApiPayload = {
  output?: Array<{
    type?: string
    content?: Array<{
      type?: string
      text?: string
    }>
  }>
  output_text?: string
}

const classificationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: {
      type: 'string',
      enum: ['question', 'inquiry', 'collaboration'],
    },
    priority: {
      type: 'string',
      enum: ['High priority', 'Normal'],
    },
    tone: {
      type: 'string',
      enum: ['blue', 'green', 'gold', 'rose'],
    },
    destination: {
      type: 'string',
      enum: ['sales', 'course', 'community'],
    },
    fanSegment: {
      type: 'string',
      maxLength: 60,
    },
    recommendedReply: {
      type: 'string',
      maxLength: 280,
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
    rationale: {
      type: 'string',
      maxLength: 240,
    },
  },
  required: [
    'intent',
    'priority',
    'tone',
    'destination',
    'fanSegment',
    'recommendedReply',
    'confidence',
    'rationale',
  ],
} as const

const hookSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    hooks: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: {
            type: 'string',
            maxLength: 40,
          },
          title: {
            type: 'string',
            maxLength: 120,
          },
          copy: {
            type: 'string',
            maxLength: 220,
          },
          caption: {
            type: 'string',
            maxLength: 420,
          },
        },
        required: ['type', 'title', 'copy', 'caption'],
      },
    },
  },
  required: ['hooks'],
} as const

function extractOutputText(payload: ResponsesApiPayload) {
  if (payload.output_text) {
    return payload.output_text
  }

  const textChunks =
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .filter((item) => item.type === 'output_text' && item.text)
      .map((item) => item.text) ?? []

  return textChunks.join('\n').trim()
}

function classifyWithRules(message: string): CommentIntentClassification {
  const normalized = message.toLowerCase()

  if (/(collab|collaboration|partner|agency|white[- ]?label|work together)/i.test(normalized)) {
    return {
      intent: 'collaboration',
      priority: 'High priority',
      tone: 'blue',
      destination: 'community',
      fanSegment: 'Potential collaborators',
      recommendedReply: 'Thanks for reaching out. We would love to share the partnership path and next steps in DM.',
      confidence: 0.74,
      rationale: 'Comment mentions partnership or collaboration language.',
      source: 'rules',
    }
  }

  if (/(price|pricing|demo|interested|book|buy|cost|details)/i.test(normalized)) {
    return {
      intent: 'inquiry',
      priority: 'High priority',
      tone: 'green',
      destination: 'sales',
      fanSegment: 'Hot buyers',
      recommendedReply: 'Happy to help. We will send the sales link and a short next-step message in DM.',
      confidence: 0.79,
      rationale: 'Comment contains buying-intent keywords.',
      source: 'rules',
    }
  }

  return {
    intent: 'question',
    priority: 'Normal',
    tone: 'gold',
    destination: 'course',
    fanSegment: 'Education seekers',
    recommendedReply: 'Great question. We will send a short explanation and the full workflow link in DM.',
    confidence: 0.66,
    rationale: 'Comment reads like an informational question without buying language.',
    source: 'rules',
  }
}

function generateHooksWithRules(params: {
  brandName: string
  niche: string
  goal: string
  handle?: string | null
  recentCaptions?: string[]
  salesLink?: string
  courseLink?: string
  communityLink?: string
}): GeneratedHook[] {
  const handleLabel = params.handle ?? `@${params.brandName.toLowerCase().replace(/\s+/g, '')}`
  const latestCaption =
    params.recentCaptions?.find((caption) => caption.trim())?.split(/[.!?]/)[0]?.trim() ??
    `${params.brandName} workflow breakdown`

  return [
    {
      type: 'Reel Hook',
      title: `${handleLabel}: ${latestCaption}`,
      copy: `Use this to position ${params.niche} as an operational advantage for ${handleLabel}. CTA: Comment SYSTEM and continue in DM with the sales link.`,
      caption: `${handleLabel} is growing best when the content shows the workflow clearly and then asks for one direct action.\n\nComment SYSTEM and we will send the next step.`,
    },
    {
      type: 'Carousel CTA',
      title: 'Comment GROWTH if you want the exact workflow breakdown',
      copy: `Use this for ${params.goal.toLowerCase()}. First reply with a short explanation, then route warm users to ${params.salesLink || 'your sales link'}.`,
      caption: `This is the workflow we use to turn Instagram attention into trackable conversations.\n\n1. Publish with a clear CTA\n2. Detect intent from comments\n3. Route each person into the right DM path\n\nComment GROWTH if you want the breakdown.`,
    },
    {
      type: 'Story Prompt',
      title: 'Want the DM automation flow or the analytics dashboard next?',
      copy: `Use a poll to segment education seekers from buyers, then follow up with ${params.courseLink || 'the course link'} or ${params.communityLink || 'the community link'}.`,
      caption: `Quick vote.\n\nWhat should we break down next?\nA. DM automation flow\nB. Analytics dashboard\n\nReply and we will send the next walkthrough.`,
    },
  ]
}

export async function classifyCommentIntent(params: {
  message: string
  author?: string
  salesLink?: string
  courseLink?: string
  communityLink?: string
}): Promise<CommentIntentClassification> {
  const fallback = classifyWithRules(params.message)

  if (!isOpenAiConfigured()) {
    return fallback
  }

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.openAiApiKey}`,
      },
      body: JSON.stringify({
        model: env.openAiModel,
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text:
                  'Classify Instagram comments for an automation dashboard. Choose exactly one intent. Use sales for buying intent, course for educational questions, and community for collaboration or networking intent. Keep recommended replies short, human, and sales-safe.',
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: JSON.stringify({
                  author: params.author ?? '',
                  message: params.message,
                  availableLinks: {
                    sales: params.salesLink ?? '',
                    course: params.courseLink ?? '',
                    community: params.communityLink ?? '',
                  },
                }),
              },
            ],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'comment_intent_classification',
            strict: true,
            schema: classificationSchema,
          },
        },
      }),
    })

    if (!response.ok) {
      return fallback
    }

    const payload = (await response.json()) as ResponsesApiPayload
    const outputText = extractOutputText(payload)
    if (!outputText) {
      return fallback
    }

    const parsed = JSON.parse(outputText) as Omit<CommentIntentClassification, 'source'>
    return {
      ...parsed,
      source: 'ai',
    }
  } catch {
    return fallback
  }
}

export async function generateHooksAndCtas(params: {
  brandName: string
  niche: string
  goal: string
  handle?: string | null
  recentCaptions?: string[]
  salesLink?: string
  courseLink?: string
  communityLink?: string
}): Promise<GeneratedHook[]> {
  const fallback = generateHooksWithRules(params)

  if (!isOpenAiConfigured()) {
    return fallback
  }

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.openAiApiKey}`,
      },
      body: JSON.stringify({
        model: env.openAiModel,
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text:
                  'Generate 3 Instagram growth ideas for a real connected Instagram account. Use the handle, niche, goal, and recent post captions to make the output account-specific. Return a reel hook, a carousel CTA, and a story prompt. Keep titles punchy and the copy practical, short, and conversion-safe. Also provide a usable caption draft for each idea.',
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: JSON.stringify(params),
              },
            ],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'generated_hooks',
            strict: true,
            schema: hookSchema,
          },
        },
      }),
    })

    if (!response.ok) {
      return fallback
    }

    const payload = (await response.json()) as ResponsesApiPayload
    const outputText = extractOutputText(payload)
    if (!outputText) {
      return fallback
    }

    const parsed = JSON.parse(outputText) as { hooks: GeneratedHook[] }
    return parsed.hooks?.length ? parsed.hooks : fallback
  } catch {
    return fallback
  }
}
