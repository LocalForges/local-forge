<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
import StatusPill from '../components/StatusPill.vue'
import { createZip } from '../lib/archive.js'
import { formatSize, downloadBlob } from '../utils.js'

const route = useRoute()
const files = ref([])
const password = ref('')
const level = ref(6)
const splitSize = ref(0) // MB，0 = 不拆分
const folderMode = ref(false)
const progress = ref(0)
const busy = ref(false)
const result = ref(null)
const message = ref(null)

onMounted(() => {
  if (route.query.split) splitSize.value = 100
  if (route.query.password) password.value = '' // 聚焦密码
})

function onFiles(list) {
  files.value = list
  result.value = null
  message.value = null
}
async function compress() {
  if (!files.value.length) return
  busy.value = true
  progress.value = 0
  message.value = { type: 'info', text: '正在压缩…' }
  try {
    const blob = await createZip(files.value, {
      password: password.value,
      level: level.value,
      splitSize: splitSize.value ? splitSize.value * 1024 * 1024 : 0,
      onprogress: (p) => (progress.value = p),
    })
    result.value = blob
    message.value = {
      type: 'ok',
      text: `压缩完成，生成 ${formatSize(blob.size)} 的 ZIP${password.value ? '（AES-256 加密）' : ''}${splitSize.value ? `（分卷 ${splitSize.value}MB）` : ''}。`,
    }
  } catch (e) {
    message.value = { type: 'err', text: '压缩失败：' + (e.message || e) }
  } finally {
    busy.value = false
  }
}
function download() {
  if (result.value) downloadBlob(result.value, 'archive.zip')
}
</script>

<template>
  <h1 class="page-title">压缩为 ZIP</h1>
  <p class="page-sub">多文件 / 文件夹打包成 ZIP。支持 AES-256 密码、压缩级别、分卷拆分，全部在浏览器本地多线程完成。</p>

  <HelpTip title="操作步骤" icon="bi-steps" open>
    <ol class="howto">
      <li>拖入要打包的文件，或勾选「文件夹模式」后选择整个文件夹。</li>
      <li>按需设置：<b>压缩级别</b>（标准即可）、<b>加密密码</b>（留空则不加密）、<b>分卷大小</b>（0 表示不拆分）。</li>
      <li>点「开始压缩」，完成后下载 <code>archive.zip</code>。</li>
    </ol>
    <p style="margin:8px 0 0">加密采用 AES-256，密码仅用于本机打包，不会被上传。</p>
  </HelpTip>

  <DropZone :multiple="!folderMode" :directory="folderMode" single="文件" hint="拖放文件或文件夹到此处" formats="任意文件 / 文件夹" @files="onFiles" />

  <div v-if="files.length" class="panel">
    <div class="row wrap" style="margin-top:0">
      <StatusPill v-if="busy" state="working" label="压缩中…" />
      <StatusPill v-else-if="result" state="done" label="已生成 ZIP" />
      <StatusPill v-else-if="message && message.type === 'err'" state="error" :label="message.text" />
    </div>
    <div class="row wrap">
      <div class="field">
        <label>压缩级别</label>
        <select v-model="level">
          <option :value="0">存储（不压缩）</option>
          <option :value="1">最快</option>
          <option :value="6">标准</option>
          <option :value="9">最佳</option>
        </select>
      </div>
      <div class="field">
        <label>加密密码（可选）</label>
        <input type="password" v-model="password" placeholder="留空则不加密" style="width:200px" />
      </div>
      <div class="field">
        <label>分卷大小（MB，0=不拆分）</label>
        <input type="number" min="0" v-model="splitSize" style="width:120px" />
      </div>
      <label class="check"><input type="checkbox" v-model="folderMode" /> 文件夹模式</label>
      <button class="btn" :disabled="busy" @click="compress"><i class="bi bi-file-earmark-zip"></i> 开始压缩</button>
    </div>

    <ul class="files">
      <li v-for="f in files" :key="f.name + f.size">
        <i class="bi bi-file-earmark"></i>
        <span class="name">{{ f.webkitRelativePath || f.name }}</span>
        <span class="size">{{ formatSize(f.size) }}</span>
      </li>
    </ul>

    <div v-if="busy || progress" class="progress"><span :style="{ width: progress + '%' }"></span></div>
    <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>

    <button v-if="result" class="btn green" @click="download">
      <i class="bi bi-download"></i> 下载 archive.zip ({{ formatSize(result.size) }})
    </button>
  </div>
</template>
