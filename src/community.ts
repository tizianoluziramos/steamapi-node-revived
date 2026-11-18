import { appId, id64, required, steamId, SteamApiError } from './transport.js'
import type { CallOptions, Input, Parameters, Transport } from './transport.js'
import type { AppId, SteamId } from './users.js'
import type { WebApi } from './web.js'

export interface CommunityRequestOptions extends CallOptions {
  params?: Parameters
  cookie?: string
}

export interface InventoryOptions extends CallOptions {
  language?: string
  count?: number
  startAssetId?: string | bigint
  cookie?: string
}

export interface InventoryAsset {
  appid: number
  contextid: string
  assetid: string
  classid: string
  instanceid: string
  amount: string
}

export interface InventoryDescription {
  appid: number
  classid: string
  instanceid: string
  name: string
  market_hash_name?: string
  market_name?: string
  type?: string
  icon_url: string
  icon_url_large?: string
  tradable: 0 | 1 | boolean
  marketable: 0 | 1 | boolean
  descriptions?: Array<{ type: string; value: string; color?: string }>
  tags?: Array<{ category: string; internal_name: string; localized_category_name: string; localized_tag_name: string }>
}

export interface InventoryPage {
  success: boolean | number
  assets: InventoryAsset[]
  descriptions: InventoryDescription[]
  total_inventory_count?: number
  more_items?: boolean | number
  last_assetid?: string
}

export interface MarketPrice {
  success: boolean
  lowest_price?: string
  median_price?: string
  volume?: string
}

export interface MarketSearchResult {
  hash_name: string
  name: string
  sell_listings: number
  sell_price: number
  sell_price_text: string
  app_name: string
  asset_description?: InventoryDescription
}

export interface MarketSearchPage {
  success: boolean
  start: number
  pagesize: number
  total_count: number
  results: MarketSearchResult[]
}

export interface MarketOptions extends CallOptions {
  country?: string
  language?: string
  currency?: number
  cookie?: string
}

export interface MarketActionOptions extends CallOptions {
  cookie?: string
}

export interface MarketListingOptions extends MarketActionOptions {
  start?: number
  filters?: Readonly<Record<string, string | readonly string[]>>
  accessoryFilters?: Readonly<Record<string, string | readonly string[]>>
  propertyFilters?: Readonly<Record<string, string | readonly string[]>>
}

export interface MarketListingsPage {
  start: number
  more: boolean
  total_count: number
  listings: Array<{
    listingid: string
    unPrice: number
    unFee: number
    eCurrency: number
    strSubtotal?: string
    asset?: InventoryAsset
    [key: string]: unknown
  }>
  facets?: Array<Record<string, unknown>>
}

export interface MarketOrderBook {
  amtMaxBuyOrder: number
  amtMinSellOrder: number
  eCurrency: number
  cBuyOrders: number
  cSellOrders: number
  rgCompactBuyOrders?: number[]
  rgCompactSellOrders?: number[]
}

export interface MarketPriceHistory {
  ecurrency: number
  prices: Array<{ time: number; price_median: number; purchases: number }>
}

export interface AbuseReport {
  actor: SteamId
  target: string | bigint
  app: AppId
  abuseType: number
  contentType: number
  description: string
  relatedId?: string | bigint
}

export class CommunityEndpoints {
  constructor(private readonly transport: Transport, private readonly web: WebApi) {}

  request<T = unknown>(path: string, options: CommunityRequestOptions = {}): Promise<T> {
    return this.transport.json<T>('community', path, options)
  }

  async getInventory(id: SteamId, app: AppId, contextId: string | bigint, options: InventoryOptions = {}): Promise<InventoryPage> {
    const body = await this.request<InventoryPage>(`/inventory/${steamId(id)}/${appId(app)}/${id64(contextId)}`, {
      ...options,
      params: {
        l: options.language, count: options.count,
        start_assetid: options.startAssetId === undefined ? undefined : id64(options.startAssetId),
      },
    })
    if (!body.success) throw new SteamApiError('Steam Community did not return an inventory.', 'RESPONSE')
    return { ...body, assets: body.assets ?? [], descriptions: body.descriptions ?? [] }
  }

