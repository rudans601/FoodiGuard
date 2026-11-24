#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
umask 077
ci() { docker compose -f local/compose.yaml "$@"; }
ci up -d --build
for ((i=0;i<120;i++)); do
  if curl -fsS http://127.0.0.1:18182/login -o /dev/null 2>/dev/null && ci exec -T jenkins test -s /var/jenkins_home/secrets/foodiguard-ci-token; then
    ci exec -T jenkins cat /var/jenkins_home/secrets/foodiguard-ci-token >.foodiguard-local/ci-token
    exit
  fi
  sleep 2
done
echo 'Jenkins 초기화 로그를 확인하세요: docker compose -f local/compose.yaml logs jenkins' >&2
exit 1
