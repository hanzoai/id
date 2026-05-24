/**
 * Client ID → application/organization map.
 *
 * Used for resolving the correct IAM application from a client_id,
 * e.g. during social login callbacks where we need to know which
 * app and org the login belongs to.
 */

export interface ClientInfo {
  application: string
  organization: string
}

export const CLIENT_APP_MAP: Record<string, ClientInfo> = {
  // Hanzo org
  'hanzo-platform-client-id': { application: 'app-platform', organization: 'hanzo' },
  'hanzo-app-client-id': { application: 'hanzo-id', organization: 'hanzo' },
  'hanzo-id': { application: 'hanzo-id', organization: 'hanzo' },
  'hanzo-console-client-id': { application: 'app-console', organization: 'hanzo' },
  'hanzo-cloud-client-id': { application: 'app-cloud', organization: 'hanzo' },
  'kms-client': { application: 'app-kms', organization: 'hanzo' },
  'hanzo-kms-client-id': { application: 'app-kms', organization: 'hanzo' },
  'hanzo-commerce-client-id': { application: 'app-commerce', organization: 'hanzo' },
  'hanzo-team-client-id': { application: 'app-team', organization: 'hanzo' },
  'hanzobot-client-id': { application: 'app-hanzobot', organization: 'hanzo' },
  'chat-app': { application: 'app-chat', organization: 'hanzo' },
  'hanzo-chat-client-id': { application: 'app-hanzo-chat', organization: 'hanzo' },
  'hanzo-web3': { application: 'app-hanzo-web3', organization: 'hanzo' },
  'app-analytics': { application: 'app-analytics', organization: 'hanzo' },
  'app-insights': { application: 'app-insights', organization: 'hanzo' },
  'bootnode-web': { application: 'app-bootnode', organization: 'hanzo' },
  'zt-console': { application: 'app-zt-console', organization: 'hanzo' },
  'hanzo-storage-client-id': { application: 'app-storage', organization: 'hanzo' },
  'hanzo-auto-client-id': { application: 'app-auto', organization: 'hanzo' },
  'hanzo-flow-client-id': { application: 'app-flow', organization: 'hanzo' },
  // Adnexus org
  'adnexus-app-client-id': { application: 'app-adnexus', organization: 'adnexus' },
  // Lux org
  'lux-app-client-id': { application: 'app-lux', organization: 'lux' },
  'lux-chat-client-id': { application: 'app-lux-chat', organization: 'lux' },
  'lux-kms-client': { application: 'app-lux-kms', organization: 'lux' },
  'lux-web3': { application: 'app-lux-web3', organization: 'lux' },
  'lux-mpc': { application: 'app-lux-mpc', organization: 'lux' },
  // Zoo org
  'zoo-app-client-id': { application: 'app-zoo', organization: 'zoo' },
  'zoo-web3': { application: 'app-zoo-web3', organization: 'zoo' },
  'zoo-mpc': { application: 'app-zoo-mpc', organization: 'zoo' },
  // Pars org
  'pars-app-client-id': { application: 'app-pars', organization: 'pars' },
  'pars-mpc': { application: 'app-pars-mpc', organization: 'pars' },
  // Zen org
  'zen-app-client-id': { application: 'app-zen', organization: 'zen' },
}

export function resolveClient(clientId: string): ClientInfo | undefined {
  return CLIENT_APP_MAP[clientId]
}
