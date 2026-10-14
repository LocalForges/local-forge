// 音视频转换（纯前端，基于 @ffmpeg/ffmpeg 多线程内核）。
// 优先级：本地多线程内核 /ffmpeg（需 SharedArrayBuffer）→ 本地单线程内核 /ffmpeg-st
// （不需跨源隔离，兼容性最好）→ CDN 多线程。单线程回退保证无 SharedArrayBuffer 的浏览器也能用。
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'

const ffmpeg = new FFmpeg()
let loaded = false

export function onProgress(cb) {
  ffmpeg.on('progress', ({ progress: p }) => { if (p && p > 0 && p < 1) cb(Math.round(p * 100)) })
}

// 内核偏好：'auto' = 多线程→单线程→CDN；'st' = 直接单线程（自检环境更稳、更快）
let corePreference = 'auto'
export function setCorePreference(p) {
  corePreference = p === 'st' ? 'st' : 'auto'
}

// 内核 URL 构造器。必须定义在 loadCore 之前——否则函数体内的 const 处于 TDZ，
// 提前调用会抛 ReferenceError 并被下面的 try/catch 静默吞掉，导致误回落到多线程内核而卡死。
const mtURLs = async (b) => ({
  coreURL: await toBlobURL(`${b}/ffmpeg-core.js`, 'text/javascript'),
  wasmURL: await toBlobURL(`${b}/ffmpeg-core.wasm`, 'application/wasm'),
  workerURL: await toBlobURL(`${b}/ffmpeg-core.worker.js`, 'text/javascript'),
})
const stURLs = async (b) => ({
  coreURL: await toBlobURL(`${b}/ffmpeg-core.js`, 'text/javascript'),
  wasmURL: await toBlobURL(`${b}/ffmpeg-core.wasm`, 'application/wasm'),
})

async function loadCore() {
  if (loaded) return
  // 0) 调用方显式要求单线程（自检环境更稳，避免多线程内核在无 SharedArrayBuffer 时挂起）
  if (corePreference === 'st') {
    try { await ffmpeg.load(await stURLs('/ffmpeg-st')); loaded = true; return }
    catch (e) { console.warn('[media] 单线程内核加载失败，回退自动选择：', e) }
  }
  // 1) 多线程（需跨源隔离）
  if (self.crossOriginIsolated) {
    try { await ffmpeg.load(await mtURLs('/ffmpeg')); loaded = true; return }
    catch (e) { console.warn('[media] 多线程内核加载失败，回退单线程：', e) }
  }
  // 2) 单线程（兼容性好，无需 SharedArrayBuffer）
  try { await ffmpeg.load(await stURLs('/ffmpeg-st')); loaded = true; return }
  catch (e) { console.warn('[media] 本地单线程内核加载失败，回退 CDN：', e) }
  // 3) CDN 多线程
  await ffmpeg.load(await mtURLs('https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.10/dist/esm'))
  loaded = true
}

// 显式触发内核加载（供自检 / 视图预热使用）
export async function ensureMediaCore() {
  await loadCore()
  return coreMode()
}

// 进阶能力所需的底层接口：写输入 + 执行任意参数 + 一次性取回多个输出文件。
// 与 convertMedia 共用同一个 ffmpeg 实例（内核只加载一次）。
export async function writeMediaFile(name, data) {
  await loadCore()
  await ffmpeg.writeFile(name, data)
}
export async function execMedia(args, outFiles = []) {
  await loadCore()
  await ffmpeg.exec(args)
  const out = []
  for (const f of outFiles) {
    const data = await ffmpeg.readFile(f.name)
    out.push({ name: f.name, blob: new Blob([data.buffer], { type: f.mime || 'application/octet-stream' }) })
  }
  return out
}
// 只读回已存在的输出文件（不执行任何命令）。
// 注意：不能用 exec 空参数来"读文件"——ffmpeg 无输入时会打印帮助并以非 0 退出，exec 会 reject。
export async function readMediaFiles(files) {
  const out = []
  for (const f of files) {
    try {
      const data = await ffmpeg.readFile(f.name)
      out.push({ name: f.name, blob: new Blob([data.buffer], { type: f.mime || 'application/octet-stream' }) })
    } catch {
      out.push({ name: f.name, blob: null })
    }
  }
  return out
}
// 删除虚拟文件系统里的临时文件（避免多次操作后堆积）
export async function unlinkMediaFiles(names) {
  for (const n of names) {
    try { await ffmpeg.deleteFile(n) } catch { /* 不存在则忽略 */ }
  }
}
export function coreMode() {
  return { loaded, isolated: !!self.crossOriginIsolated }
}

// 运行一次转换：writeName 为写入虚拟文件系统的输入名，args 为完整 ffmpeg 参数，
// outName 为输出文件名。返回输出 Blob（type 由调用方指定）。
export async function convertMedia(inputData, inputName, args, outName, outMime) {
  // loadCore() 内部已按「多线程 → 单线程 → CDN」顺序回退，
  // 即使页面未启用跨源隔离（无 SharedArrayBuffer），也会回退到本地单线程内核。
  await loadCore()
  await ffmpeg.writeFile(inputName, inputData)
  await ffmpeg.exec(args)
  const data = await ffmpeg.readFile(outName)
  return new Blob([data.buffer], { type: outMime })
}

// 子项收集：成功记录 detail，失败原样记录 error（message + stack）。
async function addItem(items, id, title, fn) {
  try {
    const detail = await fn()
    items.push({ id, title, ok: true, detail })
  } catch (e) {
    items.push({ id, title, ok: false, error: { message: e.message, stack: e.stack } })
  }
}

// 自检（默认路径：优先多线程，无 SharedArrayBuffer 时单线程回退）。返回统一结构。
export async function selfTest() {
  const items = []
  await addItem(items, 'load-core', '加载 ffmpeg 内核（自动回退）', async () => {
    await loadCore()
    return self.crossOriginIsolated ? '多线程' : '单线程'
  })
  await addItem(items, 'mjpeg', 'ffmpeg 编码（mjpeg）', async () => {
    await ffmpeg.exec(['-f', 'lavfi', '-i', 'color=c=blue:s=32x32:d=1', '-frames:v', '1', '-c:v', 'mjpeg', 'selftest.jpg'])
    const data = await ffmpeg.readFile('selftest.jpg')
    if (data.byteLength === 0) throw new Error('编码输出为空')
    return data.byteLength + 'B'
  })
  return { module: '媒体', items }
}

// 自检（强制单线程内核）：用于无 SharedArrayBuffer 环境 / 沙箱验证管线可用。返回统一结构。
export async function selfTestST() {
  const st = async (b) => ({
    coreURL: await toBlobURL(`${b}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${b}/ffmpeg-core.wasm`, 'application/wasm'),
  })
  const f2 = new FFmpeg()
  const items = []
  await addItem(items, 'load-st-core', '加载 ffmpeg 单线程内核', async () => {
    await f2.load(await st('/ffmpeg-st'))
    return '单线程'
  })
  await addItem(items, 'mjpeg', 'ffmpeg 编码（mjpeg）', async () => {
    await f2.exec(['-f', 'lavfi', '-i', 'color=c=blue:s=32x32:d=1', '-frames:v', '1', '-c:v', 'mjpeg', 'st.jpg'])
    const data = await f2.readFile('st.jpg')
    if (data.byteLength === 0) throw new Error('编码输出为空')
    return data.byteLength + 'B'
  })
  return { module: '媒体', items }
}
