# BLE 对接协议草案（Web ↔ ESP32）

> 用途：给 2026-10 会议对齐"网页端(我/姜定昌)"与"硬件端(王子涵)"的接口。确认后即可各自实现。

## 0. 前置：浏览器支持（决定架构）
- Web Bluetooth 仅 **Chrome / Edge / 三星浏览器** 支持；**Safari / Firefox 不支持**；**夸克待实测**。
- 用 `ble-test.html`（已部署：https://screamingmaggot.github.io/culture-webar/ble-test.html ）在夸克/Chrome 各测一次。
- **关键**：AR 摄像头目前只在夸克顺。若夸克不支持蓝牙 → 需二选一：
  - (A) 找一个"摄像头顺 + 支持蓝牙"的浏览器（先测 Edge/三星浏览器）；
  - (B) 蓝牙只在 Chrome 演示、AR 也在 Chrome（接受预览略卡）；
  - (C) 打包 APK（WebView 蓝牙需原生授权，另议）。

## 1. BLE 服务与特征（自定义 128-bit UUID）
| 用途 | UUID | 属性 |
|------|------|------|
| 服务 Service | `0000a120-0000-1000-8000-00805f9b34fb` | — |
| 命令特征 Cmd (网页→设备) | `0000a121-0000-1000-8000-00805f9b34fb` | Write / WriteWithoutResponse |
| 状态特征 Status (设备→网页, 可选) | `0000a122-0000-1000-8000-00805f9b34fb` | Notify |

> UUID 可换成王子涵惯用的；只要两端一致即可。设备广播名建议：`NWPU-CULTURE-PET`（网页按名/服务过滤）。

## 2. 命令字节表（网页写入 Cmd 特征）
| 字节 | 动作 | 设备端表现 |
|------|------|-----------|
| `0x01` | 摇尾巴 | 舵机摆动 |
| `0x02` | 眨眼 | LED/舵机 |
| `0x03` | 叫一声 | 蜂鸣/播放 |
| `0x04` | 睡觉 | 归位/熄灯 |
| `0x05` | 切换展品 N | 参数化：`0x05 <N>` 两字节 |
| `0xFF` | 复位/停止 | 全停 |
> 具体动作与字节由王子涵定，网页按表发送即可；可扩展多字节命令。

## 3. 状态回传（可选，Status Notify）
- 设备可回：按钮被按(`0x10`)、传感器值、连接心跳等 → 网页据此在 AR 里做反馈。
- 若第一版不做回传，可先只 Write。

## 4. 网页端连接流程（JS 伪码）
```js
const SERVICE = '0000a120-0000-1000-8000-00805f9b34fb';
const CMD = '0000a121-0000-1000-8000-00805f9b34fb';
const device = await navigator.bluetooth.requestDevice({
  filters: [{ name: 'NWPU-CULTURE-PET' }]   // 或 services:[SERVICE]
});
const server = await device.gatt.connect();
const svc = await server.getPrimaryService(SERVICE);
const ch = await svc.getCharacteristic(CMD);
await ch.writeValue(new Uint8Array([0x01]));   // 摇尾巴
```
- 需在**用户手势**里调用（页面放"连接设备"按钮）。
- 断线重连：监听 `gattserverdisconnected` → 提示重连。

## 5. ESP32 端要做的事（王子涵）
1. BLE Peripheral，广播名 `NWPU-CULTURE-PET` + 上面的 Service/Char UUID。
2. Cmd 特征可写，收到字节 → 分发动作（舵机/LED/蜂鸣）。
3. （可选）Status 特征 Notify，回传按钮/传感。
4. Arduino IDE + ESP32 BLE 库（如 NimBLE-Arduino）即可，无需商业插件。

## 6. 会上待定
- [ ] 夸克/候选浏览器是否支持 Web Bluetooth（看 ble-test 结果）→ 定演示浏览器。
- [ ] 最终 UUID / 广播名 / 命令字节表（王子涵定，网页照做）。
- [ ] 要不要状态回传（Notify）。
- [ ] 现场答辩用哪台设备/浏览器（提前彩排连接稳定性）。
- [ ] 蓝牙失败时的降级：纯 AR 交互演示，不阻断。
