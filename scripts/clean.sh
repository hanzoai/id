#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
find . -type d \( -name node_modules -o -name dist -o -name .turbo -o -name .next \) -prune -exec rm -rf {} +
find . -type f -name 'tsconfig.tsbuildinfo' -delete
echo "clean done"
