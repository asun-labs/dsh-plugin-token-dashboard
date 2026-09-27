import { basename, join } from 'node:path'

/** Minimal durable session header fields used by the dashboard. */
export interface DashboardSessionHeader {
  readonly id: string
  readonly createdAt: number
  readonly cwd?: string
}

/** Minimal event representation accepted from a validated DSH session snapshot. */
export interface DashboardEvent {
  readonly type: string
  readonly time: number
  readonly data: unknown
}

/** One detached DSH session prepared for dashboard aggregation. */
export interface DashboardSessionSource {
  readonly header: DashboardSessionHeader
  readonly inheritedEventCount: number
  readonly title?: string
  readonly events: readonly DashboardEvent[]
}

/** Exact per-request token counters stored in the generated dashboard. */
export interface DashboardRequest {
  readonly sessionId: string
  readonly workspace: string
  readonly time: number
  readonly provider: string
  readonly model: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly totalTokens: number
}

/** Per-model aggregate used by the overview. */
export interface DashboardModel {
  readonly name: string
  readonly totalTokens: number
  readonly requests: number
}

/** Per-workspace aggregate used by the overview and drilldown. */
export interface DashboardWorkspace {
  readonly name: string
  readonly path: string
  readonly totalTokens: number
  readonly sessions: number
  readonly requests: number
}

/** Per-session aggregate used by the workspace drilldown. */
export interface DashboardSession {
  readonly id: string
  readonly title: string
  readonly workspace: string
  readonly startedAt: number
  readonly totalTokens: number
  readonly requests: number
}

/** Per-day aggregate used by the activity chart. */
export interface DashboardDay {
  readonly date: string
  readonly totalTokens: number
  readonly requests: number
}

/** Complete JSON payload embedded into one offline dashboard document. */
export interface DashboardData {
  readonly generatedAt: number
  readonly summary: {
    readonly totalTokens: number
    readonly inputTokens: number
    readonly outputTokens: number
    readonly cacheReadTokens: number
    readonly cacheWriteTokens: number
    readonly sessions: number
    readonly requests: number
    readonly activeDays: number
  }
  readonly models: readonly DashboardModel[]
  readonly workspaces: readonly DashboardWorkspace[]
  readonly sessions: readonly DashboardSession[]
  readonly requests: readonly DashboardRequest[]
  readonly days: readonly DashboardDay[]
}

interface TokenUsageRecord {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens?: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function usage(value: unknown): TokenUsageRecord | undefined {
  if (!isRecord(value)) return undefined
  const inputTokens = count(value.inputTokens)
  const outputTokens = count(value.outputTokens)
  if (inputTokens === undefined || outputTokens === undefined) return undefined
  const totalTokens = count(value.totalTokens)
  const cacheReadTokens = count(value.cacheReadTokens)
  const cacheWriteTokens = count(value.cacheWriteTokens)
  return {
    inputTokens,
    outputTokens,
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
  }
}

function streamUsage(value: unknown): TokenUsageRecord | undefined {
  if (!Array.isArray(value)) return undefined
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const record = value[index]
    if (!isRecord(record) || record.type !== 'chunk' || !isRecord(record.chunk)) continue
    if (record.chunk.type === 'usage') return usage(record.chunk.usage)
  }
  return undefined
}

function messageRoute(value: unknown): { provider: string; model: string } | undefined {
  if (!isRecord(value) || !isRecord(value.source)) return undefined
  const provider = value.source.provider
  const model = value.source.model
  return typeof provider === 'string' && provider.length > 0 && typeof model === 'string' && model.length > 0
    ? { provider, model }
    : undefined
}

function sourceWorkspace(source: DashboardSessionSource): { name: string; path: string } {
  const path = source.header.cwd ?? '(no workspace)'
  if (source.header.cwd === undefined) return { name: path, path }
  const normalized = path.replace(/[\\/]+$/u, '')
  const pieces = normalized.split(/[\\/]/u)
  return { name: pieces.at(-1) || basename(normalized) || normalized, path }
}

/**
 * Extract billed request settlements from one validated DSH session log.
 * Fork-inherited events are excluded because their owner session already accounts for them.
 * @param source - detached session header, title, and raw events.
 * @returns one record per assistant message or failed attempt carrying provider usage.
 */
export function extractSessionRequests(source: DashboardSessionSource): DashboardRequest[] {
  const workspace = sourceWorkspace(source).path
  const requests: DashboardRequest[] = []
  for (const event of source.events.slice(source.inheritedEventCount)) {
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') continue
    if (!isRecord(event.data)) continue
    const sample = event.type === 'assistant/message'
      ? usage(event.data.usage) ?? streamUsage(event.data.stream)
      : streamUsage(event.data.stream)
    if (sample === undefined) continue
    const route = event.type === 'assistant/message' ? messageRoute(event.data.message) : undefined
    const cacheReadTokens = sample.cacheReadTokens ?? 0
    const cacheWriteTokens = sample.cacheWriteTokens ?? 0
    const derivedTotal = sample.inputTokens + sample.outputTokens + cacheReadTokens + cacheWriteTokens
    requests.push({
      sessionId: source.header.id,
      workspace,
      time: event.time,
      provider: route?.provider ?? 'unknown',
      model: route?.model ?? 'unknown',
      inputTokens: sample.inputTokens,
      outputTokens: sample.outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens: sample.totalTokens ?? derivedTotal,
    })
  }
  return requests
}

