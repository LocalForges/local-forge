// 大文件友好 IO 工具（A-4）。
//
// 背景：ffmpeg.wasm / tesseract 都把数据写进内存虚拟文件系统（MEMFS），
// 若直接用 `await file.arrayBuffer()`，浏览器会一次性分配整块 ArrayBuffer，
// 与随后写进 MEMFS 的副本叠加，峰值内存接近 2× 文件体积，几 GB 文件直接 OOM。
//
// 本模块提供：
//  - readFileInChunks(file, onChunk)：以文件流分块读取，避免一次性大分配；
//  - toUint8(file)：封装为 Uint8Array（仍返回完整视图，但经由分块拷贝，减少 GC 压力）；
//  - guardSize(file, limit, onWarn)：体积门禁，超过阈值时给出可操作提示；
//  - formatBytes(n)：人类可读体积。

export function formatBytes(n) {
  if (n == null || isNaN(n)) return '—'
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB'
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB'
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB'
  return n + ' B'
}

// 分块读取：优先使用 Blob.stream()（真正流式）；不支持时回退为按 slice 分块。
// onChunk({ chunk, offset, total, done }) 可用于进度回显。
export async function readFileInChunks(file, onChunk, chunkSize = 8 * 1048576) {
  const total = file.size
  const chunks = []

  if (typeof file.stream === 'function' && typeof ReadableStream !== 'undefined') {
    const reader = file.stream().getReader()
    let offset = 0
    let buffered = []
    let bufferedLen = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffered.push(value)
      bufferedLen += value.byteLength
      // 累积到 chunkSize 再合并，避免过碎
      if (bufferedLen >= chunkSize) {
        const merged = new Uint8Array(bufferedLen)
        let p = 0
        for (const b of buffered) { merged.set(b, p); p += b.byteLength }
        chunks.push(merged)
        offset += bufferedLen
        buffered = []
        bufferedLen = 0
        onChunk && onChunk({ offset, total, done: false })
      }
    }
    if (bufferedLen) {
      const merged = new Uint8Array(bufferedLen)
      let p = 0
      for (const b of buffered) { merged.set(b, p); p += b.byteLength }
      chunks.push(merged)
      offset += bufferedLen
      onChunk && onChunk({ offset, total, done: false })
    }
  } else {
    // 回退：按 slice 分块读
    for (let off = 0; off < total; off += chunkSize) {
      const end = Math.min(off + chunkSize, total)
      const buf = new Uint8Array(await file.slice(off, end).arrayBuffer())
      chunks.push(buf)
      onChunk && onChunk({ offset: end, total, done: false })
    }
    if (total === 0) chunks.push(new Uint8Array(0))
  }

  // 合并为单一连续缓冲区（MEMFS 需要连续数据）
  let size = 0
  for (const c of chunks) size += c.byteLength
  const out = new Uint8Array(size)
  let p = 0
  for (const c of chunks) { out.set(c, p); p += c.byteLength }
  onChunk && onChunk({ offset: size, total: size, done: true })
  return out
}

// 便捷封装：直接拿到 Uint8Array（大文件经分块路径，小文件走快路径）。
export async function toUint8(file, onChunk) {
  // 小文件（< 16MB）直接一次读取，省去合并开销
  if (file.size <= 16 * 1048576) {
    const u = new Uint8Array(await file.arrayBuffer())
    onChunk && onChunk({ offset: file.size, total: file.size, done: true })
    return u
  }
  return readFileInChunks(file, onChunk)
}

// 体积门禁：返回 { ok, level, message }。level: 'ok' | 'warn' | 'block'
//  - warn：超过软阈值，提示可能较慢/占内存，但仍允许继续
//  - block：超过硬阈值（默认 2GB，接近 wasm32 4GB 上限与常见设备内存），建议改用其他方式
export function guardSize(file, { soft = 512 * 1048576, hard = 2 * 1073741824 } = {}) {
  const size = (file && file.size) || 0
  if (size >= hard) {
    return {
      ok: false, level: 'block', size,
      message: `文件 ${formatBytes(size)} 过大，浏览器内处理可能导致内存溢出。建议先在桌面端拆分，或改用支持流式的工具。`,
    }
  }
  if (size >= soft) {
    return {
      ok: true, level: 'warn', size,
      message: `文件 ${formatBytes(size)} 较大，处理会占用较多内存且较慢，请保持页面在前台、勿关闭标签页。`,
    }
  }
  return { ok: true, level: 'ok', size, message: '' }
}

// 估算可用性：交叉参考设备内存（若暴露）给出更保守的硬阈值。
export function deviceMemoryGB() {
  const dm = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 0
  return dm || 4 // 未知时保守按 4GB
}
