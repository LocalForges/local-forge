<script setup>
import { TOOLS } from '../lib/formats.js'
import SelfTestPanel from '../components/SelfTestPanel.vue'
import HelpTip from '../components/HelpTip.vue'
</script>

<template>
  <!-- 英雄区 -->
  <section class="hero">
    <span class="hero-badge"><i class="bi bi-shield-lock"></i> 纯浏览器端 · 文件零上传</span>
    <h1 class="hero-title">本地文件工具箱 <span class="grad">LocalForge</span></h1>
    <p class="hero-sub">
      压缩 / 解压 / 转换 / 分享，全部在你的浏览器里完成。文件从不离开设备，
      由 WASM 引擎多线程本地算力驱动——快、私密、离线可用。
    </p>
    <div class="hero-pills">
      <span class="tag"><i class="bi bi-hdd-network"></i> 零上传 · 纯本地</span>
      <span class="tag"><i class="bi bi-lightning-charge"></i> 多线程加速</span>
      <span class="tag"><i class="bi bi-collection"></i> 200+ 归档格式</span>
      <span class="tag"><i class="bi bi-phone"></i> P2P 直传</span>
    </div>

    <HelpTip title="怎么开始？三步走" icon="bi-signpost-split" open>
      <ol class="howto">
        <li>在下方选择要用的工具（如「压缩为 ZIP」「图片工具」）。</li>
        <li>把文件拖进页面的拖放区，或点击「选择文件」（文件不会上传）。</li>
        <li>按提示设置选项，点「开始」，处理完直接下载结果即可。</li>
      </ol>
      <p style="margin:8px 0 0">所有操作都在本地完成；页面底部的「测试回显面板」可一键自检各功能是否正常。</p>
    </HelpTip>
  </section>

  <!-- 工具分组 -->
  <div v-for="g in TOOLS" :key="g.group" class="cat">
    <h2 class="cat-title"><i class="bi bi-collection"></i> {{ g.group }}</h2>
    <div class="tools">
      <RouterLink v-for="t in g.items" :key="t.to" :to="t.to" class="tool-card">
        <i class="bi" :class="t.icon"></i>
        <h3>{{ t.title }}</h3>
        <p>{{ t.desc }}</p>
      </RouterLink>
    </div>
  </div>

  <div class="panel">
    <h3 style="margin-top:0"><i class="bi bi-cpu"></i> 技术选型（相对 ezyzip.pro 的改进）</h3>
    <ul style="color:var(--muted);font-size:13px;line-height:1.9;margin:6px 0 0">
      <li><b style="color:var(--txt)">zip.js 2.15</b> + 多线程 + AES-256（原版 2.8.34，且真正启用多线程与分卷）</li>
      <li><b style="color:var(--txt)">libarchive.js</b> 开源 WASM 写/读引擎，覆盖 ZIP/7Z/TAR/ISO/RAR/APK/DMG… 200+ 格式</li>
      <li><b style="color:var(--txt)">@ffmpeg/ffmpeg 多线程内核</b>（SharedArrayBuffer）补齐网页端音视频转换</li>
      <li><b style="color:var(--txt)">upng-js（类 TinyPNG）量化</b>图片有损压缩 + 保透明，全程零上传</li>
      <li><b style="color:var(--txt)">WebRTC</b> 点对点文件直传（P2P 分享，手动信令，无需服务器）</li>
      <li><b style="color:var(--txt)">COOP/COEP 跨源隔离头</b>真正启用，发挥多线程与 WASM 性能</li>
    </ul>
  </div>

  <SelfTestPanel />
</template>

<style scoped>
.hero {
  position: relative;
  padding: 14px 0 6px;
}
.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--accent-2, #34d399);
  border: 1px solid rgba(52,211,153,.35);
  background: rgba(52,211,153,.08);
  padding: 5px 12px;
  border-radius: 999px;
  margin-bottom: 14px;
}
.hero-title {
  font-size: 34px;
  line-height: 1.2;
  margin: 0 0 12px;
  font-weight: 800;
  letter-spacing: .2px;
}
.hero-title .grad {
  background: var(--grad, linear-gradient(120deg,#38bdf8,#a78bfa));
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.hero-sub {
  color: var(--muted, #93a2bd);
  font-size: 15px;
  line-height: 1.75;
  max-width: 640px;
  margin: 0 0 16px;
}
.hero-pills { display: flex; flex-wrap: wrap; gap: 9px; }
</style>
