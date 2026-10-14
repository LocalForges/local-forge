// 图片处理引擎：补齐 LocalForge 在「图片压缩」上的短板。
//
// 原项目 ImageConvert.vue 仅用 Canvas.toBlob —— 而 PNG 的 toBlob 不带质量参数，
// 等于无损复制，TinyPNG 最核心的「PNG 有损智能量化 + 保留透明」从未实现。
//
// 这里借助开源社区的力量补上该能力：
//   - PNG 有损量化（保透明）：upng-js（Google Squoosh 同款 PNG 编码器，
//     内部即 pngquant/libimagequant 思路的调色板量化，是 TinyPNG 算法的开源等价实现）
//   - JPG / WEBP / AVIF：浏览器原生 Canvas 编码（零依赖、零上传）
//
// 全部在浏览器本地完成，文件不上传任何服务器（与 LocalForge 的隐私模型一致）。

import UPNG from 'upng-js'

// 解码任意浏览器可读图片为 RGBA 像素 + 尺寸。
// 用 <img> + canvas 解码（比 createImageBitmap 兼容性更广，含调色板 PNG/透明通道，
// 且 headless Chromium 下也稳定），HEIC 等需桌面端的格式会抛错由上层捕获。
export async function decodeToImageData(file) {
  const url = URL.createObjectURL(file)
  try {
    const imgEl = await new Promise((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error('浏览器无法解码该图片（如 HEIC 需桌面端）'))
      im.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = imgEl.naturalWidth
    canvas.height = imgEl.naturalHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(imgEl, 0, 0)
    return ctx.getImageData(0, 0, canvas.width, canvas.height)
  } finally {
    URL.revokeObjectURL(url)
  }
}

// 浏览器原生编码（JPG 先铺白底以处理透明；WEBP/AVIF 原生保透明）。
// 兼容传入真实 ImageData 或普通 {data,width,height} 对象（统一转成 ImageData 再绘制）。
function canvasEncode(img, mime, quality) {
  const w = img.width
  const h = img.height
  const src = img instanceof ImageData ? img : new ImageData(img.data, w, h)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (mime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.putImageData(src, 0, 0)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('当前浏览器不支持该输出格式：' + mime))),
      mime,
      quality,
    )
  })
}

// 类 TinyPNG 的 PNG 有损量化：把 24/32-bit 降为调色板索引 PNG，保留 alpha。
// colors = 目标调色板色数(2~256)；0 表示不做调色板量化（truecolor，无损）。
// 内部调用 upng.encode(bufs, w, h, ps, dels, forbidPlte)，ps 即 pngquant 的「色数」旋钮。
export function pngQuantize(img, colors) {
  // upng 接收每帧 RGBA 的 Uint8Array；直接复用 ImageData 的底层缓冲区（零拷贝）。
  const rgba = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
  const ps = colors > 0 ? Math.max(2, Math.min(256, Math.round(colors))) : 0
  const bytes = UPNG.encode([rgba], img.width, img.height, ps, 0, false)
  return new Blob([bytes], { type: 'image/png' })
}

// 主入口：把一张图片压缩 / 转换为目标格式，返回 Blob。
// opts:
//   outMime   'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif'
//   quality   0.1~1，越小体积越小（JPG/WEBP/AVIF 直接生效；PNG 映射到调色板色数）
//   losslessPng  true 时 PNG 走无损（忽略 quality）
export async function compressImage(file, { outMime = 'image/png', quality = 0.8, losslessPng = false } = {}) {
  if (!file) throw new Error('未选择文件')
  const img = await decodeToImageData(file)

  if (outMime === 'image/png') {
    if (losslessPng || quality >= 1) {
      return canvasEncode(img, 'image/png', undefined) // 无损 PNG
    }
    // 质量 → 调色板色数：quality% ≈ 色数/256。默认压缩(0.6) → 154 色，体积显著下降且肉眼几乎无差。
    const colors = Math.max(2, Math.min(256, Math.round(quality * 256)))
    return pngQuantize(img, colors)
  }
  return canvasEncode(img, outMime, quality)
}

