import type { IDVProvider, IDVSessionHandle, IDVSessionInit, IDVStatusReport } from '../provider'

/**
 * In-memory IDV stub. Always passes after a short delay. For local dev only
 * — never use in any environment that resolves user identity for real.
 */
export function createStubProvider(): IDVProvider {
  const sessions = new Map<string, { startedAt: number; init: IDVSessionInit }>()

  return {
    id: 'stub',
    async start(init: IDVSessionInit): Promise<IDVSessionHandle> {
      const id = `stub-${crypto.randomUUID()}`
      sessions.set(id, { startedAt: Date.now(), init })
      return {
        id,
        provider: 'stub',
        hostedUrl: `${init.redirectUri}?session=${id}&status=passed`,
      }
    },
    async status(sessionId: string): Promise<IDVStatusReport> {
      const s = sessions.get(sessionId)
      if (!s) return { id: sessionId, status: 'expired' }
      const elapsed = Date.now() - s.startedAt
      return {
        id: sessionId,
        status: elapsed > 2000 ? 'passed' : 'in_progress',
      }
    },
  }
}
