<script setup>
import { ref, reactive, watch } from 'vue'
import { useRoute } from 'vue-router'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
import StatusPill from '../components/StatusPill.vue'
import {
  imagesToPdf, pdfToImages, watermarkPdf, addPageNumbers, organizePdf, extractPdfText, readPdfMeta, writePdfMeta,
} from '../lib/pdfpro.js'
import { createZip } from '../lib/archive.js'
import { formatSize, downloadBlob, basename } from '../utils.js'

const route = useRoute()
const tab = ref(['img2pdf', 'pdf2img', 'stamp', 'organize'].includes(route.query.tab) ? route.query.tab : 'img2pdf')
watch(() => route.query.tab, (v) => { if (['img2pdf', 'pdf2img', 'stamp', 'organize'].includes(v)) tab.value = v })

const busy = ref(false)
const state = ref('idle')
const progress = ref(0)
const message = ref(null)
function setMsg(t, text) { message.value = { type: t, text } }
function run(promise, label) {
  busy.value = true
  state.value = 'working'
  progress.value = 0
  setMsg('info', label)
}

/* 图片 → PDF */
const imgFiles = ref([])
async function runImg2Pdf() {
  if (!imgFiles.value.length) { setMsg('err', '请先选择图片'); return }
  run(null, `正在合成 ${imgFiles.value.length} 张图片……`)
  try {
    const r = await imagesToPdf(imgFiles.value, { pageSize: imgPage.value, onprogress: (p) => (progress.value = p) })
    downloadBlob(r.blob, r.name)
    state.value = 'done'
    setMsg('ok', `已生成 ${r.count} 页 PDF（${formatSize(r.blob.size)}）并下载。`)
  } catch (e) {
    state.value = 'error'
    setMsg('err', '生成失败：' + e.message)
  } finally { busy.value = false }
}
const imgPage = ref('fit')

/* PDF → 图片 */
const pdfFile = ref(null)
const imgScale = ref(2)
const imgFmt = ref('image/png')
async function runPdf2Img() {
  if (!pdfFile.value) { setMsg('err', '请先选择 PDF'); return }
  run(null, '正在逐页渲染……')
  try {
    const r = await pdfToImages(pdfFile.value, { scale: imgScale.value, format: imgFmt.value, onprogress: (p) => (progress.value = p) })
    const files = r.parts.map((p) => new File([p.blob], p.name, { type: p.blob.type }))
    const zip = await createZip(files, { level: 6 })
    downloadBlob(zip, `${basename(pdfFile.value.name).replace(/\.pdf$/i, '')}-${r.pages}pages.zip`)
    state.value = 'done'
    setMsg('ok', `${r.pages} 页已渲染并打包下载（${formatSize(zip.size)}）。`)
  } catch (e) {
    state.value = 'error'
    setMsg('err', '转换失败：' + e.message)
  } finally { busy.value = false }
}

/* 水印 / 页码 */
const stampFile = ref(null)
const wm = reactive({ text: '机密', opacity: 0.16, rotate: 30, fontSize: 48, mode: 'center' })
const pn = reactive({ position: 'bottom-center', start: 1, fontSize: 10, prefix: '', suffix: ' 页' })
async function runWatermark() {
  if (!stampFile.value) { setMsg('err', '请先选择 PDF'); return }
  run(null, '正在加盖水印……')
  try {
    const r = await watermarkPdf(stampFile.value, { ...wm })
    downloadBlob(r.blob, r.name)
    state.value = 'done'
    setMsg('ok', `已为 ${r.pages} 页加盖水印并下载。`)
  } catch (e) {
    state.value = 'error'
    setMsg('err', '水印失败：' + e.message)
  } finally { busy.value = false }
}
async function runPageNumber() {
  if (!stampFile.value) { setMsg('err', '请先选择 PDF'); return }
  run(null, '正在添加页码……')
  try {
    const r = await addPageNumbers(stampFile.value, { ...pn })
    downloadBlob(r.blob, r.name)
    state.value = 'done'
    setMsg('ok', `已为 ${r.pages} 页添加页码并下载。`)
  } catch (e) {
    state.value = 'error'
    setMsg('err', '添加页码失败：' + e.message)
  } finally { busy.value = false }
}

