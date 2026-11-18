import { id64, required } from './transport.js'
import type { CallOptions } from './transport.js'
import type { WebApi } from './web.js'

export interface TradeAsset {
  appid: number
  contextid: string
  assetid: string
  classid: string
  instanceid: string
  amount: string
  missing?: boolean
}

export interface TradeOffer {
  tradeofferid: string
  accountid_other: number
  message: string
  expiration_time: number
  trade_offer_state: number
  items_to_give?: TradeAsset[]
  items_to_receive?: TradeAsset[]
  is_our_offer: boolean
  time_created: number
  time_updated: number
  from_real_time_trade?: boolean
  escrow_end_date?: number
}

export interface TradeOffers {
  trade_offers_sent?: TradeOffer[]
  trade_offers_received?: TradeOffer[]
  descriptions?: Array<Record<string, unknown>>
  next_cursor?: number | string
}

export interface TradeOfferOptions extends CallOptions {
  sent?: boolean
  received?: boolean
  activeOnly?: boolean
  historicalOnly?: boolean
  historyCutoff?: number
  includeDescriptions?: boolean
  language?: string
  cursor?: string | number | bigint
}

export interface TradeHistory {
  trades?: Array<{
    tradeid: string
    steamid_other: string
    time_init: number
    status: number
    assets_received?: TradeAsset[]
    assets_given?: TradeAsset[]
  }>
  descriptions?: Array<Record<string, unknown>>
  total_trades?: number
  more?: boolean
}

export class TradeEndpoints {
  constructor(private readonly web: WebApi) {}

  async getOffers(options: TradeOfferOptions = {}): Promise<TradeOffers> {
    const body = await this.web.request<{ response?: TradeOffers }>({
      ...options, interface: 'IEconService', method: 'GetTradeOffers',
      params: {
        get_sent_offers: options.sent ?? true,
        get_received_offers: options.received ?? true,
        get_descriptions: options.includeDescriptions,
        active_only: options.activeOnly,
        historical_only: options.historicalOnly,
        time_historical_cutoff: options.historyCutoff,
        language: options.language,
        cursor: options.cursor,
      },
    })
    return required(body.response, 'Steam did not return trade offers.')
  }

  async getOffer(id: string | bigint, options: CallOptions & { includeDescriptions?: boolean; language?: string } = {}) {
    const body = await this.web.request<{ response?: { offer?: TradeOffer; descriptions?: Array<Record<string, unknown>> } }>({
      ...options, interface: 'IEconService', method: 'GetTradeOffer',
      params: { tradeofferid: id64(id), get_descriptions: options.includeDescriptions, language: options.language },
    })
    return { ...body.response, offer: required(body.response?.offer, 'Steam did not return the trade offer.') }
  }

  async getOfferSummary(options: CallOptions & { cutoff?: number } = {}): Promise<Record<string, number>> {
    const body = await this.web.request<{ response?: Record<string, number> }>({
      ...options, interface: 'IEconService', method: 'GetTradeOffersSummary', params: { time_last_visit: options.cutoff },
    })
    return required(body.response, 'Steam did not return a trade offer summary.')
  }

  async getHistory(options: CallOptions & {
    count?: number
    afterTime?: number
    afterTradeId?: string | bigint
    navigatingBack?: boolean
    includeDescriptions?: boolean
    includeFailed?: boolean
    includeTotal?: boolean
    language?: string
  } = {}): Promise<TradeHistory> {
    const body = await this.web.request<{ response?: TradeHistory }>({
      ...options, interface: 'IEconService', method: 'GetTradeHistory',
      params: {
        max_trades: options.count ?? 100,
        start_after_time: options.afterTime,
        start_after_tradeid: options.afterTradeId === undefined ? undefined : id64(options.afterTradeId),
        navigating_back: options.navigatingBack,
        get_descriptions: options.includeDescriptions,
        include_failed: options.includeFailed,
        include_total: options.includeTotal,
        language: options.language,
      },
    })
    return required(body.response, 'Steam did not return trade history.')
  }
}
