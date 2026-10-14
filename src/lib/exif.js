// 图片元数据（EXIF）查看与隐私清理引擎 —— 自研，零依赖。
//
// 为什么不用现成库：生态里两个主流选择 exifr（最后更新 2022-05）与 piexifjs（2022-06）
// 均已停更 4 年，而本项目刚在二维码选型上吃过"冻结库"的亏，故改为自研轻量实现：
//   - JPEG：解析 APP1 段内的 TIFF/IFD 结构（EXIF 规范 20 年未变，自研可控且无 CVE 包袱）
//   - PNG：解析 eXIf / tEXt / zTXt / iTXt 文本块
//   - 清理：重写文件，剔除所有 APPn（含 EXIF/IPTC/XMP/ICC）与注释段；PNG 剔除元数据块
// 全程本地处理：照片从不被上传——这本身就是该功能的意义（GPS 位置属于高度敏感信息）。

/* ---------------- JPEG 段解析 ---------------- */
const MARKER_NAMES = {
  0xc0: 'SOF0', 0xc2: 'SOF2', 0xc4: 'DHT', 0xdb: 'DQT', 0xdd: 'DRI',
  0xda: 'SOS', 0xe0: 'APP0(JFIF)', 0xe1: 'APP1(EXIF/XMP)', 0xe2: 'APP2(ICC)',
  0xe3: 'APP3', 0xed: 'APP13(IPTC)', 0xee: 'APP14(Adobe)', 0xfe: 'COM(注释)',
}

// EXIF 标签字典（只列对隐私/信息有价值的，其余显示原始 tag）
const TAGS = {
  0x010e: ['图片描述', 'low'], 0x010f: ['相机厂商', 'low'], 0x0110: ['相机型号', 'low'],
  0x0112: ['方向', 'low'], 0x011a: ['X 分辨率', 'low'], 0x011b: ['Y 分辨率', 'low'],
  0x0131: ['软件', 'mid'], 0x0132: ['修改时间', 'mid'], 0x013b: ['作者', 'mid'],
  0x8298: ['版权', 'mid'], 0x829a: ['曝光时间', 'low'], 0x829d: ['光圈', 'low'],
  0x8827: ['ISO', 'low'], 0x9003: ['拍摄时间', 'mid'], 0x9004: ['数字化时间', 'mid'],
  0x920a: ['焦距', 'low'], 0xa002: ['像素宽', 'low'], 0xa003: ['像素高', 'low'],
  0xa430: ['所有者', 'high'], 0xa431: ['机身序列号', 'high'], 0xa434: ['镜头型号', 'low'],
  0xa435: ['镜头序列号', 'high'], 0x9c9b: ['XPTitle', 'mid'], 0x9c9d: ['XPAuthor', 'mid'],
}
const GPS_TAGS = {
  0x0001: '南北纬', 0x0002: '纬度', 0x0003: '东西经', 0x0004: '经度',
  0x0005: '海拔参考', 0x0006: '海拔', 0x001d: 'GPS 日期', 0x0000: 'GPS 版本',
}
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 }

export function isJpeg(u8) { return u8[0] === 0xff && u8[1] === 0xd8 }
export function isPng(u8) {
  return u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47
}

// 遍历 JPEG 结构，收集段信息并解析 EXIF（容错：任何异常都降级为"未识别"，不让工具崩）
export function parseJpeg(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const segments = []
  let off = 2
  let exif = null
  while (off + 4 <= u8.length) {
    if (u8[off] !== 0xff) { off++; continue }
    const marker = u8[off + 1]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue }
    if (marker === 0xd9) break // EOI
    if (marker === 0xda) {
      segments.push({ marker, name: 'SOS(图像数据)', start: off, length: u8.length - off })
      break
    }
    const len = dv.getUint16(off + 2)
    const name = MARKER_NAMES[marker] || ('APP' + (marker & 0x0f))
    const isMeta = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe
    if (marker === 0xe1 && off + 10 <= u8.length) {
      const sig = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7])
      if (sig === 'Exif') {
        try { exif = parseTiff(u8, dv, off + 10) } catch (e) { exif = { error: e.message } }
      }
    }
    segments.push({ marker, name, start: off, length: len + 2, isMeta })
    off += 2 + len
  }
  return { segments, exif }
}