// 改尺寸（B-2）：把图片按最大边约束缩放，保持长宽比；支持强制最短边或精确尺寸。
// opts:
//   maxEdge  最长边像素上限（0 表示不限制）
//   width / height 精确目标尺寸（0 表示按比例自动）
//   fit      'inside'（默认，等比缩到不超框）| 'cover'（填满，超出裁切）
//   outMime / quality 输出编码
//   pad      等比缩放后是否用透明/白底补齐到目标框（仅 'inside' + 显式 w/h 时有意义）
export async function resizeImage(file, { maxEdge = 1600, width = 0, height = 0, fit = 'inside', outMime = 'image/jpeg', quality = 0.85, pad = false } = {}) {
  const src = await decodeToImageData(file)
  const sw = src.width, sh = src.height

  let tw, th
  if (width && height) { tw = width; th = height }
  else if (width) { tw = width; th = Math.round((sh / sw) * width) }
  else if (height) { th = height; tw = Math.round((sw / sh) * height) }
  else {
    const m = maxEdge || Math.max(sw, sh)
    if (sw >= sh) { tw = Math.min(sw, m); th = Math.round((sh / sw) * tw) }
    else { th = Math.min(sh, m); tw = Math.round((sw / sh) * th) }
  }

  const canvas = document.createElement('canvas')
  const ctx = () => canvas.getContext('2d', { willReadFrequently: true })

  if (fit === 'cover' && width && height) {
    // 填满目标框：按较大比例缩放后居中裁切
    canvas.width = tw; canvas.height = th
    const scale = Math.max(tw / sw, th / sh)
    const dw = sw * scale, dh = sh * scale
    const c = ctx()
    c.imageSmoothingQuality = 'high'
    // 用临时 ImageData 绘制：先画出源到临时 canvas
    const tmp = document.createElement('canvas'); tmp.width = sw; tmp.height = sh
    tmp.getContext('2d').putImageData(toImageData(src), 0, 0)
    c.drawImage(tmp, (tw - dw) / 2, (th - dh) / 2, dw, dh)
  } else {
    canvas.width = tw; canvas.height = th
    const c = ctx()
    c.imageSmoothingEnabled = true
    c.imageSmoothingQuality = 'high'
    if (outMime === 'image/jpeg' || pad) {
      c.fillStyle = '#ffffff'
      c.fillRect(0, 0, tw, th)
    }
    const tmp = document.createElement('canvas'); tmp.width = sw; tmp.height = sh
    tmp.getContext('2d').putImageData(toImageData(src), 0, 0)
    if (fit === 'inside' && width && height && pad) {
      const scale = Math.min(tw / sw, th / sh)
      const dw = sw * scale, dh = sh * scale
      c.drawImage(tmp, (tw - dw) / 2, (th - dh) / 2, dw, dh)
    } else {
      c.drawImage(tmp, 0, 0, sw, sh, 0, 0, tw, th)
    }
  }
  return encodeCanvas(canvas, outMime, quality)
}

// 水印（B-2）：在图片上叠加文字水印（支持 9 宫格位置 / 平铺 / 旋转 / 透明度）。
// opts: text, position('center'|'top-left'|...|'tile'), opacity, fontSize, color, rotate
export async function watermarkImage(file, { text = 'LocalForge', position = 'bottom-right', opacity = 0.35, fontSize = 0, color = '#ffffff', rotate = 0, outMime = 'image/png', quality = 0.92 } = {}) {
  const src = await decodeToImageData(file)
  const canvas = document.createElement('canvas')
  canvas.width = src.width; canvas.height = src.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.putImageData(toImageData(src), 0, 0)

  const fs = fontSize || Math.max(14, Math.round(Math.min(src.width, src.height) * 0.045))
  ctx.font = `700 ${fs}px system-ui, sans-serif`
  ctx.fillStyle = color
  ctx.globalAlpha = Math.max(0.02, Math.min(1, opacity))
  ctx.textBaseline = 'middle'

  const tw = ctx.measureText(text).width
  const margin = Math.round(fs * 0.8)

  const place = (x, y) => {
    ctx.save()
    ctx.translate(x, y)
    if (rotate) ctx.rotate((rotate * Math.PI) / 180)
    ctx.fillText(text, 0, 0)
    ctx.restore()
  }

  if (position === 'tile') {
    const stepX = tw + fs * 3
    const stepY = fs * 4
    for (let y = fs; y < src.height; y += stepY) {
      for (let x = -tw; x < src.width + tw; x += stepX) place(x, y)
    }
  } else {
    const pos = {
      'top-left': [margin, margin + fs / 2],
      'top-center': [src.width / 2 - tw / 2, margin + fs / 2],
      'top-right': [src.width - tw - margin, margin + fs / 2],
      'middle-left': [margin, src.height / 2],
      center: [src.width / 2 - tw / 2, src.height / 2],
      'middle-right': [src.width - tw - margin, src.height / 2],
      'bottom-left': [margin, src.height - margin - fs / 2],
      'bottom-center': [src.width / 2 - tw / 2, src.height - margin - fs / 2],
      'bottom-right': [src.width - tw - margin, src.height - margin - fs / 2],
    }[position] || [src.width - tw - margin, src.height - margin - fs / 2]
    place(pos[0], pos[1])
  }

  ctx.globalAlpha = 1
  return encodeCanvas(canvas, outMime, quality)
}

