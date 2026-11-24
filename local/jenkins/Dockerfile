FROM moby/buildkit:v0.23.2-rootless AS builder
FROM jenkins/jenkins:lts-jdk21
COPY --from=builder /usr/bin/buildctl /usr/local/bin/buildctl
RUN jenkins-plugin-cli --plugins workflow-job workflow-cps workflow-durable-task-step workflow-basic-steps pipeline-stage-step matrix-auth
COPY init.groovy /usr/share/jenkins/ref/init.groovy.d/foodiguard.groovy