function parseTiff(u8, dv, tiffStart) {
  const bo = u8[tiffStart] === 0x49 && u8[tiffStart + 1] === 0x49 ? 'LE' : 'BE'
  const le = bo === 'LE'
  const u16 = (o) => dv.getUint16(o, le)
  const u32 = (o) => dv.getUint32(o, le)
  const i32 = (o) => dv.getInt32(o, le)

  const base = tiffStart
  const ifd0 = u32(base + 4)
  const out = { byteOrder: bo, tags: [], gps: null, thumbnail: false }

  const readIFD = (ifdOffset, collector) => {
    if (ifdOffset + 2 > u8.length) return 0
    const n = u16(base + ifdOffset)
    for (let i = 0; i < n; i++) {
      const e = base + ifdOffset + 2 + i * 12
      if (e + 12 > u8.length) break
      const tag = u16(e)
      const type = u16(e + 2)
      const count = u32(e + 4)
      const size = (TYPE_SIZE[type] || 1) * count
      const vOff = size <= 4 ? e + 8 : base + u32(e + 8)
      collector(tag, type, count, vOff)
    }
    return u32(base + ifdOffset + 2 + n * 12)
  }

  const valueOf = (type, count, vOff) => {
    try {
      if (type === 2) {
        let s = ''
        for (let i = 0; i < count && vOff + i < u8.length; i++) {
          const c = u8[vOff + i]
          if (c === 0) break
          s += String.fromCharCode(c)
        }
        return s.trim()
      }
      if (type === 3) return Array.from({ length: Math.min(count, 8) }, (_, i) => u16(vOff + i * 2))
      if (type === 4) return u32(vOff)
      if (type === 9) return i32(vOff)
      if (type === 5) {
        const r = []
        for (let i = 0; i < Math.min(count, 8); i++) {
          const num = u32(vOff + i * 8)
          const den = u32(vOff + i * 8 + 4)
          r.push(den ? num / den : 0)
        }
        return r
      }
      if (type === 10) {
        const r = []
        for (let i = 0; i < Math.min(count, 8); i++) {
          const num = i32(vOff + i * 8)
          const den = i32(vOff + i * 8 + 4)
          r.push(den ? num / den : 0)
        }
        return r
      }
      if (type === 7 || type === 1) return Array.from(u8.slice(vOff, vOff + Math.min(count, 16)))
      return null
    } catch {
      return null
    }
  }

  let exifPtr = 0
  let gpsPtr = 0
  readIFD(ifd0, (tag, type, count, vOff) => {
    if (tag === 0x8769) exifPtr = u32(vOff)
    else if (tag === 0x8825) gpsPtr = u32(vOff)
    else if (tag === 0x0201 || tag === 0x0202) out.thumbnail = true
    else {
      const meta = TAGS[tag] || ['标签 0x' + tag.toString(16), 'low']
      out.tags.push({ tag: '0x' + tag.toString(16), label: meta[0], level: meta[1], value: valueOf(type, count, vOff) })
    }
  })
  if (exifPtr) readIFD(exifPtr, (tag, type, count, vOff) => {
    const meta = TAGS[tag] || ['Exif 0x' + tag.toString(16), 'low']
    out.tags.push({ tag: '0x' + tag.toString(16), label: meta[0], level: meta[1], value: valueOf(type, count, vOff) })
  })
  if (gpsPtr) {
    const raw = {}
    readIFD(gpsPtr, (tag, type, count, vOff) => { raw[tag] = valueOf(type, count, vOff) })
    const lat = dmsToDecimal(raw[0x0002])
    const lng = dmsToDecimal(raw[0x0004])
    if (lat != null && lng != null) {
      const la = /S/i.test(String(raw[0x0001] || '')) ? -lat : lat
      const lo = /W/i.test(String(raw[0x0003] || '')) ? -lng : lng
      out.gps = {
        lat: Number(la.toFixed(6)),
        lng: Number(lo.toFixed(6)),
        altitude: raw[0x0006] != null ? Number(raw[0x0006].toFixed?.(1) ?? raw[0x0006]) : null,
        date: raw[0x001d] || null,
      }
    }
    out.gpsTags = Object.entries(raw).map(([t, v]) => ({
      tag: '0x' + Number(t).toString(16),
      label: GPS_TAGS[Number(t)] || 'GPS 0x' + Number(t).toString(16),
      value: v,
      level: 'high',
    }))
  }
  return out
}

