#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Load .env if exists
[ -f .env ] && export $(grep -v '^#' .env | xargs)

# ── 1. Bump version (patch 0-9, then minor+1) ──
CURRENT=$(node -p "require('./package.json').version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
PATCH=$((PATCH + 1))
if [ "$PATCH" -ge 10 ]; then
  PATCH=0
  MINOR=$((MINOR + 1))
fi
NEW_VERSION="$MAJOR.$MINOR.$PATCH"

# Update package.json version
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '$NEW_VERSION';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
echo "📦 Version: $CURRENT → $NEW_VERSION"

# ── 2. Commit everything ──
git add -A
if git diff --cached --quiet 2>/dev/null; then
  echo "⚠️  Nothing to commit, building with current HEAD"
else
  git commit -m "release: v$NEW_VERSION"
  echo "✅ Committed: v$NEW_VERSION"
fi

# ── 3. Get commit hash ──
GIT_HASH=$(git rev-parse --short HEAD)
echo "🔖 Hash: $GIT_HASH"

# ── 4. Build ──
pnpm build
echo ""
echo "🚀 Built v$NEW_VERSION+$GIT_HASH"
echo "   Reload extension from dist/chrome-mv3"

# ── 5. Push ──
git push
echo "📤 Pushed to remote"

# ── 6. Auto-reload extension (best effort) ──
if [ -n "$EXT_ID" ]; then
  echo ""
  node scripts/reload-ext.mjs "$EXT_ID" 2>/dev/null || echo "⚠️  Auto-reload skipped (browser relay not connected?)"
fi
