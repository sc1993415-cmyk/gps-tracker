# Athlete roster admin

Bind MT909 IMEI device_id to bib name color.

## Open the UI

With receiver running (demo or mt909):
- Admin page: http://localhost:8790/
- JSON API: http://localhost:8790/api/roster
Port override: ADMIN_PORT default 8790.

Start receiver demo or mt909 (admin starts with it).

## Fields

- device_id: Tracker IMEI (MT909) or demo id.
- bib: Start number
- name: Display name
- color: Marker swatch

Persisted in apps/receiver/data/roster.json as a JSON array.
Demo seed: Alice Bob Chen on demo-1 demo-2 demo-3.

## IMEI binding

1. Note the MT909 IMEI.
2. In admin UI set device_id to IMEI plus bib name color then Save.
3. Receiver writes roster.json and hot-reloads.
4. Unknown devices still show with device_id as name fallback.

## API

- GET /api/roster list
- PUT /api/roster full replace array plus reload
- POST /api/roster upsert object or array plus reload
- DELETE /api/roster/:device_id remove plus reload

No auth. Local or LAN only.
