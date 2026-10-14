<script setup>
import { ref } from 'vue'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
import StatusPill from '../components/StatusPill.vue'
import { readMetadata, stripMetadata, LEVELS } from '../lib/exif.js'
import { createZip } from '../lib/archive.js'
import { formatSize, downloadBlob, basename } from '../utils.js'

const items = ref([]) // { file, meta, state, clean?:{blob,removed,removedBytes} }
const state = ref('idle')
const message = ref(null)
const busy = ref(false)

function setMsg(t, text) { message.value = { type: t, text } }

async function onFiles(fs) {
  items.value = (fs || []).map((f) => ({ file: f, meta: null, state: 'idle', error: null }))
  if (!items.value.length) return
  state.value = 'working'
  setMsg('info', `正在读取 ${items.value.length} 张图片的元数据……`)
  for (const it of items.value) {
    try {
      it.meta = await readMetadata(it.file)
      it.state = 'done'
    } catch (e) {
      it.error = e.message
      it.state = 'error'
    }
  }
  const withGps = items.value.filter((x) => x.meta && x.meta.gps).length
  const withExif = items.value.filter((x) => x.meta && x.meta.hasExif).length
  state.value = 'done'
  setMsg(
    withGps ? 'err' : withExif ? 'info' : 'ok',
    withGps
      ? `读取完成：其中 ${withGps} 张带有 GPS 定位信息。发到群里/朋友圈前建议清理，否则别人能反查到拍摄地点。`
      : withExif
        ? `读取完成：${withExif} 张含 EXIF 信息（未发现定位数据）。`
        : '读取完成：未发现 EXIF 元数据，这些图片已不含可识别的隐私信息。',
  )
}

async function cleanOne(it) {
  try {
    const res = await stripMetadata(it.file)
    it.clean = res
    setMsg('ok', `已清理 ${it.file.name}：移除 ${res.removed} 个元数据段（${formatSize(res.removedBytes)}），图像本身无损。`)
  } catch (e) {
    setMsg('err', '清理失败：' + e.message)
  }
}

function downloadOne(it) {
  if (!it.clean) return
  const base = basename(it.file.name).replace(/\.[^.]+$/, '')
  const ext = it.clean.kind === 'png' ? 'png' : 'jpg'
  downloadBlob(it.clean.blob, `${base}-clean.${ext}`)
}

async function cleanAll() {
  const targets = items.value.filter((x) => x.meta && (x.meta.hasMeta || x.meta.hasExif) && !x.error)
  if (!targets.length) { setMsg('info', '没有需要清理的文件（或尚未发现元数据）。'); return }
  busy.value = true
  try {
    for (const it of targets) {
      try { it.clean = await stripMetadata(it.file) } catch (e) { it.error = e.message }
    }
    const done = targets.filter((x) => x.clean)
    const files = done.map((it) => {
      const base = basename(it.file.name).replace(/\.[^.]+$/, '')
      const ext = it.clean.kind === 'png' ? 'png' : 'jpg'
      return new File([it.clean.blob], `${base}-clean.${ext}`, { type: it.clean.blob.type })
    })
    const zip = await createZip(files, { level: 6 })
    downloadBlob(zip, `cleaned-${files.length}-${Date.now()}.zip`)
    setMsg('ok', `已清理 ${done.length} 张并打包下载（${formatSize(zip.size)}）。原文件未被修改。`)
  } catch (e) {
    setMsg('err', '批量清理失败：' + e.message)
  } finally {
    busy.value = false
  }
}

