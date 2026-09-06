# MQTT Topics

## Topic
- 上行：`telemetry/{device_id}`
- 示例：`telemetry/demo-1`、`telemetry/athlete-42`

## Payload（JSON）
与 `packages/schema` 一致：

| 字段 | 类型 | 说明 |
|------|------|------|
| device_id | string | 设备/选手 ID |
| lat / lng | number | WGS84 |
| speed | number | 时速 km/h |
| alt_baro | number | 气压海拔 m（主叠层可不显示，剖面用） |
| ts | number | Unix ms |
| bib | string | 号码布 |
| name | string | 显示名 |
| distance | number | 累计距离 m |
| climb | number | 累计爬升 m |

可选后续：`heading`、`sats`（第一版不要求）。

## 频率与轨迹
- 上报：**1–2 Hz**
- 播控侧轨迹存点：约每 **5–10 m** 或 **≥1 s** 一个（receiver `downsample`）
- QoS：建议 **0 或 1**；丢帧靠 marker 插值兜住

## Broker / Demo
- 本地可用 Mosquitto（可选 `docker-compose.yml`）
- Demo 不连 MQTT：`pnpm --filter receiver demo` → 直推 WS

## 播控机
订阅 MQTT → 降采样 → `ws://<host>:8787`  
消息体：`{ athlete, trail[] }`
