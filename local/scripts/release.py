"""Publish a committed source revision, then wait for this exact GitOps release."""
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.request import Request, urlopen

home = Path(os.environ["FOODIGUARD_HOME"]).resolve()
state = home / ".foodiguard-local"
jenkins = "http://127.0.0.1:18182"
revision = sys.argv[1]
source = Path(sys.argv[2]).resolve()
if not re.fullmatch("[0-9a-f]{40}", revision):
    sys.exit("Invalid Git SHA")

def run(*args):
    return subprocess.check_output(args, text=True).strip()

def k(*args):
    return run("kubectl", "--kubeconfig", str(state / "kubeconfig"), "--context", "kind-foodiguard", *args)

token = (state / "ci-token").read_text().strip()
auth = base64.b64encode(f"foodiguard-ci:{token}".encode()).decode()

def request(path, data=None):
    req = Request(jenkins + path, data=data, headers={"Authorization": "Basic " + auth})
    return urlopen(req, timeout=15)

def wait_for(check, seconds, description):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        time.sleep(4)
    sys.exit(f"Timed out waiting for {description}")

if run("git", "-C", str(source), "rev-parse", revision + "^{commit}") != revision:
    sys.exit("Revision is unavailable")
run("git", "-C", str(source), "push", "--quiet", str(state / "source.git"), f"{revision}:refs/heads/releases/{revision}")
with request("/job/foodiguard-local/buildWithParameters", f"REVISION={revision}".encode()) as response:
    queue = re.search(r"/queue/item/(\d+)/?", response.headers["Location"]).group(1)

def build_number():
    with request(f"/queue/item/{queue}/api/json") as response:
        item = json.load(response)
    if item.get("cancelled"):
        sys.exit("Jenkins queue item cancelled")
    return item.get("executable", {}).get("number")

number = wait_for(build_number, 1200, "Jenkins executor")
path = f"/job/foodiguard-local/{number}"
print(f"Jenkins build {jenkins}{path}/", flush=True)

def result():
    with request(path + "/api/json") as response:
        return json.load(response).get("result")

status = wait_for(result, 2400, "Jenkins build")
if status != "SUCCESS":
    sys.exit(f"Jenkins {number}: {status}. See its Console Output.")
release = run("git", "--git-dir", str(state / "gitops.git"), "rev-parse", "main")
if revision not in run("git", "--git-dir", str(state / "gitops.git"), "show", "main:chart/release.yaml"):
    sys.exit("A newer release has already been promoted")
k("-n", "argocd", "apply", "-f", str(source / "local/platform/application.yaml"))
k("-n", "argocd", "annotate", "application/foodiguard", "argocd.argoproj.io/refresh=hard", "--overwrite")

def synced():
    app = json.loads(k("-n", "argocd", "get", "application", "foodiguard", "-o", "json"))
    status = app.get("status", {})
    sync = status.get("sync", {})
    return sync.get("revision") == release and sync.get("status") == "Synced" and status.get("health", {}).get("status") == "Healthy"

wait_for(synced, 900, "Argo CD sync and health")
for component in ["api", "web"]:
    name = "deployment/foodiguard-" + component
    k("-n", "foodiguard", "rollout", "status", name, "--timeout=2m")
    image = k("-n", "foodiguard", "get", name, "-o", "jsonpath={.spec.template.spec.containers[0].image}")
    if not image.endswith(":" + revision):
        sys.exit(f"Unexpected {component} revision: {image}")
with urlopen("http://127.0.0.1:18180/api/health/ready", timeout=10) as response:
    assert response.status == 200
print(f"Healthy: {revision} (GitOps {release})", flush=True)
