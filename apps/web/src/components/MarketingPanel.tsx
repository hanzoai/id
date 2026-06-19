import { useEffect, useState } from 'react'
import type { Marketing } from '../marketing'

/**
 * Right-hand branding panel for the split-view login. Ported from the frozen
 * `legacy-nextjs/components/MarketingPanel.tsx`: a tagline pill, hero copy, and
 * an auto-rotating testimonial card. Accent color comes from the brand
 * contract; copy comes from the per-org marketing map.
 */
export function MarketingPanel({ marketing, accent }: { marketing: Marketing; accent: string }) {
  const quotes = marketing.quotes
  const [i, setI] = useState(0)

  useEffect(() => {
    if (quotes.length <= 1) return
    const t = setInterval(() => setI((p) => (p + 1) % quotes.length), 5000)
    return () => clearInterval(t)
  }, [quotes.length])

  const q = quotes[i]

  return (
    <div className="hanzo-id-marketing">
      {marketing.tagline ? (
        <div className="hanzo-id-pill">
          <span className="hanzo-id-pill-star">✦</span>
          <span>{marketing.tagline}</span>
        </div>
      ) : null}

      <h2 className="hanzo-id-marketing-title">{marketing.title}</h2>
      <p className="hanzo-id-marketing-subtitle">{marketing.subtitle}</p>

      {q ? (
        <div className="hanzo-id-quote-card">
          <blockquote>
            <span className="hanzo-id-quote-mark">“</span>
            {q.text}
            <span className="hanzo-id-quote-mark">”</span>
          </blockquote>
          <div className="hanzo-id-quote-author">
            <div className="hanzo-id-quote-avatar" style={{ backgroundColor: accent }}>
              {q.author
                .split(' ')
                .map((n) => n[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </div>
            <div>
              <div className="hanzo-id-quote-name">{q.author}</div>
              {q.role ? <div className="hanzo-id-quote-role">{q.role}</div> : null}
            </div>
          </div>
          {quotes.length > 1 ? (
            <div className="hanzo-id-quote-dots">
              {quotes.map((_, n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`Show testimonial ${n + 1}`}
                  className="hanzo-id-quote-dot"
                  onClick={() => setI(n)}
                  style={{ backgroundColor: n === i ? accent : undefined }}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
