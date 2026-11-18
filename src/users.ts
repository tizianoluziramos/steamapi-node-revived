import { appId, id64, required, steamId, SteamApiError } from './transport.js'
import type { CallOptions, Parameters } from './transport.js'
import type { WebApi } from './web.js'

export type SteamId = string | bigint
export type AppId = string | number

export interface PlayerSummary {
  steamid: string
  personaname: string
  profileurl: string
  avatar: string
  avatarmedium: string
  avatarfull: string
  avatarhash?: string
  personastate: number
  communityvisibilitystate: number
  profilestate?: number
  commentpermission?: number
  timecreated?: number
  lastlogoff?: number
  personastateflags?: number
  primaryclanid?: string
  realname?: string
  gameid?: string
  gameextrainfo?: string
  gameserverip?: string
  loccountrycode?: string
  locstatecode?: string
  loccityid?: number
}

interface PlayerBan {
  SteamID: string
  CommunityBanned: boolean
  VACBanned: boolean
  NumberOfVACBans: number
  DaysSinceLastBan: number
  NumberOfGameBans: number
  EconomyBan: string
}

interface Badge {
  appid?: number
  badgeid: number
  border_color?: number
  communityitemid?: string | number
  completion_time: number
  level: number
  scarcity: number
  xp: number
}

export interface OwnedGame {
  appid: number
  name?: string
  playtime_forever: number
  playtime_2weeks?: number
  img_icon_url?: string
  has_community_visible_stats?: boolean
  playtime_windows_forever?: number
  playtime_mac_forever?: number
  playtime_linux_forever?: number
  playtime_deck_forever?: number
  rtime_last_played?: number
}

interface RecentGame extends OwnedGame {
  name: string
  playtime_2weeks: number
  img_logo_url?: string
}

export interface OwnedGamesOptions extends CallOptions {
  includeAppInfo?: boolean
  includePlayedFreeGames?: boolean
  includeFreeSub?: boolean
  appIds?: readonly AppId[]
  language?: string
}

export interface UserGameStats {
  steamID: string
  gameName: string
  stats?: Array<{ name: string; value: number }>
  achievements?: Array<{ name: string; achieved: 0 | 1 }>
}

export interface WishlistItem {
  appid: number
  priority: number
  date_added: number
}

function imageUrl(app: number, hash?: string): string | undefined {
  if (!hash) return undefined
  return `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${app}/${hash}.jpg`
}

function steamIds(ids: readonly SteamId[]): string {
  if (ids.length < 1 || ids.length > 100) throw new RangeError('Expected between 1 and 100 Steam IDs.')
  return ids.map(steamId).join(',')
}

export class UserEndpoints {
  constructor(private readonly web: WebApi) {}

  async getPlayerSummaries(ids: readonly SteamId[], options: CallOptions = {}): Promise<PlayerSummary[]> {
    const body = await this.web.request<{ response?: { players?: PlayerSummary[] } }>({
      ...options, interface: 'ISteamUser', method: 'GetPlayerSummaries', version: 2, params: { steamids: steamIds(ids) },
    })
    return body.response?.players ?? []
  }

  async getUserSummary(id: SteamId, options?: CallOptions) {
    const [raw] = await this.getPlayerSummaries([id], options)
    const player = required(raw, 'Steam player was not found.')
    return {
      avatar: { small: player.avatar, medium: player.avatarmedium, large: player.avatarfull },
      commentPermission: player.commentpermission,
      created: player.timecreated,
      lastLogOff: player.lastlogoff,
      nickname: player.personaname,
      personaState: player.personastate,
      personaStateFlags: player.personastateflags,
      primaryGroupID: player.primaryclanid,
      profileState: player.profilestate,
      profileURL: player.profileurl,
      steamID: player.steamid,
      visibilityState: player.communityvisibilitystate,
    }
  }

  async getPlayerBans(ids: readonly SteamId[], options: CallOptions = {}) {
    const body = await this.web.request<{ players?: PlayerBan[] }>({
      ...options, interface: 'ISteamUser', method: 'GetPlayerBans', params: { steamids: steamIds(ids) },
    })
    return (body.players ?? []).map((ban) => ({
      communityBanned: ban.CommunityBanned,
      daysSinceLastBan: ban.DaysSinceLastBan,
      economyBan: ban.EconomyBan,
      numberOfVACBans: ban.NumberOfVACBans,
      numberOfGameBans: ban.NumberOfGameBans,
      steamID: ban.SteamID,
      VACBanned: ban.VACBanned,
    }))
  }

  async getUserBans(id: SteamId, options?: CallOptions) {
    const [ban] = await this.getPlayerBans([id], options)
    return required(ban, 'Steam player was not found.')
  }

  async getUserAchievements(id: SteamId, app: AppId, options: CallOptions & { language?: string } = {}) {
    const body = await this.web.request<{ playerstats?: {
      success: boolean
      gameName: string
      steamID: string
      achievements?: Array<{ apiname: string; achieved: number; unlocktime: number; name?: string; description?: string }>
    } }>({
      ...options, interface: 'ISteamUserStats', method: 'GetPlayerAchievements',
      params: { steamid: steamId(id), appid: appId(app), l: options.language },
    })
    const stats = body.playerstats
    if (!stats?.success) throw new SteamApiError('Steam did not return player achievements.', 'RESPONSE')
    return {
      gameName: stats.gameName,
      steamID: stats.steamID,
      achievements: (stats.achievements ?? []).map((achievement) => ({
        api: achievement.apiname,
        achieved: Boolean(achievement.achieved),
        unlockTime: achievement.unlocktime,
        ...(achievement.name !== undefined && { name: achievement.name }),
        ...(achievement.description !== undefined && { description: achievement.description }),
      })),
    }
  }

