# FoodiGuard 로컬 실행

이 폴더는 이전 비공개 저장소의 `main`에서 가져온 푸디가드의 Mac 개발 환경이다. 식품 검색, 영양 점수, 장바구니, 알레르기 필터와 AI 설명은 로컬 컨테이너에서 실행한다.

| 구성 | 위치와 역할 |
| --- | --- |
| 웹 · API · DB | Docker Desktop의 전용 kind 클러스터 `foodiguard`. Nginx가 웹과 `/api`를 같은 주소로 제공하고 Express가 PostgreSQL 17을 조회한다. |
| AI 코치 | 클러스터 내부 Ollama의 `qwen2.5:0.5b`. 모델 초기 다운로드 후 장바구니 설명을 CPU 스레드 2개로 생성한다. 첫 요청은 모델을 메모리에 읽는 시간이 추가되며 이후 10분 동안 재사용한다. 로컬 개발판의 동의 문구와 판본을 별도로 사용한다. |
| GitHub Actions | `.github/workflows/local-deploy.yml`을 Mac에서 `act`로 실행한다. 동일한 워크플로를 GitHub에서 실행하려면 아래 연결 조건이 필요하다. |
| Jenkins · Docker 이미지 | 전용 Jenkins가 정확한 Git 커밋을 체크아웃한 후 테스트, Dockerfile 빌드, 사설 레지스트리 게시를 실행한다. 빌드는 별도 rootless BuildKit 컨테이너를 사용한다. |
| Helm · Argo CD | Jenkins가 통과한 이미지 SHA와 Helm 차트를 로컬 Git 저장소에 기록한다. Argo CD가 이 이력을 읽어 DB 마이그레이션 후 웹·API를 배포한다. |
| 운영 | Metrics Server와 HPA가 API를 2~4개로 조절한다. 알레르기 재계산은 매일 한국 시간 03시에 실행한다. 로컬 Prometheus가 Pod별 API 지표를 수집하고 오류율·지연·재시작·데이터 품질 등 10개 규칙을 평가한다. |

## 접속

| 대상 | 주소 |
| --- | --- |
| 웹 | http://127.0.0.1:18180 |
| API · DB 준비 상태 | http://127.0.0.1:18180/api/health/ready |
| Jenkins | http://127.0.0.1:18182 · 계정 `local-admin` · 비밀번호 파일 `.foodiguard-local/admin-password` |
| Argo CD | https://127.0.0.1:18183 · 로컬 자체서명 인증서 · 계정 `admin` |

Argo CD 초기 비밀번호는 본인 터미널에서 아래 명령으로 확인한다.

```bash
kubectl --kubeconfig .foodiguard-local/kubeconfig -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -D
```

## 최초 설치와 실행

Mac에서 Docker Desktop을 실행하고 `git`, `kind`, `kubectl`, `helm`, `act`, `python3`, `make`, `openssl`을 준비한다. 최초 설치에는 컨테이너 이미지, npm 패키지, 모델, Argo CD와 Metrics Server를 내려받을 인터넷 연결이 필요하다. 다른 클러스터와의 포트 충돌을 피하려면 위 세 포트를 비워 둔다.

```bash
make up DUMP="/절대경로/foodiguard.dump"
```

이 Mac의 Project 폴더에는 원본과 대조한 덤프를 `.foodiguard-local/backup/foodiguard.dump`로 보관했다. 여기서는 `make up`만 실행해도 된다. 다른 Mac에서는 PostgreSQL 17 custom-format 덤프 경로를 지정한다. 복원 대상 DB가 비어 있으면 단일 트랜잭션으로 복원한다. 이미 식품 테이블이 있으면 기존 DB를 사용한다. 데이터베이스 자격 증명은 처음 시작할 때 Mac에서 새로 만든다. 로컬 덤프와 `.foodiguard-local/`은 Git 및 이미지 빌드 대상에서 제외한다.

## 개발 및 배포

앱을 수정한 뒤 배포할 파일을 **이 폴더에서 커밋**하고 다음을 실행한다.

```bash
make deploy
make status
```

`make deploy`는 커밋을 로컬 전용 소스 저장소로 전달한다. 워크플로가 Jenkins의 해당 빌드를 기다린 뒤 Argo CD의 Git 리비전, 실제 웹·API 이미지 태그, 준비 상태 HTTP 응답까지 확인한다. Jenkins 콘솔에는 실패한 단계의 로그가 남는다. Helm만 확인하려면 `helm lint local/chart --set-string tag=validation`을 사용한다.

