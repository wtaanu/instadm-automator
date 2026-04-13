import { startTransition, useEffect, useMemo, useState } from 'react'
import './App.css'
import {
  classifyCommentPreview,
  generateHooks,
  getCommentAutomation,
  getDashboardData,
  getIngestionJobs,
  getInstagramAccounts,
  getInstagramConnectUrl,
  getMetaConfig,
  getOnboarding,
  getSession,
  runIngestionJob,
  saveCommentAutomation,
  saveGeneratedHook,
  saveInstagramAccount,
  saveOnboarding,
  syncInstagramAccount,
  updateContentItem,
} from './services/dashboard'
import type {
  AuthSession,
  CommentAutomationState,
  CommentItem,
  DashboardData,
  DmConversation,
  IngestionJob,
  InstagramAccount,
  InstagramSyncResult,
  MetaAppConfig,
  OnboardingState,
  PlannerItem,
  SummaryMetric,
  TrendSignal,
} from './types'

type SurfaceKey = 'overview' | 'content' | 'inbox' | 'analytics' | 'settings'
type PeriodKey = 'today' | 'this_week' | 'this_month' | 'last_3_months'

const surfaces: Array<{ key: SurfaceKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'content', label: 'Content' },
  { key: 'inbox', label: 'Inbox' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'settings', label: 'Settings' },
]

const periodOptions: Array<{ key: PeriodKey; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'this_week', label: 'This week' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_3_months', label: 'Last 3 months' },
]

const periodScale: Record<PeriodKey, number> = {
  today: 0.18,
  this_week: 0.62,
  this_month: 1,
  last_3_months: 2.85,
}

function formatDelta(value: string) {
  return value.startsWith('+') ? value : `${value}`
}

function polarToCartesian(cx: number, cy: number, radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  }
}

