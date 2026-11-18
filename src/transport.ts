const origins = {
  public: 'https://api.steampowered.com',
  partner: 'https://partner.steam-api.com',
  community: 'https://steamcommunity.com',
  store: 'https://store.steampowered.com',
} as const

export type Host = keyof typeof origins
export type HttpMethod = 'GET' | 'POST'
export type Auth = 'none' | 'optional' | 'required'
export type Scalar = string | number | boolean | bigint
export type Input = Scalar | null | readonly Input[] | { readonly [key: string]: Input | undefined }
export type Parameters = Readonly<Record<string, Input | undefined>>

export interface TransportOptions {
  apiKey?: string
  publisherKey?: string
  fetch?: typeof fetch
  timeoutMs?: number
}

export interface ResponseInfo<T> {
  body: T
  ok: true
  status: number
  statusCode: number
  headers: Headers
}

interface RequestOptions {
  method?: HttpMethod
  params?: Parameters
  auth?: Auth
  credential?: 'api' | 'publisher'
  encoding?: 'form' | 'input_json'
  format?: 'json' | 'xml' | 'vdf'
  signal?: AbortSignal
  cookie?: string
  queryAction?: true
}

export class SteamApiError extends Error {
  override readonly name = 'SteamApiError'

  constructor(
    message: string,
    readonly code: 'AUTH' | 'HTTP' | 'NETWORK' | 'TIMEOUT' | 'ABORTED' | 'PARSE' | 'RESPONSE',
    readonly status?: number,
    readonly retryAfter?: string,
  ) {
    super(message)
  }
}

function stringifyScalar(value: Scalar): string {
  if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) {
    throw new TypeError('Use a string or bigint for integers outside the JavaScript safe range.')
  }
  return String(value)
}

function formParam(params: URLSearchParams, key: string, value: Input | undefined): void {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) {
    value.forEach((entry: Input, index: number) => formParam(params, key.endsWith('[0]') ? key.replace(/0\]$/, `${index}]`) : `${key}[${index}]`, entry))
    return
  }
  if (typeof value === 'object') throw new TypeError('Nested objects require input_json encoding.')
  params.append(key, stringifyScalar(value))
}

function encode(params: Parameters, encoding: RequestOptions['encoding']): URLSearchParams {
  const entries = Object.entries(params).filter(([key]) => key !== 'key' && key !== 'format')
  const form = new URLSearchParams()
  if (encoding === 'input_json') {
    if (entries.length) {
      form.set('input_json', JSON.stringify(Object.fromEntries(entries), (_key, value: unknown) => {
        if (typeof value === 'bigint' || typeof value === 'number') stringifyScalar(value)
        return typeof value === 'bigint' ? value.toString() : value
      }))
    }
  } else {
    for (const [key, value] of entries) formParam(form, key, value)
  }
  return form
}

function readJson<T>(text: string): T {
  try {
    return JSON.parse(text, (_key, value: unknown, context?: { source?: string }) => {
      if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value) && /^-?\d+$/.test(context?.source ?? '')) {
        return context?.source
      }
      return value
    }) as T
  } catch {
    throw new SteamApiError('Steam returned invalid JSON.', 'PARSE')
  }
}

export class Transport {
  readonly #fetch: typeof fetch
  readonly #timeout: number
  readonly #apiKey: string | undefined
  readonly #publisherKey: string | undefined

