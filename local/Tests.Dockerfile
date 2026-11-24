FROM node:22-alpine
WORKDIR /work/backend
COPY backend/package*.json ./
RUN npm ci
WORKDIR /work
COPY backend/server backend/server
COPY backend/scripts backend/scripts
COPY mobile/package*.json mobile/
COPY mobile/App.js mobile/App.js
COPY mobile/src mobile/src
COPY infra infra
COPY k8s k8s
COPY Jenkinsfile .gitignore ./
COPY mobile/scripts mobile/scripts
COPY local/chart local/chart
RUN cd backend && npm test
RUN cd mobile && node --test "src/**/*.test.js"
RUN node --test "infra/tests/*.test.mjs"
