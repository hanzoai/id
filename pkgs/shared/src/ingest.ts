/**
 * Which publishable key attributes THIS host's telemetry.
 *
 * One image serves every brand's identity host, so the key cannot be a property
 * of the BUILD. It was: the image inlined one `pk-` at build time, and that key
 * belongs to Hanzo, so Lux's, Zoo's, Osage's, Pars' and Bootnode's visitors were
 * all filed in Hanzo's project. Measured over a week: lux.id 12, zoolabs.id 7,
 * id.bootno.de 3, id.lux.network 2, osage.id 2, id.zoo.network 1, pars.id 1 —
 * every one of them in Hanzo's. Lux and Zoo could not see their own signup
 * funnel, Hanzo's numbers carried other tenants' traffic, and it crossed the
 * white-label boundary in the direction that matters least visibly.
 *
 * A key belongs to an ORG, and which org a request belongs to is already
 * answered — `resolveOrg(hostname)` decides the brand, the IAM application and
 * the brand package. This asks the same question once more and no differently:
 *
 *     ingestKey(resolveOrg(host, { catalog }).orgId, keyring)
 *
 * Keyed by ORG rather than by host on purpose. The catalog is host-keyed and
 * repeats a brand's facts on every alias (lux.id, id.lux.network), so a key
 * stated there would have to be repeated too — and the day someone adds an alias
 * and forgets the key, that host silently stops reporting. Stated once per org,
 * a new alias inherits its brand's key by naming its brand, which is the only
 * thing an alias entry says anyway.
 */

/** One publishable key per org, from the runtime `ingestKeyring`. */
export type Keyring = Record<string, string>

/**
 * `pk-` is PUBLISHABLE: it authorizes a write into one org and mints no reading
 * principal, which is what makes it safe to hand a browser. `sk-` is not, and
 * there is no third thing. The prefix is checked HERE, at the only point where a
 * key becomes something a page will send, so a mistyped keyring entry fails
 * closed instead of putting a secret key in every visitor's tab.
 */
const PUBLISHABLE = 'pk-'

/**
 * The key for an org, or undefined when there is not exactly one to give.
 *
 * Pure, total, and deliberately WITHOUT a fallback. Returning Hanzo's key for an
 * unrecognised org is precisely the defect this replaces: it is silent, it reads
 * as working, and it is only visible a week later in someone else's warehouse.
 * Undefined is the honest answer, and the caller reports it.
 */
export function ingestKey(orgId: string, keyring: Keyring): string | undefined {
  if (!orgId) return undefined
  const key = keyring[orgId]
  if (typeof key !== 'string') return undefined
  const trimmed = key.trim()
  if (!trimmed.startsWith(PUBLISHABLE)) return undefined
  return trimmed
}

/**
 * Pull the keyring JSON string out of the `/config.json` payload.
 *
 * The key is the SERVER'S name: the runtime templates `SPA_INGEST_KEYRING` into
 * `{"ingestKeyring": "<json>"}`, the same way `SPA_IAM_TENANT_CONFIG_JSON`
 * becomes `iamTenantConfigJson`. Reading any other name yields undefined and
 * every host stops reporting at once — silent on both ends — so it is one named
 * function pinned by a test beside the resolver it feeds, exactly as `catalogOf`
 * is.
 */
export function keyringOf(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const raw = (payload as { ingestKeyring?: unknown }).ingestKeyring
  return typeof raw === 'string' ? raw : undefined
}

/** Parse the keyring JSON safely; {} on any error, which reports nothing. */
export function parseKeyring(raw: string | undefined | null): Keyring {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Keyring = {}
    for (const [org, key] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key === 'string') out[org] = key
    }
    return out
  } catch {
    return {}
  }
}
