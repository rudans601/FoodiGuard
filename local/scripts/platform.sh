#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
state="$PWD/.foodiguard-local"
export KUBECONFIG="$state/kubeconfig"
umask 077
mkdir -p "$state"
exclude=$(git rev-parse --git-path info/exclude)
grep -qxF "/.foodiguard-local/" "$exclude" || echo "/.foodiguard-local/" >> "$exclude"
for repo in source gitops; do
  if [ ! -f "$state/$repo.git/HEAD" ]; then git init -q --bare --initial-branch=main "$state/$repo.git"; fi
done
# The local Git reader and Jenkins mount their respective repositories.
chmod -R a+rX "$state/gitops.git" "$state/source.git"
for key in admin-password DB_PASSWORD AUTH_TOKEN_SECRET; do
  if [ ! -s "$state/$key" ]; then openssl rand -hex 32 | tr -d '\n' > "$state/$key"; fi
done
bash local/scripts/cluster.sh
k() { kubectl --context kind-foodiguard "$@"; }
for ns in foodiguard argocd; do k create namespace "$ns" --dry-run=client -o yaml | k apply -f -; done
for spec in 'db-credentials DB_PASSWORD' 'auth-credentials AUTH_TOKEN_SECRET'; do
  read -r name key <<<"$spec"
  if ! k -n foodiguard get secret "$name" >/dev/null 2>&1; then
    k -n foodiguard create secret generic "$name" --from-file="$key=$state/$key"
  fi
done
regdir=/etc/containerd/certs.d/foodiguard-registry:5000
docker exec foodiguard-control-plane mkdir -p "$regdir"
printf '%s\n' '[host."http://foodiguard-registry:5000"]' '  capabilities = ["pull","resolve"]' | docker exec -i foodiguard-control-plane tee "$regdir/hosts.toml" >/dev/null
k -n foodiguard apply -f local/platform/db.yaml
k -n foodiguard rollout status statefulset/postgres --timeout=15m
k -n foodiguard apply -f local/platform/ollama.yaml
# Keep upstream files pinned and reusable after a restart.
download() { if [ ! -s "$2" ]; then curl -fsSL --retry 3 "$1" -o "$2.tmp" && mv "$2.tmp" "$2"; fi; }
download https://raw.githubusercontent.com/argoproj/argo-cd/v3.6.2/manifests/install.yaml "$state/argo-v3.6.2.yaml"
k -n argocd apply --server-side -f "$state/argo-v3.6.2.yaml" >/dev/null
k -n argocd scale deploy argocd-dex-server argocd-notifications-controller argocd-applicationset-controller --replicas=0
download https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.9.1/components.yaml "$state/metrics-v0.9.1.yaml"
# kind's kubelet uses its local self-signed serving certificate.
sed '/- --secure-port=10250/a\
        - --kubelet-insecure-tls
' "$state/metrics-v0.9.1.yaml" | k apply -f - >/dev/null
k -n argocd apply -f local/platform/gitops.yaml
k -n foodiguard rollout status statefulset/postgres --timeout=10m
