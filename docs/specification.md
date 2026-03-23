# Stanley Cup Tipset Specification (Kickoff)

## Goal
Build a separate Stanley Cup tipping system that keeps a familiar UX while using playoff-specific game logic.

## Functional Requirements
1. Lagen view
- Keep layout and UX close to current lagen view.
- Data model must be playoff-based (rounds, series, games).

2. Stallningen view
- Keep layout and UX close to current stallningen view.
- Scoring must use playoff rules.
- Automatic update every day at 09:00 in Europe/Helsinki timezone.

3. Playoff validator
- Use Period 3 validator as baseline pattern.
- Must include:
  - schema and required-field validation
  - rule validations (series progression, consistency, scoring inputs)
  - admin UI for run, result status, and error list

4. Nyheter
- Keep nyheter page behavior and automation pattern close to current project.
- Content language adapted for playoff context.

5. UX / Look and Feel
- Keep component structure and usability close to current product.
- Apply a light palette variation so this product is clearly distinct.

## Non-Goals
- Regular-season period 1-3 support in this project.
- Large visual redesign in MVP.
- Multi-season historical support in MVP.

## Locked Decisions (Phase 1)
1. Scoring rules: use simple playoff model v1 (`playoff-simple-v1`) for MVP.
2. Data strategy: use mock + JSON-compatible server data shape, with stale metadata (`updatedAt`, `ageMinutes`, `staleAfterMinutes`, `isStale`).
3. Admin authorization: lightweight `x-admin-token` header validation for admin endpoints.

## Deferred to Phase 2
1. Final production scoring model beyond v1 simplification.
2. External data-source integration and recovery strategy.
3. Strong admin auth/roles model.
