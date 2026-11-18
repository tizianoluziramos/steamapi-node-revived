import { appId, required, SteamApiError } from './transport.js'
import type { CallOptions } from './transport.js'
import type { StoreEndpoints, StoreLocale } from './store.js'
import type { AppId } from './users.js'
import type { WebApi } from './web.js'

export interface AppNewsItem {
  gid: string
  title: string
  url: string
  is_external_url: boolean
  author: string
  contents: string
  feedlabel: string
  feedname: string
  feed_type: number
  date: number
  appid: number
  tags?: string[]
}

export interface GameNewsOptions extends CallOptions {
  count?: number
  maxLength?: number
  endDate?: number
  feeds?: readonly string[]
}

export interface GameSchema {
  gameName: string
  gameVersion: string
  availableGameStats?: {
    achievements?: Array<{
      name: string
      defaultvalue: number
      displayName: string
      hidden: number
      description?: string
      icon: string
      icongray: string
    }>
    stats?: Array<{ name: string; defaultvalue: number; displayName: string }>
  }
}

export class GameEndpoints {
  constructor(private readonly web: WebApi, private readonly store: StoreEndpoints) {}

  getFeaturedGames(options?: StoreLocale) {
    return this.store.getFeatured(options)
  }

  getGameDetails(app: AppId, force?: boolean | (StoreLocale & { force?: boolean })) {
    return this.store.getAppDetails(app, typeof force === 'boolean' ? { force } : force)
  }

  async getGameAchievements(app: AppId, options: CallOptions = {}): Promise<Array<{ name: string; percent: number }>> {
    const body = await this.web.request<{ achievementpercentages?: { achievements?: Array<{ name: string; percent: number }> } }>({
      ...options, interface: 'ISteamUserStats', method: 'GetGlobalAchievementPercentagesForApp', version: 2,
      params: { gameid: appId(app) },
    })
    return body.achievementpercentages?.achievements ?? []
  }

  async getGameNews(app: AppId, options: GameNewsOptions = {}): Promise<AppNewsItem[]> {
    const body = await this.web.request<{ appnews?: { newsitems?: AppNewsItem[] } }>({
      ...options, interface: 'ISteamNews', method: 'GetNewsForApp', version: 2,
      params: { appid: appId(app), count: options.count, maxlength: options.maxLength, enddate: options.endDate, feeds: options.feeds?.join(',') },
    })
    return required(body.appnews, 'Steam did not return app news.').newsitems ?? []
  }

  async getGamePlayers(app: AppId, options: CallOptions = {}): Promise<number> {
    const body = await this.web.request<{ response?: { result: number; player_count: number } }>({
      ...options, interface: 'ISteamUserStats', method: 'GetNumberOfCurrentPlayers',
      params: { appid: appId(app) },
    })
    const response = body.response
    if (response?.result !== 1) throw new SteamApiError('Steam did not return a player count.', 'RESPONSE')
    return required(response.player_count, 'Steam did not return a player count.')
  }

  async getGameSchema(app: AppId, options: CallOptions & { language?: string } = {}): Promise<GameSchema> {
    const body = await this.web.request<{ game?: GameSchema }>({
      ...options, interface: 'ISteamUserStats', method: 'GetSchemaForGame', version: 2,
      params: { appid: appId(app), l: options.language },
    })
    return required(body.game, 'Steam did not return an app schema.')
  }

  async getGlobalStats(app: AppId, names: readonly string[], options: CallOptions & {
    startDate?: number
    endDate?: number
  } = {}): Promise<Record<string, { total: string | number } & Record<string, string | number>>> {
    const body = await this.web.request<{ response?: { globalstats?: Record<string, { total: string | number } & Record<string, string | number>> } }>({
      ...options, interface: 'ISteamUserStats', method: 'GetGlobalStatsForGame',
      params: { appid: appId(app), count: names.length, name: names, startdate: options.startDate, enddate: options.endDate },
    })
    return required(body.response?.globalstats, 'Steam did not return global stats.')
  }
}
