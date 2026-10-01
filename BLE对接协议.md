# BLE 对接协议（Web ↔ STM32 电子狗）

> 依据王子涵固件 `Edog_thewhole(蓝牙)/Core/Src/talk.c` 的 `deal()` 反推，**指令表以固件为准**。2026-10-01 更新。

## 0. 硬件与传输（已确认）
- 实物＝**STM32F1 电子狗**（OLED 表情 + WS2812 灯 + 舵机腿 + HC-SR04 测距），非 ESP32。
- 蓝牙＝**透明串口 BLE 模块**挂在 **USART2**，STM32 **每次收 1 个字节**即解析（`rx2_buffer[1]`）。
- 所以网页只需向该模块的**可写特征写单个字节**，模块透传给 STM32 执行。
- 收到业务指令后 STM32 会**回显同一字节**到 USART2（可作 ack，若模块支持 Notify）。

## 1. 仍需王子涵提供（网页连蓝牙必需）
STM32 侧只看到 UART，**BLE 模块的 GATT 信息在模块固件里**，网页连接要用：
- [ ] 模块**广播名**（如 HM-10/JDY/其他）；
- [ ] 可写**服务 UUID / 特征 UUID**（例：HM-10 常为 service `0xFFE0` / char `0xFFE1` write+notify）；
- [ ] 模块型号（决定用 Write 还是 WriteWithoutResponse、是否支持 Notify）。

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

## 4. 网页端连接与发送（JS 伪码，UUID 待第 1 节补全）
```js
const SERVICE = '<模块服务UUID>';   // 待王子涵给
const CHAR    = '<可写特征UUID>';   // 待王子涵给
const dev = await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE] }] }); // 或 name
const server = await dev.gatt.connect();
const svc = await server.getPrimaryService(SERVICE);
const ch  = await svc.getCharacteristic(CHAR);
const send = (b) => ch.writeValueWithoutResponse ? ch.writeValueWithoutResponse(new Uint8Array([b])) : ch.writeValue(new Uint8Array([b]));
send(0x03); // 前进
```
- 必须在**用户手势**里调用（"连接设备"按钮）。
- 监听 `gattserverdisconnected` 做重连提示。
- 注意节流：因固件动作门控，连发会被吞，UI 上宜"发一条→等 ack/延时→再发"。

## 5. AR 侧（本仓已就绪）
- 引擎 MindAR，夸克实测顺 + 支持 Web Bluetooth（唯一 AR+蓝牙同浏览器可行的组合；APK/WebView 不支持 Web Bluetooth）。
- 虚拟模型：加载 `龙马压缩_zwrgj7.glb`（王子涵提供，7.8MB，建议再压到低面数）。
- "桌子平面"＝打印识别卡所在平面；识别卡尺寸需写死用于像素→mm 换算（若做点击方向指示）。

## 6. 待定
- [ ] BLE 模块名 + Service/Char UUID（第 1 节）。
- [ ] "点击目标"要不要做（取决于是否加自定位）；不加则改叫"遥控离散动作"。
- [ ] 识别卡图案(龙马图)与尺寸(mm)。
- [ ] Status/Notify 回传（电量/动作完成）用于数字孪生同步——可选。
