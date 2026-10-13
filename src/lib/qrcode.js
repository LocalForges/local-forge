// 二维码引擎：补齐 LocalForge 在「二维码 / 条码」上的能力缺口。
//
// 技术选型（全部开源、可本地离线运行、零上传，符合 LocalForge 的隐私模型）：
//   - 生成（Encode）：qrcode（node-qrcode）
//       成熟稳定（1.5.x，周下载量数百万），覆盖 QR 全版本、四档纠错级别 L/M/Q/H，
//       支持自定义尺寸/边距/前景背景色，可输出 Canvas / PNG / SVG；社区久经验证，
//       是多数二维码组件的底层。
//   - 识别（Decode）：优先浏览器原生 BarcodeDetector（Chrome/Edge，零下载、最快）；
//       不支持时回退到 zxing-wasm（ZXing-C++ 官方 C++ 实现编译的 WASM，Sec-ant/zxing-wasm，MIT）。
//       ⚠ 为什么不用更常见的 jsQR / html5-qrcode：jsQR 自 2021 年起已冻结（最后一次发版 2021-04，
//       仅支持 QR 一种码）；html5-qrcode 已宣布"维护模式、寻找新维护者"；nimiq/qr-scanner 已停更。
//       zxing-wasm 是当前「最活跃 + 覆盖 20+ 码制（QR/DataMatrix/Aztec/EAN/UPC/Code128/PDF417…）」
//       的选择，也是多数现代 Vue/React 扫码组件的底层引擎。
//   - WASM 本地化：wasm 走 Vite `?url` 随包产出到 assets/，不依赖 CDN，离线可用（与 ffmpeg 内核策略一致）。

import QRCode from 'qrcode'
import { readBarcodes, prepareZXingModule } from 'zxing-wasm/reader'
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { decodeToImageData } from './image.js'

// 把 zxing 的 wasm 请求指向本地打包产物，而非 CDN（离线可用）。
prepareZXingModule({
  overrides: {
    locateFile: (path, prefix) => (path.endsWith('.wasm') ? zxingWasmUrl : prefix + path),
  },
  equalityFn: Object.is,
})

/* ------------------------------------------------------------------ *
 * 1. 内容类型定义（驱动视图表单，声明式，便于扩展）
 * ------------------------------------------------------------------ */
export const QR_TYPES = [
  {
    id: 'text',
    label: '文本 / 链接',
    icon: 'bi-fonts',
    desc: '任意文字，或粘贴一个网址（扫码后直接打开）',
    build: (d) => String(d.text || '').trim(),
  },
  {
    id: 'url',
    label: '网址',
    icon: 'bi-link-45deg',
    desc: '扫码后跳转到指定网页',
    build: (d) => normalizeUrl(String(d.url || '').trim()),
  },
  {
    id: 'wifi',
    label: 'WiFi',
    icon: 'bi-wifi',
    desc: '扫码即连 WiFi，免手动输密码（最常用）',
    fields: ['ssid', 'password', 'encryption', 'hidden'],
    build: (d) =>
      `WIFI:T:${String(d.encryption || 'WPA')};S:${escapeWifi(d.ssid || '')};P:${escapeWifi(
        d.password || '',
      )};H:${d.hidden ? 'true' : 'false'};;`,
  },
  {
    id: 'vcard',
    label: '名片',
    icon: 'bi-person-badge',
    desc: '扫码一键存入手机通讯录',
    fields: ['name', 'org', 'title', 'tel', 'email', 'url', 'addr'],
    build: (d) => {
      const lines = ['BEGIN:VCARD', 'VERSION:3.0']
      const push = (k, v) => {
        const val = String(v || '').trim()
        if (val) lines.push(`${k}:${val}`)
      }
      push('N', d.name)
      push('FN', d.name)
      push('ORG', d.org)
      push('TITLE', d.title)
      push('TEL', d.tel)
      push('EMAIL', d.email)
      push('URL', normalizeUrl(d.url || ''))
      push('ADR', d.addr)
      lines.push('END:VCARD')
      return lines.join('\n')
    },
  },
  {
    id: 'email',
    label: '邮件',
    icon: 'bi-envelope',
    desc: '扫码后自动打开邮件客户端并填好主题正文',
    fields: ['to', 'subject', 'body'],
    build: (d) => {
      const q = []
      if (d.subject) q.push('subject=' + encodeURIComponent(d.subject))
      if (d.body) q.push('body=' + encodeURIComponent(d.body))
      return 'mailto:' + String(d.to || '').trim() + (q.length ? '?' + q.join('&') : '')
    },
  },
  {
    id: 'phone',
    label: '电话',
    icon: 'bi-telephone',
    desc: '扫码后直接拨号',
    fields: ['tel'],
    build: (d) => 'tel:' + String(d.tel || '').trim().replace(/\s/g, ''),
  },
  {
    id: 'sms',
    label: '短信',
    icon: 'bi-chat-dots',
    desc: '扫码后自动填写号码与短信内容',
    fields: ['tel', 'body'],
    build: (d) => {
      const tel = String(d.tel || '').trim().replace(/\s/g, '')
      const body = d.body ? '?body=' + encodeURIComponent(d.body) : ''
      return 'sms:' + tel + body
    },
  },
  {
    id: 'geo',
    label: '位置',
    icon: 'bi-geo-alt',
    desc: '扫码后在地图上定位到该经纬度',
    fields: ['lat', 'lng'],
    build: (d) => `geo:${String(d.lat || '').trim()},${String(d.lng || '').trim()}`,
  },
]

