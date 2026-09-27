/** DeepSeek Harness token dashboard Cordis plugin. */

import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-session-query'
import { buildDashboardData, resolveDashboardPath, type DashboardSessionSource } from './dashboard.ts'
import { renderDashboard } from './render.ts'

/** Cordis plugin name. */
export const name = 'dsh-token-dashboard'
/** Services required to discover sessions and register the model-facing generator. */
export const inject = ['tools', 'sessionQuery']

/** Deployment configuration for dashboard generation. */
export interface Config {
  /** Plain HTML filename written inside the current session workspace. */
  fileName: string
  /** Maximum number of session snapshots read concurrently. */
  readConcurrency: number
}

/** Validated deployment configuration. */
export const Config: Schema<Config> = Schema.object({
  fileName: Schema.string().default('token-dashboard.html'),
  readConcurrency: Schema.number().default(4),
})

function validateConfig(config: Config): void {
  resolveDashboardPath(resolve('.'), config.fileName)
  if (!Number.isSafeInteger(config.readConcurrency) || config.readConcurrency < 1 || config.readConcurrency > 32) {
    throw new Error('token-dashboard: readConcurrency must be an integer between 1 and 32')
  }
}

async function mapConcurrent<T, U>(
  values: readonly T[],
  concurrency: number,
  signal: AbortSignal,
  visit: (value: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(values.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    for (;;) {
      signal.throwIfAborted()
      const index = cursor
      cursor += 1
      if (index >= values.length) return
      results[index] = await visit(values[index] as T)
    }
  }))
  return results
}

async function collectSessions(ctx: Context, concurrency: number, signal: AbortSignal): Promise<DashboardSessionSource[]> {
  const records = await ctx.sessionQuery.listSessions(signal)
  return mapConcurrent(records, concurrency, signal, async (record): Promise<DashboardSessionSource> => {
    const [snapshot, title] = await Promise.all([
      ctx.sessionQuery.readSession(record.header.id),
      ctx.sessionQuery.readTitle(record.header.id, signal),
    ])
    return {
      header: {
        id: snapshot.session.id,
        createdAt: snapshot.session.createdAt,
        ...(snapshot.session.cwd === undefined ? {} : { cwd: snapshot.session.cwd }),
      },
      inheritedEventCount: snapshot.inheritedEventCount,
      ...(title === undefined ? {} : { title: title.title }),
      events: snapshot.events,
    }
  })
}

/**
 * Register the `token_dashboard` tool.
 * @param ctx - Cordis context with tools and sessionQuery.
 * @param config - validated output and read-concurrency settings.
 */
export function apply(ctx: Context, config: Config): void {
  validateConfig(config)
  ctx.tools.register(defineTool({
    name: 'token_dashboard',
    description: 'Generate a self-contained offline HTML dashboard from exact token usage in all DeepSeek Harness sessions.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(_args, exec) {
      const current = exec.agent === undefined ? undefined : await ctx.sessionQuery.readSession(exec.agent.id)
      const workspace = current?.session.cwd ?? process.cwd()
      const outputPath = resolveDashboardPath(workspace, config.fileName)
      const sources = await collectSessions(ctx, config.readConcurrency, exec.signal)
      exec.signal.throwIfAborted()
      const data = buildDashboardData(sources)
      await writeFile(outputPath, renderDashboard(data), 'utf8')
      return [
        `Token Dashboard generated: ${outputPath}`,
        `Total tokens: ${data.summary.totalTokens}`,
        `Sessions: ${data.summary.sessions}`,
        `Requests: ${data.summary.requests}`,
        'The HTML is self-contained and uses local session data only.',
      ].join('\n')
    },
  }))
}
