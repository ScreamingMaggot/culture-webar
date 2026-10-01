// launcher.js — 摄像头选择启动层（AR.js 用 arjs 的 deviceId 入参选设备）
// 移动端要点：权限未授予前 enumerateDevices 常返回空；须在 getUserMedia 成功后、流仍存活时枚举，才拿到带标签的设备。
(function () {
  const launcher = document.getElementById('launcher');
  const sel = document.getElementById('camSel');
  const status = document.getElementById('camStatus');
  const startBtn = document.getElementById('camStart');
  const tpl = document.getElementById('scene-tpl');
  const badge = document.getElementById('badge') || document.getElementById('warn');
  const AUTO = '__auto__';
  let sceneEl = null;

  const BAD = /privacy|virtual|obs|parsec|emulator|hello|windows\s*hello|3d\s*sr|背景|blur|bokeh/i;
  const score = (d) => {
    const l = (d.label || '').toLowerCase();
    if (BAD.test(l)) return -10;
    if (/back|environment|rear|arri|后置|主摄|广角|wide/i.test(l)) return 30;
    if (/front|user|face|前置/i.test(l)) return 5;
    return 20;
  };

  // 注入一个"授权并列出摄像头"按钮（移动端需用户手势触发权限弹窗）
  let grantBtn = document.getElementById('camGrant');
  if (!grantBtn) {
    grantBtn = document.createElement('button');
    grantBtn.id = 'camGrant';
    grantBtn.textContent = '① 授权并列出摄像头';
    grantBtn.style.cssText = 'padding:12px 22px;border:0;border-radius:12px;font-size:16px;font-weight:700;color:#fff;background:#1f9d55;cursor:pointer';
    const row = document.createElement('div'); row.className = 'lrow'; row.appendChild(grantBtn);
    launcher.insertBefore(row, launcher.querySelector('#camStatus'));
  }

  function populate(devs) {
    const prev = sel.value;
    sel.replaceChildren();
    const o0 = document.createElement('option'); o0.value = AUTO; o0.textContent = '自动（优先后置）'; sel.appendChild(o0);
    devs.sort((a, b) => score(b) - score(a));
    devs.forEach((d) => {
      const o = document.createElement('option'); o.value = d.deviceId;
      o.textContent = d.label || ('摄像头 ' + d.deviceId.slice(0, 4)); sel.appendChild(o);
    });
    if (prev) sel.value = prev;
    if (devs[0]) sel.value = devs[0].deviceId;
    status.textContent = devs.length
      ? ('发现 ' + devs.length + ' 个摄像头。选一台点"开始 AR"；黑屏就换下一台（重选）。')
      : ('仍未列出摄像头。请确认地址栏摄像头权限=允许，再点"授权并列出"。也可先用"自动"试。');
    startBtn.disabled = false;
  }

  async function listSilently() {
    let devs = [];
    try { devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'); } catch (e) {}
    populate(devs);
    if (!devs.length) status.textContent = '未检测到摄像头（多半是还没授权）。请点上方"① 授权并列出摄像头"。';
  }

  async function grantAndList() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      status.textContent = '该浏览器不支持 getUserMedia（须 https 或 localhost）'; return;
    }
    grantBtn.disabled = true; status.textContent = '请在弹窗点"允许"…';
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true }); // 用普通约束，最大化授权成功率
    } catch (e) {
      status.textContent = '授权失败：' + e.name + '（' + e.message + '）— 检查浏览器摄像头权限设置';
      grantBtn.disabled = false; return;
    }
    let devs = [];
    try { devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'); } catch (e) {}
    if (stream) stream.getTracks().forEach((t) => t.stop()); // 枚举完再停，保证拿到标签
    grantBtn.disabled = false;
    grantBtn.textContent = '↻ 重新列出摄像头';
    populate(devs);
  }

  function launch() {
    const q = new URLSearchParams(location.search);
    // 回到已验证可识别的配置：默认采集分辨率 + trackingMethod best（不改视频几何，避免错位）
    // 降 CPU 用 AR.js 内置性能档（只缩内部处理画布 canvasHeight + 限检测频率），手机默认 phone-normal
    const profile = q.get('profile') || 'phone-normal';
    // tm=best 每帧插值(顺) / default 仅检测帧(省但顿)。默认 best 保证流畅；热降频时再权衡
    const tm = q.get('tm') || 'best';
    let arjs = 'sourceType: webcam; debugUIEnabled: false; detectionMode: mono; trackingMethod: ' + tm + '; performanceProfile: ' + profile + ';';
    if (q.get('rate')) arjs += ' maxDetectionRate: ' + q.get('rate') + ';';
    if (sel.value && sel.value !== AUTO) arjs += ' deviceId: ' + sel.value + ';';
    const frag = tpl.content.cloneNode(true);
    const scene = frag.querySelector('a-scene');
    scene.setAttribute('arjs', arjs);
    // 手机发热主因是高 DPI 下 WebGL 画布按 devicePixelRatio 放大。锁 pixelRatio=1 大幅减 GPU 负载，且不影响 AR 对齐。
    scene.setAttribute('renderer', 'pixelRatio: ' + (q.get('dpr') || '1') + ';');
    if (q.has('perf')) scene.setAttribute('stats', '');
    document.body.appendChild(frag);
    sceneEl = document.querySelector('a-scene');
    if (launcher) launcher.style.display = 'none';
    if (badge) badge.style.display = 'none';
    if (q.has('perf')) startPerf();
    document.dispatchEvent(new CustomEvent('ar:launched', { detail: { scene: sceneEl } }));
  }

  // 性能读数：rAF 渲染帧时 + 摄像头真实进帧率 + JS 堆。
  // 用途：区分"渲染掉帧"与"渲染满帧但摄像头/检测只给几帧"（后者才是本例的元凶）。
  function startPerf() {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:44px;left:10px;z-index:10001;font:12px ui-monospace,Consolas,monospace;color:#9fe870;background:rgba(0,0,0,.6);padding:6px 8px;border-radius:8px;white-space:pre';
    document.body.appendChild(el);
    let last = performance.now(), secMark = last, frames = 0, n = 0, sum = 0, worst = 0, over33 = 0, over50 = 0;
    let camFrames = 0, camFps = 0, camTrack = null, videoEl = null;

    function attachVideo() {
      const v = document.querySelector('video');
      if (v && v !== videoEl) {
        videoEl = v;
        if (v.srcObject && v.srcObject.getVideoTracks) camTrack = v.srcObject.getVideoTracks()[0];
        if (v.requestVideoFrameCallback) {
          const cb = () => { camFrames++; v.requestVideoFrameCallback(cb); };
          v.requestVideoFrameCallback(cb);
        } else { camFps = -1; } // 不支持则标 N/A
      }
      if (!videoEl) setTimeout(attachVideo, 400);
    }
    attachVideo();

    function loop(now) {
      const dt = now - last; last = now;
      if (dt > 0 && dt < 1000) { sum += dt; n++; if (dt > worst) worst = dt; if (dt > 33) over33++; if (dt > 50) over50++; }
      frames++;
      if (now - secMark >= 1000) {
        const fps = Math.round(frames * 1000 / (now - secMark));
        const avg = n ? sum / n : 0;
        let mem = '';
        if (performance.memory) mem = ' 堆:' + (performance.memory.usedJSHeapSize / 1048576).toFixed(1) + 'MB';
        let camLine = '摄像头: ';
        if (!videoEl) {
          camLine += '未发现<video>元素(纹理模式?)';
        } else if (camTrack) {
          const s = camTrack.getSettings();
          camLine += 'track实时 ' + (Math.round(s.frameRate) || '?') + 'fps  ' + s.width + 'x' + s.height + '  rVFC ' + camFps;
        } else {
          camLine += '有video但无track  rVFC ' + camFps;
        }
        el.textContent =
          '渲染 rAF ' + fps + 'fps  帧时 avg' + avg.toFixed(1) + '/最差' + worst.toFixed(0) + 'ms  超50ms:' + over50 + '帧' + mem + '\n' +
          camLine;
        frames = 0; n = 0; sum = 0; worst = 0; over33 = 0; over50 = 0; camFps = 0; camFrames = 0; secMark = now;
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  function rechoose() {
    if (sceneEl) { const s = sceneEl; if (s.parentNode) s.parentNode.removeChild(s); sceneEl = null; }
    if (launcher) launcher.style.display = 'flex';
    if (badge) badge.style.display = '';
  }

  if (startBtn) startBtn.addEventListener('click', launch);
  if (grantBtn) grantBtn.addEventListener('click', grantAndList);
  const rc = document.getElementById('camRechoose');
  if (rc) rc.addEventListener('click', rechoose);
  window.__arRechoose = rechoose;

  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    status.textContent = '该浏览器不支持 enumerateDevices（须 https 或 localhost）'; startBtn.disabled = false;
  } else {
    listSilently();
  }
})();
