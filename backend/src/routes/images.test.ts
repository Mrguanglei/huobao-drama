import { strict as assert } from 'node:assert'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Hono } from 'hono'

const dbDir = mkdtempSync(join(tmpdir(), 'huobao-images-test-'))
process.env.DB_PATH = join(dbDir, 'test.db')

const { default: images } = await import('./images.js')
const { db, schema } = await import('../db/index.js')

test('GET /images/pending returns processing image generation tasks', async () => {
  const now = new Date().toISOString()

  db.insert(schema.imageGenerations).values({
    dramaId: 1,
    characterId: 7,
    prompt: 'character portrait',
    provider: 'test',
    model: 'test-model',
    status: 'processing',
    createdAt: now,
    updatedAt: now,
  }).run()

  const app = new Hono()
  app.route('/images', images)

  const resp = await app.request('/images/pending')
  const json = await resp.json()

  assert.equal(resp.status, 200)
  assert.equal(Array.isArray(json.data), true)
  assert.equal(json.data.length, 1)
  assert.equal(json.data[0].characterId, 7)
})
