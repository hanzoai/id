/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Publishable event-ingest key (pk-…), inlined at build time from the
   * EVENT_INGEST_KEY build-arg (KMS `deploy/EVENT_INGEST_KEY`, env `prod`).
   * Declared so a typo reads as a type error rather than as `any` — Vite's
   * ImportMetaEnv carries a string index signature, so an undeclared
   * `import.meta.env.VITE_EVENT_INGEST_KEZ` would type-check and ship empty.
   */
  readonly VITE_EVENT_INGEST_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
