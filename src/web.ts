import { endpointCatalog, findEndpoint } from './catalog.js'
import type { DiscoveredInterface, SteamEndpoint, WebHost } from './catalog.js'
import { required } from './transport.js'
import type { Auth, CallOptions, HttpMethod, Parameters, Transport } from './transport.js'

export interface WebRequest extends CallOptions {
  interface: string
  method: string
  version?: number
  httpMethod?: HttpMethod
  host?: WebHost
  auth?: Auth
  credential?: 'api' | 'publisher'
  encoding?: 'form' | 'input_json'
  params?: Parameters
}

export interface DiscoverOptions extends CallOptions {
  authenticated?: boolean
  host?: WebHost
}

function requestTarget(request: WebRequest): { host: WebHost; path: string; method: HttpMethod; auth: Auth } {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(request.interface) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(request.method)) {
    throw new TypeError('Expected a Steam interface and method name.')
  }
  const entry = findEndpoint(request.interface, request.method, request.version)
  const latest = entry ?? findEndpoint(request.interface, request.method)
  const version = request.version ?? latest?.version ?? 1
  if (!Number.isSafeInteger(version) || version < 1) throw new RangeError('Expected a positive API version.')
  const host = request.host ?? latest?.host ?? 'public'
  const auth = request.auth ?? (host === 'partner' ? 'required' : latest?.auth ?? 'optional')
  const path = `/${latest?.interface ?? request.interface}/${latest?.method ?? request.method}/v${version}/`
  return { host, path, auth, method: request.httpMethod ?? latest?.httpMethod ?? 'GET' }
}

export class WebApi {
  readonly endpoints = endpointCatalog

  constructor(private readonly transport: Transport) {}

  find(interfaceName: string, method: string, version?: number): SteamEndpoint | undefined {
    return findEndpoint(interfaceName, method, version)
  }

  request<T = unknown>(request: WebRequest): Promise<T> {
    const { host, path, method, auth } = requestTarget(request)
    return this.transport.json<T>(host, path, { ...request, method, auth })
  }

  raw(request: WebRequest & { format?: 'json' | 'xml' | 'vdf' }) {
    const { host, path, method, auth } = requestTarget(request)
    return this.transport.raw(host, path, { ...request, method, auth })
  }

  async discover(options: DiscoverOptions = {}): Promise<DiscoveredInterface[]> {
    const host = options.host ?? 'public'
    const body = await this.request<{ apilist?: { interfaces?: DiscoveredInterface[] } }>({
      ...options,
      interface: 'ISteamWebAPIUtil',
      method: 'GetSupportedAPIList',
      host,
      auth: options.authenticated || host === 'partner' ? 'required' : 'none',
    })
    return required(body.apilist?.interfaces, 'Steam did not return an API catalog.')
  }
}
