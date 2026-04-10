#!/usr/bin/env bash
# scan-secrets.sh — Lightweight secret scanner for CI and pre-commit use.
# Scans staged/tracked files for patterns that look like hardcoded secrets.
# Exit code 1 if potential secrets are found, 0 otherwise.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

# Patterns that suggest hardcoded secrets (case-insensitive)
PATTERNS=(
  # Generic secret assignment patterns
  '(api[_-]?key|api[_-]?token|secret|password|auth[_-]?token)\s*[:=]\s*["\x27][a-zA-Z0-9_\-./+=]{16,}'
  # AWS access keys
  'AKIA[0-9A-Z]{16}'
  # GitHub tokens
  'gh[pousr]_[A-Za-z0-9_]{36,}'
  # Hex tokens (32+ bytes, common for API tokens)
  '(token|secret|key)\s*[:=]\s*["\x27][0-9a-f]{64}'
)

EXCLUDES=(
  "*.test.ts"
  "*.test.js"
  "scan-secrets.sh"
  ".env.example"
  "SECURITY.md"
  "node_modules/*"
  "packages/*/dist/*"
  "coverage/*"
)

FOUND=0

for pattern in "${PATTERNS[@]}"; do
  EXCLUDE_ARGS=""
  for exc in "${EXCLUDES[@]}"; do
    EXCLUDE_ARGS="$EXCLUDE_ARGS --glob=!$exc"
  done

  # Search tracked files only
  if git grep -lPi "$pattern" -- . $EXCLUDE_ARGS 2>/dev/null; then
    echo -e "${RED}Potential secret found matching pattern:${NC} $pattern"
    FOUND=1
  fi
done

if [ "$FOUND" -eq 0 ]; then
  echo -e "${GREEN}No potential secrets detected.${NC}"
  exit 0
else
  echo -e "${RED}Secret scan failed. Please review the files above.${NC}"
  exit 1
fi
