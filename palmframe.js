// 由手部关键点构造"掌心坐标系"：模型底面贴在掌心、纵轴沿手指方向。
// 纯数组运算、不依赖 three.js，所以可以在 Node 里用合成关键点离线验证（node _test_palm.mjs）。
//
// 坐标空间约定：palmBasis 的输入必须是"显示空间"的坐标，即页面镜像显示视频之后用户实际看到的
// 那个空间（x 右、y 上、z 指向相机）。页面用 toDisplay() 从 MediaPipe 的世界坐标换算过来。
// 需要的关键点：0 腕、9 中指根、5 食指根、17 小指根。
//
// 为什么要单独做这个文件（两个线上缺陷）：
// ① 法线的符号原先由"首帧与相机光轴的点积正负 + 之后上一帧连续"决定，也就是由相机决定而不是由手决定。
//    掌心正对镜头开场时侥幸正确，手背朝镜头开场时符号被定反并且整场沿用；手掌转到侧向时点积≈0，
//    符号取决于 1e-5 量级的残差，模型就"方向不对"甚至整只翻面。
//    现在改成：cross(小指根→食指根, 中指根→腕) 的原始符号对左手/右手天然相反，
//    用每只手一个常数抵消，符号于是成为手姿的连续函数，与开场姿势、与相机光轴都无关。
// ② 页面把视频用 CSS 水平镜像显示（自拍视角），位置一路做了 1-cx 补偿，朝向一路没有，
//    于是"手往右倾、模型往左旋"。现在两路都在显示空间里算，倾转方向才与看到的一致。
// 换轴带来的取向约定差异由 flip 常数吸收；某台设备若左右手标签口径相反，页面上"翻转这只手"现场校正并按手记住。

const v3 = p => (Array.isArray(p) ? [p[0], p[1], p[2]] : [p.x, p.y, p.z]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]); return l < 1e-9 ? null : [a[0] / l, a[1] / l, a[2] / l]; };

export const HS_DEFAULT = { Right: -1, Left: 1 };

// MediaPipe 世界坐标（原始帧）→ 显示空间（水平镜像）：x 取反，y、z 不变
export function toDisplay(wl) {
  if (!wl) return null;
  const out = [];
  for (let i = 0; i < wl.length; i++) { const p = v3(wl[i]); out.push([-p[0], p[1], p[2]]); }
  return out;
}

// 返回掌心正交基 {x,y,z}（右手系，可直接作 makeBasis 的三列）与所用符号；
// 关键点退化时返回 null，由调用方保留上一帧姿态（不要在此时改姿态，否则抖动会变成抽搐）。
export function palmBasis(wl, handed, flip = HS_DEFAULT, prevN = null) {
  if (!wl || !wl[0] || !wl[9] || !wl[5] || !wl[17]) return null;
  const y = norm(sub(v3(wl[0]), v3(wl[9])));               // 中指根 → 腕（与旧实现的纵轴约定一致）
  if (!y) return null;
  const across = norm(sub(v3(wl[5]), v3(wl[17])));         // 小指根 → 食指根
  if (!across) return null;
  const raw = norm(cross(across, y));
  if (!raw) return null;

  // 符号：能用左右手标签就用标签（与相机无关）；标签缺失才退化为"与上一帧连续"
  const sign = flip[handed] ? flip[handed] : (prevN && dot(raw, prevN) < 0 ? -1 : 1);
  const n = [raw[0] * sign, raw[1] * sign, raw[2] * sign];

  let x = [-n[0], -n[1], -n[2]];                           // 以 -法线 为 x 轴
  x = norm(sub(x, y.map(v => v * dot(x, y))));            // 对 y 正交化，保证基底正交
  if (!x) return null;
  const z = norm(cross(x, y)); if (!z) return null;        // z = x × y，右手系
  return { x, y, z, n, sign };
}
