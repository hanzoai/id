/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Publishable event-ingest key (pk-…), inlined at build time from the
   * PUBLISHABLE_KEY build-arg (KMS `deploy/PUBLISHABLE_KEY`, env `prod`).
   * Declared so a typo reads as a type error rather than as `any` — Vite's
   * ImportMetaEnv carries a string index signature, so an undeclared
   * `import.meta.env.VITE_EVENT_INGEST_KEZ` would type-check and ship empty.
   */
  readonly VITE_PUBLISHABLE_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
