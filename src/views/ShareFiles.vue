<script setup>
import { ref, computed } from 'vue'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
import StepBar from '../components/StepBar.vue'
import StatusPill from '../components/StatusPill.vue'
import { formatSize } from '../utils.js'

const role = ref('send') // send | receive
const file = ref(null)
const localSDP = ref('') // 本端需发给对方的
const remoteSDP = ref('') // 对方粘贴过来的
const status = ref('')
const progress = ref(0)
const busy = ref(false)
const pc = ref(null)
const recvName = ref('')
const recvBlob = ref(null)

function onFiles(list) {
  file.value = list[0] || null
}
function makePC() {
  const c = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
  return c
}
async function startSend() {
  if (!file.value) return
  busy.value = true
  status.value = '正在生成本端邀请（Offer）…'
  const c = makePC()
  pc.value = c
  const ch = c.createDataChannel('file')
  ch.binaryType = 'arraybuffer'
  ch.onopen = () => {
    status.value = '通道已建立，开始发送…'
    sendFile(ch)
  }
  const offer = await c.createOffer()
  await c.setLocalDescription(offer)
  await waitIce(c)
  localSDP.value = btoa(JSON.stringify(c.localDescription))
  status.value = '复制下方「本端邀请」发给对方，并把对方的「应答」粘贴回来。'
  busy.value = false
}
async function acceptSendAnswer() {
  const desc = JSON.parse(atob(remoteSDP.value))
  await pc.value.setRemoteDescription(desc)
  status.value = '已接受应答，等待通道建立…'
}
function sendFile(ch) {
  const chunk = 16 * 1024
  const buf = new Uint8Array(file.value.size)
  let off = 0
  const reader = new FileReader()
  reader.onload = () => {
    buf.set(new Uint8Array(reader.result), 0)
    ch.send(JSON.stringify({ name: file.value.name, size: file.value.size }))
    let i = 0
    const tick = () => {
      const end = Math.min(i + chunk, buf.length)
      ch.send(buf.slice(i, end))
      i = end
      progress.value = Math.round((i / buf.length) * 100)
      if (i < buf.length) setTimeout(tick, 0)
      else { status.value = '发送完成 ✅'; setTimeout(() => ch.send('__END__'), 50) }
    }
    tick()
  }
  reader.readAsArrayBuffer(file.value)
}
async function startReceive() {
  if (!remoteSDP.value) return
  busy.value = true
  status.value = '正在准备接收…'
  const c = makePC()
  pc.value = c
  const chunks = []
  let meta = null
  c.ondatachannel = (e) => {
    const ch = e.channel
    ch.binaryType = 'arraybuffer'
    ch.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        if (ev.data === '__END__') {
          const blob = new Blob(chunks)
          recvBlob.value = blob
          recvName.value = meta?.name || 'received'
          status.value = `接收完成 ✅ ${formatSize(blob.size)}`
          return
        }
        meta = JSON.parse(ev.data)
        status.value = '接收中：' + meta.name
        return
      }
      chunks.push(ev.data)
      if (meta) progress.value = Math.round((chunks.reduce((s, b) => s + b.byteLength, 0) / meta.size) * 100)
    }
  }
  const offer = JSON.parse(atob(remoteSDP.value))
  await c.setRemoteDescription(offer)
  const answer = await c.createAnswer()
  await c.setLocalDescription(answer)
  await waitIce(c)
  localSDP.value = btoa(JSON.stringify(c.localDescription))
  status.value = '复制下方「本端应答」回发给发送方即可开始接收。'
  busy.value = false
}
function waitIce(c) {
  return new Promise((res) => {
    if (c.iceGatheringState === 'complete') return res()
    c.onicegatheringstatechange = () => { if (c.iceGatheringState === 'complete') res() }
    setTimeout(res, 1500)
  })
}
function downloadRecv() {
  if (recvBlob.value) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(recvBlob.value)
    a.download = recvName.value
    a.click()
  }
}

