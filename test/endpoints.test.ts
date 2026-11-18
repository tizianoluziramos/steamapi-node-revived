import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import SteamUser, { SteamClient } from '../src/index.js'
import type { LegacyGroup } from '../src/index.js'
import { createClient, json, steamId } from './mock.js'

describe('legacy endpoints', () => {
  it('preserves the constructor and disabled group behavior', () => {
    const steam = new SteamUser('example', { enabled: false }, ['games'])
    assert.deepEqual(steam.options, { enabled: false, expires: 86_400_000, maxEntries: 512 })
    assert.equal('games' in steam, false)
    assert.equal(steam.games, undefined)
    assert.equal(typeof steam.users.getUserSummary, 'function')
    assert.equal(SteamClient, SteamUser)
    assert.throws(() => new SteamUser('example', {}, ['invalid' as LegacyGroup]), TypeError)
  })

  it('resolves exact IDs, URL paths and vanity names', async () => {
    const { steam, fetch } = createClient([
      (url) => {
        assert.equal(url.pathname, '/ISteamUser/ResolveVanityURL/v1/')
        assert.equal(url.searchParams.get('vanityurl'), 'custom-name')
        return json({ response: { success: 1, steamid: steamId } })
      },
      json({ response: { success: 42 } }),
    ])
    assert.equal(await steam.others.resolve(BigInt(steamId)), steamId)
    assert.equal(await steam.others.resolve(`/profiles/${steamId}/`), steamId)
    assert.equal(await steam.others.resolve(`https://steamcommunity.com/profiles/${steamId}/?language=english`), steamId)
    assert.equal(await steam.others.resolve('steamcommunity.com/id/custom-name/'), steamId)
    await assert.rejects(steam.others.resolve('unavailable'), { code: 'RESPONSE' })
    await assert.rejects(steam.others.resolve('https://steamcommunity.com.example.org/id/test'), TypeError)
    await assert.rejects(steam.others.resolve('https://steamcommunity.com/tradeoffer/new/'), TypeError)
    await assert.rejects(steam.others.resolve('765611980000000011'), TypeError)
    assert.equal(fetch.mock.callCount(), 2)
  })

  it('normalizes game stats and accepts new parameters', async () => {
    const { steam } = createClient([
      json({ achievementpercentages: { achievements: [{ name: 'TEST', percent: 25 }] } }),
      (url) => {
        assert.equal(url.searchParams.get('feeds'), 'steam_community_announcements,pcgamer')
        assert.equal(url.searchParams.get('maxlength'), '600')
        return json({ appnews: { count: 0 } })
      },
      json({ response: { result: 1, player_count: 0 } }),
      json({ response: { result: 2 } }),
      json({ game: { gameName: 'Example' } }),
      (url) => {
        assert.equal(url.searchParams.get('name[0]'), 'cats')
        assert.equal(url.searchParams.get('count'), '1')
        return json({ response: { globalstats: { cats: { total: '100' } } } })
      },
    ])
    assert.deepEqual(await steam.games.getGameAchievements(440), [{ name: 'TEST', percent: 25 }])
    assert.deepEqual(await steam.games.getGameNews(440, { feeds: ['steam_community_announcements', 'pcgamer'], maxLength: 600 }), [])
    assert.equal(await steam.games.getGamePlayers(440), 0)
    await assert.rejects(steam.games.getGamePlayers(440), { code: 'RESPONSE' })
    assert.partialDeepStrictEqual(await steam.games.getGameSchema(440), { gameName: 'Example' })
    assert.deepEqual(await steam.games.getGlobalStats(440, ['cats']), { cats: { total: '100' } })
  })

  it('supports lookup by address and game server filters', async () => {
    const { steam } = createClient([
      json({ response: { success: false } }),
      json({ response: { success: true, servers: [{ addr: '192.0.2.1:27015', appid: 440, secure: true }] } }),
      (url) => {
        assert.equal(url.searchParams.get('filter'), '\\appid\\440')
        return json({ response: { servers: [{ addr: '192.0.2.2:27015', appid: 440 }] } })
      },
    ])
    await assert.rejects(steam.others.getServers(' '), TypeError)
    await assert.rejects(steam.others.getServers('192.0.2.1'), { code: 'RESPONSE' })
    assert.deepEqual(await steam.others.getServers('192.0.2.1'), [{
      address: '192.0.2.1:27015', appID: 440, game: undefined, gmsindex: undefined,
      lan: undefined, port: undefined, region: undefined, secure: true, specPort: undefined,
    }])
    assert.deepEqual(await steam.others.getServerList('\\appid\\440', { limit: 5 }), [{ addr: '192.0.2.2:27015', appid: 440 }])
  })

  it('retrieves profiles and bans in batches with preserved legacy projections', async () => {
    const summary = { steamid: steamId, personaname: 'Example', avatar: 'small', avatarmedium: 'medium', avatarfull: 'full' }
    const ban = { SteamID: steamId, CommunityBanned: false, VACBanned: true, NumberOfVACBans: 1 }
    const { steam } = createClient([
      (url) => {
        assert.equal(url.searchParams.get('steamids'), `${steamId},76561198000000002`)
        return json({ response: { players: [summary] } })
      },
      json({ response: { players: [summary] } }),
      json({ response: { players: [] } }),
      json({ players: [ban] }),
      json({ players: [ban] }),
      json({ players: [] }),
    ])
    assert.deepEqual(await steam.users.getPlayerSummaries([steamId, 76561198000000002n]), [summary])
    assert.partialDeepStrictEqual(await steam.users.getUserSummary(steamId), {
      steamID: steamId, nickname: 'Example', avatar: { small: 'small', medium: 'medium', large: 'full' },
    })
    await assert.rejects(steam.users.getUserSummary(steamId), { code: 'RESPONSE' })
    const [entry] = await steam.users.getPlayerBans([steamId])
    assert.ok(entry)
    assert.partialDeepStrictEqual(entry, { steamID: steamId, VACBanned: true, numberOfVACBans: 1 })
    assert.deepEqual(await steam.users.getUserBans(steamId), entry)
    await assert.rejects(steam.users.getUserBans(steamId), { code: 'RESPONSE' })
    await assert.rejects(steam.users.getPlayerSummaries([]), RangeError)
    await assert.rejects(steam.users.getUserSummary('bad-id'), TypeError)
  })

  it('retrieves achievements, stats, badges, friends, level, and groups', async () => {
    const { steam } = createClient([
      json({ playerstats: { success: true, gameName: 'Example', steamID: steamId, achievements: [
        { apiname: 'achievement', achieved: 1, unlocktime: 10, name: 'Name', description: 'Description' },
      ] } }),
      json({ playerstats: { success: false } }),
      json({ playerstats: { steamID: steamId, gameName: 'Example', stats: [{ name: 't', value: 4 }] } }),
      json({ response: { badges: [{ appid: 440, badgeid: 1, completion_time: 100, level: 1, scarcity: 80, xp: 10 }] } }),
      json({ friendslist: { friends: [{ steamid: steamId, relationship: 'friend', friend_since: 123 }] } }),
      (url, init) => {
        assert.equal(url.hostname, 'partner.steam-api.com')
        assert.equal(new Headers(init.headers).get('x-webapi-key'), 'test-publisher-key')
        return new Response('{"response":{"success":true,"groups":[{"gid":18446744073709551615}]}}')
      },
      json({ response: { success: false } }),
      json({ response: { player_level: 0 } }),
      json({ response: { quests: [{ questid: 1, completed: true }] } }),
    ])
    assert.deepEqual((await steam.users.getUserAchievements(steamId, 440)).achievements,
      [{ api: 'achievement', achieved: true, unlockTime: 10, name: 'Name', description: 'Description' }])
    await assert.rejects(steam.users.getUserAchievements(steamId, 440), { code: 'RESPONSE' })
    assert.deepEqual((await steam.users.getUserStats(steamId, 440)).stats, [{ name: 't', value: 4 }])
    assert.deepEqual(await steam.users.getUserBadges(steamId), [{
      appID: 440, badgeID: 1, borderColor: undefined, communityItemID: undefined,
      completionTime: 100, level: 1, scarcity: 80, xp: 10,
    }])
    assert.deepEqual(await steam.users.getUserFriends(steamId), [{ steamID: steamId, relationship: 'friend', friendSince: 123 }])
    assert.deepEqual(await steam.users.getUserGroups(steamId), ['18446744073709551615'])
    await assert.rejects(steam.users.getUserGroups(steamId), { code: 'RESPONSE' })
    assert.equal(await steam.users.getUserLevel(steamId), 0)
    assert.deepEqual(await steam.users.getBadgeProgress(steamId, 1n), [{ questid: 1, completed: true }])
  })

  it('queries libraries, recently played games, favorites and managed servers', async () => {
    const game = { appid: 440, playtime_forever: 8, playtime_2weeks: 0 }
    const { steam } = createClient([
      (url) => {
        assert.partialDeepStrictEqual(JSON.parse(url.searchParams.get('input_json') ?? 'null'), {
          steamid: steamId, include_appinfo: true, appids_filter: [440],
        })
        return json({ response: { games: [game] } })
      },
      json({ response: { games: [game] } }),
      json({ response: { games: [{ ...game, img_icon_url: 'example', name: 'Example' }] } }),
      json({ response: { servers: [] } }),
      json({ response: { items: [{ appid: 1, priority: 0, date_added: 1 }] } }),
      json({ response: { count: 1 } }),
    ])
    assert.deepEqual(await steam.users.getOwnedGames(steamId, { includeAppInfo: true, appIds: ['440'] }), [game])
    assert.deepEqual(await steam.users.getUserOwnedGames(steamId), [{ appID: 440, playTime: 8, playTime2: null }])
    assert.deepEqual(await steam.users.getUserRecentGames(steamId), [{
      appID: 440, name: 'Example', playTime: 8, playTime2: 0, logoURL: undefined,
      iconURL: 'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/440/example.jpg',
    }])
    assert.deepEqual(await steam.users.getUserServers(), { servers: [] })
    assert.deepEqual(await steam.users.getWishlist(steamId), [{ appid: 1, priority: 0, date_added: 1 }])
    assert.equal(await steam.users.getWishlistItemCount(steamId), 1)
  })
})