/* 整理 / 文本 / 元数据 */
const orgFile = ref(null)
const org = reactive({ remove: '', rotateAll: 0 })
const orgMeta = ref(null)
const orgText = ref(null)
async function onOrgFile(fs) {
  orgFile.value = (fs && fs[0]) || null
  orgMeta.value = null
  orgText.value = null
  if (!orgFile.value) return
  try {
    orgMeta.value = await readPdfMeta(orgFile.value)
    setMsg('info', `已读取：${orgMeta.value.pages} 页。可执行旋转/删页，或提取文本。`)
  } catch (e) {
    setMsg('err', '读取失败：' + e.message)
  }
}
async function runOrganize() {
  if (!orgFile.value) { setMsg('err', '请先选择 PDF'); return }
  const remove = org.remove.split(/[,，\s]+/).filter(Boolean).map((n) => Number(n) - 1).filter((n) => n >= 0)
  const rotations = {}
  if (org.rotateAll && orgMeta.value) {
    for (let i = 0; i < orgMeta.value.pages; i++) rotations[i] = Number(org.rotateAll)
  }
  run(null, '正在整理页面……')
  try {
    const r = await organizePdf(orgFile.value, { remove, rotations })
    downloadBlob(r.blob, r.name)
    state.value = 'done'
    setMsg('ok', `整理完成：${r.from} 页 → ${r.pages} 页${org.rotateAll ? `，全部旋转 ${org.rotateAll}°` : ''}。`)
  } catch (e) {
    state.value = 'error'
    setMsg('err', '整理失败：' + e.message)
  } finally { busy.value = false }
}
async function runExtract() {
  if (!orgFile.value) { setMsg('err', '请先选择 PDF'); return }
  run(null, '正在提取文本……')
  try {
    const r = await extractPdfText(orgFile.value, { onprogress: (p) => (progress.value = p) })
    orgText.value = r.text
    state.value = 'done'
    setMsg('ok', orgText.value.trim() ? '提取完成，文本可直接复制或下载。' : '该 PDF 似乎是扫描件（没有文字层），建议用「OCR 图片转文字」工具。')
  } catch (e) {
    state.value = 'error'
    setMsg('err', '提取失败：' + e.message)
  } finally { busy.value = false }
}
const metaForm = reactive({ title: '', author: '', subject: '', keywords: '' })
async function runWriteMeta() {
  if (!orgFile.value) { setMsg('err', '请先选择 PDF'); return }
  try {
    const r = await writePdfMeta(orgFile.value, { ...metaForm })
    downloadBlob(r.blob, r.name)
    setMsg('ok', '元数据已写入并下载。')
  } catch (e) {
    setMsg('err', '写入失败：' + e.message)
  }
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); setMsg('ok', '文本已复制。') }
  catch { setMsg('err', '浏览器拒绝了剪贴板权限，请手动复制。') }
}
function downloadText(t, name) {
  downloadBlob(new Blob([t], { type: 'text/plain;charset=utf-8' }), name)
}
</script>

