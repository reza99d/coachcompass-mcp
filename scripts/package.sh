#!/usr/bin/env bash
# Builds the deploy tarball (+ sha256) and the OpenAI plugin ZIP into ./out/.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
rm -rf out && mkdir -p out
npm run build >/dev/null
npx vitest run --reporter=dot
COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs --exclude='.DS_Store' -czf out/coachcompass-mcp.tgz \
  package.json package-lock.json tsconfig.json vitest.config.ts src test widget dist public deploy
(cd out && shasum -a 256 coachcompass-mcp.tgz > coachcompass-mcp.tgz.sha256)
(cd openai-plugin && rm -f ../out/coachcompass-openai-plugin.zip && zip -qr -X ../out/coachcompass-openai-plugin.zip . -x '.DS_Store')
ls -la out