describe('workshop and trades', () => {
  it('calls workshop operations with the documented method and preserves file IDs', async () => {
    const { steam } = createClient([
      (url, init) => {
        assert.equal(url.pathname, '/ISteamRemoteStorage/GetPublishedFileDetails/v1/')
        assert.equal(init.method, 'POST')
        assert.equal((init.body as URLSearchParams).get('publishedfileids[0]'), '18446744073709551615')
        return json({ response: { publishedfiledetails: [{ publishedfileid: '18446744073709551615', result: 1 }] } })
      },
      json({ response: { collectiondetails: [{ publishedfileid: '123', result: 1 }] } }),
      (url) => {
        assert.equal(url.pathname, '/IPublishedFileService/QueryFiles/v1/')
        assert.partialDeepStrictEqual(JSON.parse(url.searchParams.get('input_json') ?? 'null'), {
          appid: 440, requiredtags: ['fun'],
        })
        return json({ response: { total: 0 } })
      },
    ])
    assert.deepEqual(await steam.workshop.getPublishedFileDetails([18446744073709551615n]), [{ publishedfileid: '18446744073709551615', result: 1 }])
    assert.deepEqual(await steam.workshop.getCollectionDetails(['123']), [{ publishedfileid: '123', result: 1 }])
    assert.deepEqual(await steam.workshop.queryFiles({ app: '440', requiredTags: ['fun'] }), { total: 0 })
    await assert.rejects(steam.workshop.getCollectionDetails([]), RangeError)
    await assert.rejects(steam.workshop.getCollectionDetails(['18446744073709551616']), TypeError)
  })

  it('passes trade offer, summary and history options', async () => {
    const offer = { tradeofferid: '10', message: 'Example' }
    const { steam } = createClient([
      (url) => {
        assert.equal(url.searchParams.get('get_sent_offers'), 'false')
        assert.equal(url.searchParams.get('get_received_offers'), 'true')
        return json({ response: { trade_offers_received: [offer] } })
      },
      json({ response: { offer } }),
      json({ response: { pending_received_count: 1 } }),
      (url) => {
        assert.equal(url.searchParams.get('start_after_tradeid'), '18446744073709551615')
        return json({ response: { trades: [], more: false } })
      },
    ])
    assert.partialDeepStrictEqual(await steam.trades.getOffers({ sent: false }), { trade_offers_received: [offer] })
    assert.deepEqual((await steam.trades.getOffer(10n)).offer, offer)
    assert.deepEqual(await steam.trades.getOfferSummary({ cutoff: 10 }), { pending_received_count: 1 })
    assert.deepEqual(await steam.trades.getHistory({ afterTradeId: 18446744073709551615n }), { trades: [], more: false })
  })
})
