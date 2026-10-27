
export interface CoverMeta {
  title: string
  genre?: string
  players?: string
  difficulty?: string
  lockScore?: number | null
}

// ───────────────────────── 封面 SVG ─────────────────────────

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export type CoverStyle = 'classic' | 'bloodmoon' | 'casefile' | 'snownight'

export const COVER_STYLES: { key: CoverStyle; label: string }[] = [
  { key: 'classic', label: '暗夜鎏金' },
  { key: 'bloodmoon', label: '血月惊悚' },
  { key: 'casefile', label: '绝密档案' },
  { key: 'snownight', label: '暴雪孤馆' },
]

function coverChrome(sub: string, title: string, extra: string): string {
  return `<text x="450" y="510" text-anchor="middle" font-family="'Noto Serif SC', 'Songti SC', serif" font-size="64" font-weight="700" fill="#efe6cf">${title}</text>
  ${extra}
  ${sub
    .split('\n')
    .map(
      (line, i) =>
        `<text x="450" y="${680 + i * 56}" text-anchor="middle" font-family="'Noto Serif SC', serif" font-size="30" fill="#bfae87">${line}</text>`,
    )
    .join('\n  ')}
  <text x="450" y="1085" text-anchor="middle" font-family="serif" font-size="20" letter-spacing="6" fill="#6f6545">仅供虚构剧本创作 · 诡计依赖虚构设定 · 现实不可复刻</text>`
}

