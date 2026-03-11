'use client'

import { useState, useRef, useEffect } from 'react'

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'pt', label: 'Português' },
  { code: 'fa', label: 'فارسی' },
  { code: 'ar', label: 'العربية' },
  { code: 'ru', label: 'Русский' },
]

export default function LanguageDropdown() {
  const [open, setOpen] = useState(false)
  const [lang, setLang] = useState('en')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Read from localStorage or browser language
    const saved = localStorage.getItem('hanzo_lang')
    if (saved) {
      setLang(saved)
    } else {
      const browserLang = navigator.language.split('-')[0]
      const match = LANGUAGES.find(l => l.code === browserLang)
      if (match) setLang(match.code)
    }
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (code: string) => {
    setLang(code)
    localStorage.setItem('hanzo_lang', code)
    setOpen(false)
    // IAM uses ?lang= param for locale
    const url = new URL(window.location.href)
    url.searchParams.set('lang', code)
    window.location.href = url.toString()
  }

  const current = LANGUAGES.find(l => l.code === lang) || LANGUAGES[0]

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 p-2 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-white transition-colors"
        aria-label="Language"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
        <span className="text-xs">{current.label}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 py-1 max-h-64 overflow-y-auto">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              onClick={() => handleSelect(l.code)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-zinc-800 transition-colors ${
                l.code === lang ? 'text-white' : 'text-zinc-400'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
