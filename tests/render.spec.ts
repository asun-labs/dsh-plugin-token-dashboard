import { describe, expect, it } from 'vitest'
import { renderDashboard } from '../src/render.ts'

describe('renderDashboard', () => {
  it('renders a self-contained dashboard and escapes embedded JSON', () => {
    const html = renderDashboard({
      generatedAt: 1,
      summary: {
        totalTokens: 3,
        inputTokens: 2,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        sessions: 1,
        requests: 1,
        activeDays: 1,
      },
      models: [{ name: '</script><script>alert(1)</script>', totalTokens: 3, requests: 1 }],
      workspaces: [],
      sessions: [],
      requests: [],
      days: [],
    })

    expect(html).toContain('<title>Token Dashboard</title>')
    expect(html).toContain('Token Dashboard')
    expect(html).not.toContain('</script><script>alert(1)</script>')
    expect(html).not.toMatch(/https?:\/\//)
  })
})
