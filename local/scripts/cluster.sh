#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
root=$(pwd -P)
state=$root/.foodiguard-local
umask 077
mkdir -p "$state"
export KUBECONFIG="$state/kubeconfig"
if ! kind get clusters | grep -qx foodiguard; then
  cat >"$state/kind.yaml" <<YAML
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
- role: control-plane
  extraPortMappings:
  - {containerPort: 30080, hostPort: 18180, listenAddress: "127.0.0.1"}
  - {containerPort: 30443, hostPort: 18183, listenAddress: "127.0.0.1"}
  extraMounts:
  - hostPath: "$state/gitops.git"
    containerPath: /var/local/foodiguard/gitops.git
YAML
  kind create cluster --name foodiguard --kubeconfig "$KUBECONFIG" --config "$state/kind.yaml" \
    --image kindest/node:v1.35.8@sha256:07b2536e30b803ed61d1677a79df6115f798ce64c80f9e22f6ed45afd09323c0 --wait 5m
else
  docker start foodiguard-control-plane >/dev/null
  kind export kubeconfig --name foodiguard --kubeconfig "$KUBECONFIG"
fi
kubectl --context kind-foodiguard wait --for=condition=Ready node/foodiguard-control-plane --timeout=3m