export function coverSVG(meta: CoverMeta, style: CoverStyle = 'classic'): string {
  const title = esc(meta.title).slice(0, 22)
  const rows: string[] = []
  const info: string[] = []
  if (meta.genre) info.push(`题材 ${esc(meta.genre)}`)
  if (meta.players) info.push(`人数 ${esc(meta.players)}`)
  if (meta.difficulty) info.push(`难度 ${esc(meta.difficulty)}`)
  if (info.length) rows.push(info.join('　·　'))
  if (typeof meta.lockScore === 'number') {
    rows.push(`公平性评分 ${meta.lockScore} / 100`)
  }
  const sub = rows.join('\n')

  if (style === 'bloodmoon') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
  <defs>
    <radialGradient id="sky" cx="50%" cy="26%" r="95%">
      <stop offset="0%" stop-color="#2a0708"/><stop offset="55%" stop-color="#140406"/><stop offset="100%" stop-color="#050102"/>
    </radialGradient>
    <radialGradient id="moon" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ff6b4a"/><stop offset="70%" stop-color="#b3161c"/><stop offset="100%" stop-color="#5c0a10"/>
    </radialGradient>
    <linearGradient id="roof" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000"/><stop offset="100%" stop-color="#1a0406"/>
    </linearGradient>
  </defs>
  <rect width="900" height="1200" fill="url(#sky)"/>
  <circle cx="450" cy="330" r="190" fill="url(#moon)" opacity="0.9"/>
  <circle cx="450" cy="330" r="205" fill="none" stroke="#ff8a6a" stroke-width="1" opacity="0.25"/>
  <g fill="#000" opacity="0.85">
    <polygon points="0,830 130,700 260,810 400,690 540,820 680,700 900,830 900,1200 0,1200"/>
  </g>
  <rect x="0" y="830" width="900" height="370" fill="url(#roof)"/>
  <g opacity="0.28" stroke="#ff9a7a" stroke-width="0.8">
    ${Array.from({ length: 22 }, (_, i) => `<line x1="${(i * 47) % 900}" y1="${(i * 61) % 1150}" x2="${(i * 47 + 90) % 900}" y2="${(i * 61 + 24) % 1150}"/>`).join('')}
  </g>
  <text x="450" y="470" text-anchor="middle" font-family="Georgia, serif" font-size="24" letter-spacing="16" fill="#ffb08a" opacity="0.8">MIDNIGHT FILES</text>
  ${coverChrome(sub, title, `<line x1="230" y1="580" x2="670" y2="580" stroke="#ff8a6a" stroke-width="1" opacity="0.5"/>`)
    .replace(/#efe6cf/g, '#ffe9d8')
    .replace(/#bfae87/g, '#d99a80')}
  <rect x="330" y="920" width="240" height="74" fill="none" stroke="#c0392b" stroke-width="4" transform="rotate(-6 450 957)" opacity="0.85"/>
  <text x="450" y="970" text-anchor="middle" font-family="serif" font-size="34" font-weight="700" fill="#c0392b" transform="rotate(-6 450 957)" letter-spacing="8" opacity="0.9">凶案调查中</text>
  <text x="450" y="1160" text-anchor="middle" font-family="serif" font-size="18" letter-spacing="6" fill="#7a4038">仅供虚构剧本创作 · 现实不可复刻</text>
</svg>`
  }

  if (style === 'casefile') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
  <rect width="900" height="1200" fill="#2b2b2b"/>
  <rect x="70" y="60" width="760" height="1080" rx="6" fill="#e8ddc4"/>
  <rect x="70" y="60" width="760" height="1080" rx="6" fill="url(#paper)" opacity="0.35"/>
  <defs>
    <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fff" stop-opacity="0.5"/><stop offset="100%" stop-color="#a09070" stop-opacity="0.6"/>
    </linearGradient>
  </defs>
  <rect x="380" y="20" width="140" height="90" fill="#b9a77e" transform="rotate(-3 450 65)" opacity="0.9"/>
  <line x1="120" y1="180" x2="780" y2="180" stroke="#5a4f38" stroke-width="2" stroke-dasharray="10 6"/>
  <text x="450" y="150" text-anchor="middle" font-family="Courier New, monospace" font-size="24" letter-spacing="10" fill="#5a4f38">CASE FILE No.___</text>
  <g transform="rotate(-12 450 320)">
    <rect x="240" y="270" width="420" height="100" fill="none" stroke="#b3261e" stroke-width="6" opacity="0.75"/>
    <text x="450" y="340" text-anchor="middle" font-family="serif" font-size="52" font-weight="700" fill="#b3261e" letter-spacing="14" opacity="0.8">绝 密</text>
  </g>
  <text x="450" y="510" text-anchor="middle" font-family="'Noto Serif SC', serif" font-size="60" font-weight="700" fill="#2f2a1d">${title}</text>
  <line x1="200" y1="560" x2="700" y2="560" stroke="#8a7a58" stroke-width="1.5"/>
  ${sub
    .split('\n')
    .map(
      (line, i) =>
        `<text x="450" y="${640 + i * 56}" text-anchor="middle" font-family="Courier New, monospace" font-size="28" fill="#4a4132">${line}</text>`,
    )
    .join('\n  ')}
  <g stroke="#5a4f38" stroke-width="1.4" fill="none" opacity="0.8">
    <line x1="130" y1="820" x2="770" y2="820"/><line x1="130" y1="860" x2="770" y2="860"/>
    <line x1="130" y1="900" x2="640" y2="900"/><line x1="130" y1="940" x2="770" y2="940"/>
    <line x1="130" y1="980" x2="540" y2="980"/>
  </g>
  <text x="150" y="806" font-family="Courier New, monospace" font-size="18" fill="#8a7a58">调查笔记 / NOTES:</text>
  <circle cx="740" cy="1040" r="56" fill="none" stroke="#8a7a58" stroke-width="1.5" opacity="0.7"/>
  <text x="740" y="1030" text-anchor="middle" font-family="Courier New, monospace" font-size="15" fill="#8a7a58">TRICK</text>
  <text x="740" y="1054" text-anchor="middle" font-family="Courier New, monospace" font-size="15" fill="#8a7a58">ARCHITECT</text>
  <text x="450" y="1105" text-anchor="middle" font-family="serif" font-size="18" letter-spacing="4" fill="#7a6f52">仅供虚构剧本创作 · 诡计依赖虚构设定 · 现实不可复刻</text>
</svg>`
  }

  if (style === 'snownight') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
  <defs>
    <linearGradient id="night" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0a1628"/><stop offset="60%" stop-color="#0d2137"/><stop offset="100%" stop-color="#050b14"/>
    </linearGradient>
    <linearGradient id="window" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffd98a" stop-opacity="0.9"/><stop offset="100%" stop-color="#c98a3a" stop-opacity="0.7"/>
    </linearGradient>
  </defs>
  <rect width="900" height="1200" fill="url(#night)"/>
  <g fill="#e8f2ff" opacity="0.85">
    ${Array.from({ length: 70 }, (_, i) => `<circle cx="${(i * 131 + 37) % 900}" cy="${(i * 211 + 53) % 1180}" r="${1 + (i % 3) * 0.7}" opacity="${0.25 + ((i * 7) % 60) / 100}"/>`).join('')}
  </g>
  <rect x="70" y="70" width="760" height="1060" fill="none" stroke="#7fa8c9" stroke-width="1.2" opacity="0.4"/>
  <rect x="70" y="70" width="760" height="1060" fill="none" stroke="#7fa8c9" stroke-width="4" opacity="0.12"/>
  <g>
    <rect x="360" y="820" width="180" height="260" fill="url(#window)" opacity="0.85"/>
    <line x1="450" y1="820" x2="450" y2="1080" stroke="#0a1628" stroke-width="8"/>
    <line x1="360" y1="950" x2="540" y2="950" stroke="#0a1628" stroke-width="8"/>
  </g>
  <path d="M 300 1080 L 450 960 L 600 1080 Z" fill="#0d2137" opacity="0.9"/>
  <text x="450" y="240" text-anchor="middle" font-family="Georgia, serif" font-size="24" letter-spacing="18" fill="#9cc4e4" opacity="0.85">WHITE SILENCE</text>
  <text x="450" y="290" text-anchor="middle" font-family="serif" font-size="18" letter-spacing="8" fill="#5f7f9c">雪 夜 孤 馆</text>
  <line x1="250" y1="340" x2="650" y2="340" stroke="#9cc4e4" stroke-width="1" opacity="0.5"/>
  <text x="450" y="450" text-anchor="middle" font-family="'Noto Serif SC', serif" font-size="64" font-weight="700" fill="#eaf4ff">${title}</text>
  <line x1="250" y1="520" x2="650" y2="520" stroke="#9cc4e4" stroke-width="1" opacity="0.5"/>
  ${sub
    .split('\n')
    .map(
      (line, i) =>
        `<text x="450" y="${620 + i * 56}" text-anchor="middle" font-family="'Noto Serif SC', serif" font-size="30" fill="#a8c4dc">${line}</text>`,
    )
    .join('\n  ')}
  <text x="450" y="1160" text-anchor="middle" font-family="serif" font-size="18" letter-spacing="6" fill="#4a6a88">仅供虚构剧本创作 · 现实不可复刻</text>
</svg>`
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
  <defs>
    <radialGradient id="bg" cx="50%" cy="30%" r="90%">
      <stop offset="0%" stop-color="#1d1a14"/>
      <stop offset="100%" stop-color="#0b0a08"/>
    </radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#d8b56a"/>
      <stop offset="100%" stop-color="#a8823d"/>
    </linearGradient>
  </defs>
  <rect width="900" height="1200" fill="url(#bg)"/>
  <rect x="42" y="42" width="816" height="1116" fill="none" stroke="url(#gold)" stroke-width="2" opacity="0.7"/>
  <rect x="54" y="54" width="792" height="1092" fill="none" stroke="#d8b56a" stroke-width="0.6" opacity="0.35"/>
  <text x="450" y="300" text-anchor="middle" font-family="Georgia, serif" font-size="26" letter-spacing="14" fill="#d8b56a" opacity="0.85">TRICK ARCHITECT</text>
  <text x="450" y="345" text-anchor="middle" font-family="serif" font-size="18" letter-spacing="8" fill="#8a7a58">诡 计 建 筑 师</text>
  <line x1="250" y1="400" x2="650" y2="400" stroke="#d8b56a" stroke-width="1" opacity="0.6"/>
  ${coverChrome(sub, title, `<line x1="250" y1="580" x2="650" y2="580" stroke="#d8b56a" stroke-width="1" opacity="0.6"/>`)}
</svg>`
}

// ───────────────────────── 下载工具 ─────────────────────────

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function downloadMarkdown(markdown: string, title: string): void {
  saveBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), `${title}.md`)
}