  async *iterateInventory(id: SteamId, app: AppId, contextId: string | bigint, options: InventoryOptions = {}): AsyncGenerator<InventoryPage, void> {
    let cursor = options.startAssetId === undefined ? undefined : id64(options.startAssetId)
    const seen = new Set([cursor])
    while (true) {
      const page = await this.getInventory(id, app, contextId, { ...options, ...(cursor !== undefined && { startAssetId: cursor }) })
      yield page
      if (!page.more_items) return
      const next = required(page.last_assetid, 'Steam Community omitted the inventory cursor.')
      if (seen.has(next)) throw new SteamApiError('Steam Community repeated the inventory cursor.', 'RESPONSE')
      seen.add(next)
      cursor = next
    }
  }

  async getMarketPrice(app: AppId, marketHashName: string, options: MarketOptions = {}): Promise<MarketPrice> {
    const body = await this.request<MarketPrice>('/market/priceoverview/', {
      ...options,
      params: { appid: appId(app), market_hash_name: marketHashName, country: options.country, currency: options.currency },
    })
    if (!body?.success) throw new SteamApiError('Steam Community did not return a market price.', 'RESPONSE')
    return body
  }

  async searchMarket(query: string, options: MarketOptions & {
    app?: AppId
    start?: number
    count?: number
    sortBy?: 'name' | 'price' | 'quantity'
    sortDirection?: 'asc' | 'desc'
    filters?: Readonly<Record<`category_${string}`, Input>>
  } = {}): Promise<MarketSearchPage> {
    const body = await this.request<MarketSearchPage>('/market/search/render/', {
      ...options,
      params: {
        ...options.filters, query, appid: options.app === undefined ? undefined : appId(options.app),
        start: options.start, count: options.count, sort_column: options.sortBy, sort_dir: options.sortDirection,
        country: options.country, language: options.language, currency: options.currency, norender: 1,
      },
    })
    if (!body.success) throw new SteamApiError('Steam Community did not return market search results.', 'RESPONSE')
    return { ...body, results: body.results ?? [] }
  }

  getMarketListings(app: AppId, itemName: string, options: MarketListingOptions = {}): Promise<MarketListingsPage> {
    return this.#marketAction('/market/actions', 'QueryListingsForItem', [{
      appid: appId(app),
      strItemName: itemName,
      start: options.start ?? 0,
      filters: options.filters ?? {},
      accessoryFilters: options.accessoryFilters ?? {},
      propertyFilters: options.propertyFilters ?? {},
    }], options)
  }

  getMarketItemDescription(app: AppId, marketHashName: string, options: MarketActionOptions = {}): Promise<InventoryDescription> {
    return this.#marketAction('/market/actions', 'QueryDescription', [appId(app), marketHashName], options)
  }

  getMarketPriceHistory(app: AppId, marketHashName: string, options: MarketActionOptions = {}): Promise<MarketPriceHistory> {
    return this.#marketAction('/market/actions', 'QueryPriceHistory', [appId(app), marketHashName], options)
  }

  async getMarketOrderBook(app: AppId, marketHashName: string, options: MarketActionOptions = {}): Promise<MarketOrderBook> {
    const body = await this.#marketAction<{ success: boolean; data?: MarketOrderBook }>(
      '/market/orderbook', 'Load', [appId(app), marketHashName], options,
    )
    return required(body.success ? body.data : undefined, 'Steam Community did not return a market order book.')
  }

  async #marketAction<T>(
    path: '/market/actions' | '/market/orderbook',
    action: string,
    args: unknown[],
    options: MarketActionOptions,
  ): Promise<T> {
    const body = await this.transport.json<{ data?: T }>('community', path, {
      ...options, queryAction: true, params: { q: action, qp: JSON.stringify(args) },
    })
    return required(body.data, 'Steam Community did not return market data.')
  }

  reportAbuse(report: AbuseReport, options: CallOptions = {}): Promise<unknown> {
    return this.web.request({
      ...options, interface: 'ISteamCommunity', method: 'ReportAbuse',
      params: {
        steamidActor: steamId(report.actor),
        steamidTarget: id64(report.target),
        appid: appId(report.app),
        abuseType: report.abuseType,
        contentType: report.contentType,
        description: report.description,
        gid: report.relatedId === undefined ? undefined : id64(report.relatedId),
      },
    })
  }
}
