# course-project (Phase 2 skeleton)

Shadowtrack-style along-course projection. Package: `packages/course-project`.

## Algorithm notes

1. **GPX index** — LineString → `points`, segment lengths, prefix `cum[]` (meters), `totalM`.
2. **Project** — GPS `Q` → nearest segment in a progress window; return along-track `s`, `proj`, perpendicular `dist`.
3. **maxMapM** — if `dist` exceeds mapping distance (e.g. 80–120 m), mark `offCourse` and do not advance `s`; also clamp unreasonable `|Δs|/Δt`.
4. **Anti-backtrack / multi-lap** — keep `s` monotonic within a lap; detect lap++ via finish band; forbid large backward jumps unless the course allows out-and-back.

Ranking UI is **out of scope** for this package for now (sort by `progress_m` later).

## Status

`buildCourseIndex` / `projectToCourse` implemented; wired into `apps/receiver` (writes `progress_m` / `progress_pct` / `dist_to_finish_m` / `off_course` / `lap` onto each participant).
