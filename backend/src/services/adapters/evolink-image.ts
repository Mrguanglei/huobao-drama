/**
 * EvoLink.AI 图片生成 Adapter
 * 生成端点: POST /v1/images/generations
 * 查询端点: GET /v1/tasks/{task_id}
 * 完全异步模式，返回 task_id 后轮询
 */
import type {
  ImageProviderAdapter,
  ProviderRequest,
  AIConfig,
  ImageGenerationRecord,
  ImageGenResponse,
  ImagePollResponse,
} from './types'
import { joinProviderUrl } from './url'

export class EvoLinkImageAdapter implements ImageProviderAdapter {
  provider = 'evolink'

  buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord): ProviderRequest {
    const body: any = {
      model: record.model || config.model || 'gemini-3.1-flash-image-preview',
      prompt: record.prompt || '',
    }

    if (record.size) {
      // EvoLink 的 size 参数是宽高比（1:1, 16:9, 9:16 等），不是像素尺寸
      body.size = parseAspectRatio(record.size)
    }

    // 参考图
    if (record.referenceImages) {
      try {
        const refs = JSON.parse(record.referenceImages)
        if (refs.length) body.image_urls = refs
      } catch {}
    }

    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/images/generations'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body,
    }
  }

  parseGenerateResponse(result: any): ImageGenResponse {
    // EvoLink 可能返回的字段: id, task_id, data.id 等
    const taskId = result.id ?? result.task_id ?? result.taskId ?? result.data?.id
    console.log('[EvoLinkImageAdapter] parseGenerateResponse raw keys:', Object.keys(result))
    console.log('[EvoLinkImageAdapter] parsed taskId:', taskId)
    if (taskId) {
      return { isAsync: true, taskId: String(taskId) }
    }
    // 同步返回（极少见）
    const imageUrl = result.results?.[0] || result.data?.[0]?.url || result.output?.[0]
    if (imageUrl) {
      return { isAsync: false, imageUrl }
    }
    throw new Error(`No task id in EvoLink image response. Keys: ${Object.keys(result).join(', ')}`)
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/v1', `/tasks/${taskId}`),
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: undefined,
    }
  }

  parsePollResponse(result: any): ImagePollResponse {
    // EvoLink 可能的状态: processing, completed, succeeded, success, failed, error
    const status = result.status
    console.log('[EvoLinkImageAdapter] parsePollResponse status:', status, 'keys:', Object.keys(result))

    // 兼容多种完成状态
    if (status === 'completed' || status === 'succeeded' || status === 'success' || status === 'done') {
      // 尝试多种可能的 URL 路径
      const imageUrl =
        result.results?.[0] ||
        result.output?.results?.[0] ||
        result.result?.[0] ||
        result.data?.[0]?.url ||
        result.data?.url ||
        result.url ||
        result.image_url ||
        result.imageUrl ||
        null
      console.log('[EvoLinkImageAdapter] parsed imageUrl:', imageUrl ? 'found' : 'not found')
      return {
        status: 'completed',
        imageUrl,
      }
    }
    if (status === 'failed' || status === 'error' || status === 'failure') {
      const errorMsg = result.error?.message || result.error?.code || result.message || result.detail || 'Image generation failed'
      return { status: 'failed', error: errorMsg }
    }
    return { status: status || 'processing' }
  }

  extractImageUrl(result: any): string | null {
    return result.results?.[0] || result.data?.[0]?.url || null
  }

  extractImageBase64(_result: any): { data: string; mimeType: string } | null {
    // EvoLink 返回 URL，不返回 base64
    return null
  }
}

/**
 * 将像素尺寸（如 1024x1024, 1920x1080）转换为 EvoLink 支持的宽高比格式
 */
function parseAspectRatio(size: string): string {
  const match = size.match(/(\d+)\s*[:x]\s*(\d+)/)
  if (!match) return 'auto'
  const w = Number(match[1])
  const h = Number(match[2])
  if (!w || !h) return 'auto'

  const ratio = w / h
  if (Math.abs(ratio - 1) < 0.1) return '1:1'
  if (Math.abs(ratio - 16 / 9) < 0.1) return '16:9'
  if (Math.abs(ratio - 9 / 16) < 0.1) return '9:16'
  if (Math.abs(ratio - 4 / 3) < 0.1) return '4:3'
  if (Math.abs(ratio - 3 / 4) < 0.1) return '3:4'
  if (Math.abs(ratio - 21 / 9) < 0.1) return '21:9'

  // 默认根据方向返回
  if (ratio > 1) return '16:9'
  if (ratio < 1) return '9:16'
  return '1:1'
}
