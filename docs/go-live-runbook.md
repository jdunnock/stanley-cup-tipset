# Go-Live Runbook (Kickoff)

## Pre-checks
1. Data feed available and latest dataset valid.
2. Validator schema and rule runs passed.
3. Stallningen scheduler at 09:00 Europe/Helsinki tested successfully.
4. Nyheter collection jobs passed.

## Cutover Steps
1. Apply production configuration.
2. Run validator with approved dataset.
3. Deploy frontend pages (lagen, stallningen, nyheter, validator-admin).
4. Confirm first leaderboard calculation.

## Smoke Tests
1. Lagen renders with playoff data.
2. Stallningen shows expected points on known test scenario.
3. Nyheter list updates correctly.
4. Validator admin shows status and errors correctly.

## Rollback
1. Revert to previous release.
2. Temporarily lock new data jobs.
3. Publish rollback status and start incident tracking.
