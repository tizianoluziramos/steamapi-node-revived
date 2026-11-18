import { required, steamId, SteamApiError } from './transport.js'
import type { CallOptions, Transport } from './transport.js'
import type { StoreApp, StoreEndpoints, StoreLocale } from './store.js'
import type { WebApi } from './web.js'

export interface GameServer {
  addr: string
  appid: number
  gamedir?: string
  gmsindex?: number
  lan?: boolean
  gameport?: number
  region?: number
  secure?: boolean
  specPort?: number
  steamid?: string
  name?: string
  map?: string
  players?: number
  max_players?: number
  bots?: number
}

export class OtherEndpoints {
  constructor(private readonly transport: Transport, private readonly web: WebApi, private readonly store: StoreEndpoints) {}

  get<T = unknown>(path: string, options: CallOptions = {}) {
    return this.transport.jsonResult<T>('public', path, { ...options, auth: 'optional' })
  }

  async resolve(input: string | bigint, options: CallOptions = {}): Promise<string> {
    const value = String(input).trim()
    if (/^\d{17}$/.test(value)) return value
    let path = value
    if (/^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\//i.test(value)) {
      const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
      if (url.username || url.password || url.port) throw new TypeError('Expected a Steam Community profile URL.')
      path = url.pathname
    }
    const profile = /^\/?profiles\/(\d{17})\/?$/.exec(path)?.[1]
    if (profile) return profile
    const vanity = /^\/?id\/([\w-]{2,32})\/?$/.exec(path)?.[1] ?? (/^[\w-]{2,32}$/.test(path) ? path : undefined)
    if (!vanity || /^\d+$/.test(vanity)) throw new TypeError('Expected a SteamID64, vanity name or Steam Community profile URL.')
    const body = await this.web.request<{ response?: { success: number; steamid?: string } }>({
      ...options, interface: 'ISteamUser', method: 'ResolveVanityURL', params: { vanityurl: vanity },
    })
    const result = required(body.response?.success === 1 ? body.response.steamid : undefined, 'Steam vanity profile was not found.')
    return steamId(result)
  }

  async getAppList(options: CallOptions = {}): Promise<StoreApp[]> {
    const apps: StoreApp[] = []
    for await (const { appid, name } of this.store.iterateApps({
      ...options, includeGames: true, includeDlc: true, includeSoftware: true, includeVideos: true, includeHardware: true,
    })) apps.push({ appid, name })
    return apps
  }

  async getFeaturedCategories(options?: StoreLocale): Promise<unknown[]> {
    return Object.values(await this.store.getFeaturedCategories(options))
  }

  async getServers(host: string, options: CallOptions = {}) {
    if (!host.trim()) throw new TypeError('Expected a server IP address.')
    const body = await this.web.request<{ response?: { success: boolean; servers?: GameServer[] } }>({
      ...options, interface: 'ISteamApps', method: 'GetServersAtAddress', params: { addr: host },
    })
    if (!body.response?.success) throw new SteamApiError('Steam did not return servers for that address.', 'RESPONSE')
    return (body.response.servers ?? []).map((server) => ({
      address: server.addr, appID: server.appid, game: server.gamedir, gmsindex: server.gmsindex, lan: server.lan,
      port: server.gameport, region: server.region, secure: server.secure, specPort: server.specPort,
    }))
  }

  async getServerList(filter: string, options: CallOptions & { limit?: number } = {}): Promise<GameServer[]> {
    const body = await this.web.request<{ response?: { servers?: GameServer[] } }>({
      ...options, interface: 'IGameServersService', method: 'GetServerList', params: { filter, limit: options.limit },
    })
    return body.response?.servers ?? []
  }
}