// QR 码容量上限（版本 40 + L 纠错，UTF-8 约 2953 字节；这里按中文字符保守给提示）
export const QR_MAX_CHARS = { L: 4296, M: 3391, Q: 2420, H: 1852 }

function normalizeUrl(u) {
  if (!u) return ''
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)) return u // 已带协议（含 mailto:/tel: 等）
  return 'https://' + u
}

// WIFI: 载荷规范要求转义 \ ; , : "
function escapeWifi(s) {
  return String(s || '').replace(/([\\;,:"])/g, '\\$1')
}

export function buildPayload(typeId, data) {
  const t = QR_TYPES.find((x) => x.id === typeId) || QR_TYPES[0]
  return t.build(data || {})
}

/* ------------------------------------------------------------------ *
 * 2. 生成（Encode）
 * ------------------------------------------------------------------ */
// 渲染到 canvas；可选在中心合成 Logo。
// 决策：一旦带 Logo，自动把纠错级别提到 H（可恢复 30% 遮挡），保证仍可扫。
export async function renderQrCanvas(text, opts = {}) {
  const {
    ec = 'M',
    size = 512,
    margin = 4,
    dark = '#0b1220',
    light = '#ffffff',
    logo = null, // { image: HTMLImageElement, ratio: 0.2 }
  } = opts
  if (!text) throw new Error('二维码内容为空')

  const effectiveEc = logo && logo.image ? highestEc(ec) : ec
  const canvas = document.createElement('canvas')
  await QRCode.toCanvas(canvas, text, {
    errorCorrectionLevel: effectiveEc,
    width: size,
    margin,
    color: { dark, light },
  })
  if (logo && logo.image) drawLogo(canvas, logo.image, logo.ratio || 0.2)
  return { canvas, ec: effectiveEc }
}

function highestEc(ec) {
  const rank = { L: 1, M: 2, Q: 3, H: 4 }
  const cur = rank[String(ec || 'M').toUpperCase()] || 2
  return cur >= 4 ? String(ec).toUpperCase() : 'H'
}

// 中心 Logo：白底圆角 + 留白，控制占比（默认 20%，上限 25%，超出会明显影响识别率）
function drawLogo(canvas, image, ratio = 0.2) {
  const ctx = canvas.getContext('2d')
  const r = Math.min(0.25, Math.max(0.08, ratio))
  const side = canvas.width * r
  const x = (canvas.width - side) / 2
  const y = (canvas.height - side) / 2
  const pad = side * 0.12
  ctx.save()
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, x - pad, y - pad, side + pad * 2, side + pad * 2, side * 0.16)
  ctx.fill()
  const maxSide = side
  const ratioImg = image.width / image.height
  let w = maxSide
  let h = maxSide
  if (ratioImg > 1) h = maxSide / ratioImg
  else w = maxSide * ratioImg
  ctx.drawImage(image, x + (side - w) / 2, y + (side - h) / 2, w, h)
  ctx.restore()
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function canvasToBlob(canvas, mime = 'image/png') {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas 导出失败（' + mime + '）'))),
      mime,
      undefined,
    )
  })
}

