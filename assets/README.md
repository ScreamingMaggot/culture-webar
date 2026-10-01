# assets/ — 3D 模型与文化图片资源

放入内容：
- `model-a.glb` / `model-b.glb` / `model-c.glb`：文化展品 3D 模型，务必 **glb/gltf、低面数**（手机 WebAR 面数过高会卡）。
- 原始文化识别图（如 `culture-source.png`），用于打印给观众对准摄像头。

在 HTML 中把占位方块替换为：
```html
<a-entity gltf-model="./assets/model-a.glb" animation-mixer scale="0.15 0.15 0.15"></a-entity>
```

免费 glb 来源（注意版权，比赛素材不能乱用）：
- Khronos glTF Sample Models
- Poly.pizza (CC0)
- Sketchfab（筛选可下载 + 核对授权协议）
