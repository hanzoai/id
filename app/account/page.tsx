'use client'

export const runtime = 'edge'

import { useEffect, useState } from 'react'
import { fetchUserInfo } from '@/lib/oauth'
import { getIamUrl } from '@/lib/iam'

interface User {
  sub: string
  name?: string
  displayName?: string
  email?: string
  avatar?: string
}

export default function AccountPage() {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    loadUser()
  }, [])

  async function loadUser() {
    const token = localStorage.getItem('hanzo_access_token')
    if (!token) {
      window.location.href = '/login'
      return
    }

    // Try cached user first
    try {
      const cached = localStorage.getItem('hanzo_user')
      if (cached) {
        setUser(JSON.parse(cached))
        setIsLoading(false)
      }
    } catch {}

    // Fetch fresh user info
    try {
      const host = window.location.hostname
      const iamUrl = getIamUrl(host)
      const info = await fetchUserInfo(iamUrl, token)
      const userData: User = {
        sub: info.sub,
        name: info.name,
        displayName: info.displayName,
        email: info.email,
        avatar: info.avatar,
      }
      setUser(userData)
      localStorage.setItem('hanzo_user', JSON.stringify(userData))
    } catch {
      // Token expired or invalid
      localStorage.removeItem('hanzo_access_token')
      localStorage.removeItem('hanzo_user')
      window.location.href = '/login'
      return
    } finally {
      setIsLoading(false)
    }
  }

  function handleLogout() {
    localStorage.removeItem('hanzo_access_token')
    localStorage.removeItem('hanzo_refresh_token')
    localStorage.removeItem('hanzo_user')
    window.location.href = '/login'
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="animate-spin w-8 h-8 border-2 border-zinc-700 border-t-white rounded-full" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black p-8">
      <div className="max-w-2xl mx-auto">
        <div className="login-card p-8">
          <div className="flex items-center gap-4 mb-8">
            {user?.avatar ? (
              <img src={user.avatar} alt="" className="w-16 h-16 rounded-full" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center text-2xl font-bold text-zinc-400">
                {(user?.displayName || user?.name || user?.email || '?')[0].toUpperCase()}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-bold text-white">
                {user?.displayName || user?.name || 'User'}
              </h1>
              {user?.email && (
                <p className="text-zinc-400">{user.email}</p>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="p-4 rounded-lg border border-zinc-800">
              <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">User ID</div>
              <div className="text-white font-mono text-sm">{user?.sub}</div>
            </div>

            {user?.name && (
              <div className="p-4 rounded-lg border border-zinc-800">
                <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Username</div>
                <div className="text-white">{user.name}</div>
              </div>
            )}

            {user?.email && (
              <div className="p-4 rounded-lg border border-zinc-800">
                <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Email</div>
                <div className="text-white">{user.email}</div>
              </div>
            )}
          </div>

          <div className="mt-8 pt-6 border-t border-zinc-800">
            <button
              onClick={handleLogout}
              className="px-4 py-2 rounded-lg border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors text-sm"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