// 输出 SVG 字符串（矢量，印刷不糊）。带 Logo 时以 base64 <image> 内嵌，仍是单文件。
export async function renderQrSvg(text, opts = {}) {
  const {
    ec = 'M',
    margin = 4,
    dark = '#0b1220',
    light = '#ffffff',
    logo = null, // { image: HTMLImageElement, dataUrl: string, ratio }
  } = opts
  if (!text) throw new Error('二维码内容为空')
  const effectiveEc = logo && logo.image ? highestEc(ec) : ec
  const svg = await QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: effectiveEc,
    margin,
    color: { dark, light },
  })
  if (!(logo && logo.image)) return svg

  const m = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)
  const total = m ? Number(m[1]) : 0
  if (!total) return svg
  const side = total * Math.min(0.25, Math.max(0.08, logo.ratio || 0.2))
  const pad = side * 0.12
  const x = (total - side) / 2
  const y = (total - side) / 2
  const inject =
    `<rect x="${x - pad}" y="${y - pad}" width="${side + pad * 2}" height="${side + pad * 2}" rx="${
      side * 0.16
    }" fill="#ffffff"/>` +
    `<image href="${logo.dataUrl}" x="${x}" y="${y}" width="${side}" height="${side}" preserveAspectRatio="xMidYMid meet"/>`
  return svg.replace('</svg>', inject + '</svg>')
}

// 把用户选择的 Logo 文件读成 image + dataUrl（供 canvas 与 SVG 两种输出复用）
export async function loadLogoImage(file) {
  if (!file) return null
  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.onerror = () => reject(new Error('Logo 文件读取失败'))
    fr.readAsDataURL(file)
  })
  const image = await new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error('Logo 不是浏览器可解码的图片（建议 PNG/SVG/JPG）'))
    im.src = dataUrl
  })
  return { image, dataUrl }
}

// 批量生成：每行一个二维码 → [{ name, blob }]
export async function buildBatch(lines, opts = {}) {
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const raw = String(lines[i] || '').trim()
    if (!raw) continue
    const name = opts.nameTemplate ? opts.nameTemplate(raw, i) : safeName(raw, i)
    const { canvas } = await renderQrCanvas(raw, opts)
    const blob = await canvasToBlob(canvas, 'image/png')
    out.push({ name, blob })
  }
  return out
}

function safeName(text, i) {
  const base = String(text).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 24) || 'qr'
  return `${String(i + 1).padStart(3, '0')}-${base}.png`
}

/* ------------------------------------------------------------------ *
 * 3. 识别（Decode）
 * ------------------------------------------------------------------ */
export function supportsNativeDetector() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window
}

