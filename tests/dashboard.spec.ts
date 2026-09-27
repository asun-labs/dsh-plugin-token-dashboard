import { describe, expect, it } from 'vitest'
import {
  buildDashboardData,
  extractSessionRequests,
  resolveDashboardPath,
  type DashboardSessionSource,
} from '../src/dashboard.ts'

const session = (overrides: Partial<DashboardSessionSource> = {}): DashboardSessionSource => ({
  header: {
    id: 'session-1',
    createdAt: Date.UTC(2026, 8, 20),
    cwd: 'C:\\work\\alpha',
  },
  inheritedEventCount: 0,
  title: 'Analyze usage',
  events: [],
  ...overrides,
})

describe('extractSessionRequests', () => {
  it('extracts disjoint provider usage from an assistant message', () => {
    const requests = extractSessionRequests(session({
      events: [{
        type: 'assistant/message',
        time: Date.UTC(2026, 8, 20, 8, 30),
        data: {
          turn: 1,
          step: 1,
          message: { source: { provider: 'deepseek', model: 'deepseek-chat' } },
          stream: [],
          usage: {
            inputTokens: 120,
            outputTokens: 30,
            cacheReadTokens: 50,
            cacheWriteTokens: 10,
            totalTokens: 210,
          },
        },
      }],
    }))

    expect(requests).toEqual([{
      time: Date.UTC(2026, 8, 20, 8, 30),
      provider: 'deepseek',
      model: 'deepseek-chat',
      inputTokens: 120,
      outputTokens: 30,
      cacheReadTokens: 50,
      cacheWriteTokens: 10,
      totalTokens: 210,
    }])
  })

  it('uses the final stream usage for an attempt without a message', () => {
    const requests = extractSessionRequests(session({
      events: [{
        type: 'assistant/attempt',
        time: 1000,
        data: {
          turn: 2,
          step: 1,
          stream: [
            { time: 999, chunk: { type: 'usage', usage: { inputTokens: 7, outputTokens: 2 } } },
            { time: 1000, chunk: { type: 'finish', reason: { kind: 'error' } } },
          ],
        },
      }],
    }))

    expect(requests).toMatchObject([{
      provider: 'unknown',
      model: 'unknown',
      inputTokens: 7,
      outputTokens: 2,
      totalTokens: 9,
    }])
  })

  it('does not count the inherited prefix of a forked session', () => {
    const source = session({
      inheritedEventCount: 1,
      events: [
        {
          type: 'assistant/message', time: 1,
          data: { turn: 1, step: 1, message: { source: { provider: 'p', model: 'old' } }, stream: [], usage: { inputTokens: 9, outputTokens: 1 } },
        },
        {
          type: 'assistant/message', time: 2,
          data: { turn: 2, step: 1, message: { source: { provider: 'p', model: 'new' } }, stream: [], usage: { inputTokens: 4, outputTokens: 1 } },
        },
      ],
    })

    expect(extractSessionRequests(source).map(request => request.model)).toEqual(['new'])
  })
})

describe('buildDashboardData', () => {
  it('groups sessions by workspace and computes exact KPIs', () => {
    const data = buildDashboardData([
      session({
        events: [{
          type: 'assistant/message', time: Date.UTC(2026, 8, 20),
          data: { turn: 1, step: 1, message: { source: { provider: 'deepseek', model: 'v4' } }, stream: [], usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 80 } },
        }],
      }),
      session({
        header: { id: 'session-2', createdAt: Date.UTC(2026, 8, 21), cwd: 'C:\\work\\beta' },
        title: 'Second',
        events: [{
          type: 'assistant/message', time: Date.UTC(2026, 8, 21),
          data: { turn: 1, step: 1, message: { source: { provider: 'other', model: 'qwen' } }, stream: [], usage: { inputTokens: 50, outputTokens: 10 } },
        }],
      }),
    ], Date.UTC(2026, 8, 22))

    expect(data.summary).toEqual({
      totalTokens: 260,
      inputTokens: 150,
      outputTokens: 30,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
      sessions: 2,
      requests: 2,
      activeDays: 2,
    })
    expect(data.workspaces.map(workspace => workspace.name)).toEqual(['alpha', 'beta'])
    expect(data.models.map(model => model.name)).toEqual(['v4', 'qwen'])
  })
})

describe('resolveDashboardPath', () => {
  it('keeps the generated file inside the session workspace', () => {
    expect(resolveDashboardPath('C:\\work\\alpha', 'token-dashboard.html'))
      .toBe('C:\\work\\alpha\\token-dashboard.html')
  })

  it('rejects path traversal in the configured file name', () => {
    expect(() => resolveDashboardPath('C:\\work\\alpha', '..\\secrets.html'))
      .toThrow(/plain file name/)
  })
})
