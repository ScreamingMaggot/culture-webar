// palmframe.js 的离线验证：合成关键点，不需要摄像头也不需要手。
// 用法：node _test_palm.mjs（临时校验件，跑完可删）
//
// 关键点约定：0 腕、9 中指根、5 食指根、17 小指根（MediaPipe 世界坐标：x 右、y 上、z 指向相机）。
// 合成手的真值：给定"掌心法线"方向，按左右手摆好食指根/小指根，再绕竖直轴旋转到任意角度。
import { palmBasis, HS_DEFAULT, toDisplay } from './palmframe.js';

const rotY = (v, th) => [v[0] * Math.cos(th) + v[2] * Math.sin(th), v[1], -v[0] * Math.sin(th) + v[2] * Math.cos(th)];
const rotZ = (v, th) => [v[0] * Math.cos(th) - v[1] * Math.sin(th), v[0] * Math.sin(th) + v[1] * Math.cos(th), v[2]];
const nearly = (a, b, tol = 1e-6) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < tol;

// 合成一只"平面手"：给定掌心法线 ngt 与手指方向 up，按解剖学摆出拇指侧，再放 4 个关键点。
// 显示空间参考姿势（掌心朝镜头、手指朝上）：右手拇指在画面右侧(+x)，左手在左侧。
function mkHand(handed, ngt, up = [0, 1, 0]) {
  const d = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const nv = a => { const l = Math.hypot(...a); return a.map(v => v / l); };
  const u = nv([up[0] - ngt[0] * d(up, ngt), up[1] - ngt[1] * d(up, ngt), up[2] - ngt[2] * d(up, ngt)]);
  const thc = cross(u, ngt);
  const thumb = (handed === 'Right' ? 1 : -1);
  const t = nv(thc.map(v => v * thumb));
  const at = (dir, r, extra) => [dir[0] * r + (extra ? extra[0] : 0), dir[1] * r + (extra ? extra[1] : 0), dir[2] * r + (extra ? extra[2] : 0)];
  const wl = new Array(21).fill(0).map(() => [0, 0, 0]);      // 只用得到 0/5/9/17，其余占位
  wl[0] = at(u, -0.09); wl[9] = at(u, 0.02);
  wl[5] = at(t, 0.035, [u[0] * 0.01, u[1] * 0.01, u[2] * 0.01]);
  wl[17] = at(t, -0.035, [u[0] * 0.01, u[1] * 0.01, u[2] * 0.01]);
  return wl;
}
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

let pass = 0, fail = 0;
const chk = (name, cond, info) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + '   ' + info); } };

const TH = [0, 30, 60, 90, 120, 150, 180].map(d => d * Math.PI / 180);

console.log('法线符号必须"由手决定"（对每个旋转角都等于真值掌心方向）：');
for (const handed of ['Right', 'Left']) {
  const bad = [];
  for (const th of TH) {
    const ngt = rotY([0, 0, 1], th);
    const f = palmBasis(mkHand(handed, ngt), handed);
    if (!f) { bad.push('退化'); continue; }
    if (!nearly(f.n, ngt)) bad.push('θ=' + Math.round(th * 180 / Math.PI) + ' 得 [' + f.n.map(x => x.toFixed(3)) + '] 应为 [' + ngt.map(x => x.toFixed(3)) + ']');
    // 正交右手系：x⊥y、z⊥x、z⊥y、z = x × y；且 x = -掌心法线
    const d = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const zc = [f.x[1] * f.y[2] - f.x[2] * f.y[1], f.x[2] * f.y[0] - f.x[0] * f.y[2], f.x[0] * f.y[1] - f.x[1] * f.y[0]];
    if (Math.abs(d(f.x, f.y)) > 1e-9 || Math.abs(d(f.z, f.y)) > 1e-9 || Math.abs(d(f.z, f.x)) > 1e-9) bad.push('基底不正交 θ=' + Math.round(th * 180 / Math.PI));
    if (Math.hypot(...zc) < 1e-9 || d(zc, f.z) < 0.999) bad.push('基底左手系 θ=' + Math.round(th * 180 / Math.PI));
    if (Math.abs(d(f.x, f.n) + 1) > 1e-9) bad.push('x 轴不是 -法线 θ=' + Math.round(th * 180 / Math.PI));
  }
  chk(handed + ' 手：7 个旋转角全部命中真值且基底正交右手系', bad.length === 0, bad.join('; '));
}

