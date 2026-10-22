// DX-BT24 透传模块的 Web Bluetooth 封装（Service 0xFFE0 / 特征 0xFFE1，可写 + Notify）
// 模块未被连接时处于 AT 命令模式；被网页连上即进透传模式，写入的字节原样从其 TX 脚进 STM32 USART2(9600/8/N/1)。
// 固件只认单字节、离散一次性指令，且上一动作未完不接新指令 → 每次只发 1 字节，不要连发。
// 绝对不要发 0x71：它切语音模式并关闭蓝牙，连接会当场断。

// Chrome 的 Web Bluetooth 只接受 0x 别名、完整 128 位小写 UUID 或官方标准名；裸 'ffe0' 会直接抛
// TypeError: Invalid Service name。所以一律用完整形式（短名只用来拼）。
const u16 = n => '0000' + n + '-0000-1000-8000-00805f9b34fb';
export const BT24 = { service: u16('ffe0'), char: u16('ffe1') };
const NEVER_SEND = 0x71;

export class BleClient {
  // onStatus(text, ok) 用于把连接状态显示到界面上；onRx(bytes) 在每次收到串口回读时回调
  constructor(onStatus) {
    this.s = onStatus || (() => {});
    this.dev = null; this.ch = null;
    this.rx = [];          // 最近收到的字节（滚动保留 32 个），界面显示"串口读到了什么"
    this.rxTotal = 0;      // 累计计数，用于判断"发出之后有没有新回读"
    this.notifyOk = false; // 是否成功订阅了 Notify（没订阅就永远等不到 ack）
    this.lastSrc = '—';       // 最近一次回读是从哪条通道来的：Notify / 串口桥
    this.srcCount = {};       // 每条通道各收到多少字节——手机上一旦"不确定是谁送的"，看这个数
    this.wantNotify = true;   // 是否需要订阅回读；页面只凭"发出即成功"时可设为 false
    this.onRx = null;
  }

  get connected() { return !!(this.dev && this.dev.gatt && this.dev.gatt.connected && this.ch); }

  async connect() {
    if (!('bluetooth' in navigator)) { this.s('本浏览器不支持 Web Bluetooth', false); return false; }
    try {
      if (this.dev && this.dev.gatt.connected) { if (this.ch) { this.s('已连接 ' + this.name(), true); return true; } }
      else {
        this.s('请在弹窗里选择 BT24…', false);
        this.dev = await this.pick();
      }
      const server = await this.dev.gatt.connect();
      const svc = await server.getPrimaryService(BT24.service);
      const chars = await svc.getCharacteristics();
      const isTarget = c => c.uuid.toLowerCase() === BT24.char;
      const writable = c => c.properties.writeWithoutResponse || c.properties.write;
      this.ch = chars.find(c => isTarget(c) && writable(c)) || chars.find(writable) || chars[0];
      this.dev.addEventListener('gattserverdisconnected', () => { this.ch = null; this.notifyOk = false; this.s('已断开，点此处重连', false); });
      // 一连上就订阅 Notify：正式固件（talk.c 的 deal 分支）会把收到的字节原样回显，这就是 ack
      if (this.wantNotify) await this.subscribe();
      this.s('已连接 ' + this.name() + ' ✓ ' + svc.uuid.slice(4, 8) + '/' + this.ch.uuid.slice(4, 8)
            + (this.wantNotify ? (this.notifyOk ? '（回读已订阅）' : '（无 Notify，拿不到回读）') : ''), true);
      return true;
    } catch (e) {
      this.ch = null;
      this.s('连接失败 ' + e.name + (e.message ? '：' + e.message : '') + '（点此重试）', false);
      return false;
    }
  }

