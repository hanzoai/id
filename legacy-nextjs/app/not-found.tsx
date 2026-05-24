export const runtime = 'edge'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-white mb-4">404</h1>
        <p className="text-zinc-400 mb-8">Page not found</p>
        <a href="/login" className="text-sm text-zinc-500 hover:text-white transition-colors">
          Go to login
        </a>
      </div>
    </div>
  )
}
