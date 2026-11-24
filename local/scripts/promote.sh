#!/usr/bin/env bash
set -euo pipefail
release=$(mktemp -d)
trap 'rm -rf "$release"' EXIT
git clone -q /gitops.git "$release"
mkdir -p "$release/chart"
# Mirror the current tracked chart, including removals.
git -C "$release" rm -qr --ignore-unmatch chart
mkdir -p "$release/chart"
cp -R local/chart/. "$release/chart/"
printf 'tag: "%s"\n' "$REVISION" > "$release/chart/release.yaml"
git -C "$release" add chart
if ! git -C "$release" diff --cached --quiet; then
  git -C "$release" -c user.name='FoodiGuard Jenkins' -c user.email='jenkins@localhost' commit -qm "Deploy $REVISION"
  git -C "$release" push -q origin HEAD:main
fi
