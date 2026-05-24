import type { IDVProvider, IDVSessionHandle, IDVSessionInit, IDVStatusReport } from '../provider'

export interface VeriffOptions {
  readonly apiKey: string
  readonly secret: string
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
}

export function createVeriffProvider(opts: VeriffOptions): IDVProvider {
  const base = opts.baseUrl ?? 'https://stationapi.veriff.com/v1'
  const f = opts.fetchImpl ?? fetch
  return {
    id: 'veriff',
    async start(init: IDVSessionInit): Promise<IDVSessionHandle> {
      const res = await f(`${base}/sessions`, {
        method: 'POST',
        headers: { 'X-AUTH-CLIENT': opts.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verification: {
            callback: init.redirectUri,
            person: { firstName: init.subject.displayName ?? '', lastName: init.subject.subjectId },
            vendorData: init.subject.subjectId,
          },
        }),
      })
      if (!res.ok) throw new Error(`veriff session failed: ${res.status}`)
      const body = (await res.json()) as { verification: { id: string; url: string } }
      return {
        id: body.verification.id,
        provider: 'veriff',
        hostedUrl: body.verification.url,
      }
    },
    async status(sessionId: string): Promise<IDVStatusReport> {
      const res = await f(`${base}/sessions/${sessionId}/decision`, {
        headers: { 'X-AUTH-CLIENT': opts.apiKey },
      })
      if (!res.ok) throw new Error(`veriff decision failed: ${res.status}`)
      const body = (await res.json()) as { verification?: { status?: string; code?: number } }
      const status: IDVStatusReport['status'] =
        body.verification?.status === 'approved'
          ? 'passed'
          : body.verification?.status === 'declined'
            ? 'failed'
            : body.verification?.status === 'resubmission_requested'
              ? 'awaiting_review'
              : body.verification?.status === 'expired'
                ? 'expired'
                : 'in_progress'
      return { id: sessionId, status, raw: body as unknown as Readonly<Record<string, unknown>> }
    },
  }
}
