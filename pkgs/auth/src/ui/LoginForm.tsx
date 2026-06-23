import { useEffect, useState, type FormEvent } from 'react'
import type { AuthClient } from '../client'
import type { AppLoginInfo, LoginResponse } from '../types'
import { ProviderButtons } from './ProviderButtons'
import { OTPForm } from './OTPForm'

export interface LoginFormProps {
  readonly client: AuthClient
  readonly redirectUri?: string
  readonly state?: string
  readonly clientIdOverride?: string
  /** PKCE challenge from a downstream app's OAuth authorize, forwarded to IAM. */
  readonly codeChallenge?: string
  readonly codeChallengeMethod?: 'S256' | 'plain'
  /** OAuth scope from the downstream app's authorize request. */
  readonly scope?: string
  readonly onSuccess?: (res: LoginResponse) => void
  readonly onMfaRequired?: (res: LoginResponse) => void
}

export function LoginForm(props: LoginFormProps) {
  const { client } = props
  const [app, setApp] = useState<AppLoginInfo | null>(null)
  const [mode, setMode] = useState<'password' | 'code'>('password')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Load the application's providers + sign-in methods so we render exactly
  // what IAM offers (social buttons, email/SMS code). Best-effort: on failure
  // we still show password login.
  useEffect(() => {
    let alive = true
    client
      .appLogin()
      .then((a) => {
        if (alive) setApp(a)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [client])

  const codeEnabled =
    !!app &&
    (app.enableCodeSignin ||
      app.signinMethods.some((m) => m.name === 'Verification code' && m.rule !== 'None'))

  function handleResult(res: LoginResponse) {
    if (res.error) setError(res.error)
    else if (res.mfaRequired) props.onMfaRequired?.(res)
    else if (res.redirectUrl) window.location.href = res.redirectUrl
    else props.onSuccess?.(res)
  }

  async function onPasswordSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await client.login({
        identifier,
        password,
        clientId: props.clientIdOverride ?? client.tenant.clientId,
        application: client.tenant.appName,
        organization: client.tenant.orgId,
        redirectUri: props.redirectUri,
        state: props.state,
        codeChallenge: props.codeChallenge,
        codeChallengeMethod: props.codeChallengeMethod,
        scope: props.scope,
      })
      handleResult(res)
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  async function onSendCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const r = await client.sendLoginCode(identifier)
      if (r.ok) {
        setCodeSent(true)
        setNotice(`Code sent to ${identifier}`)
      } else {
        setError(r.error ?? 'Could not send code')
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  async function onVerifyCode(code: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await client.loginWithCode({
        dest: identifier,
        code,
        clientId: props.clientIdOverride ?? client.tenant.clientId,
        application: client.tenant.appName,
        organization: client.tenant.orgId,
        redirectUri: props.redirectUri,
        state: props.state,
        codeChallenge: props.codeChallenge,
        codeChallengeMethod: props.codeChallengeMethod,
        scope: props.scope,
      })
      handleResult(res)
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hanzo-id-login">
      {app && app.providers.length > 0 ? (
        <ProviderButtons
          client={client}
          providers={app.providers}
          mode="login"
          redirectUri={props.redirectUri}
          state={props.state}
          clientIdOverride={props.clientIdOverride}
          codeChallenge={props.codeChallenge}
          codeChallengeMethod={props.codeChallengeMethod}
          scope={props.scope}
        />
      ) : null}

      {mode === 'password' ? (
        <form onSubmit={onPasswordSubmit} className="hanzo-id-login-form" aria-busy={busy}>
          <label>
            <span>Email or username</span>
            <input
              type="text"
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error ? <p role="alert" className="hanzo-id-error">{error}</p> : null}
          <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      ) : (
        <div className="hanzo-id-code-login">
          {!codeSent ? (
            <form onSubmit={onSendCode} className="hanzo-id-login-form" aria-busy={busy}>
              <label>
                <span>Email or phone</span>
                <input
                  type="text"
                  autoComplete="username"
                  placeholder="you@example.com or +1 555 555 5555"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                />
              </label>
              {error ? <p role="alert" className="hanzo-id-error">{error}</p> : null}
              <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
            </form>
          ) : (
            <>
              {notice ? <p className="hanzo-id-notice">{notice}</p> : null}
              <OTPForm channel={identifier.includes('@') ? 'email' : 'sms'} onSubmit={onVerifyCode} />
              {error ? <p role="alert" className="hanzo-id-error">{error}</p> : null}
              <button
                type="button"
                className="hanzo-id-linkbtn"
                onClick={() => {
                  setCodeSent(false)
                  setNotice(null)
                }}
              >
                Use a different address
              </button>
            </>
          )}
        </div>
      )}

      {codeEnabled ? (
        <button
          type="button"
          className="hanzo-id-linkbtn hanzo-id-toggle-mode"
          onClick={() => {
            setMode(mode === 'password' ? 'code' : 'password')
            setError(null)
            setNotice(null)
            setCodeSent(false)
          }}
        >
          {mode === 'password' ? 'Sign in with email or SMS code' : 'Sign in with password'}
        </button>
      ) : null}
    </div>
  )
}
