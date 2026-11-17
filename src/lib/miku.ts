/**
 * 初音未来桌宠引擎封装。
 *
 * 模型：Live2D 官方示例「初音未来」（Cubism 3.3 runtime，本地托管于
 * /public/models/miku，授权见《无偿提供素材使用授权协议》与示例数据使用条件，
 * 一般用户与小规模企业可自由使用）。
 *
 * 设计约束：
 * - Cubism Core 与 pixi 全部动态加载，不进首屏主包——不点开桌宠就一个字节都不下载
 * - 所有外部状态读写可注入（localStorage / document），方便单测
 */

/** 桌宠开合状态的 localStorage 键 */
export const MIKU_PET_KEY = 'trick-miku-pet'

export type MikuPetState = 'open' | 'closed'

export function readMikuPetState(storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): MikuPetState {
  try {
    return storage?.getItem(MIKU_PET_KEY) === 'open' ? 'open' : 'closed'
  } catch {
    return 'closed'
  }
}

export function writeMikuPetState(state: MikuPetState, storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): void {
  try {
    storage?.setItem(MIKU_PET_KEY, state)
  } catch {
    /* 隐私模式 / 配额满：静默降级，仅本次会话生效 */
  }
}

/** Cubism Core 官方运行时（本地托管，不依赖 CDN） */
export const CUBISM_CORE_URL = '/vendor/live2dcubismcore.min.js'
/** 官方初音未来模型（Cubism 3.3） */
export const MIKU_MODEL_URL = '/models/miku/miku.model3.json'

let corePromise: Promise<void> | null = null

/**
 * 懒加载 Cubism Core 脚本（幂等：并发调用共享同一 Promise）。
 * 加载失败会清空缓存，允许下次重试。
 */
export function loadCubismCore(
  src: string = CUBISM_CORE_URL,
  doc: Pick<Document, 'createElement' | 'head'> | undefined = typeof document === 'undefined' ? undefined : document,
): Promise<void> {
  const w = globalThis as { Live2DCubismCore?: unknown }
  if (w.Live2DCubismCore) return Promise.resolve()
  if (corePromise) return corePromise
  const pending = new Promise<void>((resolve, reject) => {
    if (!doc) {
      reject(new Error('无 DOM 环境'))
      return
    }
    const script = doc.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      script.remove()
      reject(new Error('Cubism Core 加载失败'))
    }
    doc.head.appendChild(script)
  })
  corePromise = pending
  // 加载失败清空缓存：下一次调用重新发起加载，而不是复用已 rejected 的 Promise
  pending.catch(() => {
    if (corePromise === pending) corePromise = null
  })
  return pending
}

export interface MikuStage {
  /** 画布逻辑尺寸 */
  size: { width: number; height: number }
  /** 点击模型播放 Tap 组动作（视线跟随由 autoInteract 自动开启） */
  tapMotion(): Promise<void>
  dispose(): void
}

/**
 * 创建桌宠舞台：懒加载 pixi + cubism4 插件 → 加载官方 Miku 模型 →
 * 锚点底部居中、按画布等比缩放。
 */
export async function createMikuStage(
  canvas: HTMLCanvasElement,
  opts: { modelUrl?: string } = {},
): Promise<MikuStage> {
  await loadCubismCore()
  // Cubism 4 的剪贴 mask 依赖 WebGL stencil，Canvas2D 渲染器画不出模型，
  // 所以不支持 WebGL 的环境直接明确报错（真实浏览器基本都有 WebGL）
  const hasWebGL = (() => {
    try {
      return Boolean(document.createElement('canvas').getContext('webgl'))
    } catch {
      return false
    }
  })()
  if (!hasWebGL) {
    throw new Error('当前浏览器不支持 WebGL，桌宠无法显示')
  }
  const [{ Application, Ticker }, { Live2DModel }] = await Promise.all([
    import('pixi.js'),
    import('pixi-live2d-display/cubism4'),
  ])

  const width = canvas.clientWidth || 260
  const height = canvas.clientHeight || 340
  const app = new Application({
    view: canvas,
    width,
    height,
    backgroundAlpha: 0,
    antialias: true,
    autoStart: true,
  })

  // 必须在 Live2DModel.from 之前注册，否则模型加载期间的动作更新没有 ticker 驱动
  Live2DModel.registerTicker(Ticker)
  const model = await Live2DModel.from(opts.modelUrl ?? MIKU_MODEL_URL, { autoInteract: true })
  model.registerInteraction(app.renderer.plugins.interaction as never)
  app.stage.addChild(model)

  // 锚点底部居中：贴着画布底边站着，比中心锚点更像"站在桌沿"
  model.anchor.set(0.5, 1)
  const fit = () => {
    const scale = Math.min(width / model.internalModel.width, height / model.internalModel.height)
    model.scale.set(scale)
    model.position.set(width / 2, height + 4)
  }
  fit()

  return {
    size: { width, height },
    tapMotion: async () => {
      await model.motion('Tap')
    },
    dispose: () => {
      app.destroy(true, { children: true, texture: true, baseTexture: true })
    },
  }
}
