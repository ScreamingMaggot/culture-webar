# BLE 对接协议（Web ↔ STM32 电子狗）

> 依据王子涵固件 `Edog_thewhole(蓝牙)/Core/Src/talk.c` 的 `deal()` 反推，**指令表以固件为准**。2026-10-01 更新。
> 2026-10-17：模块实物到手＝**DX-BT24**（深圳大夏龙雀 DX-SMART，BLE 5.1，Dialog14531；SRRC 2021DPG828 / CC STS52101096RE / FCC 2AKS8DX-BT24）。其透传 GATT 为公开默认：**Service 0xFFE0 / Characteristic 0xFFE1（Write + Notify）**，网页侧已按此实现（`ble.js`）。

## 0. 回读为什么一开始收不到（2026-10-17 定案）
- **真凶是我们自己的事件名写错**：Web Bluetooth 通知事件叫 `characteristicvaluechanged`（值取 `ev.target.value` 这个 DataView），我写成了 `notificationreceived`——该 API 里不存在这个事件。错得极具误导性：`startNotifications()` 照样 resolve、设备侧 CCC 确实被写成 `01 00`、同一台电脑用 bleak 能稳定收到，于是被误判成"Windows 浏览器不投递"，还为此搭了一层串口桥。现已修正。
- 防复发：`_test_ble.mjs` 里的假设备**只发规范事件**；把名字改回去，9 项里有 5 项立刻红（已实际反证过）。
- **夸克确实没有 Web Bluetooth 后端**：真调 `requestDevice` 报 `Web Bluetooth is not supported on this platform`。早先记录“夸克支持蓝牙”是只看 `'bluetooth' in navigator` 存在就下的结论，错。→ 夸克只能做 AR。
- 桌面/手机 **Edge、Chrome** 可用（能连能写；事件名修正后回读也通）。
- **串口桥作为第二条独立通道保留**：`serial_bridge.py`(读 COM4) → `serve.mjs` 代理成**同源** `/rx.json` → 页面轮询；页面会标出该字节来自 `Notify` 还是 `串口桥`，两条路任一可用即可给出"发出=回读"判据。


- **Windows Edge/Chrome 的 Web Bluetooth：对本模块订阅 Notify 会"成功但不投递"**。判据已做进 `ble-scan.html`：订阅后自动读回 `CCC(0x2902)`，实测为 `01 00`（=订阅确实写进了设备），但页面收不到任何一包；**同一台电脑用 bleak(WinRT) 直连可稳定收到**（10 秒 12 包）。→ **桌面浏览器的回读改走本机串口桥**（`serial_bridge.py` + `rxbridge.js`，页面自动优先 Notify、拿不到就用桥，判据与来源都会标出来）；手机上仍然走 Notify。实测闭环 159ms。
- **手机夸克**：AR 顺 + 支持 Web Bluetooth（演示机路径）。注意 UUID 必须写完整形式，裸 `'ffe0'` 在 Chrome 系里直接抛 `Invalid Service name`（已修）。

## 0. 硬件与传输（已确认）
- 实物＝**STM32F1 电子狗**（OLED 表情 + WS2812 灯 + 舵机腿 + HC-SR04 测距），非 ESP32。
- 蓝牙＝**透明串口 BLE 模块**挂在 **USART2**，STM32 **每次收 1 个字节**即解析（`rx2_buffer[1]`）。
- 所以网页只需向该模块的**可写特征写单个字节**，模块透传给 STM32 执行。
- 收到业务指令后 STM32 会**回显同一字节**到 USART2（可作 ack，若模块支持 Notify）。

## 1. BLE 模块（DX-BT24：**已用电脑蓝牙实测枚举确认**，2026-10-17）
- 广播名＝**`BT24`**（出厂默认，AT 可改）；广播里带 Service `FFE0`。
- **Service `0000FFE0-…-00805f9b34fb`**
  - **`0000FFE1`：write / write-without-response / notify / read** ← 写指令与订阅回显都用它（同一特征）
  - `0000FFE2`：write / write-without-response（本项目不用，备用）
  - 另有标准 GAP(1800)/GATT(1801)/Device Information(180A) 服务
- **实测已通过**：空中写 `09 02 0D` → 从模块 TXD 落到 STM32 USART2；固件回写 → 中心端 Notify 收到同样字节（**ack 通路成立**）；00-FF 全字节（跳过 0x71）**零丢失**，`0x0A/0x0D` 这些控制字节不会被吃掉。
- **模式**：未被连接时是 AT 命令模式（但本台架从板子转发 AT 无回应，见 `蓝牙测试/测试步骤.md` 第 5 节；不影响产品路径）；被连上即**透传**，写入的字节原样从 RX/TX 脚进出，**无帧头、无长度域**。
- 供电 **3.3V（别接 5V）**，串口 **9600/8/N/1**，BLE5.1 + Dialog14531，默认密码 123456，空旷约 80m。
- 网页过滤＝名字前缀 `BT24`/`BT`/`DX` + 服务 `FFE0`，选不到则放宽列出所有设备（`ble.js` 已实现）。
- **BLE 从机一般只允许一条连接**：手机/电脑连上后别再用别的 App 占着。