function levelLabel(id) {
  return (LEVELS.find((l) => l.id === id) || {}).label || id
}
function fmtValue(v) {
  if (v == null) return ''
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
</script>

<template>
  <h1 class="page-title">照片隐私清理（EXIF）</h1>
  <p class="page-sub">
    查看并清除照片里隐藏的元数据：<b>GPS 定位</b>、拍摄时间、设备型号与序列号、作者与版权。
    解析与清理全部在本地完成（自研解析，零依赖），<b>照片不会上传任何服务器</b>。
  </p>

  <HelpTip title="为什么需要这一步？" icon="bi-shield-lock" open>
    <ol class="howto">
      <li>手机/相机拍照时会把<b>拍摄位置、时间、设备型号、序列号</b>写进照片文件（EXIF）。</li>
      <li>把原图发到群、朋友圈、二手平台，对方下载后就能反查出你的<b>精确坐标</b>。</li>
      <li>这里可以一键剥离：<b>只删元数据，不动图像像素</b>，画质完全无损，生成新文件，原图保持不变。</li>
    </ol>
    <p style="margin:8px 0 0">注意：微信/部分平台会自动压缩并清除元数据，但发原图、邮件附件、网盘分享时不会。</p>
  </HelpTip>

  <DropZone
    multiple accept="image/jpeg,image/png" single="图片"
    hint="拖放 JPG / PNG 图片到此处（可多选）"
    formats="JPEG / PNG（其它格式请先用「图片工具」转换）"
    @files="onFiles"
  />

  <div class="row wrap" style="margin-top:12px">
    <button class="btn green" :disabled="busy || !items.some((x) => x.meta && (x.meta.hasMeta || x.meta.hasExif))" @click="cleanAll">
      <i class="bi bi-eraser"></i> {{ busy ? '清理中……' : '批量清理并打包 ZIP' }}
    </button>
    <StatusPill :state="state" :label="state === 'working' ? '读取中' : state === 'done' ? `已读取 ${items.length} 张` : '等待图片'" />
  </div>

  <div v-if="items.length" class="list">
    <div v-for="it in items" :key="it.file.name + it.file.size" class="card">
      <div class="head">
        <i class="bi bi-image"></i>
        <span class="name">{{ it.file.name }}</span>
        <span class="tag">{{ formatSize(it.file.size) }}</span>
        <span v-if="it.error" class="tag danger"><i class="bi bi-exclamation-triangle"></i> {{ it.error }}</span>
        <template v-else-if="it.meta">
          <span v-if="it.meta.gps" class="tag danger"><i class="bi bi-geo-alt"></i> 含 GPS 定位</span>
          <span v-else-if="it.meta.hasExif" class="tag warn"><i class="bi bi-info-circle"></i> 含 EXIF</span>
          <span v-else class="tag ok"><i class="bi bi-check-circle"></i> 无元数据</span>
          <span v-if="it.clean" class="tag ok"><i class="bi bi-eraser"></i> 已清理（移除 {{ it.clean.removed }} 段）</span>
        </template>
      </div>

      <div v-if="it.meta && it.meta.gps" class="gps">
        <i class="bi bi-geo-alt-fill"></i>
        拍摄坐标：<b>纬度 {{ it.meta.gps.lat }}，经度 {{ it.meta.gps.lng }}</b>
        <span v-if="it.meta.gps.altitude != null"> · 海拔 {{ it.meta.gps.altitude }} m</span>
        <span v-if="it.meta.gps.date"> · {{ it.meta.gps.date }}</span>
      </div>

      <div v-if="it.meta && it.meta.tags.length" class="tags">
        <div v-for="(t, i) in it.meta.tags" :key="i" class="row-tag" :class="t.level">
          <span class="lv">{{ levelLabel(t.level) }}</span>
          <span class="k">{{ t.label }}</span>
          <span class="v">{{ fmtValue(t.value) }}</span>
        </div>
      </div>
      <p v-else-if="it.meta" class="hint" style="margin:8px 0 0">这张图没有可读取的元数据。</p>

      <div v-if="it.meta && !it.error" class="row wrap" style="margin-top:10px">
        <button class="btn ghost" :disabled="!it.meta.hasMeta && !it.meta.hasExif" @click="cleanOne(it)">
          <i class="bi bi-eraser"></i> 清理这张
        </button>
        <button class="btn" :disabled="!it.clean" @click="downloadOne(it)">
          <i class="bi bi-download"></i> 下载清理后的图片
        </button>
      </div>
    </div>
  </div>

  <div v-if="items.length" class="panel" style="margin-top:14px">
    <h3 class="sec-title"><i class="bi bi-diagram-3"></i> 敏感级别说明</h3>
    <div v-for="l in LEVELS" :key="l.id" class="row-tag" :class="l.id">
      <span class="lv">{{ l.label }}</span><span class="k">{{ l.desc }}</span>
    </div>
    <p class="hint">「清理」会移除所有 APPn 段：EXIF（含 GPS）、IPTC 作者版权、XMP、ICC 色彩配置与注释。
      ICC 被移除可能让个别看图软件显示的色彩略有差异，图片数据本身不受影响。</p>
  </div>

  <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
</template>

<style scoped>
.sec-title { margin: 0 0 10px; font-size: 14px; color: var(--txt, #e6ebf2); display: flex; align-items: center; gap: 7px; }
.sec-title i { color: var(--accent, #38bdf8); }
.list { margin-top: 14px; display: grid; gap: 12px; }
.card { border: 1px solid var(--line, rgba(120,150,200,.16)); border-radius: 12px; padding: 12px; background: var(--panel-2, rgba(28,37,60,.5)); }
.head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.head > i { color: var(--accent, #38bdf8); }
.head .name { color: var(--txt, #e6ebf2); font-weight: 600; font-size: 13.5px; }
.tag { font-size: 11.5px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--line-strong, rgba(120,150,200,.32)); color: var(--muted, #93a2bd); }
.tag.danger { color: var(--danger, #fb7185); border-color: rgba(251,113,133,.45); background: rgba(251,113,133,.1); }
.tag.warn { color: var(--warn, #fbbf24); border-color: rgba(251,191,36,.4); background: rgba(251,191,36,.1); }
.tag.ok { color: var(--accent-2, #34d399); border-color: rgba(52,211,153,.45); background: rgba(52,211,153,.1); }
.gps {
  margin-top: 10px; padding: 9px 12px; border-radius: 10px; font-size: 13px;
  background: rgba(251,113,133,.1); border-left: 3px solid var(--danger, #fb7185); color: #ffc4cf;
}
.tags { margin-top: 10px; display: grid; gap: 2px; }
.row-tag {
  display: flex; gap: 10px; align-items: baseline; font-size: 12.5px;
  padding: 4px 8px; border-radius: 8px; border-left: 3px solid var(--line, rgba(120,150,200,.2));
}
.row-tag .lv { flex: none; width: 62px; color: var(--muted, #93a2bd); font-size: 11.5px; }
.row-tag .k { flex: none; width: 110px; color: var(--muted, #93a2bd); }
.row-tag .v { color: var(--txt, #e6ebf2); word-break: break-all; }
.row-tag.high { border-left-color: var(--danger, #fb7185); background: rgba(251,113,133,.07); }
.row-tag.mid { border-left-color: var(--warn, #fbbf24); background: rgba(251,191,36,.06); }
.row-tag.low { border-left-color: var(--line-strong, rgba(120,150,200,.32)); }
</style>
