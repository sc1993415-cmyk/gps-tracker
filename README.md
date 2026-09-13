# gps-tracker

跑步/骑行直播叠层（RaceMap 风格）：**MT909/H02 → TCP 5013 → receiver → WebSocket → 叠层 HTML → OBS/vMix**。

生产入口请用 `pnpm --filter receiver mt909`（不要挂 demo）。

## 结构
- `apps/overlay` 主图 + 选手列表 + LIVE/REPLAY 回放
- `apps/receiver` H02/MT909 TCP 接收 + 名册/指令管理 + WebSocket（可选 MQTT/demo）
- `packages/schema` 遥测类型与样例
- `packages/course-project` GPX 投影（进度 / 偏航 / 吸附）
- `docs/` OBS/vMix、MQTT、环境变量、[MT909 TCP](docs/mt909-tcp.md)、[Phase 1 叠层](docs/phase1-overlay.md)、[名册管理](docs/roster-admin.md)、[赛道投影](docs/course-project.md)

## 快速 Demo（本地）
前置：Node 20+，pnpm

```bash
pnpm install
# 终端1：接收服务 + 内置 demo（约 1Hz，3 名选手）
pnpm --filter receiver demo
# 终端2：叠层页
pnpm --filter overlay dev
```

打开：
- 叠层 http://localhost:5173/（OBS 可加 `#mapOnly=true`）
- 海拔剖面 http://localhost:5173/elevation.html
- WebSocket 默认 `ws://localhost:8787`
- 管理页 http://localhost:8790/

## 真机（MT909）
```bash
pnpm --filter receiver mt909
# 或 VPS systemd：gps-receiver + gps-overlay
```
- 设备短信：`IP <公网IP> 5013`
- 叠层 / 管理：见部署机端口（常见 `:4173` / `:8790`）
- 名册用 **H02 短 ID**（如 `7026238813`），不是贴纸 IMEI；空名册=严格白名单（不显示任何人）
- 陌生设备：管理页「待确认」一键加入；支持名单 CSV 导入导出

## 管理页能力（:8790）
- 名册 / 发现 / GPX 上传 / 底图样式 / 列表列
- **活动场次**：开始 / 结束 / 重置 + 自定义活动名（叠层 LIVE/REPLAY）
- **赛道吸附**：默认开，距 GPX ≤约 100m 时 marker+轨迹贴投影点，偏航回原始 GPS
- **指令下发**：FREQ / IP / CQ；**回执查看**（最近 20 条：已写出/等待/超时/回包）

## 叠层行为要点
- 跳点过滤：过大步进/速度钉住上一点；重连旧包 `recv−device_ts>120s` 或 device_ts 回退>30s → 丢弃
- 在线态：在线 / 定位中 / 在线·无定位 / 离线（心跳可刷在线）
- Marker 插值：按接收间隔中位数动态 `clamp(0.85×T, 0.4s, 8s)`（>15s 空档不估 T）
- 当前链路 **无可用 LBS 帧**（近周仅 `$` 二进制）；室内冻最后有效 GPS

## 文档
字段样例：`packages/schema/examples/sample.json`。MQTT topic（可选）：`telemetry/{device_id}`。  
Phase 1 URL 参数：[docs/phase1-overlay.md](docs/phase1-overlay.md)。  
名册 API：[docs/roster-admin.md](docs/roster-admin.md)。
