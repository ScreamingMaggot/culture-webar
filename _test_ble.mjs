// ble.js 回归测试（不依赖硬件）：node _test_ble.mjs
//
// 为什么这么写：假特征只按 Web Bluetooth 规范派发 `characteristicvaluechanged`，值放在 ev.target.value。
// 我们真踩过把事件名写成不存在的 'notificationreceived' —— 那种错在浏览器里的表现是
// "startNotifications() 成功、设备侧 CCC 确实被写成 01 00、页面却一包也收不到"，
// 从页面上完全看不出是自己听错了事件，极易一路误判成"浏览器/系统不投递"。
// 所以这里的假设备故意只发规范事件：名字听错，测试当场变红。
import { BleClient } from './ble.js';

const SPEC_EVENT = 'characteristicvaluechanged';

function mk(mode, batch) {
  const c = new BleClient(() => {});
  const L = {};
  const ch = {
    uuid: '0000ffe1-0000-1000-8000-00805f9b34fb',
    properties: { write: true, writeWithoutResponse: true, notify: true },
    startNotifications: async () => {},
    addEventListener: (n, f) => { (L[n] = L[n] || []).push(f); },
    writeValueWithoutResponse: async (d) => {
      if (mode === 'none') return;                        // 模块/板子那边不回任何东西
      const payload = mode === 'batch' ? batch : (mode === 'wrong' ? [0xEE] : [d[0]]);
      setTimeout(() => {
        ch.value = new DataView(new Uint8Array(payload).buffer);   // 规范：值挂在特征对象上，事件 target 就是该特征
        for (const f of (L[SPEC_EVENT] || [])) f({ target: ch });
      }, mode === 'slow' ? 400 : 40);
    }
  };
  c.ch = ch;
  c.dev = { name: 'BT24', gatt: { connected: true } };
  return c;
}

let pass = 0, fail = 0;
const chk = (name, cond, info) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + '   ' + info); } };
const run = async (mode, batch, to = 1500) => { const c = mk(mode, batch); await c.subscribe(); return [c, await c.writeAndAck(0x09, to)]; };

console.log('writeAndAck 判据：');
const [cOk, rOk] = await run('ok');
chk('回显相同 → 判一致', rOk.match === true && rOk.ack === 0x09, JSON.stringify(rOk));
chk('回读来源标成 Notify', cOk.lastSrc === 'Notify', 'src=' + cOk.lastSrc);
chk('结论里带来源（手机自检要用它分辨 Notify/串口桥）', rOk.src === 'Notify', 'src=' + rOk.src);
const [, rWrong] = await run('wrong');
chk('回显不同 → 报不一致（不许假绿）', rWrong.ack === 0xEE && !rWrong.match, JSON.stringify(rWrong));
const [, rNone] = await run('none', undefined, 600);
chk('没有回读 → 超时且 sent=true/ack=null', rNone.ack === null && rNone.sent === true, JSON.stringify(rNone));
const [, rSlow] = await run('slow');
chk('回显迟到 400ms 仍等得到', rSlow.match === true, JSON.stringify(rSlow));
const [, rBatch] = await run('batch', [0xB5, 0x03, 0x09, 0x0A]);
chk('一批里混着噪声也挑对那个字节', rBatch.match === true && rBatch.ack === 0x09, JSON.stringify(rBatch));

const off = new BleClient(() => {});
chk('未连接 → sent=false（不会假装发过）', (await off.writeAndAck(0x09)).sent === false, 'ok');
const c7 = mk('ok'); await c7.subscribe();
chk('0x71 被拦截（它会把蓝牙关掉）', (await c7.writeByte(0x71)) === false, 'ok');

// 手机 https 页面取不到 BLE Notify 时，改由本机串口桥喂同一条通道（判据不变）
const c9 = mk('none'); await c9.subscribe();
const p9 = c9.writeAndAck(0x09, 1500);
await new Promise(r => setTimeout(r, 120));
c9.feedExternal([0xB5, 0x09]);
const r9 = await p9;
chk('Notify 拿不到时串口桥能补上 ack', r9.match === true && c9.lastSrc === '串口桥', JSON.stringify(r9) + ' src=' + c9.lastSrc);
chk('结论里的来源是串口桥（不是假称 Notify）', r9.src === '串口桥', 'src=' + r9.src);
chk('每条通道各收多少字节有分账', cOk.srcCount.Notify === 1 && c9.srcCount['串口桥'] === 2, JSON.stringify([cOk.srcCount, c9.srcCount]));

// 自检面板：手机上一旦读不回，靠这几个字段定位。假特征没有 getDescriptor，必须稳当地降级成"读不到"。
const dg = await cOk.diag();
chk('自检报告含 CCC/各通道/已订阅', 'CCC(0x2902)' in dg && '各通道' in dg && dg['已订阅Notify'] === true && dg['特征能力'].includes('notify'), JSON.stringify(dg));
chk('自检在无描述符的浏览器上也不炸', String(dg['CCC(0x2902)']).startsWith('读不到'), dg['CCC(0x2902)']);
const dgOff = await new BleClient(() => {}).diag();
chk('没连上时自检如实说未连接', dgOff['已连接'] === false && dgOff['各通道'] === '一条都没收到', JSON.stringify(dgOff));

console.log('\n通过 %d / 失败 %d', pass, fail);
process.exit(fail ? 1 : 0);
