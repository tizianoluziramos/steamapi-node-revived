import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import SteamUser from '../src/index.js'
import { createClient, json, steamId } from './mock.js'

const details = (name: string) => json({ 440: { success: true, data: { name, steam_appid: 440, type: 'game', is_free: true } } })

describe('Steam Store', () => {
  it('shares requests, refreshes forced entries and isolates localization', async () => {
    const { steam, fetch } = createClient([
      details('Game'),
      (url) => {
        assert.equal(url.searchParams.get('l'), 'spanish')
        return details('Juego')
      },
      details('Updated'),
    ])
    const [first, second] = await Promise.all([steam.games.getGameDetails(440), steam.store.getAppDetails('440')])
    assert.deepEqual(first, second)
    assert.equal(fetch.mock.callCount(), 1)
    assert.partialDeepStrictEqual(await steam.games.getGameDetails(440), { name: 'Game' })
    assert.partialDeepStrictEqual(await steam.store.getAppDetails(440, { language: 'spanish' }), { name: 'Juego' })
    assert.partialDeepStrictEqual(await steam.games.getGameDetails(440, true), { name: 'Updated' })
    assert.partialDeepStrictEqual(await steam.games.getGameDetails(440), { name: 'Updated' })
    assert.equal(fetch.mock.callCount(), 3)
  })

  it('handles expiration, failed requests and per-request signals', async (t) => {
    const clock = t.mock.method(Date, 'now', () => 100)
    const { steam, fetch } = createClient([json({ 440: { success: false } }), details('First'), details('Second'), details('Bypass')], { cache: { expires: 5 } })
    await assert.rejects(steam.games.getGameDetails(440), { code: 'RESPONSE' })
    assert.partialDeepStrictEqual(await steam.games.getGameDetails(440), { name: 'First' })
    clock.mock.mockImplementation(() => 105)
    assert.partialDeepStrictEqual(await steam.games.getGameDetails(440), { name: 'Second' })
    const controller = new AbortController()
    assert.partialDeepStrictEqual(await steam.games.getGameDetails(440, { signal: controller.signal }), { name: 'Bypass' })
    assert.equal(fetch.mock.callCount(), 4)
  })

  it('bounds the app cache, supports disabling it and validates app IDs', async () => {
    const { steam, fetch } = createClient([details('A'), details('B'), details('C')], { cache: { maxEntries: 1 } })
    await steam.games.getGameDetails(440)
    await steam.games.getGameDetails(440, { country: 'AR' })
    await steam.games.getGameDetails(440)
    assert.equal(fetch.mock.callCount(), 3)
    const uncached = createClient([details('A'), details('B')], { cache: { enabled: false } })
    await uncached.steam.games.getGameDetails(440)
    await uncached.steam.games.getGameDetails(440)
    assert.equal(uncached.fetch.mock.callCount(), 2)
    await assert.rejects(steam.games.getGameDetails('1e3'), RangeError)
    await assert.rejects(steam.games.getGameDetails(0), RangeError)
    assert.throws(() => new SteamUser('', { expires: -1 }), RangeError)
    assert.throws(() => new SteamUser('', { maxEntries: 0 }), RangeError)
  })

  it('paginates the replacement app catalog and keeps legacy output shape', async () => {
    const { steam } = createClient([
      (url, init) => {
        assert.equal(url.origin, 'https://api.steampowered.com')
        assert.equal(url.pathname, '/IStoreService/GetAppList/v1/')
        assert.equal(new Headers(init.headers).get('x-webapi-key'), 'test-api-key')
        assert.deepEqual(JSON.parse(url.searchParams.get('input_json') ?? 'null'), {
          include_games: true, include_dlc: true, include_software: true, include_videos: true, include_hardware: true, last_appid: 0,
        })
        return json({ response: { apps: [{ appid: 440, name: 'Team Fortress 2', last_modified: 50 }], have_more_results: true, last_appid: 440 } })
      },
      (url) => {
        assert.partialDeepStrictEqual(JSON.parse(url.searchParams.get('input_json') ?? 'null'), { last_appid: 440 })
        return json({ response: { apps: [{ appid: 570, name: 'Dota 2' }] } })
      },
      json({ response: { have_more_results: true, last_appid: 0 } }),
    ])
    assert.deepEqual(await steam.others.getAppList(), [{ appid: 440, name: 'Team Fortress 2' }, { appid: 570, name: 'Dota 2' }])
    await assert.rejects(steam.store.iterateApps().next(), { code: 'RESPONSE' })
  })

  it('queries featured content and encodes review cursors', async () => {
    const { steam } = createClient([
      json({ featured_win: [] }),
      json({ specials: { items: [] } }),
      (url, init) => {
        assert.equal(url.pathname, '/IUserReviewsService/GetAppReviews/v1/')
        assert.equal(new Headers(init.headers).has('x-webapi-key'), false)
        assert.deepEqual(JSON.parse(url.searchParams.get('input_json') ?? 'null'), {
          appid: 440, cursor: '*', filter: 1, languages: ['english'], filter_offtopic_activity: false, primarily_steam_deck: true,
        })
        return json({ response: { reviews: [{ recommendationid: 'a' }], cursor: 'cursor+/=' } })
      },
      (url) => {
        assert.equal(JSON.parse(url.searchParams.get('input_json') ?? 'null').cursor, 'cursor+/=')
        return json({ response: { cursor: 'cursor+/=' } })
      },
      (url, init) => {
        assert.equal(new Headers(init.headers).get('x-webapi-key'), 'test-publisher-key')
        assert.partialDeepStrictEqual(JSON.parse(url.searchParams.get('input_json') ?? 'null'), {
          filter: 3, languages: ['japanese', 'spanish'], purchase_type: 2, review_type: 1, hardware_os: 'Windows 11',
        })
        return json({ response: { reviews: [], cursor: '' } })
      },
      json({}),
    ])
    assert.deepEqual(await steam.games.getFeaturedGames(), { featured_win: [] })
    assert.deepEqual(await steam.others.getFeaturedCategories(), [{ items: [] }])
    const reviews = steam.store.iterateReviews(440, { filterOfftopicActivity: false, language: 'english', primarilySteamDeck: true })
    assert.deepEqual(await Array.fromAsync(reviews), [{ recommendationid: 'a' }])
    assert.deepEqual(await steam.store.getReviews(440, {
      usePublisherKey: true, filter: 'funny', languages: ['japanese', 'spanish'],
      purchaseType: 'non_steam_purchase', reviewType: 'positive', hardwareOs: 'Windows 11',
    }), { reviews: [], cursor: '' })
    await assert.rejects(steam.store.getReviews(440), { code: 'RESPONSE' })
  })
})