공개 저장소에서는 원격 실행을 기본 비활성화했다. 관리자가 실행 범위를 검토한 뒤 저장소 변수 ENABLE_LOCAL_RUNNER=true를 명시해야 활성화된다. GitHub의 실제 push 이벤트를 사용하려면 이 워크플로가 원격 `main`에 있어야 한다. 저장소 전용 macOS self-hosted runner에 `foodiguard-local` 라벨을 지정하고 저장소 Secret `FOODIGUARD_HOME`을 이 폴더의 절대경로로 설정한다. 신뢰한 main 커밋으로만 Mac에서 배포한다. GitHub 연결 없이 현재 변경을 시험할 때는 위 `make deploy`를 사용한다.

## 중지 · 재시작과 데이터

```bash
make stop
make start
make status
```

중지는 프로젝트의 노드와 CI 컨테이너를 멈춘다. DB와 모델은 kind 노드의 PVC에, Jenkins와 레지스트리 데이터는 Docker 볼륨에 남는다. **kind 클러스터 자체를 삭제하면 노드 안의 DB와 모델도 지워진다.** 개발 중 바뀐 데이터는 중지 전 다음 예처럼 새 파일로 내보낼 수 있다.

```bash
(umask 077; kubectl --kubeconfig .foodiguard-local/kubeconfig -n foodiguard exec postgres-0 -- pg_dump -Fc -U postgres foodiguard > ".foodiguard-local/foodiguard-$(date +%Y%m%d-%H%M%S).dump")
```

## 로컬 모니터링

`make monitoring`으로 수집기를 설치하거나 설정을 갱신한다. `kubectl --kubeconfig .foodiguard-local/kubeconfig -n foodiguard port-forward svc/prometheus 18184:9090` 실행 후 http://127.0.0.1:18184/alerts 에서 경보 상태를 본다. 이메일은 발송하지 않는다.

## 모바일 시뮬레이터

`cd mobile && npm ci` 후 iOS는 `npm run ios`, Android는 `npm run android:local`을 사용한다. iOS의 `127.0.0.1:18180/api`, Android 에뮬레이터의 `10.0.2.2:18180/api`가 같은 웹 프록시와 DB를 사용한다. 웹·관리 UI는 Mac의 루프백에 바인딩된다.

기존 GCP 배포 자료는 `infra/gcp/`와 `docs/`의 당시 기록에서 확인할 수 있다. 이 로컬 개발판에서 연구 대상자에게 보여 줄 동의 문구 및 모델 응답의 적합성은 실제 연구 배포 전에 따로 검토한다.

## 공개본과 비공개 데이터

이 공개본은 보안 정리 후 새 Git 이력으로 구성했다. 이전 운영 이력과 동의 화면 캡처, 실제 DB 덤프, 로컬 키는 이 Mac의 .foodiguard-local/에 보관한다. 공개본의 프로젝트 ID, 운영 주소, 이메일은 예시값이다. 연구 설명문은 공개 개발용 예시이며 실제 연구 시 승인 문서와 연락처를 설정해야 한다.

공개 파일 점검은 gitleaks git . --redact로 실행한다. .foodiguard-local/ 전체를 업로드하거나 Docker 이미지에 포함하지 않는다.

## GitHub 자동 배포

main에 저장소 소유자가 push하거나 수동 실행하면 전용 Mac runner가 Jenkins의 테스트·이미지 빌드를 시작한다. Argo CD가 통과한 리비전을 배포하고 Actions가 이미지 태그와 준비 상태까지 확인한다. 소유자의 재실행만 허용한다. 외부 PR에서는 이 배포 워크플로가 실행되지 않는다.

Mac에 로그인한 상태에서 Docker Desktop과 푸디가드 서비스를 켜야 한다. make start로 서비스를 시작한다. 이 Mac에서는 Desktop 폴더 접근 권한 때문에 runner를 로그인 세션의 독립 프로세스로 실행한다. 재부팅 후에는 Project 폴더에서 make runner를 실행하고 해당 터미널을 유지한다. 자동 로그인 서비스 등록에는 macOS의 Desktop 접근 권한 설정이 추가로 필요하다. runner를 중지하거나 Mac이 잠들면 배포 작업은 대기할 수 있다.

저장소 설정은 ENABLE_LOCAL_RUNNER=true 변수와 FOODIGUARD_HOME Secret을 사용한다. Secret에는 이 Mac의 Project 절대경로를 설정한다. runner 자격 증명과 앱 비밀번호는 .foodiguard-local 안에 보관한다.
