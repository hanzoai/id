import { useEffect, useState } from 'react'
import type { BrandContract } from '@hanzo/id-shared'
import type { AuthClient } from '@hanzo/id-auth'
import { BrandHeader } from '../components/BrandHeader'

export function Callback({ client, brand }: { client: AuthClient; brand: BrandContract }) {
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const code = sp.get('code')
    if (!code) {
      setError('Missing authorization code.')
      return
    }
    const codeVerifier = sessionStorage.getItem('pkce_verifier') ?? undefined
    client
      .exchange(code, codeVerifier)
      .then((tok) => {
        // Forward the tokens to whichever app initiated this flow.
        const target = sessionStorage.getItem('post_login_redirect') ?? '/'
        const url = new URL(target, window.location.origin)
        url.searchParams.set('access_token', tok.accessToken)
        if (tok.refreshToken) url.searchParams.set('refresh_token', tok.refreshToken)
        if (tok.idToken) url.searchParams.set('id_token', tok.idToken)
        sessionStorage.removeItem('pkce_verifier')
        sessionStorage.removeItem('post_login_redirect')
        window.location.replace(url.toString())
      })
      .catch((e) => setError(String(e)))
  }, [client])

  return (
    <div className="id-portal-page id-portal-callback">
      <BrandHeader brand={brand} />
      <main>
        {error ? <p role="alert" className="id-portal-error">{error}</p> : <p>Completing sign-in…</p>}
      </main>
    </div>
  )
}
