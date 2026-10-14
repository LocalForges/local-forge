// 文件哈希与重复文件查找引擎。
//
// 选型：hash-wasm（MIT，活跃维护 v4.x）—— 把各算法的 C 实现编译为 WASM，
//   wasm 以 base64 内嵌在 JS 里，不需要额外网络请求，离线可用（符合 LocalForge 隐私/离线模型）。
// 为什么不全用浏览器原生 Web Crypto：它只有 SHA-1/SHA-256/SHA-384/SHA-512，
//   而校验场景绕不开 MD5（旧资源）、CRC32（ZIP 内部值）、xxHash/BLAKE3（高速去重）。
// 全部在本地计算：文件内容从不上传，也不写入临时文件。

import {
  createMD5, createSHA1, createSHA256, createSHA512,
  createCRC32, createXXHash32, createXXHash128, createBLAKE3,
} from 'hash-wasm'

export const ALGOS = [
  { id: 'crc32', label: 'CRC32', note: 'ZIP 内部校验值，比对压缩包常用' },
  { id: 'md5', label: 'MD5', note: '最通用的旧校验值（仅校验用，不安全）' },
  { id: 'sha1', label: 'SHA-1', note: '较旧的校验值（仅校验用）' },
  { id: 'sha256', label: 'SHA-256', note: '当前主流：完整性校验首选（推荐）' },
  { id: 'sha512', label: 'SHA-512', note: '更长摘要，校验更严格' },
  { id: 'xxhash128', label: 'xxHash128', note: '极快非加密哈希，适合大量文件去重' },
  { id: 'blake3', label: 'BLAKE3', note: '现代高速哈希，速度快且安全' },
]

const FACTORY = {
  crc32: createCRC32,
  md5: createMD5,
  sha1: createSHA1,
  sha256: createSHA256,
  sha512: createSHA512,
  xxhash32: createXXHash32,
  xxhash128: createXXHash128,
  blake3: createBLAKE3,
}

const CHUNK = 4 * 1024 * 1024

// 流式分块哈希：不一次性把文件读进内存，支持 GB 级文件。
export async function hashFile(file, algos = ['sha256', 'md5'], onprogress) {
  if (!file) throw new Error('未选择文件')
  if (!file.size && file.size !== 0) throw new Error('无法读取文件大小')
  const list = Array.isArray(algos) ? algos : [algos]
  const hs = []
  for (const id of list) {
    const f = FACTORY[id]
    if (!f) throw new Error('不支持的算法：' + id)
    const h = await f()
    h.init()
    hs.push({ id, h })
  }
  let off = 0
  while (off < file.size) {
    const end = Math.min(off + CHUNK, file.size)
    const buf = await file.slice(off, end).arrayBuffer()
    const u8 = new Uint8Array(buf)
    for (const x of hs) x.h.update(u8)
    off = end
    if (onprogress) onprogress(file.size ? Math.min(99, Math.round((off / file.size) * 100)) : 100)
  }
  const out = {}
  for (const x of hs) out[x.id] = x.h.digest()
  if (onprogress) onprogress(100)
  return out
}

// 短文本哈希（同步不了——wasm 是异步，故仍返回 Promise；小数据可忽略耗时）
export async function hashText(text, algos = ['sha256', 'md5']) {
  const bytes = new TextEncoder().encode(String(text || ''))
  const out = {}
  for (const id of algos) {
    const f = FACTORY[id]
    if (!f) throw new Error('不支持的算法：' + id)
    const h = await f()
    h.init()
    h.update(bytes)
    out[id] = h.digest()
  }
  return out
}

// 重复文件查找：先按「文件大小」粗筛（同大小才可能是同一文件），再对候选算哈希精确比对。
// 这样避免对全部文件做哈希，几千个文件也能在可接受时间内跑完。
export async function findDuplicates(files, { algo = 'sha256', onprogress } = {}) {
  const list = (files || []).filter((f) => f && f.size > 0)
  const bySize = new Map()
  for (const f of list) {
    const k = f.size
    if (!bySize.has(k)) bySize.set(k, [])
    bySize.get(k).push(f)
  }
  const candidates = [...bySize.values()].filter((g) => g.length > 1)
  const todo = candidates.reduce((s, g) => s + g.length, 0) || 1
  let done = 0
  const groups = []
  for (const g of candidates) {
    const byHash = new Map()
    for (const f of g) {
      const r = await hashFile(f, [algo])
      const key = r[algo]
      if (!byHash.has(key)) byHash.set(key, [])
      byHash.get(key).push(f)
      done++
      if (onprogress) onprogress(Math.min(99, Math.round((done / todo) * 100)))
    }
    for (const [hash, arr] of byHash) {
      if (arr.length > 1) {
        groups.push({
          hash,
          size: arr[0].size,
          count: arr.length,
          wasted: arr[0].size * (arr.length - 1),
          files: arr.map((f) => ({ name: f.name, size: f.size })),
        })
      }
    }
  }
  if (onprogress) onprogress(100)
  groups.sort((a, b) => b.wasted - a.wasted)
  return { scanned: list.length, groups, algo }
}

