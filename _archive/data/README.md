# data/ — 识别图描述符目录

生产版 `index.html` 用 `<a-nft type="image" url="data/pattern">` 做图像追踪，
AR.js 会自动去加载同名的三个描述符文件（不带扩展名）：

- `pattern.fset`
- `pattern.iset`
- `pattern.keypar`

## 怎么生成
1. 选一张纹理丰富、非对称构图的文化图片（建议 ≥ 1000×1000，300dpi 左右，纯色/对称图识别不稳）。
2. 打开在线工具 https://ar-js-org.github.io/NFT-Marker-Creator/
3. 上传该 JPG/PNG，点 Generate，浏览器会下载上述三个文件。
4. 把这三个文件放进本目录（默认命名 `pattern.*`；若改名，同步改 index.html 里的 `url`）。
5. 原始文化图片另存到 `assets/`，供打印给观众对准摄像头。

> 这一步属于你的文化选题决策，工程里不预置，避免替你把内容做死。链路想先验证请用 `hiro-quickstart.html`。
