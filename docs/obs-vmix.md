# OBS / vMix 接入

先起服务：
1. `pnpm --filter receiver demo`（或真 MQTT 的 start）
2. `pnpm --filter overlay dev`
3. 确认 `ws://localhost:8787` 与 `http://localhost:5173/`

## OBS Studio
1. 来源 → **浏览器**（Browser Source）
2. 主叠层 URL：`http://localhost:5173/`
   - 宽高按节目（如 1920×1080）
   - 可勾选「关机时关闭」；透明：CSS 已偏深色底，若要抠像可再调
3. 海拔剖面另加一路 Browser Source：`http://localhost:5173/elevation.html`
4. 远程播控机：把 `localhost` 换成播控机局域网/Tailscale IP；overlay 里 WS 地址需指向同一台 receiver（可用环境变量后续加）

## vMix
**推荐（与 OBS 同 UI）**
- 添加 **Browser** Input，URL 同上两页

**备用（仅改数字）**
- 启用 TCP/HTTP API（默认 HTTP `8088`）
- 用 Title/GT + `SetText` 写时速/距离/爬升
- 主路径仍以 Web 叠层为准

## 体感参数（已定）
- GPS **1 Hz** 时 marker **900ms** ease-out 插值
- 轨迹用降采样点，不随插值每帧重写整条线

## 检查清单
- [ ] receiver 日志有 `[ws] listening`
- [ ] 浏览器打开主页：点在动、底栏数字变、轨迹延长
- [ ] `/elevation.html` 剖面有进度点
- [ ] OBS/vMix 嵌页与浏览器一致
