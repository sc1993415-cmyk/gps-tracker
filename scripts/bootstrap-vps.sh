#!/bin/bash
set -euxo pipefail
cd /opt/gps-tracker
corepack prepare pnpm@9.15.0 --activate
hash -r
pnpm --version
pnpm install
pnpm --filter overlay build
echo bootstrap_done
