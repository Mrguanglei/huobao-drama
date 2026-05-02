import { strict as assert } from 'node:assert'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Hono } from 'hono'

const dbDir = mkdtempSync(join(tmpdir(), 'huobao-videos-test-'))
process.env.DB_PATH = join(dbDir, 'test.db')

const { default: videos } = await import('./videos.js')
const { db, schema } = await import('../db/index.js')

test('GET /videos/pending returns processing video generation tasks', async () => {
  const now = new Date().toISOString()

  db.insert(schema.videoGenerations).values({
    dramaId: 1,
    storyboardId: 9,
    prompt: 'camera move',
    provider: 'test',
    model: 'test-model',
    status: 'processing',
    createdAt: now,
    updatedAt: now,
  }).run()

  const app = new Hono()
  app.route('/videos', videos)

  const resp = await app.request('/videos/pending')
  const json = await resp.json()

  assert.equal(resp.status, 200)
  assert.equal(Array.isArray(json.data), true)
  assert.equal(json.data.length, 1)
  assert.equal(json.data[0].storyboardId, 9)
})
