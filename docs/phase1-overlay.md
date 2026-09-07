# Phase 1 — Racemap-lite live player

Multi-athlete WebSocket overlay: Athletes list + map flags + selected HUD.

## WebSocket shape (OverlayState)

- event?: { name: string }
- course?: GeoJSON Feature LineString | null (red shadowtrack)
- participants: Record of { id, bib, name, color?, online, athlete, trail }

Legacy single-athlete payload wrapped as one participant by overlay shim.
Receiver maps device_id/IMEI to participant; update that one; broadcast full state.

## Overlay URL params (hash style, RaceMap-aligned)

Use hash fragments for selected, mapOnly, largeMode, listOpen=false.

| Param | Effect |
|-------|--------|
| selected | Select by participant id |
| selectedStartNumber | Select by bib |
| largeMode | Larger HUD/flag for OBS |
| mapOnly | Hide list + top bar |
| listOpen=false | Collapse Athletes list |
| hideNonSelected | Only selected marker |
| ws | Override WebSocket URL |

Query-string fallback OK. Click list to select and follow; hash updates.
Left panel is Athletes only. Rows show progress km.

## Course / trails

- Optional course.geojson under overlay public, else inline demo LineString
- Course is red shadowtrack; selected trail is thicker

## Try locally

Install deps, run receiver demo and overlay dev.
Hash: mapOnly, selectedStartNumber, listOpen=false

