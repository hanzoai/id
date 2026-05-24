# Hanzo ID - Hosted Login Pages

Configurable, white-label login pages for Hanzo IAM. Each organization can customize their login experience based on their domain (CNAME).

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  hanzo.id   │     │   pars.id   │     │   lux.id    │
│  (CNAME)    │     │   (CNAME)   │     │   (CNAME)   │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┴───────────────────┘
                           │
                    ┌──────▼──────┐
                    │   Hanzo ID   │  ← This repo (frontend)
                    │   (Next.js)  │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Hanzo IAM  │  ← Backend auth services
                    │   (Go API)  │
                    └─────────────┘
```

## Features

- **Domain-based branding**: Logo, colors, content based on CNAME
- **Configurable auth methods**: Password, code, WebAuthn, Face ID
- **Social providers**: Google, GitHub, and more
- **Customizable content**: Quotes, testimonials, feature highlights
- **Dark mode by default**: Clean, modern design
- **Easy to fork**: Simple structure for white-labeling

## Configuration

Branding can be configured in two ways:

### 1. Static Configuration (for known domains)

Edit `lib/branding.ts` to add your domain:

```typescript
export const staticBranding: Record<string, Partial<BrandingConfig>> = {
  'your-domain.com': {
    orgId: 'your-org',
    orgName: 'Your Organization',
    logo: '/logos/your-logo.svg',
    colors: {
      primary: '#3b82f6',
      primaryText: '#ffffff',
      background: '#000000',
      surface: '#0a0a0a',
      text: '#ffffff',
      textMuted: '#a1a1aa',
      border: '#27272a',
      error: '#dc2626',
    },
    content: {
      title: 'Welcome to Your App',
      subtitle: 'Sign in to continue',
    },
  },
}
```

### 2. Dynamic Configuration (from IAM backend)

The login page fetches branding from IAM API:

```
GET https://api.hanzo.id/api/branding?domain=your-domain.com
```

Response:
```json
{
  "orgId": "your-org",
  "orgName": "Your Organization",
  "logo": "https://...",
  "colors": { ... },
  "content": { ... },
  "links": { ... },
  "auth": { ... }
}
```

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Environment Variables

```bash
# IAM backend URL
HANZO_IAM_URL=https://api.hanzo.id

# Public IAM URL (for client-side redirects)
NEXT_PUBLIC_IAM_URL=https://api.hanzo.id
```

## Forking for White-Label

1. Fork this repository
2. Update `lib/branding.ts` with your default branding
3. Add your logo to `public/logos/`
4. Update `app/globals.css` for custom styling
5. Deploy to your infrastructure

## Directory Structure

```
hanzo-id/
├── app/
│   ├── layout.tsx      # Root layout with metadata
│   ├── page.tsx        # Redirects to /login
│   ├── login/
│   │   └── page.tsx    # Main login page
│   ├── signup/         # Sign up page
│   ├── forgot-password # Password reset
│   └── callback/       # OAuth callback handler
├── components/
│   ├── LoginForm.tsx   # Login form component
│   └── MarketingPanel.tsx  # Right side marketing content
├── lib/
│   └── branding.ts     # Branding configuration
├── public/
│   └── logos/          # Organization logos
└── config/             # Additional configuration
```

## License

MIT - Fork and customize freely!
