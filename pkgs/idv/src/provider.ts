/**
 * IDV (identity verification) provider contract.
 *
 * A provider knows how to:
 *   1. mint a verification session for a given subject + flow,
 *   2. resume an existing session by id,
 *   3. report the terminal status (passed / failed / needs_review / expired).
 *
 * The portal stays agnostic of the actual vendor (Persona, Onfido, Veriff,
 * Sumsub, Stripe Identity, a custom backend, or the in-process stub for
 * dev). Wire whichever in `apps/web/src/main.tsx` via `setProvider(...)`.
 */

export type IDVFlowKind =
  | 'kyc-basic'        // ID doc + selfie
  | 'kyc-enhanced'     // + proof of address
  | 'kyb'              // business onboarding
  | 'liveness'         // selfie-only liveness check
  | 'address-proof'

export type IDVStatus =
  | 'pending'
  | 'in_progress'
  | 'awaiting_review'
  | 'passed'
  | 'failed'
  | 'expired'
  | 'cancelled'

export interface IDVSubject {
  /** Stable subject identifier (typically the IAM user id). */
  readonly subjectId: string
  /** Org org slug (for multi-org providers). */
  readonly orgId: string
  /** Email + display name carried through for vendor pre-fill. */
  readonly email?: string
  readonly displayName?: string
}

export interface IDVSessionInit {
  readonly subject: IDVSubject
  readonly flow: IDVFlowKind
  /** Where to send the user after the IDV widget completes. */
  readonly redirectUri: string
  /** Optional vendor-specific metadata pass-through. */
  readonly metadata?: Readonly<Record<string, string>>
}

export interface IDVSessionHandle {
  readonly id: string
  readonly provider: string
  /** URL the browser should redirect the user to (hosted vendor flow). */
  readonly hostedUrl?: string
  /**
   * Inline embed config (when the vendor supports an in-app web SDK). The
   * IDV UI mounts an iframe / web component using this token + config.
   */
  readonly embed?: {
    readonly sdkUrl: string
    readonly token: string
    readonly env?: 'sandbox' | 'production'
  }
}

export interface IDVStatusReport {
  readonly id: string
  readonly status: IDVStatus
  readonly reason?: string
  /** Provider-specific result blob (audit trail). */
  readonly raw?: Readonly<Record<string, unknown>>
}

export interface IDVProvider {
  readonly id: string
  start(init: IDVSessionInit): Promise<IDVSessionHandle>
  status(sessionId: string): Promise<IDVStatusReport>
  cancel?(sessionId: string): Promise<void>
}
