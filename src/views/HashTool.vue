<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
import StatusPill from '../components/StatusPill.vue'
import { ALGOS, hashFile, findDuplicates } from '../lib/hash.js'
import { formatSize, downloadBlob } from '../utils.js'

const route = useRoute()
const tab = ref('hash')
// 支持首页深链接 /hash?tab=dup（同一路由切换 query 时组件会被复用，故需监听）
watch(() => route.query.tab, (v) => { if (v === 'hash' || v === 'dup') tab.value = v })
const files = ref([])
const selected = reactive({ sha256: true, md5: true, crc32: false, sha1: false, sha512: false, xxhash128: false, blake3: false })
const algos = computed(() => Object.keys(selected).filter((k) => selected[k]))
const progress = ref(0)
const state = ref('idle')
const results = ref([]) // [{name,size,hashes:{}}]
const message = ref(null)
const expectValue = ref('')

const dupFiles = ref([])
const dupState = ref('idle')
const dupResult = ref(null)
const dupProgress = ref(0)

function setMsg(t, text) { message.value = { type: t, text } }

function onFiles(fs) {
  files.value = fs || []
  results.value = []
  state.value = 'idle'
  if (files.value.length) setMsg('info', `已选择 ${files.value.length} 个文件，点「开始计算」。`)
}

async function runHash() {
  if (!files.value.length) { setMsg('err', '请先选择文件'); return }
  if (!algos.value.length) { setMsg('err', '至少勾选一种算法'); return }
  state.value = 'working'
  progress.value = 0
  results.value = []
  try {
    const out = []
    for (let i = 0; i < files.value.length; i++) {
      const f = files.value[i]
      const h = await hashFile(f, algos.value, (p) => {
        progress.value = Math.round(((i + p / 100) / files.value.length) * 100)
      })
      out.push({ name: f.name, size: f.size, hashes: h })
    }
    results.value = out
    state.value = 'done'
    setMsg('ok', `计算完成：${out.length} 个文件 × ${algos.value.length} 种算法。文件从未离开你的设备。`)
  } catch (e) {
    state.value = 'error'
    setMsg('err', '计算失败：' + e.message)
  }
}

async function copyText(t, label) {
  try {
    await navigator.clipboard.writeText(t)
    setMsg('ok', (label || '内容') + '已复制。')
  } catch {
    setMsg('err', '浏览器拒绝了剪贴板权限，请手动选中复制。')
  }
}

const compared = computed(() => {
  const want = expectValue.value.trim().toLowerCase()
  if (!want || !results.value.length) return null
  const hits = []
  for (const r of results.value) {
    for (const [k, v] of Object.entries(r.hashes)) {
      if (String(v).toLowerCase() === want) hits.push({ name: r.name, algo: k, value: v })
    }
  }
  return { want, hits, checked: results.value.reduce((s, r) => s + Object.keys(r.hashes).length, 0) }
})

function exportCsv() {
  if (!results.value.length) return
  const algosOut = algos.value
  const rows = [['文件名', '大小(字节)', ...algosOut]]
  for (const r of results.value) rows.push([r.name, r.size, ...algosOut.map((a) => r.hashes[a])])
  const csv = '\uFEFF' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `hashes-${Date.now()}.csv`)
  setMsg('ok', '已导出 CSV（含文件名与全部摘要）。')
}

/* ---------------- 重复文件查找 ---------------- */
function onDupFiles(fs) {
  dupFiles.value = fs || []
  dupResult.value = null
  dupState.value = 'idle'
  if (dupFiles.value.length) setMsg('info', `已选择 ${dupFiles.value.length} 个文件，点「开始查找」。`)
}
async function runDup() {
  if (dupFiles.value.length < 2) { setMsg('err', '至少需要 2 个文件才能查重'); return }
  dupState.value = 'working'
  dupProgress.value = 0
  try {
    const res = await findDuplicates(dupFiles.value, { algo: 'sha256', onprogress: (p) => (dupProgress.value = p) })
    dupResult.value = res
    dupState.value = 'done'
    const wasted = res.groups.reduce((s, g) => s + g.wasted, 0)
    setMsg(
      'ok',
      res.groups.length
        ? `扫描 ${res.scanned} 个文件：发现 ${res.groups.length} 组重复，可释放约 ${formatSize(wasted)}。建议删除前先确认内容。`
        : `扫描 ${res.scanned} 个文件：没有发现内容完全相同的文件。`,
    )
  } catch (e) {
    dupState.value = 'error'
    setMsg('err', '查重失败：' + e.message)
  }
}
</script>

