#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Named volumes are created root-owned; hand it to the node user
mkdir -p node_modules
sudo chown node:node node_modules

# Enables pnpm/yarn shims bundled with Node
sudo corepack enable

if [ ! -f package.json ]; then
  echo "No package.json yet - skipping dependency install."
  exit 0
fi

if [ -f pnpm-lock.yaml ]; then
  pnpm install --frozen-lockfile
elif [ -f yarn.lock ]; then
  yarn install
elif [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

# Browsers + system libraries for e2e tests, only if the project uses Playwright
if grep -q '"@playwright/test"' package.json; then
  npx playwright install --with-deps chromium
fi
