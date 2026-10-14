#!/bin/bash
set -euo pipefail

# Bump the package version, commit it, tag it and push. The Release workflow
# then builds the Windows binaries and publishes the main package plus
# its platform packages to npm via OIDC trusted publishing (with provenance).
#
#   tag vX.Y.Z -> bumps package.json, triggers the Release workflow (npm)
#
# The platform packages under npm/* stay at 0.0.0 in git; `napi prepublish`
# stamps them with the real version during the publish job.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

usage() {
  cat <<EOF
Usage: scripts/release.sh <version|major|minor|patch> [--yes] [--skip-checks]

Examples:
  scripts/release.sh 0.0.9
  scripts/release.sh patch
  scripts/release.sh minor

Options:
  --yes, -y       Push without the confirmation prompt.
  --skip-checks   Skip the local lint (the bindings rebuild always runs).
EOF
  exit 1
}

SPEC="${1:-}"
YES=false
SKIP_CHECKS=false
for arg in "${@:2}"; do
  case "$arg" in
    --yes | -y) YES=true ;;
    --skip-checks) SKIP_CHECKS=true ;;
    *)
      echo "Unknown option: $arg"
      usage
      ;;
  esac
done

[ -z "$SPEC" ] && usage

cd "$ROOT"

# Safety: clean tree, on main, not behind origin.
if [ -n "$(git status --porcelain)" ]; then
  echo -e "${RED}Working tree not clean - commit or stash first.${NC}"
  exit 1
fi
branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "main" ]; then
  echo -e "${RED}Not on main (on '$branch').${NC}"
  exit 1
fi
git fetch -q origin main || true
if [ -n "$(git rev-list HEAD..origin/main 2>/dev/null)" ]; then
  echo -e "${RED}Local main is behind origin/main - pull first.${NC}"
  exit 1
fi

cur="$(node -p "require('./package.json').version")"

bump() {
  local IFS='.'
  read -r ma mi pa <<<"$1"
  case "$2" in
    major) echo "$((ma + 1)).0.0" ;;
    minor) echo "$ma.$((mi + 1)).0" ;;
    patch) echo "$ma.$mi.$((pa + 1))" ;;
  esac
}

case "$SPEC" in
  major | minor | patch) NEW="$(bump "$cur" "$SPEC")" ;;
  *) NEW="$SPEC" ;;
esac

if ! echo "$NEW" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo -e "${RED}Invalid version '$NEW' (expected X.Y.Z).${NC}"
  exit 1
fi

TAG="v$NEW"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo -e "${RED}Tag $TAG already exists.${NC}"
  exit 1
fi

echo -e "${CYAN}Releasing win-job: $cur -> $NEW (tag $TAG)${NC}"

# Bump the top-level version first (leave scripts.version = "napi version") so the
# rebuild below regenerates binding.js / binding.d.ts with the new version baked in.
node -e 'const fs=require("fs");const p=require("./package.json");p.version=process.argv[1];fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n")' "$NEW"

if [ "$SKIP_CHECKS" = false ]; then
  echo -e "${YELLOW}Running lint...${NC}"
  npm run lint
fi

# Always rebuild so the committed (and published) bindings match the new version.
echo -e "${YELLOW}Regenerating native bindings...${NC}"
npm run build:debug

git add package.json binding.js binding.d.ts

git commit -q -m "release: v$NEW"
echo -e "${GREEN}Committed version bump.${NC}"

git tag "$TAG"
echo -e "${GREEN}Created tag $TAG.${NC}"

if [ "$YES" = false ]; then
  printf "Push main + %s and trigger the release? [y/N] " "$TAG"
  read -r ans
  case "$ans" in
    y | Y | yes) ;;
    *)
      git tag -d "$TAG" >/dev/null
      git reset -q --hard HEAD~1
      echo "Aborted - tag and bump commit were undone locally."
      exit 0
      ;;
  esac
fi

git push -q origin main
git push -q origin "$TAG"
echo -e "${GREEN}Pushed. Watch the release workflow under the repo's Actions tab.${NC}"
