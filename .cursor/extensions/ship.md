# ship extension (job-application-agent)

**Business outcome:** apply a **frozen, CI-green** `origin/dev` commit to the live apply worker on this server (`docker compose` rebuild when needed).

**This command is not `/commit-dev-until-green`.** Ship never commits WIP. CI must already be green on `FROZEN_SHA` before dispatch.

Root: `/opt/apps/job-application-agent`. Repo: `digitalab-creator/job-application-agent`. Integration branch: `dev`. `/ship` does not merge `dev` into `master`.

## Before dispatch

1. Dirty tracked files block the release. Commit them with `/commit-dev-until-green` first.
2. `git fetch origin dev` and freeze `FROZEN_SHA` from `origin/dev`.
3. Preflight: `bash scripts/gha/verify-ci-green-for-sha.sh "$FROZEN_SHA"`.
4. The `digitalab-prod` runner must accept this repo.

## Dispatch

```bash
gh workflow run Deploy --repo digitalab-creator/job-application-agent --ref dev \
  -f sha="$FROZEN_SHA" \
  -f confirm="DEPLOY $FROZEN_SHA TO PRODUCTION" \
  -f mode=deploy
```

Watch workflow **Deploy** for that run. Retry at most 5 times.

The workflow checks out the frozen SHA under `/opt/apps/job-application-agent`, rebuilds the image when `Dockerfile`, `package.json`, or `docker-compose.yml` changed, and runs `docker compose up -d --build job-application-agent`. It does not touch `.env`, `data/ledger/`, `data/browser-profile/`, or mounted runtime dirs.

## After Deploy succeeds

Smoke `http://127.0.0.1:3099/health`. HTTP **200** means the worker is up.

Release metadata: `tmp/deploy/latest-release.json`.

## Rollback

```bash
gh workflow run Deploy --repo digitalab-creator/job-application-agent --ref dev \
  -f sha="$ROLLBACK_SHA" \
  -f confirm="DEPLOY $ROLLBACK_SHA TO PRODUCTION" \
  -f mode=rollback \
  -f previous_sha="$ROLLBACK_SHA"
```

Never print `.env` or tokens.
