/// <reference types="vite/client" />

// No build-time ingest key. One image serves every brand's identity host, so a
// key inlined here is one brand's key on all of them — the defect that filed
// Lux, Zoo, Osage, Pars and Bootnode traffic in Hanzo's project. The key is a
// per-org fact, read at request time from the runtime config the host is served
// with (pkgs/shared ingest.ts, runtime.ts).
