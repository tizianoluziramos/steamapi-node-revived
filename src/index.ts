import { CommunityEndpoints } from './community.js'
import { GameEndpoints } from './games.js'
import { OtherEndpoints } from './others.js'
import { StoreEndpoints } from './store.js'
import type { CacheOptions } from './store.js'
import { TradeEndpoints } from './trades.js'
import { Transport } from './transport.js'
import type { TransportOptions } from './transport.js'
import { UserEndpoints } from './users.js'
import { WebApi } from './web.js'
import { WorkshopEndpoints } from './workshop.js'

export { endpointCatalog, findEndpoint } from './catalog.js'
export type { DiscoveredInterface, DiscoveredMethod, DiscoveredParameter, SteamEndpoint, WebHost } from './catalog.js'
export { CommunityEndpoints } from './community.js'
export type * from './community.js'
export { GameEndpoints } from './games.js'
export type * from './games.js'
export { OtherEndpoints } from './others.js'
export type * from './others.js'
export { StoreEndpoints } from './store.js'
export type * from './store.js'
export { TradeEndpoints } from './trades.js'
export type * from './trades.js'
export { SteamApiError } from './transport.js'
export type { Auth, CallOptions, HttpMethod, Input, Parameters, ResponseInfo, Scalar } from './transport.js'
export { UserEndpoints } from './users.js'
export type * from './users.js'
export { WebApi } from './web.js'
export type * from './web.js'
export { WorkshopEndpoints } from './workshop.js'
export type * from './workshop.js'

const legacyGroups = ['users', 'games', 'others'] as const
export type LegacyGroup = (typeof legacyGroups)[number]
export interface SteamUserOptions extends TransportOptions {
  cache?: CacheOptions
}

type GroupValue<Disabled extends LegacyGroup, Group extends LegacyGroup, Value> = Group extends Disabled ? Value | undefined : Value

function normalizeCache(options: CacheOptions = {}): Required<CacheOptions> {
  const expires = options.expires ?? 86_400_000
  const maxEntries = options.maxEntries ?? 512
  if (!Number.isSafeInteger(expires) || expires < 0) throw new RangeError('Cache expiry must be a non-negative integer.')
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new RangeError('Cache capacity must be a positive integer.')
  return { enabled: options.enabled ?? true, expires, maxEntries }
}

export class SteamUser<Disabled extends LegacyGroup = never> {
  readonly web: WebApi
  readonly community: CommunityEndpoints
  readonly store: StoreEndpoints
  readonly trades: TradeEndpoints
  readonly workshop: WorkshopEndpoints
  declare readonly users: GroupValue<Disabled, 'users', UserEndpoints>
  declare readonly games: GroupValue<Disabled, 'games', GameEndpoints>
  declare readonly others: GroupValue<Disabled, 'others', OtherEndpoints>
  readonly options: Required<CacheOptions>

  constructor(
    keyOrOptions: string | SteamUserOptions = {},
    cacheOptions?: CacheOptions,
    disabled: readonly Disabled[] = [],
  ) {
    if (disabled.some((group) => !legacyGroups.includes(group))) throw new TypeError('Unknown legacy endpoint group.')
    const options = typeof keyOrOptions === 'string' ? { apiKey: keyOrOptions } : keyOrOptions
    this.options = normalizeCache(cacheOptions ?? options.cache)
    const transport = new Transport(options)
    this.web = new WebApi(transport)
    this.store = new StoreEndpoints(transport, this.web, this.options)
    this.community = new CommunityEndpoints(transport, this.web)
    this.trades = new TradeEndpoints(this.web)
    this.workshop = new WorkshopEndpoints(this.web)
    const isDisabled = (group: LegacyGroup) => (disabled as readonly LegacyGroup[]).includes(group)
    Object.assign(this, {
      ...(!isDisabled('users') && { users: new UserEndpoints(this.web) }),
      ...(!isDisabled('games') && { games: new GameEndpoints(this.web, this.store) }),
      ...(!isDisabled('others') && { others: new OtherEndpoints(transport, this.web, this.store) }),
    })
  }
}

export { SteamUser as SteamClient }
export default SteamUser
