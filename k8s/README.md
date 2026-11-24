# 로컬 Kubernetes

앱은 `local/chart/`의 Helm 차트로 배포하고 DB·배포 도구는 `local/platform/`에서 준비합니다. 저장소 루트에서 `make up DUMP="/절대경로/foodiguard.dump"`를 사용합니다.

이전 GKE 매니페스트는 `infra/gcp/k8s/`에 보관합니다.