  // 模块出厂广播名是 "BT24"（手册默认值，AT 可改）→ 按前缀 BT/DX 过滤；选不到就放宽为列出所有设备
  async pick() {
    try {
      return await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'BT24' }, { namePrefix: 'BT' }, { namePrefix: 'DX' }, { services: [BT24.service] }],
        optionalServices: [BT24.service]
      });
    } catch (e) {
      if (e.name === 'NotFoundError') return navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [BT24.service] });
      throw e;
    }
  }

  async writeByte(b) {
    if (b == null) return false;
    if (b === NEVER_SEND) { this.s('已拦截 0x71（会关掉蓝牙）', false); return false; }
    if (!this.connected) { this.s('蓝牙未连接，指令未发送', false); return false; }
    const data = new Uint8Array([b]);
    try {
      if (this.ch.properties.writeWithoutResponse) await this.ch.writeValueWithoutResponse(data);
      else await this.ch.writeValueWithResponse(data);
      return true;
    } catch (e) {
      try { await this.ch.writeValue(data); return true; }
      catch (e2) { this.s('写失败 ' + e2.name, false); return false; }
    }
  }

  _feed(bytes, src) {
    this.lastSrc = src || this.lastSrc || '未知';
    this.srcCount[this.lastSrc] = (this.srcCount[this.lastSrc] || 0) + bytes.length;
    for (const b of bytes) { this.rx.push(b); this.rxTotal++; }
    if (this.rx.length > 32) this.rx.splice(0, this.rx.length - 32);
    if (this.onRx) this.onRx(this.rx.slice());
    // 事件驱动地放行 writeAndAck 的等待：不用轮询（后台标签页里 setTimeout 会被节流到 1 秒，轮询会假报"没回读"）
    if (this._waiter && this.rxTotal > this._waiter.before) {
      const w = this._waiter; this._waiter = null;
      // 一批可能来多个字节：优先拿与发出值相同的那个，否则整批比对会假报"不一致"
      const fresh = this.rx.slice(this.rx.length - (this.rxTotal - w.before));
      const ack = (w.expect != null && fresh.indexOf(w.expect) >= 0) ? w.expect : this.rx[this.rx.length - 1];
      w.res({ ack, waited: Math.round(performance.now() - w.t0), multi: fresh.length, src: this.lastSrc });
    }
  }

  async subscribe() {
    if (!this.ch) return false;
    if (!this.ch.properties.notify && !this.ch.properties.indicate) { this.notifyOk = false; return false; }
    try {
      await this.ch.startNotifications();
      if (!this._subscribed) {
        // Web Bluetooth 的通知事件叫 characteristicvalueChanged（值在 ev.target.value 这个 DataView 里）；
      // 'notificationreceived' 在这个 API 里根本不存在——事件名写错时 startNotifications 照样成功、
      // CCC 照样写成 01 00，页面却永远收不到，极难察觉。
      this.ch.addEventListener('characteristicvaluechanged', ev => {
        const dv = ev.target.value;
        const v = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
        this._feed([...v], 'Notify');
      });
        this._subscribed = true;
      }
      this.notifyOk = true;
      return true;
    } catch (e) { this.notifyOk = false; this.s('订阅回传失败 ' + e.name, false); return false; }
  }

  // 写一个字节，并等串口那边把同一个字节回读进来（固件 deal() 里的回显）。
  // 等回读靠事件，不靠轮询；只用一个 setTimeout 做超时兜底。
  // 返回 {sent, ack, match, waited}：ack=null 表示超时没回读；match 才是"链路完全正常"的判据。
  async writeAndAck(b, timeoutMs = 2000) {
    if (this._waiter) this._waiter.res({ ack: null, waited: 0 });      // 上一条还没等到回读就先结掉
    const before = this.rxTotal;
    const t0 = performance.now();
    const mine = { before, t0, res: null, expect: b };
    const wait = new Promise(res => { mine.res = res; this._waiter = mine; });
    const sent = await this.writeByte(b);
    if (!sent) { if (this._waiter === mine) this._waiter = null; return { sent: false, ack: null, match: false, waited: 0 }; }
    let timer;
    const raced = await Promise.race([wait, new Promise(res => { timer = setTimeout(() => res({ ack: null, waited: Math.round(performance.now() - t0) }), timeoutMs); })]);
    clearTimeout(timer);
    if (this._waiter === mine) this._waiter = null;                    // 只清自己那条，别把后来者的等待顶掉
    return { sent: true, ack: raced.ack, match: raced.ack === b, waited: raced.waited, src: raced.src || this.lastSrc };
  }

  // 手机/电脑"哪一环不通"一次性列出来：连接、特征能力、CCC（订阅有没有真的落到模块上）、各通道各收了多少字节
  async diag() {
    const d = {
      '本浏览器支持': 'bluetooth' in navigator,
      '已连接': this.connected,
      'GATT': !!(this.dev && this.dev.gatt && this.dev.gatt.connected),
      '设备名': (this.dev && this.dev.name) || '—',
      '特征': this.ch ? this.ch.uuid.slice(4, 8) : '—',
      '特征能力': this.ch ? ['read', 'writeWithoutResponse', 'write', 'notify', 'indicate'].filter(k => this.ch.properties[k]).join(',') : '—',
      '已订阅Notify': this.notifyOk,
      '回读总数': this.rxTotal,
      '各通道': Object.entries(this.srcCount).map(([k, v]) => k + ' ' + v).join(' / ') || '一条都没收到',
      '最近8字节': this.rx.slice(-8).map(hex).join(' ') || '—',
      'CCC(0x2902)': '未读',
    };
    if (this.ch) {
      try {
        const cd = await this.ch.getDescriptor('00002902-0000-1000-8000-00805f9b34fb');
        const v = await cd.readValue();
        const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
        d['CCC(0x2902)'] = [...b].map(x => x.toString(16).padStart(2, '0')).join(' ')
          + ((b[0] & 1) ? ' → 模块端 notify 确实开了' : ' → 模块端 notify 没被打开');
      } catch (e) { d['CCC(0x2902)'] = '读不到（' + e.name + '）'; }
    }
    return d;
  }

  // 外部注入回读字节：Notify 在本机浏览器不投递时，可改由串口桥喂同一条通道
  feedExternal(bytes) { this._feed(bytes || [], '串口桥'); }

  name() { return (this.dev && this.dev.name) || 'BT24'; }
  info() { return { supported: 'bluetooth' in navigator, connected: this.connected, name: this.dev && this.dev.name, char: this.ch && this.ch.uuid,
    props: this.ch && ['read', 'writeWithoutResponse', 'write', 'notify', 'indicate'].filter(k => this.ch.properties[k]).join(',') }; }
}

export const hex = b => '0x' + b.toString(16).toUpperCase().padStart(2, '0');
