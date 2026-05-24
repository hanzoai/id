'use client'

import { useState, useEffect } from 'react'
import type { BrandingConfig } from '@/lib/branding'

interface MarketingPanelProps {
  branding: BrandingConfig
}

export default function MarketingPanel({ branding }: MarketingPanelProps) {
  const [currentQuote, setCurrentQuote] = useState(0)
  const quotes = branding.content.quotes || []

  // Auto-rotate quotes
  useEffect(() => {
    if (quotes.length <= 1) return

    const interval = setInterval(() => {
      setCurrentQuote((prev) => (prev + 1) % quotes.length)
    }, 5000)

    return () => clearInterval(interval)
  }, [quotes.length])

  return (
    <div className="max-w-md space-y-8">
      {/* Badge */}
      {branding.content.tagline && (
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-zinc-700 text-sm">
          <span className="text-yellow-400">✦</span>
          <span className="text-zinc-300">{branding.content.tagline}</span>
        </div>
      )}

      {/* Title */}
      {branding.content.title && (
        <h2 className="text-4xl font-bold text-white">
          {branding.content.title}
        </h2>
      )}

      {/* Subtitle */}
      {branding.content.subtitle && (
        <p className="text-zinc-400 text-lg">
          {branding.content.subtitle}
        </p>
      )}

      {/* Interactive prompt (optional feature showcase) */}
      {branding.content.features && branding.content.features.length > 0 && (
        <div className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800">
          <div className="text-xs text-zinc-500 mb-2 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: branding.colors.primary }} />
            TRY SOMETHING LIKE
          </div>
          <p className="text-white">
            {branding.content.features[0].description}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button className="p-2 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
            <button className="p-2 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </button>
            <div className="flex-1" />
            <button
              className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium"
              style={{
                backgroundColor: branding.colors.primary,
                color: branding.colors.primaryText
              }}
            >
              <span>✦</span>
              Generate
            </button>
          </div>
        </div>
      )}

      {/* Testimonials/Quotes */}
      {quotes.length > 0 && (
        <div className="quote-card">
          <blockquote className="text-white mb-4">
            <span className="text-2xl text-zinc-600">"</span>
            {quotes[currentQuote].text}
            <span className="text-2xl text-zinc-600">"</span>
          </blockquote>

          <div className="flex items-center gap-3">
            {quotes[currentQuote].avatar ? (
              <img
                src={quotes[currentQuote].avatar}
                alt={quotes[currentQuote].author}
                className="w-10 h-10 rounded-full"
              />
            ) : (
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-medium"
                style={{ backgroundColor: branding.colors.primary }}
              >
                {quotes[currentQuote].author.split(' ').map(n => n[0]).join('').slice(0, 2)}
              </div>
            )}
            <div>
              <div className="font-medium text-white">
                {quotes[currentQuote].author}
              </div>
              {(quotes[currentQuote].role || quotes[currentQuote].company) && (
                <div className="text-sm text-zinc-500">
                  {[quotes[currentQuote].role, quotes[currentQuote].company].filter(Boolean).join(', ')}
                </div>
              )}
            </div>
          </div>

          {/* Quote indicators */}
          {quotes.length > 1 && (
            <div className="flex justify-center gap-2 mt-4">
              {quotes.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentQuote(i)}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i === currentQuote ? 'bg-white' : 'bg-zinc-600'
                  }`}
                  style={{
                    backgroundColor: i === currentQuote ? branding.colors.primary : undefined
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
