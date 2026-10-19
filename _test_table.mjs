// tablepose.js 的离线验证：随机摆相机 → 投影四个桌角 → 只用这四组像素反解 → 再投影回去。
// 用法：node _test_table.mjs
import { homography, poseFromHomography, project, rectCorners, focalPx } from './tablepose.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const nv = a => { const l = Math.hypot(...a); return a.map(v => v / l); };

let pass = 0, fail = 0;
const chk = (n, c, i) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + '   ' + i); } };

// 生成一个"看着桌面"的相机：C 在桌面上方偏前，z 轴指向前方（CV：x 右、y 下、z 朝前）
function makeCam(C, target = [0, 0, 0]) {
  const z = nv(sub(target, C));                       // 相机朝前
  const x = nv(cross([0, 1, 0], z));                  // 右 = 上 × 前（y 朝下时才是右手系）
  const y = cross(z, x);                              // 下
  return { C, R: [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]] };
}
function projectRaw(cam, X, Wimg, Himg, f) {
  const d = sub(X, cam.C);
  const xc = [dot(cam.R.slice(0, 3), d), dot(cam.R.slice(3, 6), d), dot(cam.R.slice(6, 9), d)];
  return [f * xc[0] / xc[2] + Wimg / 2, f * xc[1] / xc[2] + Himg / 2];
}

const W = 0.6, D = 0.4, Wimg = 600, Himg = 800, fov = 60;
const f = focalPx(Himg, fov);
const corners = rectCorners(W, D);

console.log('重投影：随机 8 个相机位姿，只用四个像素点反解位姿，再把四个角投回去');
let worst = 0;
for (let i = 0; i < 8; i++) {
  const C = [(-0.3 + 0.6 * Math.random()), 0.9 + 0.6 * Math.random(), 0.7 + 0.8 * Math.random()];
  const cam = makeCam(C);
  const px = corners.map(p => projectRaw(cam, p, Wimg, Himg, f));
  if (px.some(p => !Number.isFinite(p[0]))) { console.log('  (跳过退化位姿)'); continue; }
  const H = homography(corners.map(p => [p[0], p[2]]), px);
  const pose = poseFromHomography(H, Wimg, Himg, fov);
  if (!pose.ok) { chk('位姿 #' + i + ' 解出', false, pose.why); continue; }
  const err = Math.max(...corners.map((p, k) => {
    const q = project(pose, p, Wimg, Himg);
    return q ? Math.hypot(q[0] - px[k][0], q[1] - px[k][1]) : 1e9;
  }));
  worst = Math.max(worst, err);
}
chk('8 个位姿的四角重投影误差都 < 0.01 像素（最差 ' + worst.toExponential(2) + '）', worst < 0.01, 'worst=' + worst);

console.log('\n位姿本身：反解出的相机中心与旋转应与真值一致');
let maxC = 0, maxR = 0;
for (let i = 0; i < 5; i++) {
  const C = [(-0.2 + 0.4 * Math.random()), 1.0 + 0.5 * Math.random(), 0.8 + 0.6 * Math.random()];
  const cam = makeCam(C);
  const px = corners.map(p => projectRaw(cam, p, Wimg, Himg, f));
  const H = homography(corners.map(p => [p[0], p[2]]), px);
  const pose = poseFromHomography(H, Wimg, Himg, fov);
  if (!pose.ok) { console.log('  (跳过)'); continue; }
  maxC = Math.max(maxC, Math.hypot(pose.C[0] - C[0], pose.C[1] - C[1], pose.C[2] - C[2]));
  // 旋转矩阵差的 Frobenius 范数；允许内参假设带来的整体尺度不影响旋转
  let dr = 0; for (let k = 0; k < 9; k++) dr += (pose.R[k] - cam.R[k]) ** 2;
  maxR = Math.max(maxR, Math.sqrt(dr));
}
chk('相机中心误差 < 1e-3 米（最差 ' + maxC.toExponential(2) + '）', maxC < 1e-3, 'maxC=' + maxC);
chk('旋转矩阵误差 < 1e-3（最差 ' + maxR.toExponential(2) + '）', maxR < 1e-3, 'maxR=' + maxR);

console.log('\n退化与容错：');
chk('四点共线 → 单应判退化', poseFromHomography(homography([[0, 0], [1, 0], [2, 0], [3, 0]], [[10, 10], [20, 10], [30, 10], [40, 10]]), 600, 800, 60).ok === false, 'ok');
// 真实场景：相机视场不是假定值（这里 45°），四点应自己解出焦距并把四角投回去
const f45 = focalPx(800, 45);
const cam2 = makeCam([0.15, 1.0, 1.2]);
const px2 = corners.map(p => {
  const d = sub(p, cam2.C);
  const xc = [dot(cam2.R.slice(0, 3), d), dot(cam2.R.slice(3, 6), d), dot(cam2.R.slice(6, 9), d)];
  return [f45 * xc[0] / xc[2] + Wimg / 2, f45 * xc[1] / xc[2] + Himg / 2];
});
const H2 = homography(corners.map(p => [p[0], p[2]]), px2);
const p2 = poseFromHomography(H2, Wimg, Himg, 60);
chk('视场与假定值不同也能从四点解出焦距（误差 ' + Math.abs(p2.f - f45).toExponential(2) + ' 像素）',
  p2.ok && !p2.approx && Math.abs(p2.f - f45) < 1e-6, JSON.stringify({ f: p2.f, f45, approx: p2.approx }));
const rp2 = corners.map(p => project(p2, p, Wimg, Himg));
chk('该例四角重投影 < 0.01 像素', rp2.every((q, k) => q && Math.hypot(q[0] - px2[k][0], q[1] - px2[k][1]) < 0.01), JSON.stringify(rp2));

// 手拖得不成矩形透视（两条水平边平行、竖边又不平行）：解不出焦距，仍给近似位姿、不能崩
const Hbad = homography([[0, 0], [0.6, 0], [0.6, 0.4], [0, 0.4]], [[150, 300], [450, 300], [520, 560], [80, 560]]);
const pbad = poseFromHomography(Hbad, 600, 800, 60);
chk('不成立的矩形透视 → 标 approx 的近似位姿（不崩、不报错）',
  pbad.ok && pbad.approx === true && Number.isFinite(pbad.C[1]), JSON.stringify({ f: pbad.f, approx: pbad.approx, C: pbad.C }));

console.log('\n通过 %d / 失败 %d', pass, fail);
process.exit(fail ? 1 : 0);
