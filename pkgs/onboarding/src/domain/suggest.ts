// Copyright 2026 Hanzo AI, Inc.
// SPDX-License-Identifier: MIT OR Apache-2.0

/**
 * Names nobody has to think of.
 *
 * Onboarding's first two questions are "what is your org called" and "what is
 * your project called", and both are asked before the person has anything to
 * name — a blank required field between a new account and the product. GitHub
 * solved the same problem for repositories by proposing something absurd and
 * memorable (`fictional-octo-succotash`), which reads as an invitation to keep
 * going rather than a form to fill in.
 *
 * So: the org name is SUGGESTED, never blank, and the project name is DERIVED
 * from whatever the org ended up being. Type over either and the suggestion is
 * gone — it is a default, not a decision.
 */

/**
 * Adjectives and nouns are kept separate and both plain ASCII, because whatever
 * comes out of here is slugified into an org slug that becomes part of URLs,
 * derived keys and a personal-org name. Nothing here needs escaping.
 */
const ADJECTIVES = [
  'brave', 'bright', 'calm', 'clever', 'cosmic', 'crisp', 'curious', 'dapper',
  'eager', 'electric', 'fearless', 'fluffy', 'friendly', 'gentle', 'glowing',
  'golden', 'happy', 'humble', 'jolly', 'keen', 'lucky', 'mighty', 'neat',
  'noble', 'polished', 'quiet', 'rapid', 'shiny', 'sleepy', 'smooth', 'solid',
  'spry', 'sturdy', 'sunny', 'swift', 'tidy', 'upbeat', 'vivid', 'witty', 'zesty',
] as const

const NOUNS = [
  'acorn', 'anchor', 'badger', 'beacon', 'bison', 'cactus', 'canyon', 'cedar',
  'comet', 'coral', 'ember', 'falcon', 'ferry', 'garnet', 'harbor', 'heron',
  'ivy', 'juniper', 'kestrel', 'lantern', 'lynx', 'maple', 'meadow', 'onyx',
  'orbit', 'otter', 'pebble', 'quartz', 'quill', 'ridge', 'river', 'sable',
  'summit', 'thicket', 'tundra', 'vector', 'walrus', 'willow', 'zephyr', 'zenith',
] as const

/**
 * Pick uniformly from `xs`.
 *
 * `crypto.getRandomValues` when it exists — not for secrecy (a suggested name is
 * not a secret) but because Math.random is seeded per-context in some embedded
 * webviews, and two people onboarding in the same shell would otherwise be
 * offered the SAME org name and collide on the slug.
 */
function pick<T>(xs: readonly T[]): T {
  const g = (globalThis as { crypto?: Crypto }).crypto
  if (g?.getRandomValues) {
    const buf = new Uint32Array(1)
    g.getRandomValues(buf)
    return xs[buf[0]! % xs.length]!
  }
  return xs[Math.floor(Math.random() * xs.length)]!
}

/**
 * A two-word suggestion, `adjective-noun`.
 *
 * 40x40 = 1,600 combinations. That is deliberately NOT collision-proof — the
 * server owns slug uniqueness and will say so — it is just wide enough that two
 * people in a room do not see the same name.
 */
export function suggestOrgName(): string {
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}`
}

/**
 * The project name that follows from an org: `acme-inc` -> `acme-inc-site`.
 *
 * Derived rather than separately suggested, so the two fields read as one
 * decision. An org that already ends in `-site` is left alone instead of
 * growing `acme-site-site`, and an absent org falls back to a bare `site`
 * (the project step can be reached before the org one via the step bar).
 */
export function suggestProjectName(orgName?: string): string {
  const org = (orgName ?? '').trim()
  if (!org) return 'site'
  return org.endsWith('-site') ? org : `${org}-site`
}