// 从 canvas 识别：原生 API 优先（传 canvas），失败或无原生则回退 zxing-wasm（传 ImageData）。
export async function detectFromCanvas(canvas, { useNative = true } = {}) {
  if (!canvas || !canvas.width) throw new Error('画面尚未就绪，无法识别')
  if (useNative && supportsNativeDetector()) {
    try {
      const hits = await new window.BarcodeDetector().detect(canvas)
      if (hits && hits.length) {
        return {
          engine: '原生 BarcodeDetector',
          hits: hits.map((h) => ({ text: h.rawValue, format: h.format })),
        }
      }
    } catch {
      // 原生不可用（如 Safari 部分版本 / 权限限制）→ 静默回退到 wasm
    }
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const res = await readBarcodes(imageData, { tryHarder: true, maxNumberOfSymbols: 5 })
  return {
    engine: 'zxing-wasm',
    hits: (res || [])
      .filter((r) => r.isValid !== false && r.text)
      .map((r) => ({ text: r.text, format: r.format, contentType: r.contentType })),
  }
}

// 识别图片文件：走浏览器解码（<img> + canvas），因此 WebP/AVIF 等浏览器能解的格式都支持。
export async function detectFromFile(file, opts = {}) {
  const img = await decodeToImageData(file)
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  canvas.getContext('2d').putImageData(img, 0, 0)
  const res = await detectFromCanvas(canvas, opts)
  return { ...res, width: img.width, height: img.height }
}

// 摄像头逐帧抽取：video → canvas（按分辨率上限缩放以提升识别速度）
export function grabFrame(video, maxSide = 1024) {
  const vw = video.videoWidth || 640
  const vh = video.videoHeight || 480
  const scale = Math.min(1, maxSide / Math.max(vw, vh))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(vw * scale)
  canvas.height = Math.round(vh * scale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas
}

/* ------------------------------------------------------------------ *
 * 4. 识别结果的"人话"解释（降低理解难度）
 * ------------------------------------------------------------------ */
const WIFI_LABELS = { WPA: 'WPA/WPA2/WPA3', WEP: 'WEP', nopass: '开放网络（无密码）' }

export function describeText(text) {
  const t = String(text || '')
  const wrap = (kind, label, fields, actions = []) => ({ kind, label, fields, actions })

  if (/^WIFI:/i.test(t)) {
    const pick = (k) => {
      const m = new RegExp(`(?:^|;)${k}:([^;]*)`, 'i').exec(t.replace(/^WIFI:/i, ''))
      return m ? unescapeWifi(m[1]) : ''
    }
    const enc = pick('T')
    return wrap('wifi', 'WiFi 网络', [
      { k: '名称 SSID', v: pick('S') },
      { k: '密码', v: pick('P') || '（无）' },
      { k: '加密方式', v: WIFI_LABELS[enc] || enc || '未知' },
      { k: '隐藏网络', v: /true/i.test(pick('H')) ? '是' : '否' },
    ])
  }
  if (/^BEGIN:VCARD/i.test(t)) {
    const pick = (k) => {
      const m = new RegExp(`^${k}[^:]*:?(.*)$`, 'im').exec(t)
      return m ? m[1].trim() : ''
    }
    const fields = [
      { k: '姓名', v: pick('FN') || pick('N') },
      { k: '公司', v: pick('ORG') },
      { k: '职位', v: pick('TITLE') },
      { k: '电话', v: pick('TEL') },
      { k: '邮箱', v: pick('EMAIL') },
      { k: '网址', v: pick('URL') },
      { k: '地址', v: pick('ADR') },
    ].filter((f) => f.v)
    return wrap('vcard', '联系人名片', fields, [{ id: 'vcf', label: '下载 .vcf 名片', icon: 'bi-person-plus' }])
  }
  if (/^https?:\/\//i.test(t)) {
    return wrap('url', '网页链接', [{ k: '地址', v: t }], [
      { id: 'open', label: '打开链接', icon: 'bi-box-arrow-up-right' },
    ])
  }
  if (/^mailto:/i.test(t)) {
    const u = new URL(t)
    return wrap('email', '邮件', [
      { k: '收件人', v: u.pathname || '' },
      { k: '主题', v: u.searchParams.get('subject') || '' },
      { k: '正文', v: u.searchParams.get('body') || '' },
    ].filter((f) => f.v))
  }
  if (/^tel:/i.test(t)) {
    return wrap('phone', '电话号码', [{ k: '号码', v: t.slice(4) }], [
      { id: 'open', label: '拨号', icon: 'bi-telephone-outbound' },
    ])
  }
  if (/^sms:/i.test(t)) {
    const u = new URL(t)
    return wrap('sms', '短信', [
      { k: '号码', v: u.pathname || t.slice(4).split('?')[0] },
      { k: '内容', v: u.searchParams.get('body') || '' },
    ].filter((f) => f.v))
  }
  if (/^geo:/i.test(t)) {
    const [lat, lng] = t.slice(4).split(',')
    return wrap('geo', '地理位置', [
      { k: '纬度', v: lat },
      { k: '经度', v: lng },
    ], [{ id: 'open', label: '在地图上查看', icon: 'bi-map' }])
  }
  return wrap('text', '文本内容', [{ k: '内容', v: t }])
}

function unescapeWifi(s) {
  return String(s || '').replace(/\\([\\;,:"])/g, '$1')
}

/* ------------------------------------------------------------------ *
 * 5. 自检（供回显层调用）：任何子测试失败都原样上报，不静默
 * ------------------------------------------------------------------ */
export async function selfTest() {
  const results = []
  const T = async (id, title, fn) => {
    try {
      const detail = await fn()
      results.push({ id, title, ok: true, detail })
    } catch (e) {
      results.push({ id, title, ok: false, error: { message: e.message, stack: e.stack } })
    }
  }

  // 1) 载荷构造：WiFi 转义 / 名片格式
  await T('payload-wifi', 'WiFi 载荷构造', async () => {
    const p = buildPayload('wifi', { ssid: 'My;WiFi', password: 'a:b\\c', encryption: 'WPA', hidden: true })
    if (!p.startsWith('WIFI:T:WPA;S:My\\;WiFi;P:a\\:b\\\\c;H:true;;')) {
      throw new Error('WiFi 载荷转义不正确：' + p)
    }
    return p
  })
  await T('payload-vcard', '名片载荷构造', async () => {
    const p = buildPayload('vcard', { name: '张三', org: 'LocalForge', tel: '13800000000' })
    if (!/^BEGIN:VCARD\nVERSION:3\.0\n/.test(p) || !p.includes('FN:张三') || !p.endsWith('END:VCARD')) {
      throw new Error('vCard 格式不正确：' + JSON.stringify(p))
    }
    return `${p.split('\n').length} 行`
  })
  await T('payload-url', '网址自动补协议', async () => {
    const p = buildPayload('url', { url: 'example.com' })
    if (p !== 'https://example.com') throw new Error('补协议失败：' + p)
    return p
  })

  // 2) 渲染：PNG / SVG
  const SAMPLE = 'https://github.com/javaeer/local-forge'
  let pngCanvas = null
  await T('render-png', 'PNG 生成', async () => {
    const { canvas } = await renderQrCanvas(SAMPLE, { ec: 'M', size: 256 })
    pngCanvas = canvas
    if (!canvas.width || !canvas.height) throw new Error('画布尺寸为空')
    return `${canvas.width}x${canvas.height}`
  })
  await T('render-svg', 'SVG 生成', async () => {
    const svg = await renderQrSvg(SAMPLE, { ec: 'M' })
    if (!svg.startsWith('<svg') || !svg.includes('</svg>')) throw new Error('SVG 结构不完整')
    return `${svg.length} 字节`
  })

  // 3) Logo 合成（自动升级纠错到 H）
  await T('render-logo', '中心 Logo 合成', async () => {
    const logoImg = await makeSolidImage(64, 64, '#38bdf8')
    const { canvas, ec } = await renderQrCanvas(SAMPLE, { ec: 'M', size: 256, logo: { image: logoImg, ratio: 0.2 } })
    if (ec !== 'H') throw new Error('带 Logo 时未自动升级纠错级别，实际=' + ec)
    const center = canvas.getContext('2d').getImageData(canvas.width / 2 - 4, canvas.height / 2 - 4, 8, 8).data
    let solid = true
    for (let i = 0; i < center.length; i += 4) {
      if (center[i + 3] < 250) solid = false
    }
    if (!solid) throw new Error('Logo 未绘制到画布中心')
    return `纠错级别 ${ec}`
  })

  // 4) 关键闭环：生成 → 识别 → 内容一致（验证 zxing-wasm 真的可用）
  await T('decode-roundtrip', '生成→识别回环', async () => {
    if (!pngCanvas) throw new Error('前置 PNG 生成失败，跳过回环')
    const res = await detectFromCanvas(pngCanvas, { useNative: false }) // 强制走 zxing-wasm 以验证内核
    if (!res.hits.length) throw new Error('未识别到任何码（引擎：' + res.engine + '）')
    if (res.hits[0].text !== SAMPLE) throw new Error('识别内容不一致：' + res.hits[0].text)
    return `${res.engine} → ${res.hits[0].format || 'QRCode'}`
  })

  // 5) 带 Logo 的码仍可识别（验证自动升级纠错确实有效）
  await T('decode-with-logo', '带 Logo 仍可识别', async () => {
    const logoImg = await makeSolidImage(64, 64, '#a78bfa')
    const { canvas } = await renderQrCanvas(SAMPLE, { ec: 'M', size: 320, logo: { image: logoImg, ratio: 0.2 } })
    const res = await detectFromCanvas(canvas, { useNative: false })
    if (!res.hits.length) throw new Error('带 Logo 后无法识别')
    if (res.hits[0].text !== SAMPLE) throw new Error('内容不一致：' + res.hits[0].text)
    return 'Logo 占比 20% 仍正确解码'
  })

  // 6) 结果解析（人情味解释层）
  await T('describe', '识别结果解析', async () => {
    const wifi = describeText('WIFI:T:WPA;S:Office;P:12345678;;')
    if (wifi.kind !== 'wifi' || !wifi.fields.some((f) => f.v === 'Office')) throw new Error('WiFi 解析失败')
    const card = describeText('BEGIN:VCARD\nVERSION:3.0\nFN:李四\nTEL:139\nEND:VCARD')
    if (card.kind !== 'vcard' || !card.fields.some((f) => f.v === '李四')) throw new Error('名片解析失败')
    return 'WiFi / vCard / 链接 均可结构化'
  })

  // 7) 引擎情报（非失败项，仅告知当前环境走哪条识别路径）
  results.push({
    id: 'engine-info',
    title: '识别引擎',
    ok: true,
    detail: supportsNativeDetector()
      ? '浏览器原生 BarcodeDetector 可用（优先走原生，回退 zxing-wasm）'
      : '当前浏览器无原生 BarcodeDetector → 使用 zxing-wasm（ZXing-C++ WASM，已本地打包）',
  })

  return { module: '二维码', items: results }
}

// 造一张纯色图当 Logo / 测试素材
function makeSolidImage(w, h, color) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, w, h)
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error('测试Logo生成失败'))
    im.src = c.toDataURL('image/png')
  })
}
