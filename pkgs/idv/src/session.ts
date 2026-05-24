import type { IDVProvider, IDVSessionHandle, IDVSessionInit, IDVStatusReport } from './provider'

/** Registry of installed IDV providers, keyed by provider id. */
const registry = new Map<string, IDVProvider>()
let active: IDVProvider | null = null

export function registerProvider(p: IDVProvider): void {
  registry.set(p.id, p)
  if (!active) active = p
}

export function setActiveProvider(id: string): void {
  const p = registry.get(id)
  if (!p) throw new Error(`IDV provider not registered: ${id}`)
  active = p
}

export function getActiveProvider(): IDVProvider {
  if (!active) throw new Error('No IDV provider registered. Call registerProvider() at startup.')
  return active
}

export async function startSession(init: IDVSessionInit): Promise<IDVSessionHandle> {
  return getActiveProvider().start(init)
}

export async function getStatus(sessionId: string): Promise<IDVStatusReport> {
  return getActiveProvider().status(sessionId)
}
