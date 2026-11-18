import { appId, id64, required } from './transport.js'
import type { CallOptions, Parameters } from './transport.js'
import type { AppId } from './users.js'
import type { WebApi } from './web.js'

export interface PublishedFile {
  publishedfileid: string
  result: number
  creator?: string
  creator_app_id?: number
  creator_appid?: number
  consumer_app_id?: number
  consumer_appid?: number
  title?: string
  description?: string
  file_url?: string
  preview_url?: string
  time_created?: number
  time_updated?: number
  subscriptions?: number
  favorited?: number
  views?: number
  tags?: Array<{ tag: string }>
}

export interface CollectionDetails {
  publishedfileid: string
  result: number
  children?: Array<{ publishedfileid: string; sortorder: number; filetype: number }>
}

export interface WorkshopQuery extends CallOptions {
  app: AppId
  searchText?: string
  cursor?: string
  page?: number
  count?: number
  queryType?: number
  fileType?: number
  requiredTags?: readonly string[]
  excludedTags?: readonly string[]
  returnTags?: boolean
  returnPreviews?: boolean
  returnShortDescription?: boolean
}

export interface WorkshopQueryPage {
  total: number
  next_cursor?: string
  publishedfiledetails?: PublishedFile[]
}

function publishedIds(ids: readonly (string | bigint)[]): string[] {
  if (!ids.length) throw new RangeError('Expected at least one Workshop ID.')
  return ids.map(id64)
}

export class WorkshopEndpoints {
  constructor(private readonly web: WebApi) {}

  async getPublishedFileDetails(ids: readonly (string | bigint)[], options: CallOptions = {}): Promise<PublishedFile[]> {
    const body = await this.web.request<{ response?: { publishedfiledetails?: PublishedFile[] } }>({
      ...options, interface: 'ISteamRemoteStorage', method: 'GetPublishedFileDetails',
      params: { itemcount: ids.length, publishedfileids: publishedIds(ids) },
    })
    return required(body.response?.publishedfiledetails, 'Steam did not return Workshop file details.')
  }

  async getCollectionDetails(ids: readonly (string | bigint)[], options: CallOptions = {}): Promise<CollectionDetails[]> {
    const body = await this.web.request<{ response?: { collectiondetails?: CollectionDetails[] } }>({
      ...options, interface: 'ISteamRemoteStorage', method: 'GetCollectionDetails',
      params: { collectioncount: ids.length, publishedfileids: publishedIds(ids) },
    })
    return required(body.response?.collectiondetails, 'Steam did not return Workshop collection details.')
  }

  async queryFiles(options: WorkshopQuery): Promise<WorkshopQueryPage> {
    const params: Parameters = {
      appid: appId(options.app),
      search_text: options.searchText,
      cursor: options.cursor,
      page: options.page,
      numperpage: options.count,
      query_type: options.queryType,
      filetype: options.fileType,
      requiredtags: options.requiredTags,
      excludedtags: options.excludedTags,
      return_tags: options.returnTags,
      return_previews: options.returnPreviews,
      return_short_description: options.returnShortDescription,
    }
    const body = await this.web.request<{ response?: WorkshopQueryPage }>({
      ...options, interface: 'IPublishedFileService', method: 'QueryFiles', auth: 'required', encoding: 'input_json', params,
    })
    return required(body.response, 'Steam did not return Workshop search results.')
  }
}
