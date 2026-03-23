# stanley-cup-tipset

Separate project for Stanley Cup playoff tipping.

## Scope
- Playoff/postseason tipping (Stanley Cup)
- No regular-season period 1-3 logic in this repository

## MVP
- Lagen page (parity with current project, using playoff logic)
- Stallningen page (automatic update at 09:00 Europe/Helsinki)
- Playoff validator (schema + rule validations + admin UI)
- Nyheter page (parity + automatic collection)
- Light color palette change compared to nhl-stats

## Project Structure
- docs/ kickoff and operations docs
- public/ frontend pages
- src/ backend/server logic
- scripts/ automation and jobs
- data/ local data artifacts

## Next
1. Expand playoff data source from mock payloads to production feed
2. Upgrade admin auth from shared token to stronger role-based model
3. Add automated regression tests for validator and scheduler

## Environment
- `PORT` (default `3000`)
- `ADMIN_TOKEN` (optional; when set, admin endpoints require `x-admin-token` header)
- `PLAYOFFS_STALE_AFTER_MINUTES` (default `1440`)

## Admin Endpoints
- `POST /api/playoffs/scheduler/run-now`
- `GET /api/playoffs/validator/files`
- `POST /api/playoffs/validator/validate-team`

If `ADMIN_TOKEN` is configured, these endpoints return `403` without a matching `x-admin-token` header.
