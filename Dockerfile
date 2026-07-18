# Stage 1: Build frontend
FROM node:24-alpine AS frontend-build

WORKDIR /app
COPY ./frontend/package.json ./frontend/package-lock.json* ./
RUN npm ci
COPY ./frontend ./
RUN npm run build

# Stage 2: Python application
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    dumb-init \
    default-libmysqlclient-dev \
    build-essential && \
    rm -rf /var/lib/apt/lists/*

COPY ./pyproject.toml ./pyproject.toml
COPY ./agent_platform ./agent_platform
RUN pip install --no-cache-dir .

COPY ./docker_start.sh ./docker_start.sh
RUN chmod +x ./docker_start.sh

# Frontend build output from stage 1 (served by FastAPI at /)
COPY --from=frontend-build /app/dist ./frontend/dist

EXPOSE 8080

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["./docker_start.sh", "serve"]
