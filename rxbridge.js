// 串口回读桥：轮询本机 serial_bridge.py 暴露的 http://127.0.0.1:8790/rx.json
// 用途：Windows Edge/Chrome 对这个透传模块"订阅 Notify 成功但不投递"时，
//       让页面仍能看到"串口读到了什么"，从而给出"发出 vs 回读"的一致/不一致判据。
// 只在同机网页（http://localhost:8000）有效；手机上 fetch 127.0.0.1 会失败，静默降级为只走 Notify。

// 优先同源（手机 https 页面也能拿到：由 serve.mjs 代理），失败再试本机端口（PC http 页面）
const APIS = ['/rx.json', 'http://127.0.0.1:8790/rx.json'];

export class RxBridge {
  // onBytes(新到的字节数组, 状态对象) —— 每次有新鲜字节才回调
  constructor(onBytes) { this.onBytes = onBytes || (() => {}); this.seen = 0; this.st = { ok: false, err: '还没连上桥' }; }

  async poll() {
    try {
      let j = null;
      for (const api of (this.goodApi ? [this.goodApi, ...APIS.filter(a => a !== this.goodApi)] : APIS)) {
        try {
          const r = await fetch(api, { cache: 'no-store' });
          const t = await r.json();
          if (t && (Array.isArray(t.ble) || t.ok === false)) { j = t; this.goodApi = api; break; }
        } catch (e) { /* 换下一个地址 */ }
      }
      if (!j) { this.st = { ok: false, err: '两个地址都取不到（桥没启动？）' }; return this.st; }
      if (j.ok === false) { this.st = { ok: false, err: j.err || '桥报告未连上串口' }; return this.st; }
      this.st = { ok: true, hb: j.hb, ble: (j.ble || []).length, pc: (j.pc || []).length, err: j.err || '', boot: j.boot || '', port: j.port, baud: j.baud, t_last: j.t_last };
      const arr = j.ble || [];
      if (arr.length > this.seen) {
        const fresh = arr.slice(this.seen);
        this.seen = arr.length;
        this.onBytes(fresh, this.st);
      } else if (arr.length < this.seen) {
        this.seen = arr.length;                        // 板子重启/桥重启，计数回绕
      }
    } catch (e) {
      this.st = { ok: false, err: '取不到串口桥（未启动？python serial_bridge.py COM4）' };
    }
    return this.st;
  }

  start(ms = 300) { this.stop(); this.poll(); this.t = setInterval(() => this.poll(), ms); }
  stop() { if (this.t) clearInterval(this.t); this.t = 0; }
}

export const hexByte = b => '0x' + (b & 0xFF).toString(16).toUpperCase().padStart(2, '0');