function describeArc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, radius, endAngle)
  const end = polarToCartesian(cx, cy, radius, startAngle)
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1'

  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`
}

function paginate<T>(items: T[], page: number, size: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / size))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * size

  return {
    page: safePage,
    totalPages,
    items: items.slice(start, start + size),
  }
}

function scaleMetricValue(value: string, factor: number) {
  const compact = value.match(/^([\d.]+)([A-Za-z%]+)?$/)

  if (!compact) {
    return value
  }

  const numeric = Number(compact[1])
  if (Number.isNaN(numeric)) {
    return value
  }

  const scaled = numeric * factor
  const rounded =
    scaled >= 100 ? Math.round(scaled) : scaled >= 10 ? Math.round(scaled * 10) / 10 : Math.round(scaled * 100) / 100

  return `${rounded}${compact[2] ?? ''}`
}

function formatDisplayDateTime(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  const day = date.getDate()
  const suffix =
    day % 10 === 1 && day % 100 !== 11
      ? 'st'
      : day % 10 === 2 && day % 100 !== 12
        ? 'nd'
        : day % 10 === 3 && day % 100 !== 13
          ? 'rd'
          : 'th'

  const month = date.toLocaleString('en-IN', { month: 'short' })
  const year = date.getFullYear()
  const time = date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  return `${day}${suffix} ${month} ${year} ${time}`
}

function createHookVariants(baseHooks: DashboardData['generatedHooks'], seed: number) {
  const openerPool = [
    'Stop posting and hoping. Start routing intent.',
    'The reach problem is usually a workflow problem.',
    'Most Instagram leads are lost in the reply gap.',
    'Growth gets cleaner when comments trigger the right DM.',
  ]

  const ctaPool = [
    'Comment CHECKLIST and we will send the framework.',
    'Comment SYSTEM if you want the exact workflow.',
    'DM GROWTH to see the automation path.',
    'Comment AUDIT and we will show the next step.',
  ]

  return baseHooks.map((hook, index) => {
    const opener = openerPool[(seed + index) % openerPool.length]
    const cta = ctaPool[(seed + index) % ctaPool.length]

    return {
      ...hook,
      title: index % 2 === 0 ? opener : hook.title,
      copy: `${hook.copy} ${cta}`,
    }
  })
}

function App() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [session, setSession] = useState<AuthSession | null>(null)
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null)
  const [jobs, setJobs] = useState<IngestionJob[]>([])
  const [instagramAccounts, setInstagramAccounts] = useState<InstagramAccount[]>([])
  const [commentAutomation, setCommentAutomation] = useState<CommentAutomationState | null>(null)
  const [metaConfig, setMetaConfig] = useState<MetaAppConfig | null>(null)
  const [syncResult, setSyncResult] = useState<InstagramSyncResult | null>(null)
  const [classificationPreview, setClassificationPreview] = useState<{
    intent: 'question' | 'inquiry' | 'collaboration'
    destination: 'sales' | 'course' | 'community'
    confidence: number
    recommendedReply: string
    fanSegment: string
    source: 'ai' | 'rules'
  } | null>(null)
  const [savingOnboarding, setSavingOnboarding] = useState(false)
  const [savingAccount, setSavingAccount] = useState(false)
  const [savingAutomation, setSavingAutomation] = useState(false)
  const [syncingInstagram, setSyncingInstagram] = useState(false)
  const [connectingInstagram, setConnectingInstagram] = useState(false)
  const [previewingComment, setPreviewingComment] = useState(false)
  const [runningJob, setRunningJob] = useState<IngestionJob['type'] | null>(null)
  const [surface, setSurface] = useState<SurfaceKey>('overview')
  const [period, setPeriod] = useState<PeriodKey>('this_month')
  const [inboxQuery, setInboxQuery] = useState('')
  const [plannerPage, setPlannerPage] = useState(1)
  const [dmPage, setDmPage] = useState(1)
  const [commentPage, setCommentPage] = useState(1)
  const [jobPage, setJobPage] = useState(1)
  const [hookItems, setHookItems] = useState<DashboardData['generatedHooks']>([])
  const [savingHookTitle, setSavingHookTitle] = useState<string | null>(null)
  const [selectedPlannerId, setSelectedPlannerId] = useState<string | null>(null)
  const [savingPlanner, setSavingPlanner] = useState(false)
  const [generatingHooks, setGeneratingHooks] = useState(false)

  const refreshWorkspaceData = async (workspaceId?: string) => {
    const [dashboardPayload, jobsPayload] = await Promise.all([
      getDashboardData(),
      getIngestionJobs(),
    ])

    setData(dashboardPayload)
    setJobs(jobsPayload)

    if (!workspaceId) {
      return
    }

    const [accountsPayload, automationPayload] = await Promise.all([
      getInstagramAccounts(workspaceId),
      getCommentAutomation(workspaceId),
    ])

    setInstagramAccounts(accountsPayload)
    setCommentAutomation(automationPayload)
  }

  useEffect(() => {
    let cancelled = false

    Promise.all([getDashboardData(), getSession(), getOnboarding(), getIngestionJobs()]).then(
      ([dashboardPayload, sessionPayload, onboardingPayload, jobsPayload]) => {
        if (!cancelled) {
          setData(dashboardPayload)
          setSession(sessionPayload)
          setOnboarding(onboardingPayload)
          setJobs(jobsPayload)
        }
      },
    )

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    getMetaConfig().then((payload) => {
      if (!cancelled) {
        setMetaConfig(payload)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    if (!onboarding?.workspaceId) {
      return
    }

    getInstagramAccounts(onboarding.workspaceId).then((payload) => {
      if (!cancelled) {
        setInstagramAccounts(payload)
      }
    })

    getCommentAutomation(onboarding.workspaceId).then((payload) => {
      if (!cancelled) {
        setCommentAutomation(payload)
      }
    })

    return () => {
      cancelled = true
    }
  }, [onboarding?.workspaceId])

  useEffect(() => {
    if (data?.generatedHooks) {
      setHookItems(data.generatedHooks)
    }
  }, [data])

  const query = inboxQuery.trim().toLowerCase()

  const filteredDms = useMemo(() => {
    if (!data || !query) {
      return data?.dms ?? []
    }

    return data.dms.filter((conversation) =>
      `${conversation.name} ${conversation.intent} ${conversation.preview} ${conversation.nextAction}`
        .toLowerCase()
        .includes(query),
    )
  }, [data, query])

  const filteredComments = useMemo(() => {
    if (!data || !query) {
      return data?.comments ?? []
    }

    return data.comments.filter((comment) =>
      `${comment.author} ${comment.intent} ${comment.message} ${comment.recommendedReply}`
        .toLowerCase()
        .includes(query),
    )
  }, [data, query])

  const scaledMetrics = useMemo(() => {
    if (!data) {
      return []
    }

    return data.summaryMetrics.map((metric) => ({
      ...metric,
      value: scaleMetricValue(metric.value, periodScale[period]),
    }))
  }, [data, period])

  const scaledAnalytics = useMemo(() => {
    if (!data) {
      return []
    }

    return data.analytics.map((item) => ({
      ...item,
      value: typeof item.value === 'number' ? Math.round(item.value * periodScale[period]) : scaleMetricValue(String(item.value), periodScale[period]),
    }))
  }, [data, period])

  const plannerPagination = useMemo(() => paginate(data?.planner ?? [], plannerPage, 4), [data?.planner, plannerPage])
  const dmPagination = useMemo(() => paginate(filteredDms, dmPage, 4), [filteredDms, dmPage])
  const commentPagination = useMemo(() => paginate(filteredComments, commentPage, 4), [filteredComments, commentPage])
  const jobPagination = useMemo(() => paginate(jobs, jobPage, 4), [jobs, jobPage])
  const connectedAccount = instagramAccounts.find((account) => account.status === 'connected')

  useEffect(() => {
    setPlannerPage(1)
  }, [period])

  useEffect(() => {
    if (data?.planner?.length && !selectedPlannerId) {
      setSelectedPlannerId(data.planner[0].id)
    }
  }, [data?.planner, selectedPlannerId])

  useEffect(() => {
    setDmPage(1)
    setCommentPage(1)
  }, [query])

  if (!data) {
    return (
      <main className="dashboard loading-state dashboard-shell">
        <section className="loading-card loading-card--wide">
          <span className="kicker">Instagram Dashboard</span>
          <h1>Loading performance view</h1>
          <p>Pulling analytics, onboarding details, inbox signals, and growth charts.</p>
        </section>
      </main>
    )
  }

  const onSurfaceChange = (nextSurface: SurfaceKey) => {
    startTransition(() => setSurface(nextSurface))
  }

  const handleOnboardingSubmit = async (formData: FormData) => {
    setSavingOnboarding(true)
    const nextState = await saveOnboarding({
      brandName: String(formData.get('brandName') ?? ''),
      niche: String(formData.get('niche') ?? ''),
      goal: String(formData.get('goal') ?? ''),
      postingFrequency: String(formData.get('postingFrequency') ?? ''),
      teamSize: Number(formData.get('teamSize') ?? 1),
      hasInstagramAccess: formData.get('hasInstagramAccess') === 'on',
      salesLink: String(formData.get('salesLink') ?? ''),
      courseLink: String(formData.get('courseLink') ?? ''),
      communityLink: String(formData.get('communityLink') ?? ''),
    })
    setOnboarding(nextState)
    setSavingOnboarding(false)
  }

  const handleInstagramAccountSubmit = async (formData: FormData) => {
    if (!onboarding?.workspaceId) {
      return
    }

    setSavingAccount(true)
    const account = await saveInstagramAccount({
      workspaceId: onboarding.workspaceId,
      handle: String(formData.get('handle') ?? ''),
      accountType: String(formData.get('accountType') ?? ''),
      status: String(formData.get('status') ?? ''),
    })
    setInstagramAccounts((current) => [account, ...current.filter((item) => item.id !== account.id)])
    setSavingAccount(false)
  }

  const handleConnectInstagram = async () => {
    if (!onboarding?.workspaceId) {
      return
    }

    setConnectingInstagram(true)
    const url = await getInstagramConnectUrl(onboarding.workspaceId)
    setConnectingInstagram(false)

    if (url) {
      window.location.href = url
    }
  }

  const handleInstagramSync = async (accountId?: string) => {
    if (!onboarding?.workspaceId) {
      return
    }

    setSyncingInstagram(true)
    try {
      const result = await syncInstagramAccount({
        workspaceId: onboarding.workspaceId,
        accountId,
      })
      setSyncResult(result)
      await refreshWorkspaceData(onboarding.workspaceId)
    } finally {
      setSyncingInstagram(false)
    }
  }

  const handleRunJob = async (type: IngestionJob['type']) => {
    setRunningJob(type)
    try {
      await runIngestionJob(type, onboarding?.workspaceId)
      await refreshWorkspaceData(onboarding?.workspaceId)
    } finally {
      setRunningJob(null)
    }
  }

  const handleAutomationSubmit = async (formData: FormData) => {
    if (!onboarding?.workspaceId || !commentAutomation) {
      return
    }

    setSavingAutomation(true)
    const nextState = await saveCommentAutomation({
      workspaceId: onboarding.workspaceId,
      autoDmEnabled: formData.get('autoDmEnabled') === 'on',
      salesLink: String(formData.get('salesLink') ?? ''),
      courseLink: String(formData.get('courseLink') ?? ''),
      communityLink: String(formData.get('communityLink') ?? ''),
      intentRoutes: [
        {
          ...commentAutomation.intentRoutes[0],
          triggerSummary: String(formData.get('questionTriggerSummary') ?? ''),
          responseTemplate: String(formData.get('questionResponseTemplate') ?? ''),
          destination: String(formData.get('questionDestination') ?? 'course') as 'sales' | 'course' | 'community',
        },
        {
          ...commentAutomation.intentRoutes[1],
          triggerSummary: String(formData.get('inquiryTriggerSummary') ?? ''),
          responseTemplate: String(formData.get('inquiryResponseTemplate') ?? ''),
          destination: String(formData.get('inquiryDestination') ?? 'sales') as 'sales' | 'course' | 'community',
        },
        {
          ...commentAutomation.intentRoutes[2],
          triggerSummary: String(formData.get('collaborationTriggerSummary') ?? ''),
          responseTemplate: String(formData.get('collaborationResponseTemplate') ?? ''),
          destination: String(formData.get('collaborationDestination') ?? 'community') as 'sales' | 'course' | 'community',
        },
      ],
    })

    setCommentAutomation(nextState)
    setSavingAutomation(false)
  }

  const handlePreviewCommentIntent = async () => {
    if (!onboarding?.workspaceId) {
      return
    }

    setPreviewingComment(true)
    try {
      const preview = await classifyCommentPreview({
        workspaceId: onboarding.workspaceId,
        author: 'preview_user',
        message: 'Interested. Can you send pricing and explain how the automation works?',
      })
      setClassificationPreview(preview)
    } finally {
      setPreviewingComment(false)
    }
  }

  const handleGenerateHooks = () => {
    if (!data || !onboarding?.workspaceId) {
      return
    }

    setGeneratingHooks(true)
    void generateHooks({ workspaceId: onboarding.workspaceId })
      .then((items) => {
        setHookItems(items.length ? items : createHookVariants(data.generatedHooks, Date.now()))
      })
      .finally(() => {
        setGeneratingHooks(false)
      })
  }

  const handleCopyHook = async (hook: { title: string; copy: string }) => {
    await navigator.clipboard.writeText(`${hook.title}\n\n${hook.copy}`)
  }

  const handleUseHookInPlanner = async (hook: DashboardData['generatedHooks'][number]) => {
    if (!onboarding?.workspaceId) {
      return
    }

    setSavingHookTitle(hook.title)
    try {
      await saveGeneratedHook({
        workspaceId: onboarding.workspaceId,
        hook,
      })

      await refreshWorkspaceData(onboarding.workspaceId)
      const refreshed = await getDashboardData()
      setData(refreshed)
      if (refreshed.planner.length) {
        setSelectedPlannerId(refreshed.planner[0].id)
      }
      setSurface('content')
    } finally {
      setSavingHookTitle(null)
    }
  }

  const selectedPlannerItem = data.planner.find((item) => item.id === selectedPlannerId) ?? data.planner[0] ?? null

  const handlePlannerUpdate = async (formData: FormData) => {
    if (!selectedPlannerItem) {
      return
    }

    setSavingPlanner(true)
    try {
      await updateContentItem({
        id: selectedPlannerItem.id,
        title: String(formData.get('title') ?? ''),
        format: String(formData.get('format') ?? ''),
        status: String(formData.get('status') ?? ''),
        goal: String(formData.get('goal') ?? ''),
        publishingAt: String(formData.get('publishingAt') ?? '') || null,
        contentCopy: String(formData.get('contentCopy') ?? ''),
      })

      await refreshWorkspaceData(onboarding?.workspaceId)
      const refreshed = await getDashboardData()
      setData(refreshed)
      setSelectedPlannerId(selectedPlannerItem.id)
    } finally {
      setSavingPlanner(false)
    }
  }

  return (
    <main className="dashboard dashboard-shell">
      <div className="dashboard-frame app-layout">
        <aside className="app-sidebar">
          <div className="sidebar-brand">
            <span className="sidebar-brand__mark">IG</span>
            <div>
              <span className="kicker">Live workspace</span>
              <h2>{onboarding?.brandName ?? 'Growth Dashboard'}</h2>
            </div>
          </div>

          <div className="sidebar-account">
            <span className={`tone-badge ${connectedAccount ? 'tone-green' : 'tone-gold'}`}>
              {connectedAccount ? 'Connected' : 'Setup needed'}
            </span>
            <strong>{data.account.handle}</strong>
            <p>{data.account.followers.toLocaleString()} followers</p>
            <small>{data.account.lastSyncedAt ? `Last sync ${formatDisplayDateTime(data.account.lastSyncedAt)}` : 'Not synced yet'}</small>
          </div>

          <nav className="sidebar-nav" aria-label="Dashboard views">
            {surfaces.map((item) => (
              <button
                key={item.key}
                className={surface === item.key ? 'is-active' : ''}
                onClick={() => onSurfaceChange(item.key)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="sidebar-summary">
            <span className="kicker">Current focus</span>
            <h3>{data.hero.primaryGoal}</h3>
            <p>{data.hero.nextPush}</p>
          </div>
        </aside>

        <section className="workspace-pane">
          <header className={`topbar ${surface === 'overview' ? '' : 'topbar--compact'}`.trim()}>
            <div>
              <span className="kicker">Instagram Dashboard</span>
              <h1>{connectedAccount?.handle ?? onboarding?.brandName ?? 'Growth Dashboard'}</h1>
              {surface === 'overview' && <p>{data.hero.subtitle}</p>}
              {connectedAccount && (
                <small className="topbar-status">
                  Connected handle: {connectedAccount.handle}
                </small>
              )}
            </div>
            {surface === 'overview' && (
              <div className="topbar-meta">
                <div className="meta-chip">
                  <span>Account</span>
                  <strong>{data.account.handle}</strong>
                </div>
                <div className="meta-chip">
                  <span>Followers</span>
                  <strong>{data.account.followers.toLocaleString()}</strong>
                </div>
                <div className="meta-chip">
                  <span>Owner</span>
                  <strong>{session?.email ?? 'owner@workspace'}</strong>
                </div>
                <div className="meta-chip">
                  <span>Media</span>
                  <strong>{data.account.mediaCount}</strong>
                </div>
              </div>
            )}
          </header>

          {surface === 'overview' && (
            <>
              <section className="hero-strip">
                <div className="hero-strip__main">
                  <span className="kicker">Workspace Summary</span>
                  <h2>{data.health.summary}</h2>
                  <p>{data.hero.nextPush}</p>
                </div>
                <div className="hero-strip__meta">
                  <article>
                    <span className="kicker">Connected</span>
                    <strong>{connectedAccount ? 'Live Instagram account' : 'Setup pending'}</strong>
                  </article>
                  <article>
                    <span className="kicker">Comments Routed</span>
                    <strong>{data.comments.length}</strong>
                  </article>
                  <article>
                    <span className="kicker">Media Synced</span>
                    <strong>{data.account.mediaCount}</strong>
                  </article>
                </div>
              </section>

              <section className="control-row">
                <div className="period-switcher" aria-label="Period switcher">
                  {periodOptions.map((item) => (
                    <button
                      key={item.key}
                      className={period === item.key ? 'is-active' : ''}
                      onClick={() => setPeriod(item.key)}
                      type="button"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="stat-grid">
                {scaledMetrics.map((metric) => (
                  <MetricCard key={metric.label} metric={metric} />
                ))}
              </section>
            </>
          )}

          {surface === 'overview' && (
            <div className="board-grid">
            <section className="chart-panel chart-panel--full">
              <PanelHeader title="Monthly Growth Progress" subtitle="Reach and new followers trend" />
              <LineChart
                primary={data.charts.reachSeries.map((value) => Math.round(value * periodScale[period]))}
                secondary={data.charts.followerSeries.map((value) => Math.round(value * periodScale[period]))}
                primaryLabel="Reach"
                secondaryLabel="Followers"
              />
            </section>

            <section className="insight-rail">
              <div className="insight-rail__head">Key Insights</div>
              <ul>
                {data.recommendations.map((item) => (
                  <li key={item.title}>
                    <strong>{item.category}</strong>
                    <span>{item.detail}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="chart-panel chart-panel--half">
              <PanelHeader title="Follower Growth by Country" subtitle="Top audiences" />
              <HorizontalBars items={data.charts.countryBars} />
            </section>

            <section className="chart-panel chart-panel--half">
              <PanelHeader title="Audience Mix" subtitle="Age band concentration" />
              <DonutChart items={data.charts.audienceMix} />
            </section>

            <section className="chart-panel chart-panel--full">
              <PanelHeader title="Traffic from Instagram" subtitle="Website sessions this month" />
              <MiniLineChart values={data.charts.trafficSeries.map((value) => Math.round(value * periodScale[period]))} />
            </section>

            <section className="chart-panel chart-panel--full">
              <PanelHeader title="Action Priorities" subtitle="What to do next" />
              <div className="priority-list">
                {data.priorityActions.map((action) => (
                  <article className="priority-row" key={action.title}>
                    <div>
                      <span className={`tone-badge tone-${action.tone}`}>{action.area}</span>
                      <h4>{action.title}</h4>
                    </div>
                    <p>{action.detail}</p>
                  </article>
                ))}
              </div>
            </section>
            </div>
          )}

          {surface === 'content' && (
            <div className="board-grid">
            <section className="chart-panel chart-panel--full">
              <PanelHeader title="Content Calendar" subtitle="Publishing plan and format mix with page-by-page view" />
              <div className="data-table">
                <div className="data-table__head">
                  <span>Title</span>
                  <span>Format</span>
                  <span>Slot</span>
                  <span>Status</span>
                  <span>Goal</span>
                </div>
                {plannerPagination.items.map((item) => (
                  <PlannerCard
                    key={item.id}
                    item={item}
                    isSelected={item.id === selectedPlannerId}
                    onSelect={() => setSelectedPlannerId(item.id)}
                  />
                ))}
              </div>
              <Pagination
                currentPage={plannerPagination.page}
                totalPages={plannerPagination.totalPages}
                onChange={setPlannerPage}
              />
            </section>

            {selectedPlannerItem && (
              <section className="chart-panel chart-panel--full">
                <PanelHeader title="Planner Editor" subtitle="Edit title, caption, status, and publishing time" />
                <form
                  className="ops-card"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void handlePlannerUpdate(new FormData(event.currentTarget))
                  }}
                >
                  <div className="form-grid">
                    <label className="form-grid__full">
                      <span>Title</span>
                      <input defaultValue={selectedPlannerItem.title} name="title" />
                    </label>
                    <label>
                      <span>Format</span>
                      <select defaultValue={selectedPlannerItem.format} name="format">
                        <option value="Reel">Reel</option>
                        <option value="Carousel">Carousel</option>
                        <option value="Story">Story</option>
                        <option value="Static post">Static post</option>
                      </select>
                    </label>
                    <label>
                      <span>Status</span>
                      <select defaultValue={selectedPlannerItem.status} name="status">
                        <option value="Draft">Draft</option>
                        <option value="Ready">Ready</option>
                        <option value="Scheduled">Scheduled</option>
                        <option value="Needs assets">Needs assets</option>
                      </select>
                    </label>
                    <label>
                      <span>Goal</span>
                      <input defaultValue={selectedPlannerItem.goal} name="goal" />
                    </label>
                    <label>
                      <span>Publishing time</span>
                      <input
                        defaultValue={selectedPlannerItem.publishingAt ? selectedPlannerItem.publishingAt.slice(0, 16) : ''}
                        name="publishingAt"
                        type="datetime-local"
                      />
                    </label>
                    <label className="form-grid__full">
                      <span>Caption draft</span>
                      <textarea
                        className="content-textarea"
                        defaultValue={selectedPlannerItem.contentCopy ?? ''}
                        name="contentCopy"
                        rows={7}
                      />
                    </label>
                  </div>
                  <button className="primary-button" disabled={savingPlanner} type="submit">
                    {savingPlanner ? 'Saving...' : 'Save planner item'}
                  </button>
                </form>
              </section>
            )}

            <section className="chart-panel chart-panel--half">
              <PanelHeader title="Trend Signals" subtitle="What to create next" />
              <div className="compact-list compact-list--single">
                {data.trends.map((trend) => (
                  <TrendCard key={trend.title} trend={trend} />
                ))}
              </div>
            </section>

            <section className="chart-panel chart-panel--half">
              <div className="panel-head panel-head--split">
                <div>
                  <h3>Hooks & CTA</h3>
                  <p>Generate fresh angles and copy them into your workflow.</p>
                </div>
                <div className="action-row">
                  <button className="soft-button" disabled={generatingHooks} onClick={handleGenerateHooks} type="button">
                    {generatingHooks ? 'Generating...' : 'Generate new'}
                  </button>
                </div>
              </div>
              <div className="compact-list compact-list--single">
                {hookItems.map((hook) => (
                  <article className="compact-card" key={hook.title}>
                    <div className="card-topline">
                      <span className="tone-badge tone-blue">{hook.type}</span>
                      <div className="inline-actions">
                        <button className="inline-button" onClick={() => void handleCopyHook(hook)} type="button">
                          Copy
                        </button>
                        <button
                          className="inline-button"
                          disabled={savingHookTitle === hook.title}
                          onClick={() => void handleUseHookInPlanner(hook)}
                          type="button"
                        >
                          {savingHookTitle === hook.title ? 'Saving...' : 'Use in planner'}
                        </button>
                      </div>
                    </div>
                    <h4>{hook.title}</h4>
                    <p>{hook.copy}</p>
                    <small>{hook.caption}</small>
                  </article>
                ))}
              </div>
            </section>
            </div>
          )}

          {surface === 'inbox' && (
            <div className="board-grid">
            <section className="chart-panel chart-panel--full">
              <div className="panel-head panel-head--split">
                <div>
                  <h3>Engagement Desk</h3>
                  <p>Organized replies instead of a crowded inbox.</p>
                </div>
                <label className="searchbox">
                  <span>Search inbox</span>
                  <input
                    type="search"
                    value={inboxQuery}
                    onChange={(event) => setInboxQuery(event.target.value)}
                    placeholder="Search author, intent, or message"
                  />
                </label>
              </div>
              <div className="inbox-grid inbox-grid--stacked">
                <InboxSection title={`DM Queue (${filteredDms.length})`}>
                  {dmPagination.items.length ? (
                    dmPagination.items.map((conversation) => (
                      <DmCard key={conversation.id} conversation={conversation} />
                    ))
                  ) : (
                    <EmptyState
                      title="No live DMs yet"
                      detail="Once real message webhook events are processed, they will appear here instead of demo rows."
                    />
                  )}
                  <Pagination currentPage={dmPagination.page} totalPages={dmPagination.totalPages} onChange={setDmPage} />
                </InboxSection>
                <InboxSection title={`Comment Queue (${filteredComments.length})`}>
                  {commentPagination.items.length ? (
                    commentPagination.items.map((comment) => (
                      <CommentCard key={comment.id} comment={comment} />
                    ))
                  ) : (
                    <EmptyState
                      title="No live comments routed yet"
                      detail="Synced and classified comments will appear here once comment events or comment sync results are stored."
                    />
                  )}
                  <Pagination
                    currentPage={commentPagination.page}
                    totalPages={commentPagination.totalPages}
                    onChange={setCommentPage}
                  />
                </InboxSection>
              </div>
            </section>

            <section className="chart-panel chart-panel--full">
              <PanelHeader title="Response Quality" subtitle="Operational progress" />
              <div className="quality-meters">
                <MeterCard label="Avg reply time" value="11m" progress={78} />
                <MeterCard label="Lead coverage" value="86%" progress={86} />
                <MeterCard label="FAQ auto-ready" value="64%" progress={64} />
              </div>
            </section>
            </div>
          )}

          {surface === 'analytics' && (
            <div className="board-grid">
            <section className="chart-panel chart-panel--full">
              <PanelHeader title="Performance Snapshot" subtitle="Core KPI movement" />
              <div className="analytics-row">
                {scaledAnalytics.map((item) => (
                  <article className="analytics-pill analytics-pill--dense" key={item.label}>
                    <span>{item.label}</span>
                    <strong>{String(item.value)}</strong>
                    <p>{item.detail}</p>
                  </article>
                ))}
              </div>
            </section>

              <section className="chart-panel chart-panel--full">
                <PanelHeader title="Backend Activity" subtitle="Ingestion jobs" />
                <div className="action-row">
                <button
                  className="soft-button"
                  disabled={runningJob === 'metrics-sync'}
                  onClick={() => void handleRunJob('metrics-sync')}
                  type="button"
                >
                  {runningJob === 'metrics-sync' ? 'Queueing...' : 'Run metrics sync'}
                </button>
                <button
                  className="soft-button"
                  disabled={runningJob === 'competitor-scan'}
                  onClick={() => void handleRunJob('competitor-scan')}
                  type="button"
                >
                  {runningJob === 'competitor-scan' ? 'Queueing...' : 'Run competitor scan'}
                </button>
              </div>
                <div className="compact-list compact-list--jobs">
                  {jobPagination.items.map((job) => (
                    <IngestionCard key={job.id} job={job} />
                  ))}
                </div>
                <Pagination currentPage={jobPagination.page} totalPages={jobPagination.totalPages} onChange={setJobPage} />
              </section>

              {commentAutomation && (
                <section className="chart-panel chart-panel--full">
                  <PanelHeader title="Comment Listener -> Intent Detector -> Auto-DM" subtitle="Route comments into the right DM with the right link and measure what happens next" />
                  <div className="automation-grid">
                    <article className="ops-card">
                      <h4>Link destinations</h4>
                      <div className="compact-list compact-list--single">
                        <LinkCard label="Sales" value={commentAutomation.links.sales} tone="green" />
                        <LinkCard label="Course" value={commentAutomation.links.course} tone="blue" />
                        <LinkCard label="Community" value={commentAutomation.links.community} tone="rose" />
                      </div>
                    </article>

                    <article className="ops-card">
                      <h4>Message performance</h4>
                      <div className="performance-strip">
                        <article className="performance-tile">
                          <span>Sent</span>
                          <strong>{commentAutomation.performance.sent}</strong>
                        </article>
                        <article className="performance-tile">
                          <span>Opened</span>
                          <strong>{commentAutomation.performance.openRate}</strong>
                        </article>
                        <article className="performance-tile">
                          <span>Clicked</span>
                          <strong>{commentAutomation.performance.clickRate}</strong>
                        </article>
                      </div>
                      <div className="chart-wrap chart-wrap--tight">
                        <MiniBarChart
                          items={commentAutomation.performance.history.map((entry) => ({
                            label: entry.label,
                            primary: entry.opened,
                            secondary: entry.clicked,
                          }))}
                          primaryLabel="Opened"
                          secondaryLabel="Clicked"
                        />
                      </div>
                    </article>

                    <article className="ops-card">
                      <h4>Intent routes</h4>
                      <div className="route-list route-list--triple">
                        {commentAutomation.intentRoutes.map((route) => (
                          <article className="route-row" key={route.id}>
                            <div className="card-topline">
                              <span className="tone-badge tone-gold">{route.intent}</span>
                              <strong>{route.destination}</strong>
                            </div>
                            <p>{route.triggerSummary}</p>
                            <small>{route.responseTemplate}</small>
                          </article>
                        ))}
                      </div>
                    </article>

                    <article className="ops-card ops-card--wide">
                      <h4>Fan segments</h4>
                      <div className="route-list route-list--triple">
                        {commentAutomation.fanSegments.map((segment) => (
                          <article className="route-row" key={segment.id}>
                            <div className="card-topline">
                              <span className="tone-badge tone-blue">{segment.name}</span>
                              <strong>{segment.count}</strong>
                            </div>
                            <p>{segment.description}</p>
                          </article>
                        ))}
                      </div>
                    </article>
                  </div>
                </section>
              )}

            </div>
          )}

          {surface === 'settings' && (
            <div className="board-grid">
              <section className="chart-panel chart-panel--full">
                <PanelHeader title="Workspace Settings" subtitle="Keep account, links, and automation logic in one place" />
                <div className="settings-grid">
                  {onboarding && (
                    <form
                      className="ops-card"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void handleOnboardingSubmit(new FormData(event.currentTarget))
                      }}
                    >
                      <h4>Workspace profile</h4>
                      <div className="form-grid">
                        <label>
                          <span>Brand</span>
                          <input defaultValue={onboarding.brandName} name="brandName" />
                        </label>
                        <label>
                          <span>Frequency</span>
                          <input defaultValue={onboarding.postingFrequency} name="postingFrequency" />
                        </label>
                        <label className="form-grid__full">
                          <span>Niche</span>
                          <input defaultValue={onboarding.niche} name="niche" />
                        </label>
                        <label className="form-grid__full">
                          <span>Primary goal</span>
                          <input defaultValue={onboarding.goal} name="goal" />
                        </label>
                        <label>
                          <span>Team size</span>
                          <input defaultValue={String(onboarding.teamSize)} min="1" name="teamSize" type="number" />
                        </label>
                        <label className="checkbox-field">
                          <input defaultChecked={onboarding.hasInstagramAccess} name="hasInstagramAccess" type="checkbox" />
                          <span>Instagram access connected</span>
                        </label>
                        <label className="form-grid__full">
                          <span>Sales link</span>
                          <input defaultValue={onboarding.salesLink} name="salesLink" />
                        </label>
                        <label className="form-grid__full">
                          <span>Course link</span>
                          <input defaultValue={onboarding.courseLink} name="courseLink" />
                        </label>
                        <label className="form-grid__full">
                          <span>Community link</span>
                          <input defaultValue={onboarding.communityLink} name="communityLink" />
                        </label>
                      </div>
                      <button className="primary-button" disabled={savingOnboarding} type="submit">
                        {savingOnboarding ? 'Saving...' : 'Save workspace'}
                      </button>
                    </form>
                  )}

                  <div className="ops-card">
                    <h4>Instagram connection</h4>
                    <div className="action-row">
                      {!connectedAccount && (
                        <button
                          className="primary-button"
                          disabled={!metaConfig?.configured || connectingInstagram}
                          onClick={() => void handleConnectInstagram()}
                          type="button"
                        >
                          {connectingInstagram ? 'Opening Meta...' : 'Connect Instagram'}
                        </button>
                      )}
                      <button
                        className="soft-button"
                        disabled={!connectedAccount || syncingInstagram}
                        onClick={() => void handleInstagramSync(connectedAccount?.id)}
                        type="button"
                      >
                        {syncingInstagram ? 'Syncing...' : 'Sync live data'}
                      </button>
                    </div>
                    <div className="compact-list">
                      <article className="compact-card">
                        <span className={`tone-badge ${connectedAccount ? 'tone-green' : metaConfig?.configured ? 'tone-blue' : 'tone-gold'}`}>
                          {connectedAccount ? 'Instagram connected' : metaConfig?.configured ? 'Meta ready' : 'Meta config missing'}
                        </span>
                        <p>
                          {connectedAccount
                            ? `Connected account: ${connectedAccount.handle}`
                            : `Redirect: ${metaConfig?.redirectUri ?? 'not loaded'}`}
                        </p>
                        <small>
                          {connectedAccount
                            ? 'Connection is active. Use sync to refresh profile, media, insights, and comments.'
                            : metaConfig?.configured
                            ? 'Use Connect Instagram to start the live Meta OAuth flow.'
                            : 'Add Meta app credentials to the backend env before connecting.'}
                        </small>
                      </article>
                      {syncResult && (
                        <article className="compact-card">
                          <span className={`tone-badge ${syncResult.synced ? 'tone-green' : 'tone-rose'}`}>
                            {syncResult.synced ? 'Last sync succeeded' : 'Sync blocked'}
                          </span>
                          <p>
                            {syncResult.synced
                              ? `Media: ${syncResult.mediaCount ?? 0}, insights: ${syncResult.insightsCount ?? 0}, classified comments: ${syncResult.commentsClassified ?? 0}`
                              : syncResult.reason}
                          </p>
                          <small>{syncResult.account?.handle ?? 'No account synced yet.'}</small>
                        </article>
                      )}
                    </div>
                    <form
                      className="ops-form"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void handleInstagramAccountSubmit(new FormData(event.currentTarget))
                      }}
                    >
                      <div className="form-grid">
                        <label>
                          <span>Handle</span>
                          <input defaultValue="@anutechlabs" name="handle" />
                        </label>
                        <label>
                          <span>Account type</span>
                          <input defaultValue="business" name="accountType" />
                        </label>
                        <label className="form-grid__full">
                          <span>Status</span>
                          <input defaultValue="connected" name="status" />
                        </label>
                      </div>
                      <button className="soft-button" disabled={savingAccount} type="submit">
                        {savingAccount ? 'Saving...' : 'Save account'}
                      </button>
                    </form>

                    <div className="compact-list">
                      {instagramAccounts.map((account) => (
                        <article className="compact-card" key={account.id}>
                          <span className="tone-badge tone-green">{account.status}</span>
                          <h4>{account.handle}</h4>
                          <p>{account.accountType}</p>
                          <small>
                            {account.instagramUserId ? `IG user: ${account.instagramUserId}` : 'Instagram user id not stored yet'}
                          </small>
                          <small>
                            {account.tokenLast4 ? `Token ending ${account.tokenLast4}` : 'No token reference stored'}
                          </small>
                          <small>
                            {account.lastSyncedAt ? `Last synced ${formatDisplayDateTime(account.lastSyncedAt)}` : 'Not synced yet'}
                          </small>
                        </article>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              {commentAutomation && (
                <section className="chart-panel chart-panel--full">
                  <PanelHeader title="Auto-DM Rules" subtitle="Edit intent routes, reply templates, and destination links" />
                  <div className="settings-grid settings-grid--automation">
                    <form
                      className="ops-card"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void handleAutomationSubmit(new FormData(event.currentTarget))
                      }}
                    >
                      <h4>Intent routing</h4>
                      <div className="form-grid">
                        <label className="checkbox-field form-grid__full">
                          <input defaultChecked={commentAutomation.autoDmEnabled} name="autoDmEnabled" type="checkbox" />
                          <span>Enable comment-triggered auto-DMs</span>
                        </label>
                        <label className="form-grid__full">
                          <span>Sales link</span>
                          <input defaultValue={commentAutomation.links.sales} name="salesLink" />
                        </label>
                        <label className="form-grid__full">
                          <span>Course link</span>
                          <input defaultValue={commentAutomation.links.course} name="courseLink" />
                        </label>
                        <label className="form-grid__full">
                          <span>Community link</span>
                          <input defaultValue={commentAutomation.links.community} name="communityLink" />
                        </label>
                        <label className="form-grid__full">
                          <span>Question triggers</span>
                          <input defaultValue={commentAutomation.intentRoutes[0]?.triggerSummary ?? ''} name="questionTriggerSummary" />
                        </label>
                        <label className="form-grid__full">
                          <span>Question DM response</span>
                          <input defaultValue={commentAutomation.intentRoutes[0]?.responseTemplate ?? ''} name="questionResponseTemplate" />
                        </label>
                        <label>
                          <span>Question destination</span>
                          <select defaultValue={commentAutomation.intentRoutes[0]?.destination ?? 'course'} name="questionDestination">
                            <option value="sales">Sales</option>
                            <option value="course">Course</option>
                            <option value="community">Community</option>
                          </select>
                        </label>
                        <label className="form-grid__full">
                          <span>Inquiry triggers</span>
                          <input defaultValue={commentAutomation.intentRoutes[1]?.triggerSummary ?? ''} name="inquiryTriggerSummary" />
                        </label>
                        <label className="form-grid__full">
                          <span>Inquiry DM response</span>
                          <input defaultValue={commentAutomation.intentRoutes[1]?.responseTemplate ?? ''} name="inquiryResponseTemplate" />
                        </label>
                        <label>
                          <span>Inquiry destination</span>
                          <select defaultValue={commentAutomation.intentRoutes[1]?.destination ?? 'sales'} name="inquiryDestination">
                            <option value="sales">Sales</option>
                            <option value="course">Course</option>
                            <option value="community">Community</option>
                          </select>
                        </label>
                        <label className="form-grid__full">
                          <span>Collaboration triggers</span>
                          <input defaultValue={commentAutomation.intentRoutes[2]?.triggerSummary ?? ''} name="collaborationTriggerSummary" />
                        </label>
                        <label className="form-grid__full">
                          <span>Collaboration DM response</span>
                          <input defaultValue={commentAutomation.intentRoutes[2]?.responseTemplate ?? ''} name="collaborationResponseTemplate" />
                        </label>
                        <label>
                          <span>Collaboration destination</span>
                          <select defaultValue={commentAutomation.intentRoutes[2]?.destination ?? 'community'} name="collaborationDestination">
                            <option value="sales">Sales</option>
                            <option value="course">Course</option>
                            <option value="community">Community</option>
                          </select>
                        </label>
                      </div>
                      <div className="action-row">
                        <button className="soft-button" disabled={previewingComment} onClick={() => void handlePreviewCommentIntent()} type="button">
                          {previewingComment ? 'Previewing...' : 'Preview AI intent'}
                        </button>
                        <button className="primary-button" disabled={savingAutomation} type="submit">
                          {savingAutomation ? 'Saving...' : 'Save auto-DM logic'}
                        </button>
                      </div>
                    </form>

                    <div className="ops-card">
                      <h4>Preview & live routes</h4>
                      <div className="compact-list">
                        {commentAutomation.intentRoutes.map((route) => (
                          <article className="compact-card" key={route.id}>
                            <div className="card-topline">
                              <span className="tone-badge tone-gold">{route.intent}</span>
                              <strong>{route.destination}</strong>
                            </div>
                            <p>{route.triggerSummary}</p>
                            <small>{route.responseTemplate}</small>
                          </article>
                        ))}
                        {classificationPreview && (
                          <article className="compact-card">
                            <div className="card-topline">
                              <span className="tone-badge tone-blue">{classificationPreview.intent}</span>
                              <strong>{classificationPreview.destination}</strong>
                            </div>
                            <p>{classificationPreview.recommendedReply}</p>
                            <small>
                              Segment: {classificationPreview.fanSegment} | Confidence: {(classificationPreview.confidence * 100).toFixed(0)}% | Source: {classificationPreview.source}
                            </small>
                          </article>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function PanelHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="panel-head">
      <h3>{title}</h3>
      <p>{subtitle}</p>
    </div>
  )
}

function MetricCard({ metric }: { metric: SummaryMetric }) {
  return (
    <article className="metric-card">
      <span>{metric.label}</span>
      <strong>{metric.value}</strong>
      <p>{metric.context}</p>
      <em>{formatDelta(metric.delta)}</em>
    </article>
  )
}

function TrendCard({ trend }: { trend: TrendSignal }) {
  return (
    <article className="list-card">
      <div className="card-topline">
        <span className={`tone-badge tone-${trend.tone}`}>{trend.signal}</span>
        <strong>{trend.lift}</strong>
      </div>
      <h4>{trend.title}</h4>
      <p>{trend.detail}</p>
      <small>{trend.recommendation}</small>
    </article>
  )
}

function PlannerCard({
  item,
  isSelected,
  onSelect,
}: {
  item: PlannerItem
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <article className={`data-table__row ${isSelected ? 'data-table__row--selected' : ''}`} onClick={onSelect} role="button" tabIndex={0}>
      <div className="data-table__primary">
        <strong>{item.title}</strong>
      </div>
      <span>{item.format}</span>
      <span>{item.slot}</span>
      <span><i className={`status-dot status-dot--${item.tone}`} />{item.status}</span>
      <span>{item.goal}</span>
    </article>
  )
}

function InboxSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="inbox-column">
      <div className="inbox-column__head">
        <h4>{title}</h4>
      </div>
      <div className="compact-list">{children}</div>
    </div>
  )
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <article className="empty-state">
      <strong>{title}</strong>
      <p>{detail}</p>
    </article>
  )
}

function DmCard({ conversation }: { conversation: DmConversation }) {
  return (
    <article className="ticket-row">
      <div className="ticket-row__meta">
        <span className={`tone-badge tone-${conversation.tone}`}>{conversation.intent}</span>
        <strong>{conversation.sla}</strong>
      </div>
      <div className="ticket-row__main">
        <h4>{conversation.name}</h4>
        <p>{conversation.preview}</p>
      </div>
      <div className="ticket-row__action">
        <small>{conversation.nextAction}</small>
      </div>
    </article>
  )
}

function CommentCard({ comment }: { comment: CommentItem }) {
  return (
    <article className="ticket-row">
      <div className="ticket-row__meta">
        <span className={`tone-badge tone-${comment.tone}`}>{comment.intent}</span>
        <strong>{comment.priority}</strong>
      </div>
      <div className="ticket-row__main">
        <h4>{comment.author}</h4>
        <p>{comment.message}</p>
      </div>
      <div className="ticket-row__action">
        <small>{comment.recommendedReply}</small>
      </div>
    </article>
  )
}

function IngestionCard({ job }: { job: IngestionJob }) {
  const tone = job.status === 'completed' ? 'green' : job.status === 'running' ? 'blue' : 'gold'

  return (
    <article className="list-card">
      <div className="card-topline">
        <span className={`tone-badge tone-${tone}`}>{job.status}</span>
        <strong>{job.type}</strong>
      </div>
      <h4>{job.source}</h4>
      <p>{job.note}</p>
      <small>{formatDisplayDateTime(job.scheduledFor)}</small>
    </article>
  )
}

function LinkCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'blue' | 'green' | 'rose'
}) {
  return (
    <article className="list-card">
      <div className="card-topline">
        <span className={`tone-badge tone-${tone}`}>{label}</span>
      </div>
      <p>{value}</p>
    </article>
  )
}

function Pagination({
  currentPage,
  totalPages,
  onChange,
}: {
  currentPage: number
  totalPages: number
  onChange: (page: number) => void
}) {
  return (
    <div className="pagination">
      <button disabled={currentPage <= 1} onClick={() => onChange(currentPage - 1)} type="button">
        Previous
      </button>
      <span>
        Page {currentPage} of {totalPages}
      </span>
      <button disabled={currentPage >= totalPages} onClick={() => onChange(currentPage + 1)} type="button">
        Next
      </button>
    </div>
  )
}

function MiniBarChart({
  items,
  primaryLabel,
  secondaryLabel,
}: {
  items: Array<{ label: string; primary: number; secondary: number }>
  primaryLabel: string
  secondaryLabel: string
}) {
  const max = Math.max(
    1,
    ...items.flatMap((item) => [item.primary, item.secondary]),
  )

  return (
    <div className="mini-bars">
      <div className="mini-bars__legend">
        <span><i className="legend-primary" />{primaryLabel}</span>
        <span><i className="legend-secondary" />{secondaryLabel}</span>
      </div>
      {items.map((item) => (
        <div className="mini-bars__row" key={item.label}>
          <span>{item.label}</span>
          <div className="mini-bars__track">
            <div className="mini-bars__bar mini-bars__bar--primary" style={{ width: `${(item.primary / max) * 100}%` }} />
            <div className="mini-bars__bar mini-bars__bar--secondary" style={{ width: `${(item.secondary / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function MeterCard({ label, value, progress }: { label: string; value: string; progress: number }) {
  return (
    <article className="meter-card">
      <div className="meter-row">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${progress}%` }} />
      </div>
    </article>
  )
}

function LineChart({
  primary,
  secondary,
  primaryLabel,
  secondaryLabel,
}: {
  primary: number[]
  secondary: number[]
  primaryLabel: string
  secondaryLabel: string
}) {
  const width = 720
  const height = 280
  const padding = 28
  const max = Math.max(...primary, ...secondary)
  const stepX = (width - padding * 2) / (primary.length - 1)

  const toPoints = (values: number[]) =>
    values
      .map((value, index) => {
        const x = padding + stepX * index
        const y = height - padding - (value / max) * (height - padding * 2)
        return `${x},${y}`
      })
      .join(' ')

  return (
    <div className="chart-wrap">
      <div className="chart-legend">
        <span><i className="legend-dot legend-dot--primary" />{primaryLabel}</span>
        <span><i className="legend-dot legend-dot--secondary" />{secondaryLabel}</span>
      </div>
      <svg className="line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Line chart">
        {[0, 1, 2, 3].map((row) => {
          const y = padding + ((height - padding * 2) / 3) * row
          return <line key={row} x1={padding} x2={width - padding} y1={y} y2={y} />
        })}
        <polyline points={toPoints(primary)} className="line-chart__primary" />
        <polyline points={toPoints(secondary)} className="line-chart__secondary" />
        {primary.map((value, index) => {
          const x = padding + stepX * index
          const y = height - padding - (value / max) * (height - padding * 2)
          return <circle key={`p-${index}`} cx={x} cy={y} r="4" className="point point--primary" />
        })}
        {secondary.map((value, index) => {
          const x = padding + stepX * index
          const y = height - padding - (value / max) * (height - padding * 2)
          return <circle key={`s-${index}`} cx={x} cy={y} r="4" className="point point--secondary" />
        })}
      </svg>
    </div>
  )
}

function MiniLineChart({ values }: { values: number[] }) {
  const width = 720
  const height = 220
  const padding = 20
  const max = Math.max(...values)
  const stepX = (width - padding * 2) / (values.length - 1)
  const points = values
    .map((value, index) => {
      const x = padding + stepX * index
      const y = height - padding - (value / max) * (height - padding * 2)
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg className="mini-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Traffic line chart">
      {[0, 1, 2, 3].map((row) => {
        const y = padding + ((height - padding * 2) / 3) * row
        return <line key={row} x1={padding} x2={width - padding} y1={y} y2={y} />
      })}
      <polyline points={points} className="line-chart__primary" />
    </svg>
  )
}

function HorizontalBars({ items }: { items: Array<{ label: string; value: number }> }) {
  return (
    <div className="bars">
      {items.map((item) => (
        <div className="bar-row" key={item.label}>
          <span>{item.label}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${item.value}%` }} />
          </div>
          <strong>{item.value}%</strong>
        </div>
      ))}
    </div>
  )
}

function DonutChart({
  items,
}: {
  items: Array<{ label: string; value: number; color: string }>
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0)
  let cursor = 0

  return (
    <div className="donut-layout">
      <svg className="donut-chart" viewBox="0 0 220 220" role="img" aria-label="Audience mix chart">
        <circle cx="110" cy="110" r="68" className="donut-bg" />
        {items.map((item) => {
          const start = (cursor / total) * 360
          cursor += item.value
          const end = (cursor / total) * 360
          return (
            <path
              key={item.label}
              d={describeArc(110, 110, 68, start, end)}
              stroke={item.color}
              className="donut-segment"
            />
          )
        })}
        <text x="110" y="104" textAnchor="middle" className="donut-text">Audience</text>
        <text x="110" y="126" textAnchor="middle" className="donut-number">100%</text>
      </svg>
      <div className="donut-legend">
        {items.map((item) => (
          <div className="legend-row" key={item.label}>
            <span className="legend-swatch" style={{ backgroundColor: item.color }} />
            <span>{item.label}</span>
            <strong>{item.value}%</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

export default App
