import { appId, required, SteamApiError } from './transport.js'
import type { CallOptions, Transport } from './transport.js'
import type { AppId } from './users.js'
import type { WebApi } from './web.js'

export interface StoreLocale extends CallOptions {
  country?: string
  language?: string
}

export interface AppDetails {
  steam_appid: number
  name: string
  type: string
  is_free: boolean
  detailed_description?: string
  short_description?: string
  header_image?: string
  capsule_image?: string
  website?: string | null
  developers?: string[]
  publishers?: string[]
  dlc?: number[]
  packages?: number[]
  platforms?: { windows: boolean; mac: boolean; linux: boolean }
  genres?: Array<{ id: string; description: string }>
  categories?: Array<{ id: number; description: string }>
  release_date?: { coming_soon: boolean; date: string }
  price_overview?: {
    currency: string
    initial: number
    final: number
    discount_percent: number
    initial_formatted: string
    final_formatted: string
  }
  [key: string]: unknown
}

export interface AppListOptions extends CallOptions {
  modifiedSince?: number
  descriptionLanguage?: string
  includeGames?: boolean
  includeDlc?: boolean
  includeSoftware?: boolean
  includeVideos?: boolean
  includeHardware?: boolean
  lastAppId?: number
  maxResults?: number
}

export interface StoreApp {
  appid: number
  name: string
  last_modified?: number
  price_change_number?: number
}

export interface AppListPage {
  apps: StoreApp[]
  have_more_results?: boolean
  last_appid?: number
}

export interface ReviewOptions extends CallOptions {
  cursor?: string
  count?: number
  filter?: 'recent' | 'updated' | 'helpful' | 'funny' | 'all'
  language?: string
  languages?: readonly string[]
  dayRange?: number
  reviewType?: 'all' | 'positive' | 'negative'
  purchaseType?: 'all' | 'steam' | 'non_steam_purchase'
  filterOfftopicActivity?: boolean
  displayLanguage?: string
  useReviewQuality?: boolean
  dateRangeStart?: number
  dateRangeEnd?: number
  dateRangeExclude?: boolean
  playtimeMinHours?: number
  playtimeMaxHours?: number
  primarilySteamDeck?: boolean
  hardwareOs?: string
  hardwareCpu?: string
  hardwareGpu?: string
  hardwareDeviceType?: string
  usePublisherKey?: boolean
}

export interface StoreReview {
  recommendationid: string
  author: {
    steamid: string
    num_reviews: number
    playtime_forever: number
    playtime_last_two_weeks?: number
    playtime_at_review?: number
    deck_playtime_at_review?: number
    last_played?: number
  }
  language: string
  review: string
  timestamp_created: number
  timestamp_updated: number
  voted_up: boolean
  votes_up: number
  votes_funny: number
  weighted_vote_score: number
  comment_count: number
  steam_purchase: boolean
  received_for_free: boolean
  written_during_early_access: boolean
  developer_response?: string
  timestamp_dev_responded?: number
  primarily_steam_deck?: boolean
  refunded?: boolean
  hardware?: Record<string, unknown>
}

export interface ReviewsPage {
  query_summary: {
    num_reviews: number
    review_score?: number
    review_score_desc?: string
    total_positive?: number
    total_negative?: number
    total_reviews?: number
  }
  reviews: StoreReview[]
  cursor: string
  day_range_used?: number
  total_matching?: number
}

const reviewFilters = { helpful: 0, all: 0, recent: 1, updated: 2, funny: 3 } as const
const reviewTypes = { all: 0, positive: 1, negative: 2 } as const
const purchaseTypes = { steam: 0, all: 1, non_steam_purchase: 2 } as const

export interface CacheOptions {
  enabled?: boolean
  expires?: number
  maxEntries?: number
}

interface CacheEntry {
  expires: number
  details: AppDetails
}

export class StoreEndpoints {
  readonly #cache = new Map<string, CacheEntry>()
  readonly #pending = new Map<string, Promise<AppDetails>>()

  constructor(
    private readonly transport: Transport,
    private readonly web: WebApi,
    private readonly cache: Required<CacheOptions>,
  ) {}

