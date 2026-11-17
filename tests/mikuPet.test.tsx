import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import MikuPet from '../src/components/MikuPet'
import {
  CUBISM_CORE_URL,
  MIKU_MODEL_URL,
  MIKU_PET_KEY,
  loadCubismCore,
  readMikuPetState,
  writeMikuPetState,
} from '../src/lib/miku'

function fakeStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  }
}

describe('桌宠状态持久化', () => {
  it('默认收起——没写入过状态时不自动展开', () => {
    expect(readMikuPetState(fakeStorage())).toBe('closed')
  })

  it('open 状态写读一致，键名固定', () => {
    const storage = fakeStorage()
    writeMikuPetState('open', storage)
    expect(storage.getItem(MIKU_PET_KEY)).toBe('open')
    expect(readMikuPetState(storage)).toBe('open')
  })

  it('localStorage 不可用（隐私模式）时静默降级不抛异常', () => {
    expect(() => writeMikuPetState('open', undefined)).not.toThrow()
    expect(readMikuPetState(undefined)).toBe('closed')
  })

  it('localStorage 抛异常（被禁用）时也不影响主流程', () => {
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(() => writeMikuPetState('open', broken)).not.toThrow()
    expect(readMikuPetState(broken)).toBe('closed')
  })
})

describe('Cubism Core 懒加载', () => {
  it('资源路径固定为本地托管，不依赖外部 CDN', () => {
    expect(CUBISM_CORE_URL).toBe('/vendor/live2dcubismcore.min.js')
    expect(MIKU_MODEL_URL).toBe('/models/miku/miku.model3.json')
  })

  it('无 DOM 环境时拒绝并报错', async () => {
    await expect(loadCubismCore('/x.js', undefined)).rejects.toThrow('无 DOM')
  })

  it('脚本加载失败清空缓存，允许重试', async () => {
    vi.stubGlobal('Live2DCubismCore', undefined)
    const makeDoc = () => ({
      createElement: () => ({ src: '', async: false, onload: null, onerror: null, remove() {} }),
      head: {
        appendChild: (script: { onerror: (() => void) | null }) =>
          setTimeout(() => script.onerror?.(), 0),
      },
    })
    // 第一次失败
    await expect(loadCubismCore('/bad.js', makeDoc() as never)).rejects.toThrow('加载失败')
    // 第二次是重新发起的加载（失败同样报"加载失败"而不是复用上一个错误）
    await expect(loadCubismCore('/bad.js', makeDoc() as never)).rejects.toThrow('加载失败')
    vi.unstubAllGlobals()
  })

  it('已注入 Live2DCubismCore 时直接 resolve，不再插 script', async () => {
    vi.stubGlobal('Live2DCubismCore', { version: 3 })
    await expect(loadCubismCore('/x.js', undefined)).resolves.toBeUndefined()
    vi.unstubAllGlobals()
  })
})

describe('MikuPet 组件', () => {
  it('收起态渲染顶栏入口按钮，带 ♪ 标识与 aria-pressed', () => {
    const html = renderToStaticMarkup(<MikuPet />)
    expect(html).toContain('♪')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('miku-btn')
    // 收起态不该出现 canvas（桌面渲染器也不会有，防将来误加）
    expect(html).not.toContain('<canvas')
  })
})
