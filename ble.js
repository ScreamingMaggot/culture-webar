// DX-BT24 透传模块的 Web Bluetooth 封装（Service 0xFFE0 / 特征 0xFFE1，可写 + Notify）
// 模块未被连接时处于 AT 命令模式；被网页连上即进透传模式，写入的字节原样从其 TX 脚进 STM32 USART2(9600/8/N/1)。
// 固件只认单字节、离散一次性指令，且上一动作未完不接新指令 → 每次只发 1 字节，不要连发。
// 绝对不要发 0x71：它切语音模式并关闭蓝牙，连接会当场断。

export const BT24 = { service: 'ffe0', char: 'ffe1' };
const NEVER_SEND = 0x71;

export class BleClient {
  // onStatus(text, ok) 用于把连接状态显示到界面上
  constructor(onStatus) { this.s = onStatus || (() => {}); this.dev = null; this.ch = null; }

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
      const isTarget = c => c.uuid.slice(4, 8).toLowerCase() === BT24.char;
      const writable = c => c.properties.writeWithoutResponse || c.properties.write;
      this.ch = chars.find(c => isTarget(c) && writable(c)) || chars.find(writable) || chars[0];
      this.dev.addEventListener('gattserverdisconnected', () => { this.ch = null; this.s('已断开，点此处重连', false); });
      this.s('已连接 ' + this.name() + ' ✓ ' + svc.uuid.slice(4, 8) + '/' + this.ch.uuid.slice(4, 8), true);
      return true;
    } catch (e) {
      this.ch = null;
      this.s('连接失败 ' + e.name + (e.message ? '：' + e.message : '') + '（点此重试）', false);
      return false;
    }
  }

  // 先按 DX-BT24 的常见广播名/服务过滤；选不到就放宽为列出所有设备（名字可能被 AT 改过）
  async pick() {
    try {
      return await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'DX' }, { services: [BT24.service] }],
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

  async subscribe(onData) {
    if (!this.ch) return false;
    try {
      await this.ch.startNotifications();
      this.ch.addEventListener('notificationreceived', ev => {
        const v = new Uint8Array(ev.value.buffer, ev.value.byteOffset, ev.value.byteLength);
        onData([...v]);
      });
      return true;
    } catch (e) { this.s('订阅回传失败 ' + e.name, false); return false; }
  }

  name() { return (this.dev && this.dev.name) || 'BT24'; }
  info() { return { supported: 'bluetooth' in navigator, connected: this.connected, name: this.dev && this.dev.name, char: this.ch && this.ch.uuid,
    props: this.ch && ['read', 'writeWithoutResponse', 'write', 'notify', 'indicate'].filter(k => this.ch.properties[k]).join(',') }; }
}

export const hex = b => '0x' + b.toString(16).toUpperCase().padStart(2, '0');
