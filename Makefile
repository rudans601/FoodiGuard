SHELL := /bin/bash
DUMP ?= $(CURDIR)/.foodiguard-local/backup/foodiguard.dump
export FOODIGUARD_HOME := $(CURDIR)
export KUBECONFIG := $(CURDIR)/.foodiguard-local/kubeconfig
K := kubectl --context kind-foodiguard
COMPOSE := docker compose -f local/compose.yaml
.PHONY: up platform restore deploy model monitoring status stop start

platform:
	bash local/scripts/platform.sh
	bash local/scripts/ci-up.sh

restore:
	bash local/scripts/restore.sh "$(DUMP)"

model:
	$(K) -n foodiguard rollout status sts/ollama --timeout=15m
	$(K) -n foodiguard exec ollama-0 -- ollama pull qwen2.5:0.5b

up: platform
	$(MAKE) restore DUMP="$(DUMP)"
	$(MAKE) model
	$(MAKE) deploy
	$(MAKE) monitoring

deploy:
	@test -z "$$(git status --porcelain --untracked-files=normal)" || { echo '배포할 파일을 먼저 로컬 Git에 커밋하세요.'; exit 1; }
	act workflow_dispatch --actor rudans601 --var ENABLE_LOCAL_RUNNER=true -W .github/workflows/local-deploy.yml -P self-hosted=-self-hosted -P foodiguard-local=-self-hosted --env "FOODIGUARD_HOME=$(CURDIR)" --var "FOODIGUARD_HOME=$(CURDIR)"

monitoring:
	$(K) -n foodiguard create configmap foodiguard-monitoring --from-file=local/platform/prometheus.yml --from-file=local/platform/alerts.yml --dry-run=client -o yaml | $(K) -n foodiguard apply -f -
	$(K) -n foodiguard apply -f local/platform/monitoring.yaml
	$(K) -n foodiguard rollout status sts/prometheus --timeout=10m
	$(K) -n foodiguard exec prometheus-0 -- promtool check config /etc/foodiguard/prometheus.yml
	$(K) -n foodiguard exec prometheus-0 -- kill -HUP 1

status:
	$(K) -n foodiguard get pod,hpa,cronjob,pvc
	$(K) -n argocd get application foodiguard
	$(COMPOSE) ps
	curl -fsS http://127.0.0.1:18180/api/health/ready

stop:
	docker stop foodiguard-control-plane
	$(COMPOSE) stop

start:
	docker start foodiguard-control-plane
	$(COMPOSE) start
	@for ((i=0;i<90;i++)); do $(K) --request-timeout=3s get --raw=/readyz >/dev/null 2>&1 && break; sleep 2; done
	$(K) --request-timeout=10s get --raw=/readyz
	$(K) -n foodiguard rollout status sts/postgres --timeout=5m
	$(K) -n foodiguard rollout status deploy/foodiguard-api --timeout=5m
	$(K) -n foodiguard rollout status deploy/foodiguard-web --timeout=5m
	curl --retry 24 --retry-all-errors --retry-delay 2 --max-time 5 -fsS http://127.0.0.1:18180/api/health/ready