function add(map: Map<string, number>, key: string, value: number): void {
  map.set(key, (map.get(key) ?? 0) + value)
}

function dateKey(time: number): string {
  const date = new Date(time)
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}

/**
 * Aggregate detached session snapshots into the stable JSON payload consumed by the dashboard.
 * @param sources - validated live-preferred session observations.
 * @param generatedAt - generation timestamp; injectable for deterministic tests.
 * @returns sorted dashboard data with exact token sums.
 */
export function buildDashboardData(
  sources: readonly DashboardSessionSource[],
  generatedAt = Date.now(),
): DashboardData {
  const requests = sources.flatMap(extractSessionRequests).sort((left, right) => left.time - right.time)
  const bySession = new Map<string, DashboardRequest[]>()
  for (const request of requests) {
    const bucket = bySession.get(request.sessionId) ?? []
    bucket.push(request)
    bySession.set(request.sessionId, bucket)
  }

  const sessions: DashboardSession[] = sources.map((source) => {
    const owned = bySession.get(source.header.id) ?? []
    const workspace = sourceWorkspace(source)
    return {
      id: source.header.id,
      title: source.title ?? source.header.id,
      workspace: workspace.path,
      startedAt: owned[0]?.time ?? source.header.createdAt,
      totalTokens: owned.reduce((sum, request) => sum + request.totalTokens, 0),
      requests: owned.length,
    }
  }).filter(item => item.requests > 0).sort((left, right) => right.startedAt - left.startedAt)

  const modelTokens = new Map<string, number>()
  const modelRequests = new Map<string, number>()
  const dayTokens = new Map<string, number>()
  const dayRequests = new Map<string, number>()
  for (const request of requests) {
    add(modelTokens, request.model, request.totalTokens)
    add(modelRequests, request.model, 1)
    const day = dateKey(request.time)
    add(dayTokens, day, request.totalTokens)
    add(dayRequests, day, 1)
  }

  const models = [...modelTokens].map(([name, totalTokens]): DashboardModel => ({
    name,
    totalTokens,
    requests: modelRequests.get(name) ?? 0,
  })).sort((left, right) => right.totalTokens - left.totalTokens || left.name.localeCompare(right.name))

  const workspaces = [...new Map(sources.map(source => {
    const workspace = sourceWorkspace(source)
    return [workspace.path, workspace] as const
  }))].map(([path, workspace]): DashboardWorkspace => {
    const ownedSessions = sessions.filter(item => item.workspace === path)
    return {
      name: workspace.name,
      path,
      totalTokens: ownedSessions.reduce((sum, item) => sum + item.totalTokens, 0),
      sessions: ownedSessions.length,
      requests: ownedSessions.reduce((sum, item) => sum + item.requests, 0),
    }
  }).filter(item => item.requests > 0).sort((left, right) => right.totalTokens - left.totalTokens || left.name.localeCompare(right.name))

  const days = [...dayTokens].map(([date, totalTokens]): DashboardDay => ({
    date,
    totalTokens,
    requests: dayRequests.get(date) ?? 0,
  })).sort((left, right) => left.date.localeCompare(right.date))

  return {
    generatedAt,
    summary: {
      totalTokens: requests.reduce((sum, request) => sum + request.totalTokens, 0),
      inputTokens: requests.reduce((sum, request) => sum + request.inputTokens, 0),
      outputTokens: requests.reduce((sum, request) => sum + request.outputTokens, 0),
      cacheReadTokens: requests.reduce((sum, request) => sum + request.cacheReadTokens, 0),
      cacheWriteTokens: requests.reduce((sum, request) => sum + request.cacheWriteTokens, 0),
      sessions: sessions.length,
      requests: requests.length,
      activeDays: days.length,
    },
    models,
    workspaces,
    sessions,
    requests,
    days,
  }
}

/**
 * Resolve the configured dashboard filename without allowing it to leave the session workspace.
 * @param workspace - current session working directory.
 * @param fileName - configured plain HTML file name.
 * @returns absolute output path.
 */
export function resolveDashboardPath(workspace: string, fileName: string): string {
  if (basename(fileName) !== fileName || fileName === '.' || fileName === '..') {
    throw new Error('token-dashboard: fileName must be a plain file name')
  }
  if (!fileName.toLowerCase().endsWith('.html')) {
    throw new Error('token-dashboard: fileName must end with .html')
  }
  return join(workspace, fileName)
}
