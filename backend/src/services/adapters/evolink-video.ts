/**
 * EvoLink.AI 视频生成 Adapter
 * 生成端点: POST /v1/videos/generations
 * 查询端点: GET /v1/tasks/{task_id}
 * 完全异步模式，返回 task_id 后轮询
 */
import type {
  VideoProviderAdapter,
  ProviderRequest,
  AIConfig,
  VideoGenerationRecord,
  VideoGenResponse,
  VideoPollResponse,
} from './types'
import { joinProviderUrl } from './url'

export class EvoLinkVideoAdapter implements VideoProviderAdapter {
  provider = 'evolink'

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest {
    // 根据参考图模式选择合适的模型
    const baseModel = record.model || config.model || 'seedance-2.0-text-to-video'
    let model = baseModel

    // 如果用户填的模型不含模式后缀，根据 referenceMode 自动选择
    if (!baseModel.includes('-to-video')) {
      if (record.referenceMode === 'single' && record.imageUrl) {
        model = 'seedance-2.0-image-to-video'
      } else if (record.referenceMode === 'first_last' || record.referenceMode === 'multiple') {
        model = 'seedance-2.0-reference-to-video'
      } else {
        model = 'seedance-2.0-text-to-video'
      }
    }

    const body: any = {
      model,
      prompt: record.prompt || '',
      duration: record.duration || 5,
      aspect_ratio: record.aspectRatio || '16:9',
      generate_audio: true,
    }

    // 添加参考图
    const imageUrls: string[] = []
    if (record.referenceMode === 'single' && record.imageUrl) {
      imageUrls.push(record.imageUrl)
    } else if (record.referenceMode === 'first_last') {
      if (record.firstFrameUrl) imageUrls.push(record.firstFrameUrl)
      if (record.lastFrameUrl) imageUrls.push(record.lastFrameUrl)
    } else if (record.referenceMode === 'multiple' && record.referenceImageUrls) {
      try {
        const refs = JSON.parse(record.referenceImageUrls)
        imageUrls.push(...refs)
      } catch {}
    }
    if (imageUrls.length) {
      body.image_urls = imageUrls
    }

    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/videos/generations'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body,
    }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    const taskId = result.id
    if (taskId) {
      return { isAsync: true, taskId }
    }
    throw new Error('No task id in EvoLink response')
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

  parsePollResponse(result: any): VideoPollResponse {
    const status = result.status
    if (status === 'completed') {
      const videoUrl = result.results?.[0] || result.video_url || null
      return {
        status: 'completed',
        videoUrl,
      }
    }
    if (status === 'failed') {
      const errorMsg = result.error?.message || result.error?.code || 'Video generation failed'
      return { status: 'failed', error: errorMsg }
    }
    return { status: status || 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    return result.results?.[0] || result.video_url || null
  }
}
