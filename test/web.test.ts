import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import SteamUser, { endpointCatalog, findEndpoint, SteamApiError } from '../src/index.js'
import { createClient, json, steamId } from './mock.js'

describe('Steam Web API', () => {
  it('indexes versions and keeps Valve metadata immutable', () => {
    const { steam } = createClient()
    assert.equal(endpointCatalog.length, 221)
    assert.equal(new Set(endpointCatalog.map((entry) => `${entry.interface}/${entry.method}/${entry.version}`)).size, endpointCatalog.length)
    assert.equal(Object.isFrozen(endpointCatalog), true)
    assert.equal(Object.isFrozen(endpointCatalog[0]), true)
    assert.partialDeepStrictEqual(findEndpoint('isteamnews', 'getnewsforapp'), { version: 2, host: 'public', httpMethod: 'GET' })
    assert.equal(findEndpoint('ISteamNews', 'GetNewsForApp', 1)?.version, 1)
    assert.equal(findEndpoint('ISteamNews', 'GetNewsForApp', 99), undefined)
    assert.partialDeepStrictEqual(findEndpoint('ISteamMicroTxnSandbox', 'InitTxn'), { host: 'partner', httpMethod: 'POST' })
    assert.equal(steam.web.find('ISteamNews', 'GetNewsForApp', 2), findEndpoint('ISteamNews', 'GetNewsForApp', 2))
  })

  it('routes public calls and encodes scalar values without a key on keyless methods', async () => {
    const { steam } = createClient([
      (url, init) => {
        assert.equal(url.href, 'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=440&q=a+%26+b&format=json')
        assert.equal(init.method, 'GET')
        assert.equal(new Headers(init.headers).has('x-webapi-key'), false)
        return json({ appnews: {} })
      },
    ])
    assert.deepEqual(await steam.web.request({ interface: 'ISteamNews', method: 'GetNewsForApp', params: { appid: 440, q: 'a & b', ignored: null } }), { appnews: {} })
  })

  it('keeps the publisher key on the partner host and uses a form body on POST', async () => {
    const { steam } = createClient([
      (url, init) => {
        assert.equal(url.href, 'https://partner.steam-api.com/ISteamCommunity/ReportAbuse/v1/')
        assert.equal(init.method, 'POST')
        assert.equal(new Headers(init.headers).get('x-webapi-key'), 'test-publisher-key')
        assert.deepEqual(Object.fromEntries(init.body as URLSearchParams), {
          steamidActor: steamId, steamidTarget: '76561198000000002', appid: '730',
          abuseType: '1', contentType: '2', description: 'Example & detail', gid: '18446744073709551615', format: 'json',
        })
        return json({ response: {} })
      },
    ])
    await steam.community.reportAbuse({
      actor: steamId, target: 76561198000000002n, app: '730', abuseType: 1, contentType: 2,
      description: 'Example & detail', relatedId: 18446744073709551615n,
    })
  })

  it('accepts nested input_json data and preserves unsigned 64-bit values', async () => {
    const { steam } = createClient([
      (url, init) => {
        assert.equal(url.pathname, '/IExampleService/Extra/v7/')
        assert.equal(new Headers(init.headers).get('x-webapi-key'), 'test-api-key')
        assert.deepEqual(JSON.parse(url.searchParams.get('input_json') ?? 'null'), {
          choice: { appids: [440, 570], id: '18446744073709551615' },
        })
        return new Response('{"ids":[18446744073709551615,9007199254740991],"signed":-9007199254740993}')
      },
    ])
    assert.deepEqual(await steam.web.request({
      interface: 'IExampleService', method: 'Extra', version: 7, encoding: 'input_json',
      params: { choice: { appids: [440, 570], id: 18446744073709551615n }, format: 'xml', key: 'ignored' },
    }), { ids: ['18446744073709551615', 9007199254740991], signed: '-9007199254740993' })
  })

  it('streams encoded indexed form parameters and accepts raw response formats', async () => {
    const { steam } = createClient([
      (url, init) => {
        assert.equal(url.pathname, '/ISteamRemoteStorage/GetCollectionDetails/v1/')
        assert.deepEqual(Object.fromEntries(init.body as URLSearchParams), {
          collectioncount: '2', 'publishedfileids[0]': '123', 'publishedfileids[1]': '456', format: 'xml',
        })
        return new Response('<response />')
      },
    ])
    const result = await steam.web.raw({
      interface: 'ISteamRemoteStorage', method: 'GetCollectionDetails', format: 'xml',
      params: { collectioncount: 2, 'publishedfileids[0]': ['123', 456n] },
    })
    assert.equal(new TextDecoder().decode(result.body), '<response />')
    assert.partialDeepStrictEqual(result, { ok: true, status: 200, statusCode: 200 })
  })

  it('discovers live-style interfaces with and without credentials', async () => {
    const entry = { name: 'ITest', methods: [{ name: 'Get', version: 1, httpmethod: 'GET', parameters: [] }] }
    const { steam } = createClient([
      (_url, init) => {
        assert.equal(new Headers(init.headers).has('x-webapi-key'), false)
        return json({ apilist: { interfaces: [entry] } })
      },
      (url, init) => {
        assert.equal(url.hostname, 'partner.steam-api.com')
        assert.equal(new Headers(init.headers).get('x-webapi-key'), 'test-publisher-key')
        return json({ apilist: { interfaces: [] } })
      },
      json({}),
    ])
    assert.deepEqual(await steam.web.discover(), [entry])
    assert.deepEqual(await steam.web.discover({ host: 'partner' }), [])
    await assert.rejects(steam.web.discover({ authenticated: true }), { code: 'RESPONSE' })
  })

  it('rejects missing credentials, invalid routes and lossy input', async () => {
    const steam = new SteamUser()
    await assert.rejects(steam.users.getUserSummary(steamId), { code: 'AUTH' })
    assert.throws(() => steam.web.request({ interface: '../test', method: 'Go' }), TypeError)
    assert.throws(() => steam.web.request({ interface: 'ITest', method: 'Go', version: 0 }), RangeError)
    await assert.rejects(steam.web.request({ interface: 'ITest', method: 'Go', params: { id: 9007199254740992 } }), TypeError)
    await assert.rejects(steam.web.request({ interface: 'ITest', method: 'Go', params: { id: { nested: 1 } } }), TypeError)
    await assert.rejects(steam.others.get('//example.org/'), TypeError)
    await assert.rejects(steam.community.request('/\\example.org/'), TypeError)
    assert.throws(() => new SteamUser({ timeoutMs: 0 }), RangeError)
  })

  it('reports HTTP, JSON and sanitized transport failures', async () => {
    const { steam } = createClient([
      new Response('private test-api-key', { status: 429, headers: { 'Retry-After': '60' } }),
      new Response('invalid JSON'),
      new Error('private test-api-key'),
      new Response(null, { status: 204 }),
    ])
    const request = () => steam.others.get('/ITest/Example/v1/?key=user-input')
    await assert.rejects(request(), {
      name: 'SteamApiError', code: 'HTTP', status: 429, retryAfter: '60', message: 'Steam returned HTTP 429.',
    })
    await assert.rejects(request(), { code: 'PARSE' })
    await assert.rejects(request(), { code: 'NETWORK', message: 'Could not complete the Steam request.' })
    assert.partialDeepStrictEqual(await request(), { status: 204, body: undefined })
  })

  it('handles a timeout, a caller abort, and a pre-aborted request', async () => {
    const defer = (_url: URL, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const fallback = setTimeout(() => reject(new Error('Unexpected timeout fallback')), 1_000)
      init.signal?.addEventListener('abort', () => {
        clearTimeout(fallback)
        reject(init.signal?.reason)
      }, { once: true })
    })
    const timed = createClient([defer], { timeoutMs: 5 })
    await assert.rejects(timed.steam.community.request('/path'), { code: 'TIMEOUT' })
    const { steam, fetch } = createClient([defer])
    const controller = new AbortController()
    const pending = steam.community.request('/path', { signal: controller.signal })
    controller.abort()
    await assert.rejects(pending, { code: 'ABORTED' })
    await assert.rejects(steam.community.request('/path', { signal: controller.signal }), { code: 'ABORTED' })
    assert.equal(fetch.mock.callCount(), 1)
  })

  it('follows GET redirects within the same origin and blocks cross-origin credentials', async () => {
    const { steam, fetch } = createClient([
      new Response(null, { status: 302, headers: { location: '/path?key=untrusted&q=ok' } }),
      (url, init) => {
        assert.equal(url.searchParams.get('key'), null)
        assert.equal(url.searchParams.get('q'), 'ok')
        assert.equal(new Headers(init.headers).get('cookie'), 'session=value')
        assert.equal(new Headers(init.headers).has('x-webapi-key'), false)
        return json({ ok: true })
      },
      new Response(null, { status: 302, headers: { location: 'https://example.org/path' } }),
    ])
    assert.deepEqual(await steam.community.request('/initial', { cookie: 'session=value' }), { ok: true })
    await assert.rejects(steam.others.get('/initial'), SteamApiError)
    assert.equal(fetch.mock.callCount(), 3)
  })
})
