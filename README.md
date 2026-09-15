# gps-tracker

跑步/骑行直播叠层（RaceMap 风格）：**MT909/H02 → TCP 5013 → receiver → WebSocket → 叠层 HTML → OBS/vMix**。

生产入口请用 `pnpm --filter receiver mt909`（不要挂 demo）。

## 结构
- `apps/overlay` 主图 + 选手列表 + 底部 HUD + LIVE/REPLAY 回放
- `apps/receiver` H02/MT909 TCP 接收 + Ucast 云端轮询 + 名册/指令管理 + WebSocket（可选 MQTT/demo）
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
- Ucast 设备不直连 5013，走云端轮询，设备号填 SN 或另指定的数字 ID（见下一节）
- 陌生设备：管理页「待确认」一键加入；支持名单 CSV 导入导出
- 二进制 `$` 定位帧（73B）通常 **不带 CI**；ASCII `*HQ,…,V1,…,MCC,MNC,LAC,CI#` 心跳才有完整 LTE CI
- 心跳间隔：`interval,密码,秒数`（如 `interval,123456,10`），管理页可下发原文

## Ucast 云端定位（apiv3 轮询）
Ucast 设备**不直连 5013**：receiver 用账号登录 `api.ucastcn.com`（`/v3/users/login` → `/v3/ws/user/…`），订阅后由云端按 SN 推 tick。

配置在管理页「Ucast 云端定位」面板（账号 / 密码 / 设备 SN），落盘到 `apps/receiver/data/ucast.json`（已 gitignore；密码不回显，输入框留空=不改）。

**SN 怎么写**（一行一台，可用空白分隔写第二列）
- **只写 SN** → 以 SN 当设备号上报，设备出现在「待确认设备」（来源标 `Ucast`），一键加入名册即可上叠层
- **`SN  7026238813`** → 直接按这个名册 ID 匹配，跳过待确认那一步
- 第二列**必须是 8–15 位数字**；若写成非数字（比如又写一遍 SN）不报错，但该设备的数据会被丢弃

**接入状态怎么判断**（别把「接上了」和「设备有定位」混为一谈）

`GET /api/ucast/status`，面板下方也有一行会 5 秒自动刷新的状态：

| 字段 | 含义 |
|---|---|
| `apiUp` / `phase: connected` | ① 账号接入成功（登录拿到 token + WS 打开） |
| `ticks > 0` | ② 云端确实在推数据 |
| `valid_ticks > 0` / `phase: ok` | ③ 设备有定位 |

`phase` 取值：`disabled` / `stopped` / `connecting` / `connected` / `no_fix` / `ok` / `error`，各带一句中文 `summary`。

日志对照：`[ucast] api link up (login ok + subscribe ack)` = ①成功；`tick no-fix sn=… error=-1` = ②在推但③不满足（**设备无定位，不是接入失败**）；`continuous error=1004 "device not online"` = 连②都没有。

**停止 / 启动**：面板「停止轮询」/「启动轮询」，或 `POST /api/ucast/stop` / `POST /api/ucast/start`。停止会把 `enabled` 一并写成 `false`（**重启后不会自动重连**）；两个方向都不动账号、密码、SN。

**速度单位**：云端 `speed` 是 km/h 的 1000 倍（m/h），poller 已 ÷1000 后交付，叠层的时速/配速可直接用。

自测：`pnpm --filter receiver test:ucast`（轮询生命周期）、`pnpm --filter receiver test:discovery`（设备号判定 + 待确认）。

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
- **Ucast 云端定位**：账号 / 密码 / 设备 SN；停止 / 启动轮询；接入状态行（5 秒刷新，悬停看细节）
- 待确认设备（H02 数字 ID 或 Ucast SN，含**来源**列）/ 底图样式 / 列表列  
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
