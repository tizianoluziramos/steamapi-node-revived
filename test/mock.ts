import { mock } from 'node:test'
import SteamUser from '../src/index.js'
import type { SteamUserOptions } from '../src/index.js'

type Reply = Response | Error | ((url: URL, init: RequestInit) => Response | Promise<Response>)

export function createClient(replies: Reply[] = [], options: SteamUserOptions = {}) {
  const fetch = mock.fn<typeof globalThis.fetch>(async (input, init = {}) => {
    const next = replies.shift()
    if (typeof next === 'function') return next(new URL(String(input)), init)
    if (next instanceof Error) throw next
    if (!next) throw new Error('Unexpected Steam request.')
    return next
  })
  return { steam: new SteamUser({ apiKey: 'test-api-key', publisherKey: 'test-publisher-key', ...options, fetch }), fetch }
}

export function json(value: unknown): Response {
  return Response.json(value)
}

export const steamId = '76561198000000001'
