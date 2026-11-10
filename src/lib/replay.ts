/**
 * 案件重演：把时间线 + 凶手真相编排成一帧帧「片子」。
 *
 * 纯数据函数拆出来便于单测——回放 UI 只负责按帧渲染，谁在什么帧出现、
 * 最后一帧是不是真相，都在这里定。
 */

import type { TimelineEvent } from '../types'

export interface ReplayFrame {
  kind: 'event' | 'truth'
  time?: string
  event?: string
  witness?: string
  /** 深入事件在片子里也标出来，DM 复盘时提醒玩家「这条当时你们没看到」 */
  deep?: boolean
  /** 真相帧 */
  culprit?: string
  motive?: string
}

/** 事件帧在前、真相帧收尾（没有解析出凶手就没有终幕）。 */
export function buildFrames(
  timeline: TimelineEvent[] | undefined,
  culprit: { character?: string; motive?: string } | null | undefined,
): ReplayFrame[] {
  const frames: ReplayFrame[] = (timeline || []).map((ev) => ({
    kind: 'event' as const,
    time: ev.time,
    event: ev.event,
    witness: ev.witness,
    deep: (ev.visibility || '').includes('深入'),
  }))
  if (culprit?.character) {
    frames.push({ kind: 'truth', culprit: culprit.character, motive: culprit.motive })
  }
  return frames
}

/** 自动播放的步进间隔：讲一句话的工夫，太快看不清、太慢像卡顿 */
export const REPLAY_STEP_MS = 2600
