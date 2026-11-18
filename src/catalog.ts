import { catalogData } from './catalog-data.js'
import type { Auth, HttpMethod } from './transport.js'

export type WebHost = 'public' | 'partner'

export type CatalogRow = readonly [
  interfaceName: string,
  method: string,
  version: number,
  httpMethod: HttpMethod,
  host: WebHost,
  auth: Auth,
  reference?: string,
]

export interface SteamEndpoint {
  readonly interface: string
  readonly method: string
  readonly version: number
  readonly httpMethod: HttpMethod
  readonly host: WebHost
  readonly auth: Auth
  readonly documentation?: string
}

export interface DiscoveredParameter {
  name: string
  type: string
  optional: boolean
  description?: string
}

export interface DiscoveredMethod {
  name: string
  version: number
  httpmethod: HttpMethod
  description?: string
  parameters: DiscoveredParameter[]
}

export interface DiscoveredInterface {
  name: string
  methods: DiscoveredMethod[]
}

export const endpointCatalog: readonly SteamEndpoint[] = Object.freeze(catalogData.map(
  ([interfaceName, method, version, httpMethod, host, auth, reference]) => Object.freeze({
    interface: interfaceName,
    method,
    version,
    httpMethod,
    host,
    auth,
    ...(reference && { documentation: `https://partner.steamgames.com/doc/webapi/${reference}` }),
  }),
))

const byMethod = new Map<string, SteamEndpoint[]>()
for (const endpoint of endpointCatalog) {
  const key = `${endpoint.interface}/${endpoint.method}`.toLowerCase()
  const versions = byMethod.get(key) ?? []
  versions.push(endpoint)
  byMethod.set(key, versions)
}
for (const versions of byMethod.values()) versions.sort((a, b) => b.version - a.version)

export function findEndpoint(interfaceName: string, method: string, version?: number): SteamEndpoint | undefined {
  const entries = byMethod.get(`${interfaceName}/${method}`.toLowerCase())
  return version === undefined ? entries?.[0] : entries?.find((entry) => entry.version === version)
}
