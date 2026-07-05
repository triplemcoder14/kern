#!/usr/bin/env bash
# Wrapper — use deploy-agent.sh
exec "$(cd "$(dirname "$0")" && pwd)/deploy-agent.sh" "$@"
