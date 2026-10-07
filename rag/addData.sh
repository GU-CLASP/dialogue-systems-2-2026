#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <collection_name> <directory_path>" >&2
  exit 1
fi

COLLECTION_NAME="$1"
DIRECTORY_PATH="$2"

if [ ! -d "$DIRECTORY_PATH" ]; then
  echo "Error: Directory '$DIRECTORY_PATH' does not exist." >&2
  exit 1
fi

for file in "$DIRECTORY_PATH"/*; do
  if [ -f "$file" ]; then
    npx tsx src/main.ts addData "$COLLECTION_NAME" "$file"
  fi
done
