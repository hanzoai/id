import type { IDVProvider, IDVSessionHandle, IDVSessionInit, IDVStatusReport } from '../provider'

/**
 * Persona (https://withpersona.com) IDV adapter.
 *
 * Pre-creates an Inquiry via the Persona REST API, returns the hosted
 * URL for redirect. Status is read by polling the Inquiry resource.
 */
export interface PersonaOptions {
  readonly templateId: string
  readonly apiKey: string
  /** Sandbox or production environment. */
  readonly environment?: 'sandbox' | 'production'
  /** Override fetch impl (testing). */
  readonly fetchImpl?: typeof fetch
}

export function createPersonaProvider(opts: PersonaOptions): IDVProvider {
  const base = 'https://withpersona.com/api/v1'
  const f = opts.fetchImpl ?? fetch
  return {
    id: 'persona',
    async start(init: IDVSessionInit): Promise<IDVSessionHandle> {
      const res = await f(`${base}/inquiries`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
          'Persona-Version': '2023-01-05',
        },
        body: JSON.stringify({
          data: {
            attributes: {
              'inquiry-template-id': opts.templateId,
              'reference-id': init.subject.subjectId,
              fields: { email: init.subject.email },
            },
          },
        }),
      })
      if (!res.ok) throw new Error(`persona start failed: ${res.status}`)
      const body = (await res.json()) as { data: { id: string; attributes: { 'session-token'?: string } } }
      const id = body.data.id
      const token = body.data.attributes['session-token']
      return {
        id,
        provider: 'persona',
        embed: token
          ? {
              sdkUrl: 'https://cdn.withpersona.com/dist/persona-v5.1.0.js',
              token,
              env: opts.environment ?? 'sandbox',
            }
          : undefined,
        hostedUrl: `https://withpersona.com/verify?inquiry-id=${id}&redirect-uri=${encodeURIComponent(init.redirectUri)}`,
      }
    },
    async status(sessionId: string): Promise<IDVStatusReport> {
      const res = await f(`${base}/inquiries/${sessionId}`, {
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          'Persona-Version': '2023-01-05',
        },
      })
      if (!res.ok) throw new Error(`persona status failed: ${res.status}`)
      const body = (await res.json()) as { data: { attributes: { status: string } } }
      return { id: sessionId, status: mapStatus(body.data.attributes.status), raw: body.data as unknown as Readonly<Record<string, unknown>> }
    },
  }
}

function mapStatus(s: string): IDVStatusReport['status'] {
  switch (s) {
    case 'completed':
    case 'approved':
      return 'passed'
    case 'failed':
    case 'declined':
      return 'failed'
    case 'needs_review':
      return 'awaiting_review'
    case 'expired':
      return 'expired'
    case 'created':
    case 'pending':
      return 'pending'
    default:
      return 'in_progress'
  }
}
