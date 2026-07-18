#!/bin/bash
set -e

if [ "$1" == "serve" ]; then
    # Production: uvicorn with multiple workers
    exec python -m uvicorn agent_platform.api.app:app \
        --host 0.0.0.0 \
        --port "${SERVER_PORT:-8080}" \
        --workers 4 \
        --log-level info
elif [ "$1" == "dev" ]; then
    # Development: single worker with reload
    exec python -m uvicorn agent_platform.api.app:app \
        --host 0.0.0.0 \
        --port "${SERVER_PORT:-8080}" \
        --reload \
        --log-level debug
elif [ "$1" == "test" ]; then
    exec python -m pytest tests/ -v
else
    echo "Usage: docker_start.sh {serve|dev|test}"
    exit 1
fi