describe('Steam Community', () => {
  it('paginates inventory and preserves IDs without exposing the Steam Web API key', async () => {
    const { steam } = createClient([
      (url, init) => {
        assert.equal(url.pathname, `/inventory/${steamId}/730/2`)
        assert.equal(url.searchParams.get('l'), 'english')
        assert.equal(new Headers(init.headers).has('x-webapi-key'), false)
        assert.equal(new Headers(init.headers).get('cookie'), 'session=example')
        return new Response('{"success":1,"more_items":1,"last_assetid":18446744073709551615}')
      },
      (url) => {
        assert.equal(url.searchParams.get('start_assetid'), '18446744073709551615')
        return json({ success: 1, assets: [{ assetid: '9' }] })
      },
      json({ success: 1, more_items: true, last_assetid: '7' }),
      json({ success: 1, more_items: true, last_assetid: '7' }),
    ])
    const inventory = await Array.fromAsync(steam.community.iterateInventory(steamId, 730, 2n, { cookie: 'session=example', language: 'english' }))
    assert.deepEqual(inventory.map((page) => page.assets), [[], [{ assetid: '9' }]])
    await assert.rejects(Array.fromAsync(steam.community.iterateInventory(steamId, 730, '2')), { code: 'RESPONSE' })
  })

  it('handles market price, listing and search parameters', async () => {
    const { steam } = createClient([
      (url) => {
        assert.equal(url.searchParams.get('market_hash_name'), 'Item / Name')
        assert.equal(url.searchParams.get('currency'), '1')
        return json({ success: true, lowest_price: '$1.25' })
      },
      (url, init) => {
        assert.equal(url.pathname, '/market/actions')
        assert.equal(url.searchParams.get('q'), 'QueryListingsForItem')
        assert.equal(new Headers(init.headers).get('x-valve-request-type'), 'queryAction')
        assert.deepEqual(JSON.parse(url.searchParams.get('qp') ?? 'null'), [{
          appid: 730, strItemName: 'G180720A1063004', start: 10, filters: {}, accessoryFilters: {}, propertyFilters: {},
        }])
        return json({ data: { listings: [], more: false, start: 10, total_count: 10 } })
      },
      (url) => {
        assert.equal(url.searchParams.get('norender'), '1')
        assert.equal(url.searchParams.get('query'), 'Item & Name')
        assert.equal(url.searchParams.get('category_730_Type[0]'), 'tag_Weapon')
        return json({ success: true, total_count: 0 })
      },
      json({ success: false }),
      json({ success: false }),
      json({ success: false }),
    ])
    assert.partialDeepStrictEqual(await steam.community.getMarketPrice(730, 'Item / Name', { currency: 1 }), { lowest_price: '$1.25' })
    assert.deepEqual(await steam.community.getMarketListings(730, 'G180720A1063004', { start: 10 }),
      { listings: [], more: false, start: 10, total_count: 10 })
    assert.partialDeepStrictEqual(await steam.community.searchMarket('Item & Name', { app: 730, filters: { category_730_Type: ['tag_Weapon'] } }), { results: [], total_count: 0 })
    await assert.rejects(steam.community.getMarketPrice(730, 'Item'), { code: 'RESPONSE' })
    await assert.rejects(steam.community.searchMarket('Item'), { code: 'RESPONSE' })
    await assert.rejects(steam.community.getInventory(steamId, 730, '2'), { code: 'RESPONSE' })
  })

  it('retrieves item descriptions, price histories, and order books', async () => {
    const { steam } = createClient([
      (url) => {
        assert.equal(url.searchParams.get('q'), 'QueryDescription')
        assert.deepEqual(JSON.parse(url.searchParams.get('qp') ?? 'null'), [730, 'Item'])
        return json({ data: { appid: 730, name: 'Item' } })
      },
      json({ data: { ecurrency: 1, prices: [{ time: 1, price_median: 2, purchases: 3 }] } }),
      (url) => {
        assert.equal(url.pathname, '/market/orderbook')
        assert.equal(url.searchParams.get('q'), 'Load')
        return json({ data: { success: true, data: { cBuyOrders: 5 } } })
      },
      json({ data: { success: false } }),
      json({ data: null }),
    ])
    assert.partialDeepStrictEqual(await steam.community.getMarketItemDescription(730, 'Item'), { name: 'Item' })
    assert.deepEqual(await steam.community.getMarketPriceHistory(730, 'Item'),
      { ecurrency: 1, prices: [{ time: 1, price_median: 2, purchases: 3 }] })
    assert.partialDeepStrictEqual(await steam.community.getMarketOrderBook(730, 'Item'), { cBuyOrders: 5 })
    await assert.rejects(steam.community.getMarketOrderBook(730, 'Item'), { code: 'RESPONSE' })
    await assert.rejects(steam.community.getMarketItemDescription(730, 'Item'), { code: 'RESPONSE' })
  })
})