// 当前流程的步骤指引（发送方 / 接收方）
const flowSteps = computed(() => {
  const done = /完成/.test(status.value || '')
  if (role.value === 'send') {
    return [
      { label: '生成邀请', state: localSDP.value ? 'done' : 'active' },
      { label: '粘贴对方应答并连接', state: localSDP.value && remoteSDP.value ? 'done' : (localSDP.value ? 'active' : 'todo') },
      { label: '发送文件', state: done ? 'done' : (localSDP.value ? 'active' : 'todo') },
    ]
  }
  return [
    { label: '粘贴对方邀请', state: remoteSDP.value ? 'done' : 'active' },
    { label: '生成应答', state: localSDP.value ? 'done' : (remoteSDP.value ? 'active' : 'todo') },
    { label: '接收文件', state: recvBlob.value ? 'done' : (localSDP.value ? 'active' : 'todo') },
  ]
})
const flowState = computed(() => {
  if (/完成/.test(status.value || '')) return 'done'
  if (busy.value) return 'working'
  if (/失败|错误/.test(status.value || '')) return 'error'
  return 'idle'
})
</script>

<template>
  <h1 class="page-title">P2P 文件分享</h1>
  <p class="page-sub">基于 WebRTC 点对点直传，文件不经任何服务器。两人通过复制/粘贴「邀请码」完成握手（无需后端）。</p>

  <HelpTip title="怎么点对点传文件？（两步握手）" icon="bi-share" open tone="tip">
    <ol class="howto">
      <li><b>发送方</b>点「生成邀请」，把出现的「本端邀请」码发给对方。</li>
      <li><b>接收方</b>把邀请码粘贴进来，点「生成应答」，再把「本端应答」码回发给发送方。</li>
      <li>发送方粘贴应答并连接，通道建立后文件直接点对点传输，<b>不经过任何服务器</b>。</li>
    </ol>
    <p style="margin:8px 0 0">提示：邀请/应答码只是一串握手信息，不含文件内容；传完即断连。</p>
  </HelpTip>

  <div class="tabs">
    <button :class="{ active: role === 'send' }" @click="role = 'send'">发送方</button>
    <button :class="{ active: role === 'receive' }" @click="role = 'receive'">接收方</button>
  </div>

  <StepBar :steps="flowSteps" />

  <div class="panel">
    <StatusPill :state="flowState" :label="status || (busy ? '处理中…' : '等待操作')" />
    <template v-if="role === 'send'">
      <DropZone :multiple="false" single="文件" hint="选择要发送的文件" @files="onFiles" />
      <div v-if="file" class="status">待发送：<b style="color:var(--txt)">{{ file.name }}</b> · {{ formatSize(file.size) }}</div>
      <div class="row wrap">
        <button class="btn" :disabled="busy || !file" @click="startSend"><i class="bi bi-send"></i> 1. 生成邀请</button>
        <button class="btn ghost" :disabled="!pc" @click="acceptSendAnswer"><i class="bi bi-check2"></i> 2. 粘贴对方应答并连接</button>
      </div>
    </template>
    <template v-else>
      <div class="field"><label>1. 粘贴发送方的「邀请」</label>
        <textarea v-model="remoteSDP" rows="3" style="width:100%"></textarea></div>
      <button class="btn" :disabled="busy || !remoteSDP" @click="startReceive"><i class="bi bi-reply"></i> 2. 生成应答</button>
      <div v-if="recvBlob" class="row wrap"><button class="btn green" @click="downloadRecv"><i class="bi bi-download"></i> 下载 {{ recvName }} ({{ formatSize(recvBlob.size) }})</button></div>
    </template>

    <div class="field" v-if="localSDP"><label>本端凭证（发给对方）</label>
      <textarea :value="localSDP" rows="3" readonly style="width:100%;font-family:monospace;font-size:11px"></textarea>
      <button class="btn ghost" @click="navigator.clipboard.writeText(localSDP)"><i class="bi bi-clipboard"></i> 复制</button>
    </div>
    <div v-if="role === 'receive' && !localSDP && remoteSDP" class="field"><label>本端应答（回发发送方）</label></div>

    <div v-if="busy || progress" class="progress"><span :style="{ width: progress + '%' }"></span></div>
    <div v-if="status" class="msg info">{{ status }}</div>
  </div>
</template>
