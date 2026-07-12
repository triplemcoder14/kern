#!/usr/bin/env bash
# Shared helpers for building Go images for the right CPU architecture.
#
# BuildKit sets TARGETOS/TARGETARCH from --platform. Always pass --platform so
# local arm64 Macs do not accidentally bake amd64 binaries (exec format error).

kern_docker_platform() {
  if [[ -n "${DOCKER_PLATFORM:-}" ]]; then
    echo "${DOCKER_PLATFORM}"
    return
  fi
  case "$(uname -m)" in
    x86_64 | amd64) echo "linux/amd64" ;;
    aarch64 | arm64) echo "linux/arm64" ;;
    *) echo "linux/$(uname -m)" ;;
  esac
}

# Usage: kern_build_go_image <context-dir> <image:tag> [extra docker build args...]
kern_build_go_image() {
  local context="$1"
  local tag="$2"
  shift 2
  local platform
  platform="$(kern_docker_platform)"
  echo "Building ${tag} (--platform ${platform})"
  DOCKER_BUILDKIT=1 docker build \
    --platform "${platform}" \
    -t "${tag}" \
    "$@" \
    "${context}"
}
