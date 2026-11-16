import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AI_COVER_MEDIA } from '../src/lib/api'

/** 从后端 cover.py 里提取 _MEDIA 的 key 列表，作为前后端契约的真相来源 */
function backendMediaKeys(): string[] {
  const src = readFileSync(resolve(__dirname, '../agents/_lib/cover.py'), 'utf-8')
  const block = src.slice(src.indexOf('_MEDIA = ('), src.indexOf('_FLAT_TONES'))
  return [...block.matchAll(/"key":\s*"([a-z0-9]+)"/g)].map((m) => m[1])
}

describe('AI 封面画风：前后端契约', () => {
  it('前端画风列表与后端 _MEDIA 完全一致（key 与顺序）', () => {
    const backend = backendMediaKeys()
    expect(backend.length).toBe(10)
    expect(AI_COVER_MEDIA.map((m) => m.key)).toEqual(backend)
  })

  it('画风标签唯一且非空', () => {
    const labels = AI_COVER_MEDIA.map((m) => m.label)
    expect(new Set(labels).size).toBe(labels.length)
    for (const label of labels) expect(label.trim().length).toBeGreaterThan(0)
  })

  it('覆盖画种跨度大的几类，避免「换一张」还是同一个世界', () => {
    const keys = AI_COVER_MEDIA.map((m) => m.key)
    for (const key of ['cine', 'noir', 'ukiyoe', 'ink', 'screenprint']) {
      expect(keys).toContain(key)
    }
  })
})