  async getAppDetails(app: AppId, options: StoreLocale & { force?: boolean } = {}): Promise<AppDetails> {
    const id = appId(app)
    const key = JSON.stringify([id, options.country ?? '', options.language ?? ''])
    if (!this.cache.enabled || options.signal) return this.#loadDetails(id, options)
    if (!options.force) {
      const cached = this.#cache.get(key)
      if (cached && cached.expires > Date.now()) return cached.details
    }
    const pending = this.#pending.get(key)
    if (pending) return pending
    const request = this.#loadDetails(id, options).then((details) => {
      this.#cache.delete(key)
      this.#cache.set(key, { details, expires: Date.now() + this.cache.expires })
      if (this.#cache.size > this.cache.maxEntries) {
        const oldest = this.#cache.keys().next().value
        if (oldest !== undefined) this.#cache.delete(oldest)
      }
      return details
    }).finally(() => this.#pending.delete(key))
    this.#pending.set(key, request)
    return request
  }

  async #loadDetails(id: number, options: StoreLocale): Promise<AppDetails> {
    const result = await this.transport.json<Record<string, { success: boolean; data?: AppDetails }>>('store', '/api/appdetails', {
      ...options, params: { appids: id, cc: options.country, l: options.language },
    })
    return required(result[id]?.success ? result[id].data : undefined, 'Steam Store application was not found.')
  }

  getFeatured(options: StoreLocale = {}): Promise<Record<string, unknown>> {
    return this.transport.json('store', '/api/featured', {
      ...options, params: { cc: options.country, l: options.language },
    })
  }

  getFeaturedCategories(options: StoreLocale = {}): Promise<Record<string, unknown>> {
    return this.transport.json('store', '/api/featuredcategories', {
      ...options, params: { cc: options.country, l: options.language },
    })
  }

  async getAppListPage(options: AppListOptions = {}): Promise<AppListPage> {
    const body = await this.web.request<{ response?: AppListPage }>({
      ...options, interface: 'IStoreService', method: 'GetAppList', encoding: 'input_json',
      params: {
        if_modified_since: options.modifiedSince,
        have_description_language: options.descriptionLanguage,
        include_games: options.includeGames,
        include_dlc: options.includeDlc,
        include_software: options.includeSoftware,
        include_videos: options.includeVideos,
        include_hardware: options.includeHardware,
        last_appid: options.lastAppId,
        max_results: options.maxResults,
      },
    })
    const page = required(body.response, 'Steam did not return an app list.')
    return { ...page, apps: page.apps ?? [] }
  }

  async *iterateApps(options: AppListOptions = {}): AsyncGenerator<StoreApp, void> {
    let lastAppId = options.lastAppId ?? 0
    while (true) {
      const page = await this.getAppListPage({ ...options, lastAppId })
      yield* page.apps
      if (!page.have_more_results) return
      const next = page.last_appid ?? page.apps.at(-1)?.appid
      if (!next || next <= lastAppId) throw new SteamApiError('Steam Store returned a non-advancing app cursor.', 'RESPONSE')
      lastAppId = next
    }
  }

  async getReviews(app: AppId, options: ReviewOptions = {}): Promise<ReviewsPage> {
    const body = await this.web.request<{ response?: ReviewsPage }>({
      ...options,
      interface: 'IUserReviewsService',
      method: 'GetAppReviews',
      encoding: 'input_json',
      auth: options.usePublisherKey ? 'required' : 'none',
      credential: 'publisher',
      params: {
        appid: appId(app),
        cursor: options.cursor ?? '*',
        num_per_page: options.count,
        filter: options.filter !== undefined ? reviewFilters[options.filter] : undefined,
        languages: options.languages ?? (options.language ? [options.language] : undefined),
        day_range: options.dayRange,
        review_type: options.reviewType !== undefined ? reviewTypes[options.reviewType] : undefined,
        purchase_type: options.purchaseType !== undefined ? purchaseTypes[options.purchaseType] : undefined,
        filter_offtopic_activity: options.filterOfftopicActivity,
        display_language: options.displayLanguage,
        use_review_quality: options.useReviewQuality,
        date_range_start: options.dateRangeStart,
        date_range_end: options.dateRangeEnd,
        date_range_exclude: options.dateRangeExclude,
        playtime_min_hours: options.playtimeMinHours,
        playtime_max_hours: options.playtimeMaxHours,
        primarily_steam_deck: options.primarilySteamDeck,
        hardware_os: options.hardwareOs,
        hardware_cpu: options.hardwareCpu,
        hardware_gpu: options.hardwareGpu,
        hardware_device_type: options.hardwareDeviceType,
      },
    })
    const page = required(body.response, 'Steam did not return reviews.')
    return { ...page, reviews: page.reviews ?? [] }
  }

  async *iterateReviews(app: AppId, options: ReviewOptions = {}): AsyncGenerator<StoreReview, void> {
    let cursor = options.cursor ?? '*'
    const seen = new Set([cursor])
    while (true) {
      const page = await this.getReviews(app, { ...options, filter: options.filter ?? 'recent', cursor })
      yield* page.reviews
      if (!page.reviews.length || !page.cursor || seen.has(page.cursor)) return
      cursor = page.cursor
      seen.add(cursor)
    }
  }
}
