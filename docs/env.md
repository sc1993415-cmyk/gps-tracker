# 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `WS_PORT` | `8787` | receiver WebSocket 监听端口 |
| `MT909_TCP_PORT` | `5013` | Mictrack MT909 TCP listen port |
| `ADMIN_PORT` | `8790` | Roster admin HTTP UI + /api/roster |
| `H02_TCP_PORT` | `5013` | 与 `MT909_TCP_PORT` 同义 |
| `CELL_DB_PATH` | `apps/receiver/data/opencellid-460.csv.gz` | 离线 OpenCelliD CSV / .csv.gz |
| `GPS_ONLINE_TIMEOUT_MS` | `360000` | 无包判离线窗口 |

示例：
```bash
WS_PORT=8787 pnpm --filter receiver demo
```