// 关键性质：同一个视觉姿势（掌心朝镜头）换左手/右手，得到的基底必须相同——否则模型会镜像或倒置
const fr = palmBasis(mkHand('Right', [0, 0, 1]), 'Right'), fl = palmBasis(mkHand('Left', [0, 0, 1]), 'Left');
chk('同一姿势左右手基底一致（换Hands不改变模型朝向）',
  nearly(fr.y, fl.y) && nearly(fr.x, fl.x) && nearly(fr.z, fl.z), JSON.stringify([fr, fl]));

// 手背朝向镜头（θ=180）——线上版本正是在这里翻错，导致"模型方向不对"
const n180 = rotY([0, 0, 1], Math.PI);
chk('手背朝镜头时法线仍等于掌心方向（不跳反）',
  nearly(palmBasis(mkHand('Right', n180), 'Right').n, n180) && nearly(palmBasis(mkHand('Left', n180), 'Left').n, n180), 'n=' + JSON.stringify(palmBasis(mkHand('Right', n180), 'Right').n));

// 侧向（掌心法线⊥光轴，θ=90）：符号不能靠"点积≈0"的运气
chk('手掌侧向时法线仍正确（旧规则在此靠噪声定符号）',
  nearly(palmBasis(mkHand('Right', [1, 0, 0]), 'Right').n, [1, 0, 0]), JSON.stringify(palmBasis(mkHand('Right', [1, 0, 0]), 'Right').n));

console.log('\n连续旋转不得跳变（逐 5° 扫 0→360°，相邻两帧法线点积必须 > 0.99）：');
for (const handed of ['Right', 'Left']) {
  let prev = null, worst = 2, at = 0;
  for (let d = 0; d <= 360; d += 5) {
    const th = d * Math.PI / 180, ngt = rotY([0, 0, 1], th);
    const f = palmBasis(mkHand(handed, ngt), handed);
    if (prev) { const dd = f.n[0] * prev[0] + f.n[1] * prev[1] + f.n[2] * prev[2]; if (dd < worst) { worst = dd; at = d; } }
    prev = f.n;
  }
  chk(handed + ' 手：无 180° 跳变（最差相邻点积 ' + worst.toFixed(3) + ' @' + at + '°）', worst > 0.99, 'worst=' + worst.toFixed(3) + ' at ' + at + '°');
}

console.log('\n反证：旧规则（首帧用"与相机光轴点积"定符号，之后靠上一帧连续）错在开场姿势——');
console.log('       手背朝镜头开场时，符号被定反并且整场沿用；侧向开场时符号取决于点积≈0 的运气。');
function legacySession(startDeg) {                      // 线上出问题的算法，仅本测试用
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nv = a => { const l = Math.hypot(...a); return l < 1e-9 ? null : a.map(v => v / l); };
  let prev = [0, 0, 1], wrong = 0, n = 0;
  for (let d = startDeg; d < startDeg + 60; d += 5) {   // 模拟 12 帧
    const wl = mkHand('Right', rotY([0, 0, 1], d * Math.PI / 180));
    const y = nv(sub(wl[0], wl[9])), across = nv(sub(wl[5], wl[17]));
    let nn = nv(cr(across, y));
    if (nn[0] * prev[0] + nn[1] * prev[1] + nn[2] * prev[2] < 0) nn = nn.map(v => -v);
    const truth = rotY([0, 0, 1], d * Math.PI / 180);
    if (Math.hypot(nn[0] - truth[0], nn[1] - truth[1], nn[2] - truth[2]) > 1e-6) wrong++;
    prev = nn; n++;
  }
  return { wrong, n };
}
const back = legacySession(180), face = legacySession(0);
chk('旧规则：手背朝镜头开场 → 整场法线取反（模型方向不对，且不自我纠正）',
  back.wrong === back.n, JSON.stringify(back));
chk('旧规则：掌心正对镜头开场 → 恰好是对的（解释了"我们这边测着没事"）',
  face.wrong === 0, JSON.stringify(face));
