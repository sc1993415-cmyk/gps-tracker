# Athlete roster admin

Bind tracker device_id (H02 short id, e.g. 7026238813 — not sticker IMEI) to bib / name / color.
Admin UI is Chinese-localized (设备号 / 号码牌 / 姓名 / 颜色).

## Open the UI

With receiver running (demo or mt909):
- Admin page: http://localhost:8790/
- JSON API: http://localhost:8790/api/roster
Port override: ADMIN_PORT default 8790.

Start receiver demo or mt909 (admin starts with it).

## Fields

- device_id: H02 short id from binary frames, or demo id.
- bib: Start number
- name: Display name
- color: Marker swatch

Persisted in apps/receiver/data/roster.json as a JSON array.
Demo seed: Alice Bob Chen on demo-1 demo-2 demo-3.

## IMEI binding

1. Note the H02 device_id from receiver logs (`[h02] $ binary id=…`).
2. In admin UI set device_id + bib/name/color then Save (or accept from 待确认).
3. Receiver writes roster.json and hot-reloads. Empty roster = whitelist nobody.
4. Unknown plausible ids go to discovery pending; ghost suffixes like 238813 are dropped.

## API

- GET /api/roster list
- PUT /api/roster full replace array plus reload
- POST /api/roster upsert object or array plus reload
- DELETE /api/roster/:device_id remove plus reload

No auth. Local or LAN only.

## Also on the same admin UI
- Session start/end/reset, event name
- GPX upload, course snap toggle
- MT909 commands + GET /api/command/receipts (last 20)
- Roster CSV import/export, discovered devices accept/dismiss