  constructor(options: TransportOptions) {
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.#timeout = options.timeoutMs ?? 15_000
    this.#apiKey = options.apiKey?.trim() || undefined
    this.#publisherKey = options.publisherKey?.trim() || undefined
    if (!Number.isSafeInteger(this.#timeout) || this.#timeout < 1 || this.#timeout > 2_147_483_647) {
      throw new RangeError('timeoutMs must be between 1 and 2147483647.')
    }
  }

  async json<T>(host: Host, path: string, options: RequestOptions = {}): Promise<T> {
    return (await this.jsonResult<T>(host, path, options)).body
  }

  async jsonResult<T>(host: Host, path: string, options: RequestOptions = {}): Promise<ResponseInfo<T>> {
    return this.#send(host, path, options, async (response) => {
      if (response.status === 204) return undefined as T
      return readJson<T>(await response.text())
    })
  }

  async raw(host: Host, path: string, options: RequestOptions): Promise<ResponseInfo<Uint8Array>> {
    return this.#send(host, path, options, async (response) => new Uint8Array(await response.arrayBuffer()))
  }

  async #send<T>(
    host: Host,
    path: string,
    options: RequestOptions,
    decode: (response: Response) => Promise<T>,
  ): Promise<ResponseInfo<T>> {
    const origin = origins[host]
    const url = new URL(path, origin)
    if (!path.startsWith('/') || path.startsWith('//') || url.origin !== origin || url.username || url.password || url.hash) {
      throw new TypeError('Use an absolute path on the selected Steam host.')
    }
    url.searchParams.delete('key')
    url.searchParams.delete('format')
    const web = host === 'public' || host === 'partner'
    const auth = options.auth ?? (host === 'partner' ? 'required' : 'none')
    const key = options.credential === 'publisher' || host === 'partner'
      ? this.#publisherKey ?? this.#apiKey
      : this.#apiKey
    const headers = new Headers({ 'User-Agent': 'steamapi-node-revived/1.0.0' })
    if (auth === 'required' && !key) throw new SteamApiError('A Steam API key is required for this method.', 'AUTH')
    if (web && auth !== 'none' && key) headers.set('x-webapi-key', key)
    if (host === 'community' && options.cookie) headers.set('cookie', options.cookie)
    if (host === 'community' && options.queryAction) headers.set('x-valve-request-type', 'queryAction')

    const method = options.method ?? 'GET'
    const form = encode(options.params ?? {}, options.encoding)
    if (web) form.set('format', options.format ?? 'json')
    if (method === 'GET') {
      for (const [name, value] of form) url.searchParams.append(name, value)
    }
    const timeout = AbortSignal.timeout(this.#timeout)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    const init: RequestInit = { method, headers, signal, redirect: 'manual' }
    if (method === 'POST') init.body = form

    try {
      signal.throwIfAborted()
      let response = await this.#fetch(url, init)
      let current = url
      for (let count = 0; method === 'GET' && count < 3 && [301, 302, 303, 307, 308].includes(response.status); count++) {
        const location = response.headers.get('location')
        if (!location) break
        const next = new URL(location, current)
        if (next.origin !== origin || next.username || next.password) break
        next.searchParams.delete('key')
        await response.body?.cancel()
        current = next
        response = await this.#fetch(current, init)
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw new SteamApiError(`Steam returned HTTP ${response.status}.`, 'HTTP', response.status, response.headers.get('retry-after') ?? undefined)
      }
      const body = await decode(response)
      return { body, ok: true, status: response.status, statusCode: response.status, headers: response.headers }
    } catch (error) {
      if (error instanceof SteamApiError) throw error
      if (signal.aborted) {
        if (timeout.aborted && signal.reason === timeout.reason) throw new SteamApiError('Steam request timed out.', 'TIMEOUT')
        throw new SteamApiError('Steam request was aborted.', 'ABORTED')
      }
      throw new SteamApiError('Could not complete the Steam request.', 'NETWORK')
    }
  }
}

export type CallOptions = { signal?: AbortSignal }

export function appId(input: string | number): number {
  const value = typeof input === 'string' && !/^\d+$/.test(input) ? NaN : Number(input)
  if (!Number.isInteger(value) || value < 1 || value > 0xffffffff) throw new RangeError('Expected a positive uint32 app ID.')
  return value
}

export function id64(input: string | bigint): string {
  if (typeof input !== 'string' && typeof input !== 'bigint') throw new TypeError('Use a string or bigint for a uint64 ID.')
  const value = String(input)
  if (!/^\d{1,20}$/.test(value) || BigInt(value) > 0xffffffffffffffffn) throw new TypeError('Expected a uint64 ID.')
  return value
}

export function steamId(input: string | bigint): string {
  if (typeof input !== 'string' && typeof input !== 'bigint') throw new TypeError('Use a string or bigint for a SteamID64.')
  if (!/^\d{17}$/.test(String(input))) throw new TypeError('Expected a 17-digit SteamID64.')
  return String(input)
}

export function required<T>(value: T | undefined | null, message: string): T {
  if (value == null) throw new SteamApiError(message, 'RESPONSE')
  return value
}
