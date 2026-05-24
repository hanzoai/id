import type { IDVProvider, IDVSessionHandle, IDVSessionInit, IDVStatusReport } from '../provider'

export interface OnfidoOptions {
  readonly apiToken: string
  readonly region?: 'eu' | 'us' | 'ca'
  readonly workflowId?: string
  readonly fetchImpl?: typeof fetch
}

export function createOnfidoProvider(opts: OnfidoOptions): IDVProvider {
  const region = opts.region ?? 'eu'
  const base = `https://api.${region}.onfido.com/v3.6`
  const f = opts.fetchImpl ?? fetch
  return {
    id: 'onfido',
    async start(init: IDVSessionInit): Promise<IDVSessionHandle> {
      // Create an applicant
      const applicantRes = await f(`${base}/applicants`, {
        method: 'POST',
        headers: { Authorization: `Token token=${opts.apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: init.subject.displayName?.split(' ')[0] ?? 'Applicant',
          last_name: init.subject.displayName?.split(' ').slice(1).join(' ') || init.subject.subjectId,
          email: init.subject.email,
          external_id: init.subject.subjectId,
        }),
      })
      if (!applicantRes.ok) throw new Error(`onfido applicant failed: ${applicantRes.status}`)
      const applicant = (await applicantRes.json()) as { id: string }

      // Generate SDK token for the web SDK
      const tokenRes = await f(`${base}/sdk_token`, {
        method: 'POST',
        headers: { Authorization: `Token token=${opts.apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          applicant_id: applicant.id,
          referrer: '*://*.hanzo.id/*',
        }),
      })
      if (!tokenRes.ok) throw new Error(`onfido sdk_token failed: ${tokenRes.status}`)
      const { token } = (await tokenRes.json()) as { token: string }

      return {
        id: applicant.id,
        provider: 'onfido',
        embed: {
          sdkUrl: 'https://assets.onfido.com/web-sdk-releases/14.0.0/onfido.min.js',
          token,
        },
      }
    },
    async status(sessionId: string): Promise<IDVStatusReport> {
      const res = await f(`${base}/checks?applicant_id=${sessionId}`, {
        headers: { Authorization: `Token token=${opts.apiToken}` },
      })
      if (!res.ok) throw new Error(`onfido check status failed: ${res.status}`)
      const body = (await res.json()) as { checks?: Array<{ status: string; result?: string }> }
      const latest = body.checks?.[0]
      if (!latest) return { id: sessionId, status: 'pending' }
      const status: IDVStatusReport['status'] =
        latest.status === 'complete'
          ? latest.result === 'clear'
            ? 'passed'
            : 'failed'
          : 'in_progress'
      return { id: sessionId, status, raw: latest as unknown as Readonly<Record<string, unknown>> }
    },
  }
}