export function downloadCoverPNG(meta: CoverMeta, style: CoverStyle = 'classic'): void {
  const svg = coverSVG(meta, style)
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const image = new Image()
  image.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = 900
    canvas.height = 1200
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(image, 0, 0, 900, 1200)
    URL.revokeObjectURL(url)
    canvas.toBlob((png) => {
      if (png) saveBlob(png, `${meta.title}·封面.png`)
    }, 'image/png')
  }
  image.onerror = () => {
    // PNG 转换失败时兜底下载原始 SVG
    saveBlob(blob, `${meta.title}·封面.svg`)
    URL.revokeObjectURL(url)
  }
  image.src = url
}

/** AI 生成插画封面：AI 图片打底 + 画布叠加标题/信息文字（AI 画字会崩，文字必须自己画）。 */
export function downloadAICoverPNG(imageDataUrl: string, meta: CoverMeta): void {
  const image = new Image()
  image.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = 900
    canvas.height = 1200
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // cover 模式铺满画布
    const scale = Math.max(900 / image.width, 1200 / image.height)
    const w = image.width * scale
    const h = image.height * scale
    ctx.drawImage(image, (900 - w) / 2, (1200 - h) / 2, w, h)
    // 上下暗色渐晕，保证文字可读
    const shade = ctx.createLinearGradient(0, 0, 0, 1200)
    shade.addColorStop(0, 'rgba(5,8,16,0.55)')
    shade.addColorStop(0.45, 'rgba(5,8,16,0.05)')
    shade.addColorStop(0.8, 'rgba(5,8,16,0.72)')
    shade.addColorStop(1, 'rgba(5,8,16,0.9)')
    ctx.fillStyle = shade
    ctx.fillRect(0, 0, 900, 1200)
    // 描边双框
    ctx.strokeStyle = 'rgba(216,181,106,0.8)'
    ctx.lineWidth = 3
    ctx.strokeRect(36, 36, 828, 1128)
    ctx.strokeStyle = 'rgba(216,181,106,0.35)'
    ctx.lineWidth = 1
    ctx.strokeRect(48, 48, 804, 1104)
    // 顶部眉题
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(216,181,106,0.9)'
    ctx.font = '24px Georgia, serif'
    const spaced = 'TRICK ARCHITECT'.split('').join(' ')
    ctx.fillText(spaced, 450, 130)
    // 主标题（带描影）
    ctx.font = "700 72px 'Noto Serif SC', 'Songti SC', serif"
    ctx.shadowColor = 'rgba(0,0,0,0.8)'
    ctx.shadowBlur = 16
    ctx.fillStyle = '#f2e8d2'
    const title = meta.title.slice(0, 12)
    ctx.fillText(title, 450, 620)
    ctx.shadowBlur = 0
    ctx.strokeStyle = 'rgba(216,181,106,0.85)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(250, 680)
    ctx.lineTo(650, 680)
    ctx.stroke()
    // 信息行
    const info: string[] = []
    if (meta.genre) info.push(`题材 ${meta.genre}`)
    if (meta.players) info.push(`人数 ${meta.players}`)
    if (meta.difficulty) info.push(`难度 ${meta.difficulty}`)
    if (typeof meta.lockScore === 'number') info.push(`公平性评分 ${meta.lockScore}/100`)
    ctx.font = "30px 'Noto Serif SC', serif"
    ctx.fillStyle = '#cbb88f'
    ctx.fillText(info.join('　·　'), 450, 760)
    ctx.font = "18px serif"
    ctx.fillStyle = 'rgba(203,184,143,0.6)'
    ctx.fillText('仅供虚构剧本创作 · 诡计依赖虚构设定 · 现实不可复刻', 450, 1130)
    canvas.toBlob((png) => {
      if (png) saveBlob(png, `${meta.title}·AI封面.png`)
    }, 'image/png')
  }
  image.src = imageDataUrl
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

