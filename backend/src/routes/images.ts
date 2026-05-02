import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, created, now, badRequest } from '../utils/response.js'
import { generateImage } from '../services/image-generation.js'
import { logTaskError, logTaskPayload, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono()

// POST /images — Generate image
app.post('/', async (c) => {
  const body = await c.req.json()
  if (!body.prompt) return badRequest(c, 'prompt is required')

  try {
    let configId: number | undefined = body.config_id
    if (body.storyboard_id) {
      const [sb] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, Number(body.storyboard_id))).all()
      if (sb) {
        const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId)).all()
        if (ep?.imageConfigId != null) configId = ep.imageConfigId
      }
    }

    logTaskStart('ImageAPI', 'generate', {
      storyboardId: body.storyboard_id,
      sceneId: body.scene_id,
      characterId: body.character_id,
      dramaId: body.drama_id,
      frameType: body.frame_type,
    })
    logTaskPayload('ImageAPI', 'request body', body)
    const id = await generateImage({
      storyboardId: body.storyboard_id,
      dramaId: body.drama_id,
      sceneId: body.scene_id,
      characterId: body.character_id,
      prompt: body.prompt,
      model: body.model,
      size: body.size,
      referenceImages: body.reference_images,
      frameType: body.frame_type,
      configId,
    })

    const [record] = db.select().from(schema.imageGenerations)
      .where(eq(schema.imageGenerations.id, id)).all()
    logTaskSuccess('ImageAPI', 'generate', { generationId: id, provider: record?.provider })
    return created(c, record)
  } catch (err: any) {
    logTaskError('ImageAPI', 'generate', { error: err.message })
    return badRequest(c, err.message)
  }
})

// GET /images — List by storyboard_id or drama_id
app.get('/', async (c) => {
  const storyboardId = c.req.query('storyboard_id')
  const dramaId = c.req.query('drama_id')

  let rows = db.select().from(schema.imageGenerations).all()

  if (storyboardId) rows = rows.filter(r => r.storyboardId === Number(storyboardId))
  if (dramaId) rows = rows.filter(r => r.dramaId === Number(dramaId))

  return success(c, rows)
})

// GET /images/pending — 获取正在生成中的任务（用于页面刷新后恢复状态）
app.get('/pending', async (c) => {
  const dramaId = c.req.query('drama_id')
  const episodeId = c.req.query('episode_id')

  let rows = db.select().from(schema.imageGenerations).all()

  // 只返回 processing 状态的任务
  rows = rows.filter(r => r.status === 'processing')

  if (dramaId) rows = rows.filter(r => r.dramaId === Number(dramaId))

  // 如果指定了 episode_id，通过 storyboard_id / scene_id / character_id 关联过滤
  if (episodeId) {
    const epIdNum = Number(episodeId)
    const epSbs = db.select().from(schema.storyboards).where(eq(schema.storyboards.episodeId, epIdNum)).all()
    const epSbIds = new Set(epSbs.map(s => s.id))

    // characters 通过 episode_characters 关联表
    const epCharLinks = db.select().from(schema.episodeCharacters).where(eq(schema.episodeCharacters.episodeId, epIdNum)).all()
    const epCharIds = new Set(epCharLinks.map(l => l.characterId))

    // scenes 通过 episode_scenes 关联表
    const epSceneLinks = db.select().from(schema.episodeScenes).where(eq(schema.episodeScenes.episodeId, epIdNum)).all()
    const epSceneIds = new Set(epSceneLinks.map(l => l.sceneId))

    rows = rows.filter(r =>
      (r.storyboardId && epSbIds.has(r.storyboardId)) ||
      (r.characterId && epCharIds.has(r.characterId)) ||
      (r.sceneId && epSceneIds.has(r.sceneId))
    )
  }

  return success(c, rows)
})

// GET /images/:id
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [row] = db.select().from(schema.imageGenerations)
    .where(eq(schema.imageGenerations.id, id)).all()
  return success(c, row || null)
})

// DELETE /images/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  db.delete(schema.imageGenerations).where(eq(schema.imageGenerations.id, id)).run()
  return success(c)
})

export default app
