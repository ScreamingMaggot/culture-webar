// ble.js 的回归测试：不依赖硬件，用假特征验"发出 vs 回读"的判据本身
// 用法：node _test_ble.mjs（跑完即可删，属临时校验件）
import { BleClient } from './ble.js';

function mk(mode, batch) {
  const c = new BleClient(() => {});
  const L = {};
  c.ch = {
    uuid: '0000ffe1-0000-1000-8000-00805f9b34fb',
    properties: { write: true, writeWithoutResponse: true, notify: true },
    startNotifications: async () => {},
    addEventListener: (n, f) => { (L[n] = L[n] || []).push(f); },
    writeValueWithoutResponse: async (d) => {
      if (mode === 'none') return;
      const payload = mode === 'batch' ? batch : (mode === 'wrong' ? [0xEE] : [d[0]]);
      setTimeout(() => {
        for (const f of (L['notificationreceived'] || [])) {
          f({ value: new DataView(new Uint8Array(payload).buffer) });
        }
      }, mode === 'slow' ? 400 : 40);
    }
  };
  c.dev = { name: 'BT24', gatt: { connected: true } };
  return c;
}

let pass = 0, fail = 0;
function chk(name, cond, info) { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + '  ' + info); } }

const cases = [];
for (const [mode, batch] of [['ok'], ['wrong'], ['none'], ['slow'], ['batch', [0xB5, 0x03, 0x09, 0x0A]]]) {
  const c = mk(mode, batch); await c.subscribe();
  cases.push([mode, await c.writeAndAck(0x09, mode === 'none' ? 600 : 1500)]);
}
const get = m => cases.find(x => x[0] === m)[1];

console.log('writeAndAck 判据：');
chk('回显相同 → match', get('ok').match === true && get('ok').ack === 0x09, JSON.stringify(get('ok')));
chk('回显不同 → 不一致', get('wrong').ack === 0xEE && get('wrong').match === false, JSON.stringify(get('wrong')));
chk('无回读 → 超时', get('none').ack === null && get('none').sent === true, JSON.stringify(get('none')));
chk('迟到 400ms 仍能等到', get('slow').match === true, JSON.stringify(get('slow')));
chk('一批含噪声时挑相同的那个', get('batch').match === true && get('batch').ack === 0x09, JSON.stringify(get('batch')));

const off = new BleClient(() => {});
chk('未连接 → sent=false', (await off.writeAndAck(0x09)).sent === false, 'ok');
const c7 = mk('ok'); await c7.subscribe();
chk('0x71 被拦截', (await c7.writeByte(0x71)) === false, 'ok');
// 关键场景：浏览器 Notify 不投递（Windows Edge 实测），改由串口桥喂同一个通道
const c9 = mk('none'); await c9.subscribe();
const p9 = c9.writeAndAck(0x09, 1500);
await new Promise(r => setTimeout(r, 120));
c9.feedExternal([0xB5, 0x09]);
const r9 = await p9;
chk('Notify 死掉时串口桥能补上 ack', r9.match === true && c9.lastSrc === '串口桥', JSON.stringify(r9) + ' src=' + c9.lastSrc);

console.log('\n通过 %d / 失败 %d', pass, fail);
process.exit(fail ? 1 : 0);