function dmsToDecimal(dms) {
  if (!Array.isArray(dms) || dms.length < 3) return null
  const [d, m, s] = dms
  if (!isFinite(d)) return null
  return d + (m || 0) / 60 + (s || 0) / 3600
}

/* ---------------- PNG 块解析 ---------------- */
export function parsePng(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const chunks = []
  let off = 8
  while (off + 8 <= u8.length) {
    const len = dv.getUint32(off)
    const type = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7])
    const isMeta = ['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'].includes(type)
    let text = null
    if (isMeta && (type === 'tEXt' || type === 'iTXt')) {
      let z = off + 8
      let key = ''
      while (z < off + 8 + len && u8[z] !== 0) key += String.fromCharCode(u8[z++])
      z++
      let val = ''
      for (let i = z; i < off + 8 + Math.min(len, 512); i++) {
        if (u8[i] === 0 && type === 'tEXt') break
        val += String.fromCharCode(u8[i])
      }
      text = { key, value: val }
    }
    chunks.push({ type, start: off, length: len + 12, isMeta, text })
    off += len + 12
    if (type === 'IEND') break
  }
  return { chunks }
}

/* ---------------- 统一入口 ---------------- */
export async function readMetadata(file) {
  const buf = await file.arrayBuffer()
  const u8 = new Uint8Array(buf)
  if (isJpeg(u8)) {
    const { segments, exif } = parseJpeg(u8)
    const metaSegs = segments.filter((s) => s.isMeta)
    const tags = (exif && exif.tags) || []
    const gpsTags = (exif && exif.gpsTags) || []
    return {
      kind: 'jpeg',
      size: file.size,
      hasMeta: metaSegs.length > 0,
      hasExif: !!(exif && tags.length),
      gps: (exif && exif.gps) || null,
      tags: [...gpsTags, ...tags],
      exifError: (exif && exif.error) || null,
      segments: segments.map((s) => ({ name: s.name, length: s.length, isMeta: !!s.isMeta })),
    }
  }
  if (isPng(u8)) {
    const { chunks } = parsePng(u8)
    const meta = chunks.filter((c) => c.isMeta)
    return {
      kind: 'png',
      size: file.size,
      hasMeta: meta.length > 0,
      hasExif: meta.some((c) => c.type === 'eXIf'),
      gps: null,
      tags: meta.filter((c) => c.text).map((c) => ({ tag: c.type, label: 'PNG 文本：' + c.text.key, level: 'mid', value: c.text.value })),
      segments: chunks.map((c) => ({ name: c.type, length: c.length, isMeta: c.isMeta })),
    }
  }
  throw new Error('暂不支持该格式（当前支持 JPEG / PNG）。可先用「图片工具」转换为 JPG 或 PNG 再处理。')
}

export const LEVELS = [
  { id: 'high', label: '高敏感', desc: '精确位置、序列号等，强烈建议清除' },
  { id: 'mid', label: '中敏感', desc: '拍摄时间、作者、软件等' },
  { id: 'low', label: '一般信息', desc: '设备型号、参数等' },
]

// 清理：JPEG 剔除所有 APPn + COM 段；PNG 剔除 eXIf/文本块/tIME。图像数据本身不动（画质无损）。
export async function stripMetadata(file) {
  const buf = await file.arrayBuffer()
  const u8 = new Uint8Array(buf)
  if (isJpeg(u8)) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
    const out = [0xff, 0xd8]
    let off = 2
    let removed = 0
    let removedBytes = 0
    while (off + 4 <= u8.length) {
      if (u8[off] !== 0xff) { off++; continue }
      const marker = u8[off + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue }
      if (marker === 0xd9) break
      if (marker === 0xda) {
        // SOS 之后是熵编码数据：原样保留到文件尾
        for (let i = off; i < u8.length; i++) out.push(u8[i])
        break
      }
      const len = dv.getUint16(off + 2)
      const isMeta = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe
      if (!isMeta) {
        for (let i = off; i < off + 2 + len; i++) out.push(u8[i])
      } else {
        removed++
        removedBytes += 2 + len
      }
      off += 2 + len
    }
    const endsWithEoi = out.length >= 2 && out[out.length - 2] === 0xff && out[out.length - 1] === 0xd9
    if (!endsWithEoi) out.push(0xff, 0xd9)
    return { blob: new Blob([new Uint8Array(out)], { type: 'image/jpeg' }), removed, removedBytes, kind: 'jpeg' }
  }
  if (isPng(u8)) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
    const out = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    let off = 8
    let removed = 0
    let removedBytes = 0
    while (off + 8 <= u8.length) {
      const len = dv.getUint32(off)
      const type = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7])
      const isMeta = ['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'].includes(type)
      if (!isMeta) {
        for (let i = off; i < off + 12 + len; i++) out.push(u8[i])
      } else {
        removed++
        removedBytes += 12 + len
      }
      off += 12 + len
      if (type === 'IEND') break
    }
    return { blob: new Blob([new Uint8Array(out)], { type: 'image/png' }), removed, removedBytes, kind: 'png' }
  }
  throw new Error('暂不支持该格式（当前支持 JPEG / PNG）。')
}

