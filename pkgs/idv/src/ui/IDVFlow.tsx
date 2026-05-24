import { useEffect, useState } from 'react'
import { getActiveProvider } from '../session'
import type { IDVFlowKind, IDVSessionHandle, IDVStatusReport, IDVSubject } from '../provider'

export interface IDVFlowProps {
  readonly subject: IDVSubject
  readonly flow: IDVFlowKind
  /** Where to send the user after the flow completes. */
  readonly redirectUri: string
  /** Called as the status changes. */
  readonly onChange?: (s: IDVStatusReport) => void
  /** Called once the status is terminal. */
  readonly onTerminal?: (s: IDVStatusReport) => void
}

const TERMINAL = new Set<IDVStatusReport['status']>(['passed', 'failed', 'expired', 'cancelled'])

export function IDVFlow(props: IDVFlowProps) {
  const [handle, setHandle] = useState<IDVSessionHandle | null>(null)
  const [status, setStatus] = useState<IDVStatusReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stopped = false
    let poll: ReturnType<typeof setInterval> | null = null
    const provider = getActiveProvider()
    provider
      .start({ subject: props.subject, flow: props.flow, redirectUri: props.redirectUri })
      .then((h) => {
        if (stopped) return
        setHandle(h)
        // If hosted, redirect immediately
        if (h.hostedUrl && !h.embed) {
          window.location.href = h.hostedUrl
          return
        }
        // Otherwise poll for status while the embed is rendered
        poll = setInterval(async () => {
          try {
            const s = await provider.status(h.id)
            if (stopped) return
            setStatus(s)
            props.onChange?.(s)
            if (TERMINAL.has(s.status)) {
              if (poll) clearInterval(poll)
              props.onTerminal?.(s)
            }
          } catch (e) {
            setError(String(e))
          }
        }, 4000)
      })
      .catch((e) => setError(String(e)))
    return () => {
      stopped = true
      if (poll) clearInterval(poll)
    }
    // props.flow / props.subject changes trigger a new session; the deps list
    // intentionally tracks the meaningful identity bits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.subject.subjectId, props.flow, props.redirectUri])

  if (error) return <p role="alert" className="hanzo-id-error">{error}</p>
  if (!handle) return <p>Starting verification…</p>
  if (handle.embed) {
    return (
      <div className="hanzo-id-idv-embed" data-provider={handle.provider}>
        <iframe
          title="Identity verification"
          src={handle.embed.sdkUrl}
          // The web SDKs use postMessage to receive the token — apps that
          // need full SDK init should override IDVFlow with their own
          // provider-specific mount. This iframe is the safe default.
          style={{ width: '100%', minHeight: 600, border: 0 }}
        />
        {status ? <p className="hanzo-id-idv-status">Status: {status.status}</p> : null}
      </div>
    )
  }
  return <p>Redirecting…</p>
}
