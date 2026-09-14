# gps-tracker

跑步/骑行直播叠层（RaceMap 风格）：**MT909/H02 → TCP 5013 → receiver → WebSocket → 叠层 HTML → OBS/vMix**。

生产入口请用 `pnpm --filter receiver mt909`（不要挂 demo）。

## 结构
- `apps/overlay` 主图 + 选手列表 + 底部 HUD + LIVE/REPLAY 回放
- `apps/receiver` H02/MT909 TCP 接收 + 名册/指令管理 + WebSocket（可选 MQTT/demo）
- `packages/schema` 遥测类型与样例
- `packages/course-project` GPX 投影（进度 / 偏航 / 吸附 / 沿线插值）
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
- 二进制 `$` 定位帧（73B）通常 **不带 CI**；ASCII `*HQ,…,V1,…,MCC,MNC,LAC,CI#` 心跳才有完整 LTE CI
- 心跳间隔：`interval,密码,秒数`（如 `interval,123456,10`），管理页可下发原文

## 定位融合（GPS / LBS / 推估）
优先级概览：

1. **有效 GPS** → 红点 / 黄轨迹  
2. **无星** 且开了赛道推估、速度足够 → 沿线 coast（丢星隧道）  
3. **LBS** → 绿点 + 精度圈  

LBS 查库顺序：

1. 本地 OpenCelliD（`apps/receiver/data/opencellid-460.csv.gz`）：精确 CI → 同 LAC 质心  
2. 未命中且 CI>0 → [cellocation.com](http://api.cellocation.com:84/cell/) 公网兜底  
   - 同一 `mcc:mnc:lac:ci` 只请求一次，结果写入 `data/cellocation-cache.json`  
   - 失败缓存 6 小时；按日限额 **1000**（`data/cellocation-quota.json`）  
   - 用量：`GET /api/cellocation`  
3. 二进制 `ci=0` 时沿用最近一条 V1 心跳的 CI  

LBS / coast 切回 GPS 时轨迹会断开，避免黄线被绿点拖飞。

## 管理页（:8790）
打开默认只展开 **添加/编辑** 和 **当前名册**，其余面板折叠。

- 名册：号码牌、姓名、国籍 ISO（`CN` 等，叠层画小国旗）、颜色；CSV 导入导出  
- 待确认设备 / 底图样式 / 列表列  
- **叠层底部 HUD 开关**：号牌、姓名、国旗、时速、已过里程、剩余里程、配速、累计爬升  
- **活动场次**：开始 / 结束 / 重置 + 活动名（叠层 LIVE/REPLAY）  
- **赛道 GPX**：上传 / 清除；**起点绿旗 / 终点格旗**（环线显示 S/F），可关  
- **赛道吸附**：默认开，距 GPX ≤约 100m 时 marker+轨迹贴投影点  
- **赛道推估**：丢星时沿线滑行，可关（关则走 LBS）  
- **轨迹跳点断开**：位移超过阈值（默认 60m）切段，阈值可改  
- **高速平滑**：显示点用 T-2→T-1 插值，始终晚一包，可关  
- **指令下发**：FREQ / IP / CQ，或原文（如 `interval,123456,10`）；回执最近 20 条  

## 叠层行为要点
- 跳点过滤：过大步进/速度钉住上一点；重连旧包 `recv−device_ts>120s` 或 device_ts 回退>30s → 丢弃  
- 在线态：在线 / 定位中 / 在线·无定位 / 离线（心跳可刷在线）  
- Marker 插值：按接收间隔中位数动态 `clamp(0.85×T, 0.4s, 8s)`（>15s 空档不估 T）  
- 可选「晚一包」插值，90–100 km/h 更稳  
- 底部 HUD 数据来自投影进度 / 开赛时间；MT909 二进制当前不报海拔，累计爬升多为 0  
- START / FINISH 取 GPX 首尾点，不必改 GPX 文件  

## 文档
字段样例：`packages/schema/examples/sample.json`。MQTT topic（可选）：`telemetry/{device_id}`。  
Phase 1 URL 参数：[docs/phase1-overlay.md](docs/phase1-overlay.md)。  
名册 API：[docs/roster-admin.md](docs/roster-admin.md)。
