import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { registerProvider } from '@hanzo/id-idv'
import { createStubProvider } from '@hanzo/id-idv/providers/stub'
import './app.css'

// Default IDV provider — replace at boot via env-driven config.
registerProvider(createStubProvider())

const root = document.getElementById('root')
if (!root) throw new Error('#root missing')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
