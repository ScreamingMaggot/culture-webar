// 桌面标定的几何核心：从"桌面米制坐标 ↔ 画面像素"的四点对应，
// 解出单应矩阵，再分解出与这张桌面透视一致的虚拟相机（旋转 R、相机中心 C、焦距 f）。
// 纯数组运算、不依赖 three.js，便于离线用随机姿态做重投影验证（见 _test_table.mjs）。
//
// 坐标约定：
//   · 桌面坐标：x 沿桌宽、z 沿桌深、y 垂直于桌面向上的高度；模型底面落在 y=0 平面。
//   · 相机坐标（计算机视觉惯例）：x 右、y 下、z 朝前。
//   · 投影：u = f*x/z + cx，v = f*y/z + cy；焦距 f 以像素计，垂直视场决定。

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mulv = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]); return l < 1e-12 ? null : [a[0] / l, a[1] / l, a[2] / l]; };

// 3×3 矩阵用行优先数组 [m00..m22]
const mul33 = (A, B) => {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
    o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
  return o;
};

// 四点 DLT 求单应：src(桌面米制) → dst(像素)。八元线性方程，高斯消元。
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const n = 8;
  const M = A.map((r, i) => r.concat(b[i]));
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    const t = M[i]; M[i] = M[p]; M[p] = t;
    if (Math.abs(M[i][i]) < 1e-12) return null;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = M[r][i] / M[i][i];
      for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c];
    }
  }
  const h = M.map((r, i) => r[n] / r[i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function applyH(H, x, y) {
  const X = H[0] * x + H[1] * y + H[2], Y = H[3] * x + H[4] * y + H[5], W = H[6] * x + H[7] * y + H[8];
  return [X / W, Y / W];
}

export function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = c * h - b * i, C = b * f - c * e,
        D = f * g - d * i, E = a * i - c * g, F = c * d - a * f,
        G = d * h - e * g, Hh = b * g - a * h, I = a * e - b * d;
  const det = a * A + b * D + c * G;
  if (!det) return null;
  const q = 1 / det;
  return [A * q, B * q, C * q, D * q, E * q, F * q, G * q, Hh * q, I * q];
}

// 由垂直视场角得到像素焦距
export const focalPx = (imgH, fovDeg) => (imgH / 2) / Math.tan(fovDeg * Math.PI / 360);

// 从单应自己估计焦距：把像素平移到以主点为中心后，K = diag(f,f,1)，
// 正交约束 h1ᵀ·K⁻ᵀK⁻¹·h2 = 0 给出 f² = -(a_x b_x + a_y b_y)/(a_z b_z)（a、b 为 K 作用前的两列）。
// 这样用户拖出来的四点本身就决定了视场，渲染色透视才与框一致；解不出来时由调用方回落默认视场。
export function estimateFocal(H, imgW, imgH) {
  const T = [1, 0, -imgW / 2, 0, 1, -imgH / 2, 0, 0, 1];
  const Hp = mul33(T, H);
  const a = [Hp[0], Hp[3], Hp[6]], b = [Hp[1], Hp[4], Hp[7]];
  const ok = f2 => Number.isFinite(f2) && f2 > 1e4 && f2 < 4e8;   // 像素焦距约 100–20000
  const den = a[2] * b[2];
  if (Math.abs(den) > 1e-12) {
    const f2 = -(a[0] * b[0] + a[1] * b[1]) / den;
    if (ok(f2)) return Math.sqrt(f2);
  }
  // 一组平行边（该方向灭点在无穷远）时，第一个约束退化，改用两列等长：||a||² = ||b||²
  const d2 = a[2] * a[2] - b[2] * b[2];
  if (Math.abs(d2) > 1e-12) {
    const f2 = (b[0] * b[0] + b[1] * b[1] - a[0] * a[0] - a[1] * a[1]) / d2;
    if (ok(f2)) return Math.sqrt(f2);
  }
  return null;
}

// 单应分解：K⁻¹H 的前两列 = λ·r1, λ·r2，第三列 = λ·t。
// 返回 { R, C, f, ok }；R 的行是相机坐标基在桌面坐标中的表示（即 world→camera 旋转），
// C 是相机中心的桌面坐标。重投影的四处桌面角点应与标定点重合。
export function poseFromHomography(H, imgW, imgH, fovDeg) {
  if (!H) return { ok: false, f: 0, why: '单应无解（四点共线或重合）' };
  const fEst = estimateFocal(H, imgW, imgH);
  const f = fEst || focalPx(imgH, fovDeg);
  const cx = imgW / 2, cy = imgH / 2;
  // 像素平移到主点中心后，K = diag(f,f,1)，K⁻¹ = diag(1/f,1/f,1)
  const Hp = mul33([1, 0, -cx, 0, 1, -cy, 0, 0, 1], H);
  const M = [Hp[0] / f, Hp[1] / f, Hp[2] / f * 1, Hp[3] / f, Hp[4] / f, Hp[5] / f * 1, Hp[6], Hp[7], Hp[8]];
  const col = c => [M[c], M[3 + c], M[6 + c]];
  let h1 = col(0), h2 = col(1), h3 = col(2);
  const n1 = Math.hypot(...h1), n2 = Math.hypot(...h2);
  if (!(n1 > 1e-12) || !(n2 > 1e-12)) return { ok: false, f, why: '单应退化' };
  let lam = 2 / (n1 + n2);
  if (h3[2] * lam < 0) lam = -lam;                    // 相机应在桌面前方（t_z>0）
  let r1 = norm(mulv(h1, lam)), r2raw = mulv(h2, lam);
  if (!r1) return { ok: false, f, why: 'r1 退化' };
  r2raw = sub(r2raw, mulv(r1, dot(r1, r2raw)));       // 正交化（吸收拖点误差）
  let r2 = norm(r2raw);
  if (!r2) return { ok: false, f, why: 'r2 退化' };
  const r3 = cross(r1, r2);
  const t = mulv(h3, lam);
  // 推导：x_c = R·(X,0,Z) + t' = X·(R 的第 0 列) + Z·(R 的第 2 列) + t'。
  // 所以 K⁻¹H 的两列分别是 R 的第 0 列（世界 x）与第 2 列（世界 z）；
  // 第 1 列（世界 y，向上）= -(r1 × r2)（右手系里 col0 × col2 = -col1）。
  const R = [r1[0], -r3[0], r2[0],
             r1[1], -r3[1], r2[1],
             r1[2], -r3[2], r2[2]];                    // 行优先，R 的列 = (r1, -r3, r2)
  // C = -Rᵀ·t' → C_i = -(R[0][i]·t0 + R[1][i]·t1 + R[2][i]·t2)
  const C = [-(R[0] * t[0] + R[3] * t[1] + R[6] * t[2]),
             -(R[1] * t[0] + R[4] * t[1] + R[7] * t[2]),
             -(R[2] * t[0] + R[5] * t[1] + R[8] * t[2])];
  return { ok: true, R, C, f, t, approx: !fEst };
}

// 把桌面坐标投影到像素（用于自检与离线验证）
export function project(pose, Xw, Wimg, Himg) {
  const { R, C, f } = pose;
  const d = sub(Xw, C);
  const xc = [R[0] * d[0] + R[1] * d[1] + R[2] * d[2],
              R[3] * d[0] + R[4] * d[1] + R[5] * d[2],
              R[6] * d[0] + R[7] * d[1] + R[8] * d[2]];
  if (xc[2] <= 1e-9) return null;
  return [f * xc[0] / xc[2] + Wimg / 2, f * xc[1] / xc[2] + Himg / 2];
}

// 由桌面矩形求四个角点（顺序：左上、右上、右下、左下）
export const rectCorners = (W, D) => [
  [-W / 2, 0, -D / 2], [W / 2, 0, -D / 2], [W / 2, 0, D / 2], [-W / 2, 0, D / 2],
];
