#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export KUBECONFIG="$PWD/.foodiguard-local/kubeconfig"
db() { kubectl --context kind-foodiguard -n foodiguard exec -i postgres-0 -- "$@"; }
if [ "$#" != 1 ] || [ ! -r "$1" ]; then echo '사용법: bash local/scripts/restore.sh /절대경로/foodiguard.dump' >&2; exit 2; fi
count=$(db psql -XAt -U postgres -d foodiguard -c "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
if [ "$count" != 0 ]; then
  echo '기존 데이터가 있어 복원을 건너뜁니다.'
  db psql -XAt -U postgres -d foodiguard -c 'SELECT count(*) AS foods FROM food_products'
  exit
fi
# A failed restore rolls back, allowing the same command to be retried.
db pg_restore --no-owner --no-privileges --single-transaction -U postgres -d foodiguard < "$1"
db psql -XAt -U postgres -d foodiguard -c 'SELECT count(*) AS foods FROM food_products'