// 侧向开场：点积正好≈0，符号由 1e-5 量级的残差决定 → 姿势过一点点方向就整只翻面
const legAt = deg => {
  const wl = mkHand('Right', rotY([0, 0, 1], deg * Math.PI / 180));
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nv = a => { const l = Math.hypot(...a); return l < 1e-12 ? null : a.map(v => v / l); };
  const y = nv(sub(wl[0], wl[9])), across = nv(sub(wl[5], wl[17]));
  let nn = nv(cr(across, y));
  if (nn[2] < 0) nn = nn.map(v => -v);                 // prev 初始 (0,0,1)：点积就是 z 分量
  return nn;
};
const lA = legAt(89.999), lB = legAt(90.001);
chk('旧规则：侧向开场时符号由浮点残差决定（±0.001° 就整只翻面）',
  lA[0] * lB[0] + lA[2] * lB[2] < -0.9, '89.999°→' + JSON.stringify(lA) + ' 90.001°→' + JSON.stringify(lB));
const nA = palmBasis(mkHand('Right', rotY([0, 0, 1], 89.999 * Math.PI / 180)), 'Right').n;
const nB = palmBasis(mkHand('Right', rotY([0, 0, 1], 90.001 * Math.PI / 180)), 'Right').n;
chk('新规则：同一侧向姿势两侧符号一致（与光轴无关）', nA[0] * nB[0] + nA[2] * nB[2] > 0.999, JSON.stringify([nA, nB]));
function newSession(startDeg) {                          // 新规则：与开场姿势无关
  let wrong = 0, n = 0;
  for (let d = startDeg; d < startDeg + 60; d += 5) {
    const truth = rotY([0, 0, 1], d * Math.PI / 180);
    const f = palmBasis(mkHand('Right', truth), 'Right');
    if (!f || Math.hypot(f.n[0] - truth[0], f.n[1] - truth[1], f.n[2] - truth[2]) > 1e-6) wrong++;
    n++;
  }
  return { wrong, n };
}
chk('新规则：任意开场姿势都正确（180°/90°/0° 三种起点各 12 帧）',
  newSession(180).wrong === 0 && newSession(90).wrong === 0 && newSession(0).wrong === 0,
  JSON.stringify([newSession(180), newSession(90), newSession(0)]));

console.log('\n镜像补偿（位置一路做了 1-cx，朝向一路也必须做，否则"手往右倾、模型往左旋"）：');
// 显示空间：手指朝画面右倾 30°、掌心仍朝镜头
const dispTilt = mkHand('Right', [0, 0, 1], rotZ([0, 1, 0], -30 * Math.PI / 180));
// 原始帧坐标 = 显示空间左右取反（MediaPipe 在未镜像的帧上出关键点）
const rawTilt = dispTilt.map(p => ({ x: -p[0], y: p[1], z: p[2] }));   // MediaPipe 给的是 {x,y,z} 对象
const conv = toDisplay(rawTilt);
chk('toDisplay 把原始帧坐标还原成显示空间', nearly(conv[5], dispTilt[5]) && nearly(conv[17], dispTilt[17]),
  JSON.stringify([conv[5], dispTilt[5]]));
const fFix = palmBasis(conv, 'Right'), fBug = palmBasis(rawTilt, 'Right');   // fBug＝少了镜像补偿的线上写法
chk('做了镜像：手指向画面右倾 → 纵轴(中指根→腕)向画面左偏，与看到的一致', fFix.y[0] < -0.2, 'y=' + JSON.stringify(fFix.y));
chk('不做镜像（线上现状）：同一只手却向相反方向倾转', Math.sign(fBug.y[0]) === -Math.sign(fFix.y[0]) && fBug.y[0] > 0.2,
  'fix y.x=' + fFix.y[0].toFixed(3) + ' bug y.x=' + fBug.y[0].toFixed(3));

console.log('\n兜底：');
const noLabel = palmBasis(mkHand('Right', [0, 0, 1]), null);   // 没有左右手标签（旧浏览器/识别失败）
chk('标签缺失时仍给出有效基底（退化为上一帧连续）',
  !!noLabel && Math.abs(Math.hypot(...noLabel.n) - 1) < 1e-9, JSON.stringify(noLabel));
chk('关键点退化时返回 null（调用方保留上一帧姿态，不产生 NaN）',
  palmBasis(null, 'Right') === null && palmBasis({ 0: [0, 0, 0], 9: [0, 0, 0], 5: [1, 0, 0], 17: [1, 0, 0] }, 'Right') === null, 'ok');
chk('默认常数确实是 Right:-1 / Left:+1', HS_DEFAULT.Right === -1 && HS_DEFAULT.Left === 1, JSON.stringify(HS_DEFAULT));

console.log('\n通过 %d / 失败 %d', pass, fail);
process.exit(fail ? 1 : 0);
