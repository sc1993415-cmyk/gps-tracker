# gps-tracker

跑步/骑行直播叠层：4G GPS → MQTT JSON → 播控机 → WebSocket HTML → OBS/vMix（RaceMap 风格）

## 结构
- `apps/overlay` 主图+数据条 / 海拔剖面
- `apps/receiver` MQTT 接收 + 降采样 + WebSocket + demo 假数据
- `packages/schema` 遥测类型与样例
- `docs/` OBS/vMix、MQTT、环境变量

## 快速 Demo（本地）
前置：Node 20+，pnpm（或改 npm）

```bash
pnpm install
# 终端1：接收服务 + 内置 demo 发布（约 1Hz）
pnpm --filter receiver demo
# 终端2：叠层页
pnpm --filter overlay dev
```

打开：
- 主叠层 http://localhost:5173/
- 海拔剖面 http://localhost:5173/elevation.html
- WebSocket 默认 ws://localhost:8787

OBS：Browser Source 填上述 URL，透明背景按需开。
vMix：Browser Input 同 URL。

字段见 `packages/schema/examples/sample.json`。topic：`telemetry/{device_id}`。