<template>
  <h1 class="page-title">文件哈希 / 校验</h1>
  <p class="page-sub">
    计算文件摘要、核对下载文件是否被篡改、找出重复的冗余文件。由 <b>hash-wasm</b>（WASM 内核，离线可用）驱动，
    文件分块读取，<b>从不上传</b>也不落临时文件。
  </p>

  <HelpTip title="怎么用？三种常见场景" icon="bi-info-circle" open>
    <ol class="howto">
      <li><b>核对下载</b>：官网会给出 SHA-256/MD5 校验值，把它粘到「比对校验值」框，一致说明文件完整无误。</li>
      <li><b>找重复文件</b>：切到「重复文件查找」，一次拖入整个文件夹，按内容（不是文件名）找出完全相同的文件。</li>
      <li><b>批量留档</b>：算完可导出 CSV，作为文件清单存档。</li>
    </ol>
    <p style="margin:8px 0 0">提示：MD5 / SHA-1 只适合<b>校验完整性</b>，不适合做密码类安全用途；校验优先选 SHA-256。</p>
  </HelpTip>

  <div class="tabs">
    <button :class="{ active: tab === 'hash' }" @click="tab = 'hash'"><i class="bi bi-shield-check"></i> 计算哈希</button>
    <button :class="{ active: tab === 'dup' }" @click="tab = 'dup'"><i class="bi bi-copy"></i> 重复文件查找</button>
  </div>

  <!-- 哈希 -->
  <div v-if="tab === 'hash'" class="panel">
    <DropZone multiple hint="拖放文件到此处（可多选）" @files="onFiles" />

    <h3 class="sec-title"><i class="bi bi-cpu"></i> 选择算法</h3>
    <div class="algo-grid">
      <label v-for="a in ALGOS" :key="a.id" class="check">
        <input type="checkbox" v-model="selected[a.id]" />
        <span><b>{{ a.label }}</b><em>{{ a.note }}</em></span>
      </label>
    </div>

    <div class="row wrap" style="margin-top:12px">
      <button class="btn" :disabled="!files.length || !algos.length" @click="runHash">
        <i class="bi bi-play-circle"></i> 开始计算
      </button>
      <button class="btn ghost" :disabled="!results.length" @click="exportCsv">
        <i class="bi bi-file-earmark-spreadsheet"></i> 导出 CSV
      </button>
      <StatusPill :state="state" :label="state === 'working' ? `计算中 ${progress}%` : state === 'done' ? `完成 ${results.length} 个` : '待计算'" />
    </div>
    <div v-if="state === 'working'" class="progress"><span :style="{ width: progress + '%' }"></span></div>

    <div v-if="results.length" class="field" style="margin-top:14px">
      <label>比对校验值（粘贴官网给的摘要，自动逐文件核对）</label>
      <input v-model="expectValue" placeholder="例如 ba7816bf8f01cfea414140de5dae2223..." />
    </div>
    <div v-if="compared" class="msg" :class="compared.hits.length ? 'ok' : 'err'">
      <template v-if="compared.hits.length">
        <b>一致</b>：{{ compared.hits.map((h) => `${h.name}（${h.algo}）`).join('、') }} —— 文件完整，与官方值相符。
      </template>
      <template v-else>
        <b>不一致</b>：已比对该文件组的 {{ compared.checked }} 个摘要，没有与之相同的。<b>建议重新下载</b>该文件。
      </template>
    </div>

    <div v-if="results.length" class="table-wrap">
      <table class="kv">
        <thead>
          <tr><th>文件名</th><th>大小</th><th v-for="a in algos" :key="a">{{ a }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in results" :key="r.name">
            <td class="fname">{{ r.name }}</td>
            <td>{{ formatSize(r.size) }}</td>
            <td v-for="a in algos" :key="a" class="mono">
              <button class="cp" :title="'复制 ' + a" @click="copyText(r.hashes[a], a)">{{ r.hashes[a] }}</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="hint">点击任意摘要即可复制。</p>
    </div>
  </div>

  <!-- 查重 -->
  <div v-else class="panel">
    <DropZone multiple directory hint="拖放文件或整个文件夹" @files="onDupFiles" />
    <div class="row wrap" style="margin-top:12px">
      <button class="btn" :disabled="dupFiles.length < 2" @click="runDup">
        <i class="bi bi-search"></i> 开始查找
      </button>
      <StatusPill :state="dupState" :label="dupState === 'working' ? `扫描中 ${dupProgress}%` : dupState === 'done' ? `完成 ${dupResult.groups.length} 组` : '待扫描'" />
    </div>
    <div v-if="dupState === 'working'" class="progress"><span :style="{ width: dupProgress + '%' }"></span></div>

    <div v-if="dupResult && dupResult.groups.length" class="dup-list">
      <div v-for="(g, i) in dupResult.groups" :key="i" class="dup">
        <div class="dup-head">
          <span class="tag"><i class="bi bi-files"></i> {{ g.count }} 个相同</span>
          <span class="tag warn"><i class="bi bi-hdd"></i> 可释放 {{ formatSize(g.wasted) }}</span>
          <code class="mono">{{ g.hash.slice(0, 24) }}…</code>
        </div>
        <ul class="files">
          <li v-for="f in g.files" :key="f.name + f.size">
            <i class="bi bi-file-earmark"></i>
            <span class="name">{{ f.name }}</span>
            <span class="size">{{ formatSize(f.size) }}</span>
          </li>
        </ul>
      </div>
    </div>
    <p v-else-if="dupResult" class="hint">没有发现内容完全相同的文件（已扫描 {{ dupResult.scanned }} 个）。</p>
    <p class="hint">
      判定依据：先按<b>文件大小</b>粗筛，再对同大小文件逐个计算 SHA-256 —— 只有内容逐字节相同才会被判为重复。
      删除前请自行确认，本工具不会替你删除任何文件。
    </p>
  </div>

  <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
</template>

<style scoped>
.sec-title { margin: 16px 0 8px; font-size: 14px; color: var(--txt, #e6ebf2); display: flex; align-items: center; gap: 7px; }
.sec-title i { color: var(--accent, #38bdf8); }
.algo-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 6px; }
.algo-grid em { display: block; font-style: normal; font-size: 11.5px; color: var(--muted, #93a2bd); margin-top: 2px; }
.table-wrap { margin-top: 16px; overflow-x: auto; }
table.kv { width: 100%; border-collapse: collapse; font-size: 12.5px; }
table.kv th, table.kv td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line, rgba(120,150,200,.16)); }
table.kv th { color: var(--muted, #93a2bd); font-weight: 600; white-space: nowrap; }
.fname { color: var(--txt, #e6ebf2); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mono { font-family: var(--mono, monospace); }
.cp {
  background: none; border: none; padding: 0; cursor: pointer;
  color: var(--accent, #38bdf8); font-family: var(--mono, monospace); font-size: 12px; text-align: left;
}
.cp:hover { text-decoration: underline; }
.dup-list { margin-top: 16px; display: grid; gap: 12px; }
.dup { border: 1px solid var(--line, rgba(120,150,200,.16)); border-radius: 12px; padding: 12px; background: var(--panel-2, rgba(28,37,60,.5)); }
.dup-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.tag.warn { color: var(--warn, #fbbf24); border-color: rgba(251,191,36,.4); }
.dup-head code { font-size: 11.5px; color: var(--muted, #93a2bd); }
</style>
