# 文化 WebAR 最小 Demo（全国仿真创新应用大赛 · 数字文创艺术设计方向）

技术路线：**AR.js + A-Frame 图像追踪**，纯前端，库已本地内置（`libs/`），断网可跑。
目标闭环：**识别一张图 → 在其上叠加可交互的 3D 文化展品**。

---

## 0. 目录结构
```
webar-demo/
├─ index.html            生产版：<a-nft> 图像追踪，用你选定的文化识别图（需先生成描述符）
├─ hiro-quickstart.html  开箱验证版：用 AR.js 自带 hiro 预设，零素材即可证明 AR 链路跑通
├─ serve.mjs             零依赖 Node 静态服务器（无需 npm install）
├─ package.json
├─ libs/                 已内置：aframe.min.js(1.4.2) + aframe-ar-nft.js(AR.js 3.4.6)
├─ assets/               放 3D 模型(.glb)与原始文化识别图  —— 见 assets/README.md
└─ data/                 放识别图描述符 pattern.fset/.iset/.keypar —— 见 data/README.md
```

## 1. 本机跑起来（桌面浏览器）
```bash
cd 准备阶段/webar-demo
node serve.mjs            # 默认 http://localhost:8000
```
浏览器打开 `http://localhost:8000`（默认进 hiro-quickstart.html）。
localhost 是安全上下文，可直接授权摄像头。
- **验证 AR 是否通**：打印一张 AR.js 的 hiro 图案（[示例图](https://raw.githubusercontent.com/AR-js-org/AR.js/master/data/patt/hiro.png)）对准摄像头，出现旋转方块即通过。

## 2. 手机真机测试（关键坑）
摄像头 `getUserMedia` 只在**安全上下文**可用。本机 localhost 没问题，但手机经局域网 `http://192.168.x.x:8000` 打开属**非安全上下文，多数浏览器会拒绝开摄像头**。三选一：
1. **自签 HTTPS**（最快，需 Git 自带 openssl）：
   ```bash
   mkdir -p certs
   openssl req -x509 -newkey rsa:2048 -keyout certs/key.pem -out certs/cert.pem -days 3650 -nodes -config certs/openssl.cnf -extensions v3
   node serve.mjs --https --host 0.0.0.0     # 手机访问 https://<本机局域网IP>:8443，首次忽略证书警告
   ```
   > 证书已生成（`certs/`，含 SAN: localhost + 192.168.31.193）。若 openssl 命令行 `-subj "/CN=..."` 在 Git-bash 下被当路径报错，用配置文件方式（见 certs/openssl.cnf）。
2. **GitHub Pages**（推荐正式演示/答辩用，自带 HTTPS，扫码即用，契合比赛"HTML5 链接/二维码"展现形式）。
3. **cloudflared 临时隧道**：`cloudflared tunnel --url http://localhost:8000` 得一个 https 临时域名，路演应急。

### 2.1 内置摄像头选择器（手机多摄/黑屏时用）
两个页面都加了"选择摄像头后开始"启动层（`launcher.js`）：进入页面先列摄像头、选一台点"开始 AR"，黑屏就点右上"重选摄像头"换下一台。原理是 AR.js 的 `arjs` 组件支持 `deviceId` 入参（默认已是 `facingMode:environment` 后置）。脚本会自动把虚拟/隐私摄像头（AMD Privacy View / OBS / Parsec 等）排到最后。
> 若逐台选完手机仍全黑：多半是 AR.js 默认请求 1280×720 该机型不支持，下一步可固定 `sourceWidth/sourceHeight` 或改用 MindAR 变体。

### 2.1b 手机发热掉帧（不是内存泄漏，是算力/热降频）
堆平稳但 FPS 慢慢掉 = CPU/GPU 满载热降频。已内置两把几何安全的降载杠杆（不改采集尺寸、不会错位）：
- `renderer pixelRatio` 锁 1（治 GPU）；`?dpr=2` 可恢复高清。
- AR.js 内置性能档 `performanceProfile`，默认 `phone-normal`（处理画布 240、检测 30/s）。更省：`?profile=phone-slow`；对比：`?profile=desktop-normal`。
- 读数：URL 加 `?perf=1` 看 FPS + JS 堆。组合示例 `?perf=1&profile=phone-slow`。
> 别用 `sourceWidth/sourceHeight` 降分辨率——它会改变视频元素尺寸导致画面错位、marker 识别不到（已踩坑）。

### 2.2 手机浏览器兼容（实测坑，重要）
WebAR 摄像头在手机上高度依赖浏览器实现。姜定昌这台(骁龙8Gen3/Adreno750)实测矩阵：

| 浏览器 | 摄像头 | 视频预览 | AR.js | MindAR |
|--------|--------|----------|-------|--------|
| Via | ✗ 不给授权(NotAllowedError) | — | 不可用 | 不可用 |
| Chrome | ✓ | **越来越卡**(画面几帧/3D顺，切后台短暂恢复) | 能识别但预览卡 | 同样卡 |
| 夸克 Quark | ✓ | **顺** | 竖屏/横屏都**缩放错位**(只显一角) | **开不了摄像头**(转圈) |

**✅ 已找到可用组合：夸克(Quark) + MindAR + 显式 deviceId 改写**（实测"效果绝佳"）。
- 关键：MindAR 的 aframe 组件把摄像头约束写死成 `facingMode:'environment'`，夸克对它会卡住转圈；在启动那一刻**改写 `getUserMedia` 用显式 `deviceId`**（见 `mindar-launch.html`）即可绕开。
- 纯 `<video>` 在 Chrome 也卡 → 卡是浏览器视频合成，与 AR 引擎无关；夸克视频通道顺。
- AR.js 竖屏错位是其已知硬伤 → **移动端主引擎定 MindAR**，AR.js 仅留作桌面/备用。

**定组合速查（给实际演示机/王子涵，约2分钟）**：
1. 手机开 `camera-test.html` → 换 2–3 个浏览器，看哪个**纯视频就顺**(实测呈现 fps≈30)。
2. 用那个顺的浏览器开 `mindar-launch.html`(MindAR) → 选摄像头→启动；顺且全屏正确即定 **该浏览器 + MindAR**。
3. 若某浏览器 MindAR 卡摄像头，多半是 facingMode 问题，用 deviceId 改写页即可。

> 比赛主交付是"演示视频 + 报告 + PPT"，在顺的设备/浏览器上**录屏**即可，实时预览的浏览器差异不影响提交；答辩用已验证顺的设备/浏览器。

## 3. 换成你的文化选题（生产版 index.html = MindAR）
1. 选纹理丰富、非对称、≥1000×1000 的文化图片；原始图放 `assets/`。
2. 用 MindAR 官方 Image Editor 生成 `.mind`：打开 https://hiukim.github.io/mind-ar-js/examples/image-tracking/ 的编译页（或 `examples/image-tracking/compile.html`），拖入文化图 → 导出 `.mind` → 放 `mindar/`，并把 `index.html` 里 `imageTargetSrc` 指到它。
3. 找低面数 `.glb` 文化模型放 `assets/`；在 `index.html` 的 `<a-entity id="culture-slot">` 里把占位 `<a-box>` 换成
   `<a-entity gltf-model="./assets/model-a.glb" animation-mixer scale="0.5 0.5 0.5"></a-entity>`。
4. 改底部三个按钮的 `data-name / data-desc`，并把切换逻辑改成换对应 `.glb`（或改用多目标：一个 `.mind` 放多张识别图，各挂 `<a-entity mindar-image-target="targetIndex: N">`）。
> 默认 `imageTargetSrc` 指向官方示例 `mindar/card.mind`（打印 `mindar/card.png` 即可先跑通），换成你的 `.mind` 后即接真实内容。
> AR.js 的 `data/pattern.*` 描述符流程已随主引擎切换为**备用**（桌面/AR.js 路线才用）。

## 4. 已知状态（本机已验证 2026-10-01）
- A-Frame 1.4.2 / THREE 0.147.1 / AR.js 3.4.6(artoolkit) 均成功加载，ARToolkit 初始化通过，HUD 与切换按钮渲染正常。
- 自动化浏览器里唯一报错是摄像头权限被拒（预期内）；真机授权后即恢复。
- 实体识别图追踪须真机+打印标记由人工验证，本环境无法代验。
- ⚠ **坑（已修）**：`html/body` 若设不透明背景（如 `background:#000`），会把 AR.js 的 `z-index:-1` 摄像头视频层盖成黑屏（现象：授权后画面一闪即全黑）。改样式别加回黑底。桌面用 `localhost`、手机用 `--https`，别用局域网 http（非安全上下文会被拦摄像头）。
- 本机摄像头分诊：Integrated Camera 正常(帧亮度~72)，另有 "AMD Privacy View camera" 虚拟设备，默认走真实那颗，无需干预。`camera-test.html` 可随时复查。

## 5. 套壳 APK（后期 P1，暂不做）
本机 Java 为 **1.8**，而 Capacitor + Android Gradle 需 **JDK 17 + Android SDK**。到打包阶段再装（装到 `D:\Software\...` 新子目录），然后：
```bash
npm i @capacitor/core @capacitor/cli @capacitor/android
npx cap init && npx cap add android && npx cap sync && npx cap open android
```
> 若走 GitHub Pages 二维码方案，可不套壳，直接交付链接，规则同样允许（交互开发类支持 HTML5 链接/二维码）。

## 6. 进阶备选（见 准备阶段/开源AR资源评估.md）
- **MindAR**：图像追踪比 AR.js 更稳，专治"纯色/细节少识别抖"。若 AR.js 识别不稳，可换主引擎。
- **8th Wall（已开源）**：质量最高但 SLAM 仍封闭、需自建托管，时间紧时不建议。