// 自研自检：用广为人知的固定向量（abc / 空串）验证内核，避免"算出来的值没人知道对不对"。
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

  await T('md5-vector', 'MD5 固定向量', async () => {
    const r = await hashText('abc', ['md5'])
    if (r.md5 !== '900150983cd24fb0d6963f7d28e17f72') throw new Error('MD5 不符：' + r.md5)
    return r.md5
  })
  await T('sha1-vector', 'SHA-1 固定向量', async () => {
    const r = await hashText('abc', ['sha1'])
    if (r.sha1 !== 'a9993e364706816aba3e25717850c26c9cd0d89d') throw new Error('SHA-1 不符：' + r.sha1)
    return r.sha1
  })
  await T('sha256-vector', 'SHA-256 固定向量', async () => {
    const r = await hashText('abc', ['sha256'])
    if (r.sha256 !== 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') {
      throw new Error('SHA-256 不符：' + r.sha256)
    }
    const empty = await hashText('', ['sha256'])
    if (empty.sha256 !== 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') {
      throw new Error('空串 SHA-256 不符：' + empty.sha256)
    }
    return 'abc + 空串 均正确'
  })
  await T('utf8', '中文/UTF-8 哈希', async () => {
    const a = await hashText('会宁县会师镇', ['sha256'])
    const b = await hashText('会宁县会师镇', ['sha256'])
    if (a.sha256 !== b.sha256) throw new Error('相同中文两次哈希结果不一致')
    if (!/^[0-9a-f]{64}$/.test(a.sha256)) throw new Error('摘要格式异常：' + a.sha256)
    return a.sha256.slice(0, 16) + '…'
  })
  await T('file-chunked', '文件分块哈希', async () => {
    // 造一个 3MB 文件（超过单个 CHUNK 的 4MB? 不超；再补一个 9MB 验证跨块拼接）
    const big = new Uint8Array(9 * 1024 * 1024)
    for (let i = 0; i < big.length; i++) big[i] = i & 255
    const file = new File([big], 'big.bin', { type: 'application/octet-stream' })
    const r = await hashFile(file, ['sha256', 'md5'])
    // 与一次性喂给 wasm 的结果对照（验证分块拼接正确）
    const h = await createSHA256()
    h.init()
    h.update(big)
    const one = h.digest()
    if (r.sha256 !== one) throw new Error(`分块(${r.sha256}) 与整体(${one}) 不一致`)
    return `9MB 跨块一致：${r.sha256.slice(0, 16)}…`
  })
  await T('dedupe', '重复文件查找', async () => {
    const a = new File([new Uint8Array([1, 2, 3, 4])], 'a.bin')
    const b = new File([new Uint8Array([1, 2, 3, 4])], 'b-copy.bin') // 与 a 同内容
    const c = new File([new Uint8Array([1, 2, 3, 5])], 'c.bin') // 同大小不同内容
    const d = new File([new Uint8Array([1, 2, 3])], 'd.bin') // 大小不同直接排除
    const res = await findDuplicates([a, b, c, d], { algo: 'sha256' })
    if (res.groups.length !== 1) throw new Error('应找到 1 组重复，实际 ' + res.groups.length)
    const names = res.groups[0].files.map((f) => f.name).sort()
    if (names.join(',') !== 'a.bin,b-copy.bin') throw new Error('重复组成员不对：' + names.join(','))
    return `扫描 ${res.scanned} 个 → 1 组重复（含同大小不同内容的正确排除）`
  })
  await T('multi-algo', '多算法并行输出', async () => {
    const r = await hashText('LocalForge', ['md5', 'sha1', 'sha256', 'crc32', 'xxhash128', 'blake3'])
    const keys = Object.keys(r)
    if (keys.length !== 6) throw new Error('应输出 6 个算法，实际 ' + keys.length)
    for (const k of keys) if (!r[k]) throw new Error('算法 ' + k + ' 结果为空')
    return keys.join(' / ')
  })

  return { module: '哈希', items }
}