<template>
  <h1 class="page-title">PDF 进阶工具</h1>
  <p class="page-sub">
    图片与 PDF 互转、中文水印、页码、旋转删页、提取文本与元数据编辑。
    全部由已内置的 <b>pdf-lib</b> 与 <b>pdf.js</b> 在本地完成，<b>文件不上传</b>。
  </p>

  <HelpTip title="每个功能怎么用？" icon="bi-info-circle" open>
    <ol class="howto">
      <li><b>图片转 PDF</b>：把多张截图/照片合成一份 PDF，可选 A4 或按原图尺寸。</li>
      <li><b>PDF 转图片</b>：逐页渲染成 PNG/JPG，自动打包成 ZIP（倍数越高越清晰）。</li>
      <li><b>水印 / 页码</b>：中文可用（水印走 Canvas 图层渲染，不依赖字体文件）。</li>
      <li><b>整理 / 文本</b>：整册旋转、删除指定页、提取文字（扫描件没有文字层，需用 OCR）。</li>
    </ol>
  </HelpTip>

  <div class="tabs">
    <button :class="{ active: tab === 'img2pdf' }" @click="tab = 'img2pdf'"><i class="bi bi-images"></i> 图片 → PDF</button>
    <button :class="{ active: tab === 'pdf2img' }" @click="tab = 'pdf2img'"><i class="bi bi-file-earmark-image"></i> PDF → 图片</button>
    <button :class="{ active: tab === 'stamp' }" @click="tab = 'stamp'"><i class="bi bi-droplet"></i> 水印 / 页码</button>
    <button :class="{ active: tab === 'organize' }" @click="tab = 'organize'"><i class="bi bi-sort-numeric-down"></i> 整理 / 文本</button>
  </div>

  <!-- 图片 → PDF -->
  <div v-if="tab === 'img2pdf'" class="panel">
    <DropZone multiple accept="image/*" single="图片" hint="拖放图片（可多选，按顺序合成）" formats="JPG / PNG / WEBP / AVIF（其它格式会自动转换为 JPG）" @files="(fs) => (imgFiles = fs)" />
    <div class="row wrap" style="margin-top:12px">
      <div class="field">
        <label>页面尺寸</label>
        <select v-model="imgPage">
          <option value="fit">按原图尺寸</option>
          <option value="a4">统一 A4（竖版）</option>
        </select>
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <button class="btn" :disabled="busy || !imgFiles.length" @click="runImg2Pdf"><i class="bi bi-file-earmark-pdf"></i> 合成 PDF</button>
      </div>
      <StatusPill :state="state" :label="state === 'working' ? `处理中 ${progress}%` : state === 'done' ? '已完成' : '待处理'" />
    </div>
    <div v-if="imgFiles.length" class="status">已选 {{ imgFiles.length }} 张图片，将按选择顺序排列。</div>
  </div>

  <!-- PDF → 图片 -->
  <div v-else-if="tab === 'pdf2img'" class="panel">
    <DropZone :multiple="false" accept=".pdf" single="PDF" hint="拖放 PDF 文件" @files="(fs) => (pdfFile = fs && fs[0])" />
    <div class="row wrap" style="margin-top:12px">
      <div class="field">
        <label>清晰度（{{ imgScale }}×）</label>
        <input type="range" min="1" max="4" step="0.5" v-model.number="imgScale" style="width:150px" />
      </div>
      <div class="field">
        <label>输出格式</label>
        <select v-model="imgFmt">
          <option value="image/png">PNG（无损）</option>
          <option value="image/jpeg">JPG（体积小）</option>
        </select>
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <button class="btn" :disabled="busy || !pdfFile" @click="runPdf2Img"><i class="bi bi-images"></i> 转换并打包 ZIP</button>
      </div>
      <StatusPill :state="state" :label="state === 'working' ? `渲染中 ${progress}%` : state === 'done' ? '已完成' : '待处理'" />
    </div>
    <div v-if="state === 'working'" class="progress"><span :style="{ width: progress + '%' }"></span></div>
    <p class="hint">1×≈屏幕清晰度，2×≈打印清晰度（推荐），4× 体积会显著变大。</p>
  </div>

  <!-- 水印 / 页码 -->
  <div v-else-if="tab === 'stamp'" class="panel">
    <DropZone :multiple="false" accept=".pdf" single="PDF" hint="拖放 PDF 文件" @files="(fs) => (stampFile = fs && fs[0])" />
    <h3 class="sec-title"><i class="bi bi-droplet"></i> 文字水印（支持中文）</h3>
    <div class="row wrap">
      <div class="field"><label>水印文字</label><input v-model="wm.text" placeholder="如：机密 · 仅供内部使用" /></div>
      <div class="field"><label>透明度 {{ wm.opacity }}</label><input type="range" min="0.05" max="0.6" step="0.01" v-model.number="wm.opacity" style="width:130px" /></div>
      <div class="field"><label>角度 {{ wm.rotate }}°</label><input type="range" min="-90" max="90" step="5" v-model.number="wm.rotate" style="width:130px" /></div>
      <div class="field"><label>字号 {{ wm.fontSize }}</label><input type="range" min="16" max="96" step="4" v-model.number="wm.fontSize" style="width:130px" /></div>
      <div class="field">
        <label>排布</label>
        <select v-model="wm.mode">
          <option value="center">居中单个</option>
          <option value="tile">整页平铺</option>
        </select>
      </div>
    </div>
    <button class="btn" :disabled="busy || !stampFile" @click="runWatermark"><i class="bi bi-droplet"></i> 加盖水印并下载</button>

    <hr class="split" />
    <h3 class="sec-title"><i class="bi bi-123"></i> 页码</h3>
    <div class="row wrap">
      <div class="field">
        <label>位置</label>
        <select v-model="pn.position">
          <option value="bottom-center">底部居中</option>
          <option value="bottom-left">底部居左</option>
          <option value="bottom-right">底部居右</option>
          <option value="top-center">顶部居中</option>
        </select>
      </div>
      <div class="field"><label>起始页码</label><input type="number" min="1" v-model.number="pn.start" style="width:90px" /></div>
      <div class="field"><label>字号</label><input type="number" min="6" max="24" v-model.number="pn.fontSize" style="width:90px" /></div>
      <div class="field"><label>后缀</label><input v-model="pn.suffix" style="width:120px" /></div>
    </div>
    <button class="btn" :disabled="busy || !stampFile" @click="runPageNumber"><i class="bi bi-123"></i> 添加页码并下载</button>
    <p class="hint">两个操作互不影响，都是从<b>原始文件</b>重新生成一份新 PDF，原文件不会被修改。</p>
  </div>

  <!-- 整理 / 文本 -->
  <div v-else class="panel">
    <DropZone :multiple="false" accept=".pdf" single="PDF" hint="拖放 PDF 文件" @files="onOrgFile" />
    <div v-if="orgMeta" class="status">
      共 <b style="color:var(--txt)">{{ orgMeta.pages }}</b> 页<template v-if="orgMeta.title"> · 标题：{{ orgMeta.title }}</template><template v-if="orgMeta.author"> · 作者：{{ orgMeta.author }}</template>
    </div>

    <h3 class="sec-title"><i class="bi bi-arrow-repeat"></i> 整册旋转 / 删除页</h3>
    <div class="row wrap">
      <div class="field">
        <label>整册旋转</label>
        <select v-model.number="org.rotateAll">
          <option :value="0">不旋转</option>
          <option :value="90">顺时针 90°</option>
          <option :value="180">180°</option>
          <option :value="270">逆时针 90°</option>
        </select>
      </div>
      <div class="field">
        <label>删除页码（如 1,3）</label>
        <input v-model="org.remove" placeholder="留空表示不删除" style="width:180px" />
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <button class="btn" :disabled="busy || !orgFile" @click="runOrganize"><i class="bi bi-sort-numeric-down"></i> 应用并下载</button>
      </div>
    </div>

    <hr class="split" />
    <h3 class="sec-title"><i class="bi bi-fonts"></i> 提取文本</h3>
    <div class="row wrap">
      <button class="btn" :disabled="busy || !orgFile" @click="runExtract"><i class="bi bi-text-left"></i> 提取全文</button>
      <button class="btn ghost" :disabled="!orgText" @click="copyText(orgText)"><i class="bi bi-clipboard"></i> 复制</button>
      <button class="btn ghost" :disabled="!orgText" @click="downloadText(orgText, 'pdf-text.txt')"><i class="bi bi-download"></i> 下载 TXT</button>
      <StatusPill :state="state" :label="state === 'working' ? `提取中 ${progress}%` : state === 'done' ? '完成' : '待处理'" />
    </div>
    <div v-if="state === 'working'" class="progress"><span :style="{ width: progress + '%' }"></span></div>
    <textarea v-if="orgText" rows="10" readonly :value="orgText"></textarea>
    <p v-if="orgText && !orgText.trim()" class="msg err">
      没有提取到任何文字 —— 这份 PDF 很可能是<b>扫描件/图片型</b>，需要先转图片再用 OCR 工具识别。
    </p>

    <hr class="split" />
    <h3 class="sec-title"><i class="bi bi-card-heading"></i> 编辑元数据</h3>
    <div class="row wrap">
      <div class="field"><label>标题</label><input v-model="metaForm.title" /></div>
      <div class="field"><label>作者</label><input v-model="metaForm.author" /></div>
      <div class="field"><label>主题</label><input v-model="metaForm.subject" /></div>
      <div class="field"><label>关键词（逗号分隔）</label><input v-model="metaForm.keywords" /></div>
    </div>
    <button class="btn" :disabled="!orgFile" @click="runWriteMeta"><i class="bi bi-save"></i> 写入并下载</button>
  </div>

  <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
</template>

<style scoped>
.sec-title { margin: 16px 0 8px; font-size: 14px; color: var(--txt, #e6ebf2); display: flex; align-items: center; gap: 7px; }
.sec-title i { color: var(--accent, #38bdf8); }
.split { border: none; border-top: 1px solid var(--line, rgba(120,150,200,.16)); margin: 18px 0; }
textarea { width: 100%; box-sizing: border-box; font-family: var(--mono, monospace); font-size: 12.5px; margin-top: 10px; }
</style>