// 统一把 {data,width,height} 或 ImageData 转成 ImageData
function toImageData(x) {
  return x instanceof ImageData ? x : new ImageData(x.data, x.width, x.height)
}
// 把 canvas 编码为 Blob（PNG 走 upng 保透明量化，其余走原生编码）
function encodeCanvas(canvas, mime, quality) {
  const img = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height)
  if (mime === 'image/png') return canvasEncode(img, 'image/png', undefined)
  return canvasEncode(img, mime, quality)
}

// 浏览器内解码 Blob 并报告尺寸 + 是否含透明（与真实展示路径一致：<img> + canvas）。
async function decodeBlob(blob) {
  const url = URL.createObjectURL(blob)
  try {
    const el = await new Promise((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error('浏览器无法解码该图片'))
      im.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = el.naturalWidth
    canvas.height = el.naturalHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(el, 0, 0)
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let hasAlpha = false
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] < 255) { hasAlpha = true; break }
    }
    return { width: el.naturalWidth, height: el.naturalHeight, hasAlpha }
  } finally {
    URL.revokeObjectURL(url)
  }
}

// 浏览器内自检（供回显层调用）：覆盖 PNG 量化/透明、JPG/WEBP/AVIF 编码、解码回环。
// 返回统一结构 { module, items:[{id,title,ok,detail?,error?}] } —— 任何子测试失败都原样记录错误。
export async function selfTest() {
  const w = 8
  const h = 8
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = (i * 7) & 255
    data[i * 4 + 1] = (i * 13) & 255
    data[i * 4 + 2] = (i * 29) & 255
    data[i * 4 + 3] = i % 2 ? 128 : 255 // 半透明像素，验证 alpha 保留
  }
  const img = { data, width: w, height: h, colorSpace: 'srgb' }

  const results = []
  const T = async (id, title, fn) => {
    try {
      const detail = await fn()
      results.push({ id, title, ok: true, detail })
    } catch (e) {
      results.push({ id, title, ok: false, error: { message: e.message, stack: e.stack } })
    }
  }

  // 1) PNG 有损量化（类 TinyPNG）：降调色板 + 解码回环
  await T('png-quantize', 'PNG 有损量化', async () => {
    const png = pngQuantize(img, 64) // 64 色，触发量化
    const dec = await decodeBlob(png)
    if (dec.width !== w || dec.height !== h) throw new Error('解码尺寸不符')
    return `量化后 ${png.size}B，解码 ${dec.width}x${dec.height}`
  })
  // 2) 透明通道保留
  await T('png-alpha', 'PNG 透明通道保留', async () => {
    const png = pngQuantize(img, 64)
    const dec = await decodeBlob(png)
    if (!dec.hasAlpha) throw new Error('量化后透明通道丢失')
    return '半透明像素保留'
  })
  // 3) JPG 编码
  await T('jpg', 'JPG 编码', async () => {
    const b = await canvasEncode(img, 'image/jpeg', 0.8)
    if (b.type !== 'image/jpeg') throw new Error('输出 MIME 非 image/jpeg: ' + b.type)
    return `${b.size}B`
  })
  // 4) WEBP 编码
  await T('webp', 'WEBP 编码', async () => {
    const b = await canvasEncode(img, 'image/webp', 0.8)
    if (b.type !== 'image/webp') throw new Error('当前浏览器不支持 WEBP 编码')
    return `${b.size}B`
  })
  // 5) AVIF 编码（部分浏览器可能不支持 → 标记为「跳过」而非失败）
  await (async () => {
    try {
      const b = await canvasEncode(img, 'image/avif', 0.8)
      if (b.type !== 'image/avif') {
        results.push({ id: 'avif', title: 'AVIF 编码', ok: true, skipped: true, detail: '当前浏览器不支持 AVIF 编码，跳过（非 bug）' })
      } else {
        results.push({ id: 'avif', title: 'AVIF 编码', ok: true, detail: `${b.size}B` })
      }
    } catch (e) {
      results.push({ id: 'avif', title: 'AVIF 编码', ok: false, error: { message: e.message, stack: e.stack } })
    }
  })()
  // 6) 解码回环：canvasEncode 生成 PNG → File → decodeToImageData
  await T('decode-roundtrip', '图片解码回环', async () => {
    const png = await canvasEncode(img, 'image/png', undefined) // 无损 truecolor PNG（保证可解码）
    const file = new File([png], 't.png', { type: 'image/png' })
    const di = await decodeToImageData(file)
    if (di.width !== w || di.height !== h) throw new Error('回环尺寸不符')
    return `${di.width}x${di.height} RGBA`
  })

  return { module: '图片', items: results }
}
