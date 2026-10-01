#!/usr/bin/env bash
# Runs ON the droplet (invoked by GitHub Actions after CI pushed the images).
# The caller updates the checkout BEFORE invoking this script — a script that
# git-resets itself mid-run keeps executing the stale buffered copy.
set -euo pipefail
cd /opt/cailyx

echo "==> pull images (built in CI)"
docker compose pull frontend backend redis

echo "==> migrate Supabase to this release (from the backend image)"
docker compose run --rm backend npm run db:migrate

echo "==> start (redis first, then backend, then frontend)"
docker compose up -d redis
docker compose up -d backend
docker compose up -d --no-deps frontend

wait_healthy() {
  local name="$1" svc="$2" check="$3"
  for _ in $(seq 1 30); do
    if docker compose exec -T "$svc" sh -c "$check" >/dev/null 2>&1; then
      echo "$name healthy"; return 0
    fi
    sleep 2
  done
  echo "$name FAILED to become healthy"; return 1
}
wait_healthy redis redis "redis-cli ping | grep -q PONG"
wait_healthy backend backend "wget -qO- http://127.0.0.1:3001/health | grep -q '\"status\":\"ok\"'"
wait_healthy frontend frontend "wget -qO- http://127.0.0.1:3000/"

docker image prune -f >/dev/null 2>&1 || true
echo "deploy ok"
# ---- disk hygiene: drop build cache, orphans, images unused 3+ days ----
docker builder prune -f >/dev/null 2>&1 || true
docker container prune -f >/dev/null 2>&1 || true
docker image prune -af --filter "until=72h" >/dev/null 2>&1 || true
echo "cleanup ok"
