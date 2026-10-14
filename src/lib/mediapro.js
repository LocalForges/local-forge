// 音视频进阶能力（复用项目已装的 ffmpeg.wasm 内核，不新增依赖）。
//
// 设计原则：
//   - 能「流拷贝」就绝不重编码（-c copy），速度快几十倍且画质/音质无损
//   - 每个功能都把 ffmpeg 参数显式暴露出来（视图里可展示"实际执行的命令"），便于排查
//   - 全部在本地虚拟文件系统里完成，媒体文件从不上传

import { writeMediaFile, execMedia, readMediaFiles, unlinkMediaFiles, coreMode, ensureMediaCore, setCorePreference } from './media.js'
import { toUint8 } from './fileio.js'

const extOf = (name) => (String(name).split('.').pop() || '').toLowerCase()

function sanitize(name) {
  // ffmpeg 虚拟文件系统对文件名敏感：去掉路径与空格，避免参数被拆坏
  return String(name).replace(/[^\w.-]/g, '_').slice(-60) || 'in.media'
}

/* ---------------- 读取媒体信息（浏览器原生，零 ffmpeg 开销） ---------------- */
export async function probeMedia(file) {
  const url = URL.createObjectURL(file)
  try {
    const info = await new Promise((resolve, reject) => {
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.muted = true
      const timer = setTimeout(() => reject(new Error('读取超时：浏览器无法解析该媒体（格式不支持或文件损坏）')), 15000)
      v.onloadedmetadata = () => {
        clearTimeout(timer)
        resolve({
          duration: v.duration,
          width: v.videoWidth || 0,
          height: v.videoHeight || 0,
          hasVideo: (v.videoWidth || 0) > 0,
          hasAudio: !!v.webkitAudioDecodedByteCount || (v.mozHasAudio ?? true),
          fileSize: file.size,
          type: file.type || extOf(file.name),
        })
      }
      v.onerror = () => { clearTimeout(timer); reject(new Error('浏览器无法解码该文件')) }
      v.src = url
    })
    return info
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

/* ---------------- 视频 → GIF ---------------- */
export async function videoToGif(file, { fps = 10, width = 480, start = 0, duration = 0, onRead } = {}) {
  const inName = sanitize(file.name)
  const outName = 'out.gif'
  const vf = `fps=${Math.max(1, Math.min(30, fps))},scale=${Math.max(64, Math.min(1280, width))}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`
  const args = ['-ss', String(start || 0), '-i', inName]
  if (duration > 0) args.push('-t', String(duration))
  args.push('-vf', vf, '-loop', '0', outName)
  await writeMediaFile(inName, await toUint8(file, onRead))
  const [out] = await execMedia(args, [{ name: outName, mime: 'image/gif' }])
  await unlinkMediaFiles([inName, outName])
  return { blob: out.blob, name: `${file.name.replace(/\.[^.]+$/, '')}.gif`, cmd: 'ffmpeg ' + args.join(' ') }
}

/* ---------------- 提取音频 ---------------- */
export async function extractAudio(file, { mode = 'copy', bitrate = '192k', onRead } = {}) {
  const inName = sanitize(file.name)
  const ext = extOf(file.name)
  let outName = 'out.m4a'
  let args
  if (mode === 'wav') {
    outName = 'out.wav'
    args = ['-i', inName, '-vn', '-c:a', 'pcm_s16le', outName]
  } else if (mode === 'mp3') {
    outName = 'out.mp3'
    args = ['-i', inName, '-vn', '-c:a', 'libmp3lame', '-b:a', bitrate, outName]
  } else {
    // 流拷贝：最快且无损；aac 流装进 m4a 容器
    outName = ext === 'mp3' ? 'out.mp3' : 'out.m4a'
    args = ['-i', inName, '-vn', '-c:a', 'copy', outName]
  }
  await writeMediaFile(inName, await toUint8(file, onRead))
  const [out] = await execMedia(args, [{ name: outName, mime: outName.endsWith('wav') ? 'audio/wav' : outName.endsWith('mp3') ? 'audio/mpeg' : 'audio/mp4' }])
  await unlinkMediaFiles([inName, outName])
  return { blob: out.blob, name: `${file.name.replace(/\.[^.]+$/, '')}-audio.${outName.split('.').pop()}`, cmd: 'ffmpeg ' + args.join(' ') }
}

/* ---------------- 批量抽帧 ---------------- */
export async function extractFrames(file, { fps = 1, max = 12, format = 'image/png', onRead } = {}) {
  const inName = sanitize(file.name)
  const ext = format === 'image/jpeg' ? 'jpg' : 'png'
  const total = Math.max(1, Math.min(60, Number(max) || 12))
  const pattern = `frame-%04d.${ext}`
  const args = ['-i', inName, '-vf', `fps=${Math.max(0.1, Number(fps) || 1)}`, '-frames:v', String(total), pattern]
  await writeMediaFile(inName, await toUint8(file, onRead))
  await execMedia(args, [])
  // ffmpeg 按序列命名，逐个读回（读不到即已到结尾）
  const parts = []
  const names = []
  for (let i = 1; i <= total; i++) {
    const n = `frame-${String(i).padStart(4, '0')}.${ext}`
    try {
      const [got] = await readMediaFiles([{ name: n, mime: format }])
      if (got && got.blob && got.blob.size) {
        parts.push({ blob: got.blob, name: `frame-${String(i).padStart(3, '0')}.${ext}` })
        names.push(n)
      }
    } catch {
      break
    }
  }
  await unlinkMediaFiles([inName, ...names])
  if (!parts.length) throw new Error('没有抽取到任何帧（视频可能过短或格式不受支持）')
  return { parts, cmd: 'ffmpeg ' + args.join(' ') }
}

/* ---------------- 按时间段裁剪 ---------------- */
export async function clipMedia(file, { start = 0, duration = 10, reencode = false, onRead } = {}) {
  const inName = sanitize(file.name)
  const outExt = reencode ? 'mp4' : extOf(file.name) || 'mp4'
  const outName = `clip.${outExt}`
  // -ss 放在 -i 之前：先定位再解码，速度快；-c copy 则不重新编码
  const args = ['-ss', String(start || 0), '-i', inName, '-t', String(Math.max(0.1, duration || 10)), '-avoid_negative_ts', 'make_zero']
  args.push(...(reencode ? ['-c:v', 'mpeg4', '-c:a', 'aac'] : ['-c', 'copy']))
  args.push(outName)
  await writeMediaFile(inName, await toUint8(file, onRead))
  const [out] = await execMedia(args, [{ name: outName, mime: outExt === 'mp4' ? 'video/mp4' : file.type || 'video/mp4' }])
  await unlinkMediaFiles([inName, outName])
  return { blob: out.blob, name: `${file.name.replace(/\.[^.]+$/, '')}-clip.${outExt}`, cmd: 'ffmpeg ' + args.join(' ') }
}

/* ---------------- 自检 ---------------- */
// 用 lavfi 合成源（不依赖任何外部素材），快速验证各条管线可用。
export async function selfTest() {
  // 自检统一走单线程内核：headless / 无跨源隔离环境下多线程内核可能加载过慢甚至卡住，
  // 单线程路径稳定且足以验证 ffmpeg 管线本身是否可用（真实运行时仍优先多线程）。
  setCorePreference('st')
  const items = []
  const T = async (id, title, fn) => {
    try {
      const detail = await fn()
      items.push({ id, title, ok: true, detail })
    } catch (e) {
      items.push({ id, title, ok: false, error: { message: e.message, stack: e.stack } })
    }
  }

  await T('core', '加载 ffmpeg 内核（自检强制单线程）', async () => {
    // 必须先触发加载再断言状态：coreMode() 只反映当前状态，不会主动加载
    const m = await ensureMediaCore()
    if (!m.loaded) throw new Error('内核加载失败')
    return m.isolated ? '已加载（跨源隔离环境）' : '已加载（单线程）'
  })
  await T('gif', '视频转 GIF 管线', async () => {
    await execMedia(
      ['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1:r=10', '-vf', 'fps=5,scale=32:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse', '-loop', '0', 't.gif'],
      [{ name: 't.gif', mime: 'image/gif' }],
    )
    const [out] = await readMediaFiles([{ name: 't.gif', mime: 'image/gif' }])
    if (!out || !out.blob || !out.blob.size) throw new Error('GIF 输出为空')
    await unlinkMediaFiles(['t.gif'])
    return out.blob.size + 'B'
  })
  await T('audio', '音频提取管线（WAV）', async () => {
    await execMedia(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-vn', '-c:a', 'pcm_s16le', 't.wav'], [{ name: 't.wav', mime: 'audio/wav' }])
    const [out] = await readMediaFiles([{ name: 't.wav', mime: 'audio/wav' }])
    if (!out || !out.blob || !out.blob.size) throw new Error('音频输出为空')
    await unlinkMediaFiles(['t.wav'])
    return out.blob.size + 'B'
  })
  await T('frames', '抽帧管线', async () => {
    await execMedia(['-f', 'lavfi', '-i', 'testsrc=s=64x64:d=1:r=10', '-frames:v', '3', 'f-%04d.png'], [])
    let n = 0
    for (let i = 1; i <= 3; i++) {
      const [g] = await readMediaFiles([{ name: `f-${String(i).padStart(4, '0')}.png`, mime: 'image/png' }])
      if (g && g.blob && g.blob.size) n++
    }
    await unlinkMediaFiles(['f-0001.png', 'f-0002.png', 'f-0003.png'])
    if (n !== 3) throw new Error('应抽到 3 帧，实际 ' + n)
    return n + ' 帧'
  })
  await T('clip', '裁剪管线（流拷贝）', async () => {
    await execMedia(['-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=2:r=10', '-c:v', 'mjpeg', 'src.avi'], [])
    await execMedia(['-ss', '0', '-i', 'src.avi', '-t', '1', '-c', 'copy', 'cut.avi'], [{ name: 'cut.avi', mime: 'video/x-msvideo' }])
    const [out] = await readMediaFiles([{ name: 'cut.avi', mime: 'video/x-msvideo' }])
    if (!out || !out.blob || !out.blob.size) throw new Error('裁剪输出为空')
    await unlinkMediaFiles(['src.avi', 'cut.avi'])
    return out.blob.size + 'B'
  })

  return { module: '媒体进阶', items }
}
