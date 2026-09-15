# 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `WS_PORT` | `8787` | receiver WebSocket 监听端口 |
| `MT909_TCP_PORT` | `5013` | Mictrack MT909 TCP listen port |
| `ADMIN_PORT` | `8790` | Roster admin HTTP UI + /api/roster |
| `H02_TCP_PORT` | `5013` | 与 `MT909_TCP_PORT` 同义 |
| `CELL_DB_PATH` | `apps/receiver/data/opencellid-460.csv.gz` | 离线 OpenCelliD CSV / .csv.gz |
| `GPS_ONLINE_TIMEOUT_MS` | `360000` | 无包判离线窗口 |
| `UCAST_ENABLED` | 配置文件里的 `enabled` | 覆盖 Ucast 轮询开关 |
| `UCAST_LOGIN` / `UCAST_PASSWORD` | 配置文件里的值 | 覆盖 Ucast 账号/密码。**设了会让管理页那两个输入框失效** |
| `UCAST_SN` | — | 覆盖设备列表。**设了会整个忽略配置文件里的 `devices`**，且未同时给 `UCAST_DEVICE_ID` 时会拿 SN 当设备号 |
| `UCAST_DEVICE_ID` | 同 `UCAST_SN` | 配合 `UCAST_SN` 指定名册设备号 |
| `UCAST_CONFIG_PATH` | `apps/receiver/data/ucast.json` | Ucast 配置文件路径 |
| `UCAST_LINK_RECENT_MS` | `15000` | 多久没收到 tick 就算断流（`/api/ucast/status` 用） |
| `ROSTER_PATH` | `apps/receiver/data/roster.json` | 名册文件路径（测试用） |
| `DISCOVERY_PATH` | `apps/receiver/data/discovered.json` | 待确认设备库路径（测试用） |
| `GPS_DISCOVERY_MIN_HITS` | `3` | 陌生设备见到几次才算待确认 |
| `GPS_DISCOVERY_GLOBAL` | `0` | 设为 `1` 放开坐标范围限制（默认限中国境内） |

示例：
```bash
WS_PORT=8787 pnpm --filter receiver demo
```
