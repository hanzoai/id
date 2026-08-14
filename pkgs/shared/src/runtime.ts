import { catalogOf, parseCatalog, type Catalog } from './org'
import { keyringOf, parseKeyring, type Keyring } from './ingest'

/**
 * `/config.json`, fetched ONCE per document and shared.
 *
 * Two readers now need it — the shell, to learn which brand this host is, and
 * telemetry, to learn which key attributes it — and they must agree. A second
 * copy of "fetch it, pick the key out, parse it" is a second chance to read the
 * wrong property name, and reading the wrong name is a total, silent outage in
 * both cases (every catalog-only host drops to a bundled default; every host
 * stops reporting). So it is one function, and the promise is memoized: two
 * callers, one request, one answer.
 */

/** What the runtime serves: which brand each host is, and each org's ingest key. */
export interface Runtime {
  readonly catalog: Catalog
  readonly keyring: Keyring
}

const EMPTY: Runtime = { catalog: {}, keyring: {} }

let pending: Promise<Runtime> | null = null

/** Resolves the runtime config, fetching at most once per document. */
export function loadRuntime(): Promise<Runtime> {
  pending ??= fetchRuntime()
  return pending
}

/** Drops the memo. Tests only — a document never needs this. */
export function resetRuntime(): void {
  pending = null
}

async function fetchRuntime(): Promise<Runtime> {
  let payload: unknown
  try {
    const res = await fetch('/config.json', { cache: 'no-store' })
    if (res.ok) payload = await res.json()
  } catch {
    // network/parse error → fall through to the global, then to empty
  }

  const catalogRaw =
    catalogOf(payload) ??
    (globalThis as { __ID_CATALOG__?: string }).__ID_CATALOG__

  return {
    catalog: parseCatalog(catalogRaw),
    // NO global fallback for the keyring, and none is wanted. The catalog has one
    // for history; a key that could arrive from an injected global would be a
    // second way to say which tenant a page writes into, decided by whichever
    // source happened to load. One source: the runtime that serves the host.
    keyring: parseKeyring(keyringOf(payload)),
  }
}

/** The empty runtime — every host unknown, nothing reports. Exported for tests. */
export const noRuntime = EMPTY
