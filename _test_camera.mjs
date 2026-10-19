// 验证页面里"位姿 → three 相机"的那段换算：用 three 相机把桌角投回屏幕，应与拖点重合。
import * as THREE from './samples/three-webxr-hittest/libs/three.module.js';
import { homography, poseFromHomography, rectCorners, focalPx } from './tablepose.js';

const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const nv=a=>{const l=Math.hypot(...a);return a.map(v=>v/l);};
function makeCam(C){const z=nv(sub([0,0,0],C)), x=nv(cross([0,1,0],z)), y=cross(z,x);
  return {C,R:[x[0],x[1],x[2],y[0],y[1],y[2],z[0],z[1],z[2]]};}

const Wimg=innerW(), Himg=innerH();
function innerW(){return 600} function innerH(){return 800}
const f=focalPx(Himg,50), corners=rectCorners(0.6,0.4), cam=makeCam([0.2,1.05,1.1]);
const px=corners.map(p=>{const d=sub(p,cam.C);const xc=[dot(cam.R.slice(0,3),d),dot(cam.R.slice(3,6),d),dot(cam.R.slice(6,9),d)];
  return [f*xc[0]/xc[2]+Wimg/2, f*xc[1]/xc[2]+Himg/2];});
const H=homography(corners.map(p=>[p[0],p[2]]),px);
const pose=poseFromHomography(H,Wimg,Himg,60);

// 与 ar-table.html 的 applyPose 完全一致
const camera=new THREE.PerspectiveCamera(60,Wimg/Himg,0.01,100);
const m=new THREE.Matrix4().set(pose.R[0],pose.R[1],pose.R[2],0, pose.R[3],pose.R[4],pose.R[5],0, pose.R[6],pose.R[7],pose.R[8],0, 0,0,0,1);
m.transpose().multiply(new THREE.Matrix4().makeScale(1,-1,-1));
camera.quaternion.setFromRotationMatrix(m);
camera.position.set(...pose.C);
camera.fov=2*Math.atan((Himg/2)/pose.f)*180/Math.PI; camera.aspect=Wimg/Himg;
camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);

let worst=0;
corners.forEach((p,i)=>{
  const v=new THREE.Vector3(p[0],p[1],p[2]).project(camera);
  const u=(v.x*0.5+0.5)*Wimg, vv=(-v.y*0.5+0.5)*Himg;
  worst=Math.max(worst, Math.hypot(u-px[i][0], vv-px[i][1]));
});
console.log('three 相机四角复投最差误差 =', worst.toExponential(2), '像素');
console.log(worst < 0.1 ? '✅ 页面相机换算正确' : '❌ 页面相机换算有误');
const cameraOk = worst < 0.1;

// ---- 回归：模型归一化的"缩放与平移必须同层" ----
// 用 a19.min.glb 的真实包围盒：min(-100.8,-77.68,0) max(114.03,77.68,125.47)
const bmin = [-100.8, -77.677, 0], bmax = [114.025, 77.677, 125.466];
const bsize = bmax.map((v, i) => v - bmin[i]);
const bctr = bmin.map((v, i) => (v + bmax[i]) / 2);
const hy = Math.max(...bsize), s = 1 / hy, holderS = 0.3;
const offset = [-bctr[0], -bmin[1], -bctr[2]];
// 底面中心的顶点（局部坐标）
const vtx = [bctr[0], bmin[1], bctr[2]];
// 旧写法：scale 加在 model 上 → model.position 不被自身缩放影响
const bad = offset.map((o, i) => holderS * (o + s * vtx[i]));
// 新写法：unit（缩放层）包住 model，holder（米制层）再包 unit
const good = offset.map((o, i) => holderS * s * (o + vtx[i]));
const badDist = Math.hypot(...bad), goodDist = Math.hypot(...good);
console.log('\n模型归一化回归：旧层级底面中心 = ' + bad.map(v => v.toFixed(2)) + '（距桌心 ' + badDist.toFixed(1) + ' 米）');
console.log('                 新层级底面中心 = ' + good.map(v => v.toExponential(1)) + '（距桌心 ' + goodDist.toExponential(1) + ' 米）');
const nOk = badDist > 10 && goodDist < 1e-9;
process.exit(cameraOk && nOk ? 0 : 1);
console.log(nOk ? '✅ 旧写法确实把模型抛到十米外；新写法底面精确落在桌心' : '❌ 归一化层级回归失败');