/* ---------------- 自检 ---------------- */
// 造一个带 EXIF（含 GPS）的测试 JPEG，用于验证解析 + 清理闭环。
export function buildTestJpegWithExif(jpegBytes, { make = 'Cam', model = 'X', lat = 35.7, lng = 105.2 } = {}) {
  const tiff = (() => {
    const bytes = []
    const push16 = (v) => bytes.push(v & 255, (v >> 8) & 255)
    const push32 = (v) => bytes.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255)
    const ascii = (s, n) => { const b = [...s].map((c) => c.charCodeAt(0)); while (b.length < n) b.push(0); return b }
    // TIFF header(II)
    bytes.push(0x49, 0x49); push16(42); push32(8)
    // IFD0 @8：3 条目 (Make / Model / GPSIFD)
    push16(3)
    push16(0x010f); push16(2); push32(make.length + 1); bytes.push(...ascii(make, 4)) // inline (<=4)
    push16(0x0110); push16(2); push32(model.length + 1); bytes.push(...ascii(model, 4))
    push16(0x8825); push16(4); push32(1); push32(50) // GPS IFD 位于 50
    push32(0) // no next IFD
    // 填充到 50
    while (bytes.length < 50) bytes.push(0)
    // GPS IFD @50：4 条目
    const latOff = 104
    const lngOff = 128
    push16(4)
    push16(0x0001); push16(2); push32(2); bytes.push(...ascii('N', 4))
    push16(0x0002); push16(5); push32(3); push32(latOff)
    push16(0x0003); push16(2); push32(2); bytes.push(...ascii('E', 4))
    push16(0x0004); push16(5); push32(3); push32(lngOff)
    push32(0)
    while (bytes.length < latOff) bytes.push(0)
    const rational = (v) => {
      const d = Math.floor(v)
      const m = Math.floor((v - d) * 60)
      const s = Math.round(((v - d) * 60 - m) * 60)
      push32(d); push32(1); push32(m); push32(1); push32(s); push32(1)
    }
    rational(lat)
    while (bytes.length < lngOff) bytes.push(0)
    rational(lng)
    return new Uint8Array(bytes)
  })()

  // APP1 段布局：[FF E1][len 2B]["Exif\0\0" 6B][TIFF…]
  // 注意：JPEG 段长度字段只统计"数据部分"，不含 FF E1 这两个字节。
  const app1Len = 6 + tiff.length
  const seg = new Uint8Array(4 + 6 + tiff.length)
  seg[0] = 0xff; seg[1] = 0xe1
  seg[2] = (app1Len >> 8) & 255; seg[3] = app1Len & 255
  const sig = [...'Exif'].map((c) => c.charCodeAt(0))
  seg.set(sig, 4) // 4..7 = "Exif"
  seg[8] = 0; seg[9] = 0 // 8..9 = "\0\0"
  seg.set(tiff, 10)

  const out = new Uint8Array(jpegBytes.length + seg.length)
  out.set(jpegBytes.slice(0, 2), 0)
  out.set(seg, 2)
  out.set(jpegBytes.slice(2), 2 + seg.length)
  return out
}

