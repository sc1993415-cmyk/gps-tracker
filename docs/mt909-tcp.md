# MT909 TCP 接入
- 设备：Mictrack MT909，开放 TCP（非 MQTT）
- 默认端口：5013；短信 `IP <公网IP> 5013`
- 启动：`pnpm --filter receiver mt909`
- 帧：`#IMEI#...` + `$GPRMC...` + `##`；`V` 丢弃
- 映射：IMEI→device_id；RMC→lat/lng/speed(/heading)；alt_baro/climb=0
- 与 MQTT 无关：直接进同一套 WS 叠层