  async getUserBadges(id: SteamId, options: CallOptions = {}) {
    const body = await this.web.request<{ response?: { badges?: Badge[] } }>({
      ...options, interface: 'IPlayerService', method: 'GetBadges', params: { steamid: steamId(id) },
    })
    return (body.response?.badges ?? []).map((badge) => ({
      appID: badge.appid,
      badgeID: badge.badgeid,
      borderColor: badge.border_color,
      communityItemID: badge.communityitemid,
      completionTime: badge.completion_time,
      level: badge.level,
      scarcity: badge.scarcity,
      xp: badge.xp,
    }))
  }

  async getUserFriends(id: SteamId, options: CallOptions = {}) {
    const body = await this.web.request<{ friendslist?: { friends?: Array<{
      steamid: string; relationship: string; friend_since: number
    }> } }>({
      ...options, interface: 'ISteamUser', method: 'GetFriendList', params: { steamid: steamId(id), relationship: 'friend' },
    })
    return (body.friendslist?.friends ?? []).map((friend) => ({
      steamID: friend.steamid, relationship: friend.relationship, friendSince: friend.friend_since,
    }))
  }

  async getUserGroups(id: SteamId, options: CallOptions = {}): Promise<string[]> {
    const body = await this.web.request<{ response?: { success: boolean; groups?: Array<{ gid: string | number }> } }>({
      ...options, interface: 'ISteamUser', method: 'GetUserGroupList', params: { steamid: steamId(id) },
    })
    if (!body.response?.success) throw new SteamApiError('Steam did not return player groups.', 'RESPONSE')
    return (body.response.groups ?? []).map(({ gid }) => String(gid))
  }

  async getUserLevel(id: SteamId, options: CallOptions = {}): Promise<number> {
    const body = await this.web.request<{ response?: { player_level?: number } }>({
      ...options, interface: 'IPlayerService', method: 'GetSteamLevel', params: { steamid: steamId(id) },
    })
    return required(body.response?.player_level, 'Steam did not return the player level.')
  }

  async getOwnedGames(id: SteamId, options: OwnedGamesOptions = {}): Promise<OwnedGame[]> {
    const params: Parameters = {
      steamid: steamId(id),
      include_appinfo: options.includeAppInfo,
      include_played_free_games: options.includePlayedFreeGames,
      include_free_sub: options.includeFreeSub,
      appids_filter: options.appIds?.map(appId),
      language: options.language,
    }
    const body = await this.web.request<{ response?: { games?: OwnedGame[] } }>({
      ...options, interface: 'IPlayerService', method: 'GetOwnedGames', encoding: 'input_json', params,
    })
    return body.response?.games ?? []
  }

  async getUserOwnedGames(id: SteamId, options?: OwnedGamesOptions) {
    const games = await this.getOwnedGames(id, options)
    return games.map((game) => ({
      appID: game.appid, playTime: game.playtime_forever, playTime2: game.playtime_2weeks || null,
    }))
  }

  async getUserRecentGames(id: SteamId, options: CallOptions & { count?: number } = {}) {
    const body = await this.web.request<{ response?: { games?: RecentGame[] } }>({
      ...options, interface: 'IPlayerService', method: 'GetRecentlyPlayedGames',
      params: { steamid: steamId(id), count: options.count },
    })
    return (body.response?.games ?? []).map((game) => ({
      appID: game.appid,
      logoURL: imageUrl(game.appid, game.img_logo_url),
      name: game.name,
      iconURL: imageUrl(game.appid, game.img_icon_url),
      playTime: game.playtime_forever,
      playTime2: game.playtime_2weeks,
    }))
  }

  async getUserServers(options: CallOptions = {}): Promise<{ servers?: Array<Record<string, unknown>> }> {
    const { response } = await this.web.request<{ response?: { servers?: Array<Record<string, unknown>> } }>({
      ...options, interface: 'IGameServersService', method: 'GetAccountList',
    })
    return required(response, 'Steam did not return a server account list.')
  }

  async getUserStats(id: SteamId, app: AppId, options: CallOptions = {}): Promise<UserGameStats> {
    const body = await this.web.request<{ playerstats?: UserGameStats }>({
      ...options, interface: 'ISteamUserStats', method: 'GetUserStatsForGame', version: 2,
      params: { steamid: steamId(id), appid: appId(app) },
    })
    return required(body.playerstats, 'Steam did not return player statistics.')
  }

  async getWishlist(id: SteamId, options: CallOptions = {}): Promise<WishlistItem[]> {
    const body = await this.web.request<{ response?: { items?: WishlistItem[] } }>({
      ...options, interface: 'IWishlistService', method: 'GetWishlist', params: { steamid: steamId(id) },
    })
    return body.response?.items ?? []
  }

  async getWishlistItemCount(id: SteamId, options: CallOptions = {}): Promise<number> {
    const body = await this.web.request<{ response?: { count?: number } }>({
      ...options, interface: 'IWishlistService', method: 'GetWishlistItemCount', params: { steamid: steamId(id) },
    })
    return required(body.response?.count, 'Steam did not return the wishlist count.')
  }

  async getBadgeProgress(id: SteamId, badge: string | bigint, options: CallOptions = {}) {
    const body = await this.web.request<{ response?: { quests?: Array<{ questid: number; completed: boolean }> } }>({
      ...options, interface: 'IPlayerService', method: 'GetCommunityBadgeProgress', params: { steamid: steamId(id), badgeid: id64(badge) },
    })
    return body.response?.quests ?? []
  }
}