export async function selfTest() {
  const items = []
  const T = async (id, title, fn) => {
    try {
      const detail = await fn()
      items.push({ id, title, ok: true, detail })
    } catch (e) {
      items.push({ id, title, ok: false, error: { message: e.message, stack: e.stack } })
    }
  }

  const canvasToBlob = (mime) => {
    const c = document.createElement('canvas')
    c.width = 32; c.height = 32
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#38bdf8'; ctx.fillRect(0, 0, 32, 32)
    ctx.fillStyle = '#0b1220'; ctx.fillRect(8, 8, 16, 16)
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('canvas 导出失败：' + mime))), mime, 0.95))
  }

  let jpegBlob = null
  await T('jpeg-plain', '无 EXIF 的 JPEG 解析', async () => {
    jpegBlob = await canvasToBlob('image/jpeg')
    const meta = await readMetadata(new File([jpegBlob], 't.jpg', { type: 'image/jpeg' }))
    if (meta.kind !== 'jpeg') throw new Error('格式识别错误：' + meta.kind)
    if (meta.hasExif) throw new Error('本应无 EXIF，却解析出标签')
    return `段数 ${meta.segments.length}，无 EXIF`
  })

  let withExifFile = null
  await T('exif-parse', 'EXIF / GPS 解析', async () => {
    const raw = new Uint8Array(await jpegBlob.arrayBuffer())
    const withExif = buildTestJpegWithExif(raw, { make: 'Cam', model: 'X', lat: 35.7, lng: 105.2 })
    withExifFile = new File([withExif], 'gps.jpg', { type: 'image/jpeg' })
    const meta = await readMetadata(withExifFile)
    if (!meta.hasExif) throw new Error('未解析出 EXIF（构造数据可能有误）')
    if (!meta.gps) throw new Error('未解析出 GPS')
    const dLat = Math.abs(meta.gps.lat - 35.7)
    const dLng = Math.abs(meta.gps.lng - 105.2)
    if (dLat > 0.01 || dLng > 0.01) throw new Error(`GPS 解析偏差过大：${meta.gps.lat},${meta.gps.lng}`)
    const hasMake = meta.tags.some((t) => t.label === '相机厂商' && String(t.value).includes('Cam'))
    if (!hasMake) throw new Error('未解析出相机厂商')
    return `GPS=${meta.gps.lat},${meta.gps.lng} · 标签 ${meta.tags.length} 项 · 高敏感 ${meta.tags.filter((t) => t.level === 'high').length} 项`
  })

  await T('strip-jpeg', 'JPEG 清理后无 EXIF 且仍可解码', async () => {
    // 前一个用例若失败，这里自己构造素材，避免"连带失败"掩盖真实问题
    if (!withExifFile) {
      const raw = new Uint8Array(await jpegBlob.arrayBuffer())
      withExifFile = new File([buildTestJpegWithExif(raw, { make: 'Cam', model: 'X', lat: 35.7, lng: 105.2 })], 'gps.jpg', { type: 'image/jpeg' })
    }
    const res = await stripMetadata(withExifFile)
    if (res.removed < 1) throw new Error('未移除任何元数据段')
    const meta = await readMetadata(new File([res.blob], 'clean.jpg', { type: 'image/jpeg' }))
    if (meta.hasExif) throw new Error('清理后仍存在 EXIF')
    if (meta.gps) throw new Error('清理后仍存在 GPS')
    // 关键：清理后图片必须还能正常打开
    const { decodeToImageData } = await import('./image.js')
    const img = await decodeToImageData(new File([res.blob], 'clean.jpg', { type: 'image/jpeg' }))
    if (!img.width || !img.height) throw new Error('清理后图片无法解码')
    return `移除 ${res.removed} 段 / ${res.removedBytes}B，清理后仍可解码 ${img.width}x${img.height}`
  })

  await T('strip-png', 'PNG 清理后仍可解码', async () => {
    const png = await canvasToBlob('image/png')
    const before = await readMetadata(new File([png], 't.png', { type: 'image/png' }))
    const res = await stripMetadata(new File([png], 't.png', { type: 'image/png' }))
    const { decodeToImageData } = await import('./image.js')
    const img = await decodeToImageData(new File([res.blob], 'c.png', { type: 'image/png' }))
    if (!img.width) throw new Error('PNG 清理后无法解码')
    return `PNG 块 ${before.segments.length} → 清理 ${res.removed} 个元数据块，解码 ${img.width}x${img.height}`
  })

  await T('unsupported', '不支持格式明确报错', async () => {
    const f = new File([new Uint8Array([1, 2, 3, 4, 5])], 'x.bin', { type: 'application/octet-stream' })
    let msg = ''
    try { await readMetadata(f) } catch (e) { msg = e.message }
    if (!msg) throw new Error('对不支持的格式未报错（应明确提示，而不是静默）')
    return msg
  })

  return { module: '元数据', items }
}