## 2. 真实指令字节表（网页写入的字节 → 动作）
| 网页发 | 动作 | | 网页发 | 动作 |
|---|---|---|---|---|
| `0x02` | 立正 | | `0x0A` | 趴下 |
| `0x03` | 前进 | | `0x0B` | 蹲下 |
| `0x04` | 后退 | | `0x0C` | 摇尾巴 |
| `0x05` | 握手 | | `0x0D` | 互动(测距跟随) |
| `0x06` | 左转 | | `0x0E` | 流水灯 |
| `0x07` | 右转 | | `0x0F` | 呼吸灯 |
| `0x08` | 转圈 | | `0x10` | 充能灯 |
| `0x09` | 跳舞 | | `0x11` | 灭灯 |
| `0x71` | ⚠**切到语音模式**（会关掉蓝牙串口！网页**不要发**） | | 其它 | Action_Mode=99 无效 |

## 3. 控制特性（固件决定的硬约束）
- **离散动作**：一条指令＝一个完整动作；且**上一动作未完成(`Action_Done_Flag`)前不接新指令**（`Mode_Update_Flag` 门控）。→ **不是连续速度/摇杆流控**。
- **无自定位**：只有一个测距传感器用于"互动跟随"，**不知道自己在桌面的坐标**。
- 含义：
  - "**遥控模式**"＝发离散方向字节(0x03/0x04/0x06/0x07)，每按一次走一步/转一次；可做"点按式遥控"，非平滑比例驾驶。
  - "**点击屏幕目标→实物走到该点**"＝现有固件**做不到**（无定位、离散）。要么退化为"朝该方向发离散动作"（开环不准），要么王子涵**新增定位+导航**（工作量大）。→ 需与王子涵确认取舍。

## 4. 网页端连接与发送（已实现，见 `ble.js`）
```js
import { BleClient } from './ble.js';
const bt = new BleClient((text, ok) => { /* 显示到界面 */ });
await bt.connect();            // 用户手势里调用；先按 DX/BT/FFE0 过滤，选不到则列出全部设备
await bt.writeByte(0x09);      // 跳舞：向 0xFFE1 写 1 字节（writeWithoutResponse，失败自动降级 writeValue）
await bt.subscribe(bytes => console.log(bytes)); // 订阅 Notify，收固件回显的同一字节当 ack
```
- 必须在**用户手势**里调用（"连接设备"按钮）。
- 监听 `gattserverdisconnected` 做重连提示。
- 注意节流：因固件动作门控，连发会被吞，UI 上宜"发一条→等 ack/延时→再发"。
- **需要 HTTPS 或 localhost**（Web Bluetooth 只在安全上下文可用）；GitHub Pages 的 `https://` 地址即可。

## 5. AR 侧（本仓已就绪）
- 引擎 MindAR，夸克实测顺 + 支持 Web Bluetooth（唯一 AR+蓝牙同浏览器可行的组合；APK/WebView 不支持 Web Bluetooth）。
- 虚拟模型：加载 `龙马压缩_zwrgj7.glb`（王子涵提供，7.8MB，建议再压到低面数）。
- "桌子平面"＝打印识别卡所在平面；识别卡尺寸需写死用于像素→mm 换算（若做点击方向指示）。

## 6. 待定
- [x] BLE Service/Char UUID＝`0xFFE0` / `0xFFE1`（DX-BT24 出厂默认，已按此实现）。
- [ ] 广播名（AT 可改）→ 现场 `ble-scan.html` 一测即得，之后写死进网页过滤条件。
- [x] **三大功能的字节**：**唱歌/科普是语音芯片自身功能，不经过 MCU/蓝牙**（2026-10-21 王子涵确认）。
  网页手势已改为蓝牙可控的三个：**食指上指→跳舞 `0x09`、胜利→前进 `0x03`、握拳→呼吸灯 `0x0F`**；
  另提供 `0x02 立正 / 0x04 撤退 / 0x05 握手 / 0x0A 趴下 / 0x0B 蹲下 / 0x0C 摇尾巴 / 0x10 充能 / 0x11 关灯` 的指令表参考。
- [ ] 网页发完一条指令后要不要用**回显字节做 ack**（固件已回显同一字节）→ 可用来在 AR 里显示"实物已收到"，并实现"发一条→等 ack→再发下一条"的节流。
- [ ] "点击目标"要不要做（取决于是否加自定位）；不加则改叫"遥控离散动作"。
- [ ] 识别卡图案(龙马图)与尺寸(mm)。

## 7. 网页侧实现状态（本仓）
- `ble.js`＝DX-BT24 连接与写单字节的封装（含 0x71 拦截、write 属性自动降级、断线提示），hand-horse 与各页共用。
- `ble.js` 的 `writeAndAck(b, timeoutMs)`：写一个字节并**等固件回显的那个字节**，返回 `{sent, ack, match, waited}`；`match` 就是"链路完全正常"的判据。等回读用**事件**（Notify 回调里放行），不用轮询——后台标签页里 `setTimeout` 被浏览器节流到 1 秒，轮询会把好端端的回读误判成"没收到"。
- `ar-longma.html`（掌心模式）：**发送即判定**——向 0xFFE1 写 1 字节成功即显示 `✅ 已发送 0x09（跳舞）`，通信是否成功由“龙马有没有动作”肉眼确认；失败（未连接/写失败）显示 ⚠️。**不再订阅 Notify、不再等回显**（2026-10-21 决定：设备端不加回显也能演示）。BLE 客户端 `wantNotify=false`；若将来需要自动判定，可在 `ble.js` 里打开 `wantNotify` 并恢复回读等待。
- `ble-scan.html`：现场调试台（枚举 UUID、按指令表逐条发字节、订阅回显）。
