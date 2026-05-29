import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Brand-neutral identity portal.
 *
 * NO brand packages are bundled. The runtime fetches `brand.json` from
 * the absolute URL supplied by the tenant catalog (typically the brand's
 * npm package served via jsDelivr, but any URL works). Adding a brand
 * means publishing a brand package and pointing the catalog at it — this
 * repo never changes.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  server: { port: 5173, host: '0.0.0.0' },
  preview: { port: 5174, host: '0.0.0.0' },
  build: { target: 'es2022', sourcemap: true },
})
