<script setup>
import { ref, reactive, watch } from 'vue'
import { useRoute } from 'vue-router'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
import StatusPill from '../components/StatusPill.vue'
import { videoToGif, extractAudio, extractFrames, clipMedia, probeMedia } from '../lib/mediapro.js'
import { createZip } from '../lib/archive.js'
import { formatSize, downloadBlob, basename } from '../utils.js'

const route = useRoute()
const tab = ref(['gif', 'audio', 'frames', 'clip'].includes(route.query.tab) ? route.query.tab : 'gif')
watch(() => route.query.tab, (v) => { if (['gif', 'audio', 'frames', 'clip'].includes(v)) tab.value = v })

const file = ref(null)
const info = ref(null)
const busy = ref(false)
const state = ref('idle')
const message = ref(null)
const lastCmd = ref('')
function setMsg(t, text) { message.value = { type: t, text } }

async function onFiles(fs) {
  file.value = (fs && fs[0]) || null
  info.value = null
  if (!file.value) return
  state.value = 'working'
  setMsg('info', '正在读取媒体信息……')
  try {
    info.value = await probeMedia(file.value)
    state.value = 'idle'
    setMsg('ok', `已读取：${fmtDur(info.value.duration)}${info.value.hasVideo ? ` · ${info.value.width}×${info.value.height}` : ''} · ${formatSize(info.value.fileSize)}。选择上方功能开始处理。`)
  } catch (e) {
    state.value = 'error'
    setMsg('err', '读取失败：' + e.message)
  }
}
function fmtDur(s) {
  if (!isFinite(s)) return '未知时长'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}（${s.toFixed(1)}s）`
}

const gif = reactive({ fps: 10, width: 480, start: 0, duration: 0 })
const audio = reactive({ mode: 'copy', bitrate: '192k' })
const frames = reactive({ fps: 1, max: 12, format: 'image/png' })
const clip = reactive({ start: 0, duration: 10, reencode: false })

async function guard() {
  if (!file.value) { setMsg('err', '请先选择音视频文件'); return false }
  return true
}
async function doRun(fn) {
  busy.value = true
  state.value = 'working'
  setMsg('info', '正在处理，首次使用需加载 ffmpeg 内核（约 20–30 秒），请耐心等待……')
  try {
    const r = await fn()
    lastCmd.value = r.cmd || ''
    if (r.parts) {
      const files = r.parts.map((p) => new File([p.blob], p.name, { type: p.blob.type }))
      const zip = await createZip(files, { level: 6 })
      downloadBlob(zip, `${basename(file.value.name).replace(/\.[^.]+$/, '')}-frames-${files.length}.zip`)
      setMsg('ok', `已抽取 ${files.length} 帧并打包下载（${formatSize(zip.size)}）。`)
    } else {
      downloadBlob(r.blob, r.name)
      setMsg('ok', `处理完成：${formatSize(r.blob.size)}，已开始下载。`)
    }
    state.value = 'done'
  } catch (e) {
    state.value = 'error'
    setMsg('err', '处理失败：' + e.message)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <h1 class="page-title">音视频进阶工具</h1>
  <p class="page-sub">
    视频转 GIF、提取音轨、批量抽帧、按时间段裁剪。由已内置的 <b>ffmpeg.wasm</b> 在本地完成，
    <b>文件不上传</b>；能直接流拷贝的环节绝不重编码，速度更快且画质无损。
  </p>

  <HelpTip title="五个功能分别适合什么场景？" icon="bi-info-circle" open>
    <ol class="howto">
      <li><b>转 GIF</b>：把一段操作录屏/视频做成表情包或文档演示图（建议 5–12 fps、宽度 480）。</li>
      <li><b>提取音频</b>：从视频里扒出音轨；默认「流拷贝」无损且极快。</li>
      <li><b>抽帧</b>：按间隔导出图片，做封面、做缩略图或给文章配图，自动打包 ZIP。</li>
      <li><b>裁剪</b>：只保留你要的那一段（如 01:20–01:50），默认不重编码，几秒完成。</li>
    </ol>
    <p style="margin:8px 0 0">首次点任何按钮都要先下载并启动 ffmpeg 内核（约 20–30 秒，之后同一页面内复用）。</p>
  </HelpTip>

  <DropZone
    :multiple="false" accept="video/*,audio/*" single="音视频"
    hint="拖放视频或音频文件"
    formats="MP4 / MOV / WEBM / MKV / AVI / MP3 / WAV / M4A 等"
    @files="onFiles"
  />

  <div v-if="info" class="info-box">
    <div class="kpi"><span class="num">{{ info.hasVideo ? info.width + '×' + info.height : '纯音频' }}</span><span class="lbl">分辨率</span></div>
    <div class="kpi"><span class="num">{{ fmtDur(info.duration) }}</span><span class="lbl">时长</span></div>
    <div class="kpi"><span class="num">{{ formatSize(info.fileSize) }}</span><span class="lbl">大小</span></div>
    <div class="kpi"><span class="num">{{ info.type }}</span><span class="lbl">类型</span></div>
  </div>

  <div class="tabs">
    <button :class="{ active: tab === 'gif' }" @click="tab = 'gif'"><i class="bi bi-film"></i> 转 GIF</button>
    <button :class="{ active: tab === 'audio' }" @click="tab = 'audio'"><i class="bi bi-music-note-beamed"></i> 提取音频</button>
    <button :class="{ active: tab === 'frames' }" @click="tab = 'frames'"><i class="bi bi-images"></i> 抽帧</button>
    <button :class="{ active: tab === 'clip' }" @click="tab = 'clip'"><i class="bi bi-scissors"></i> 裁剪片段</button>
  </div>

  <div class="panel">
    <!-- GIF -->
    <div v-if="tab === 'gif'" class="row wrap">
      <div class="field"><label>帧率 {{ gif.fps }} fps</label><input type="range" min="4" max="20" v-model.number="gif.fps" style="width:130px" /></div>
      <div class="field"><label>宽度 {{ gif.width }}px</label><input type="range" min="160" max="800" step="20" v-model.number="gif.width" style="width:130px" /></div>
      <div class="field"><label>起始秒</label><input type="number" min="0" step="0.5" v-model.number="gif.start" style="width:90px" /></div>
      <div class="field"><label>时长秒（0=到结尾）</label><input type="number" min="0" step="0.5" v-model.number="gif.duration" style="width:90px" /></div>
    </div>

    <!-- 音频 -->
    <div v-else-if="tab === 'audio'" class="row wrap">
      <div class="field">
        <label>输出方式</label>
        <select v-model="audio.mode">
          <option value="copy">流拷贝（最快、无损，输出 m4a/mp3）</option>
          <option value="wav">转 WAV（通用无损，体积大）</option>
          <option value="mp3">转 MP3（需内核含 libmp3lame）</option>
        </select>
      </div>
      <div class="field" v-if="audio.mode === 'mp3'">
        <label>码率</label>
        <select v-model="audio.bitrate"><option value="128k">128k</option><option value="192k">192k</option><option value="256k">256k</option><option value="320k">320k</option></select>
      </div>
    </div>

    <!-- 抽帧 -->
    <div v-else-if="tab === 'frames'" class="row wrap">
      <div class="field"><label>每秒抽 {{ frames.fps }} 帧</label><input type="range" min="0.2" max="5" step="0.2" v-model.number="frames.fps" style="width:140px" /></div>
      <div class="field"><label>最多 {{ frames.max }} 张</label><input type="range" min="1" max="60" v-model.number="frames.max" style="width:140px" /></div>
      <div class="field">
        <label>格式</label>
        <select v-model="frames.format"><option value="image/png">PNG</option><option value="image/jpeg">JPG</option></select>
      </div>
    </div>

    <!-- 裁剪 -->
    <div v-else class="row wrap">
      <div class="field"><label>起始秒</label><input type="number" min="0" step="0.5" v-model.number="clip.start" style="width:100px" /></div>
      <div class="field"><label>持续秒</label><input type="number" min="0.5" step="0.5" v-model.number="clip.duration" style="width:100px" /></div>
      <label class="check"><input type="checkbox" v-model="clip.reencode" /> 重新编码（起点不精确时勾选，会慢很多）</label>
    </div>

    <div class="row wrap" style="margin-top:12px">
      <button class="btn green" :disabled="busy || !file" @click="
        tab === 'gif' ? (guard() && doRun(() => videoToGif(file, { ...gif }))) :
        tab === 'audio' ? (guard() && doRun(() => extractAudio(file, { ...audio }))) :
        tab === 'frames' ? (guard() && doRun(() => extractFrames(file, { ...frames }))) :
        (guard() && doRun(() => clipMedia(file, { ...clip })))
      ">
        <i class="bi bi-play-circle"></i> {{ busy ? '处理中……' : '开始处理' }}
      </button>
      <StatusPill :state="state" :label="state === 'working' ? '处理中' : state === 'done' ? '完成' : '待处理'" />
    </div>

    <p v-if="busy" class="hint"><i class="bi bi-hourglass-split"></i> 大文件会慢一些，请保持页面打开。</p>
    <div v-if="busy" class="progress indeterminate"><span></span></div>
    <details v-if="lastCmd" class="cmd"><summary>查看实际执行的 ffmpeg 命令</summary><code>{{ lastCmd }}</code></details>
  </div>

  <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
</template>

<style scoped>
.info-box { display: flex; gap: 10px; flex-wrap: wrap; margin: 14px 0; }
.kpi {
  flex: 1; min-width: 120px; padding: 10px 12px; border-radius: 12px; text-align: center;
  background: var(--panel-2, rgba(28,37,60,.55)); border: 1px solid var(--line, rgba(120,150,200,.16));
}
.kpi .num { display: block; font-size: 15px; font-weight: 700; color: var(--txt, #e6ebf2); }
.kpi .lbl { display: block; font-size: 11.5px; color: var(--muted, #93a2bd); margin-top: 2px; }
.cmd { margin-top: 12px; }
.cmd summary { cursor: pointer; font-size: 12.5px; color: var(--muted, #93a2bd); }
.cmd code {
  display: block; margin-top: 6px; padding: 8px 10px; border-radius: 8px; font-size: 11.5px;
  background: rgba(120,150,200,.1); color: var(--txt, #e6ebf2); word-break: break-all; white-space: pre-wrap;
}
</style>
