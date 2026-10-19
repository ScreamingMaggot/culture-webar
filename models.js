// 模型的轴系预设（由几何分析得出，不靠猜）：
//   up   = 模型本地"向上"的轴
//   head = 模型本地"头朝向"的轴（从身体指向头）
// a19：趴着导出，+Z 向上、头在 -X、Y 为左右；longma：直立导出，+Y 向上、头在 -X。
// 判定依据：
//   · a19：沿 Z 的底部切片恰好 4 个连通簇（四腿），沿 Y 的底部切片只有 1 簇；
//   · longma：Y 底面≈0；X 低端顶端宽 2.6（头颈），X 高端顶端宽 0.33（细尾）；
//   · a19 的"头在 -X"另由掌心版实测（180° 翻转后方向才对）与识别卡版的既有朝向约定印证。
export const MODELS = {
  a19:    { name: '龙马 A19', url: './assets/a19.min.glb',    up: [0, 0, 1], head: [-1, 0, 0] },
  longma: { name: '龙马 Longma',     url: './assets/longma.min.glb', up: [0, 1, 0], head: [-1, 0, 0] },
};

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// 统一姿态：上 → 世界 +Y、头 → 世界 -X（与识别卡版的朝向公式 atan2(dz,-nx) 一致）。
// 返回三列（makeBasis 的 x/y/z），右手系。
export function standColumns(m) {
  const col0 = [-m.head[0], -m.head[1], -m.head[2]];     // 局部 +X 的像：头指向世界 -X
  if (m.up[2] === 1) {                                   // 上 = 局部 +Z
    const col2 = [0, 1, 0];
    return [col0, cross(col2, col0), col2];
  }
  const col1 = [0, 1, 0];                                // 上 = 局部 +Y
  return [col0, col1, cross(col0, col1)];
}

// 掌心版：把各模型的本地轴对齐到 a19 的本地轴（上=+Z、头=-X），
// 这样已经调好的 roll/yaw/pitch 参数对三个模型都成立。
export function a19Columns(m) {
  const col0 = [-m.head[0], -m.head[1], -m.head[2]];
  if (m.up[2] === 1) {                                   // 已经是 a19 的轴系
    const col2 = [0, 0, 1];
    return [col0, cross(col2, col0), col2];
  }
  const col1 = [0, 0, 1];                                // longma 的 +Y → a19 的 +Z（绕 X 转 90°）
  return [col0, col1, cross(col0, col1)];
}
