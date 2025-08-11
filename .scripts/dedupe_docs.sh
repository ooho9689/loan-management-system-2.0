#!/usr/bin/env bash
set -euo pipefail

ROOT=${1:-/workspace}
ARCHIVE_DIR="$ROOT/docs/_archive"
DUP_DIR="$ARCHIVE_DIR/duplicates"
UNUSED_DIR="$ARCHIVE_DIR/unused"
mkdir -p "$DUP_DIR" "$UNUSED_DIR"

DOCS_LIST="$ROOT/.docs_filelist.txt"
HASH_LIST="$ROOT/.docs_hashes.tsv"
ACTIONS_REPORT="$ARCHIVE_DIR/actions_taken.txt"
: > "$ACTIONS_REPORT"

# Find documents, excluding common build/dep dirs and existing archive
find "$ROOT" \
  -type f \
  \( -iname "*.md" -o -iname "*.mdx" -o -iname "*.rst" -o -iname "*.adoc" -o -iname "*.txt" -o -iname "*.pdf" -o -iname "*.doc" -o -iname "*.docx" -o -iname "*.odt" -o -iname "*.html" \) \
  -not -path "*/.git/*" -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/build/*" -not -path "*/.next/*" -not -path "*/out/*" -not -path "*/.venv/*" -not -path "*/venv/*" -not -path "*/target/*" -not -path "*/.terraform/*" -not -path "*/.cache/*" -not -path "*/docs/_archive/*" \
  | sed "s#^$ROOT/##" | sort -u > "$DOCS_LIST"

DOCS_COUNT=$(wc -l < "$DOCS_LIST" || echo 0)
echo "Found $DOCS_COUNT document files"

# Compute hashes (sha256) and store as TAB-separated: hash\tpath
: > "$HASH_LIST"
while IFS= read -r rel; do
  file="$ROOT/$rel"
  [ -s "$file" ] || continue
  if sha256sum "$file" >/dev/null 2>&1; then
    sha=$(sha256sum "$file" | awk '{print $1}')
    printf "%s\t%s\n" "$sha" "$rel" >> "$HASH_LIST"
  fi
done < "$DOCS_LIST"

# Sort by hash then path
sort -t $'\t' -k1,1 -k2,2 "$HASH_LIST" -o "$HASH_LIST"

# Scoring function to select canonical path within a duplicate group
score_path() {
  local p="$1"
  local score=0
  case "$p" in
    docs/*) score=$((score+100));;
  esac
  case "$p" in
    */README.md|README.md) score=$((score+50));;
  esac
  case "$p" in
    *.md|*.mdx|*.rst|*.adoc|*.txt|*.html) score=$((score+20));;
  esac
  case "$p" in
    */examples/*|*/example/*|*/samples/*|*/sample/*) score=$((score-5));;
  esac
  local len=${#p}
  if [ $len -gt 500 ]; then len=500; fi
  score=$((score + 500 - len))
  echo "$score"
}

# Process a group of duplicates for a given hash
process_group() {
  local h="$1"; shift
  local files=("$@")
  [ ${#files[@]} -le 1 ] && return 0
  local best="" best_score=-999999 best_len=999999
  for p in "${files[@]}"; do
    local s l
    s=$(score_path "$p")
    l=${#p}
    if [ "$s" -gt "$best_score" ] || { [ "$s" -eq "$best_score" ] && { [ "$l" -lt "$best_len" ] || { [ "$l" -eq "$best_len" ] && [[ "$p" < "$best" ]]; }; }; }; then
      best="$p"; best_score="$s"; best_len="$l"
    fi
  done
  for p in "${files[@]}"; do
    if [ "$p" = "$best" ]; then continue; fi
    local src dst
    src="$ROOT/$p"
    dst="$DUP_DIR/$p"
    mkdir -p "$(dirname "$dst")"
    if [ -f "$src" ]; then
      if [ -e "$dst" ]; then
        local base prefix dst_dir
        base=$(basename "$p")
        prefix=$(echo -n "$h" | cut -c1-8)
        dst_dir="$DUP_DIR/$(dirname "$p")"
        mkdir -p "$dst_dir"
        dst="$dst_dir/${prefix}__${base}"
      fi
      mv "$src" "$dst"
      echo "moved duplicate: $p -> ${dst#$ROOT/} (canonical: $best)" >> "$ACTIONS_REPORT"
    fi
  done
}

# Iterate groups in HASH_LIST
prev_hash=""
declare -a group_files
while IFS=$'\t' read -r h rel; do
  if [ "$h" != "$prev_hash" ]; then
    if [ -n "$prev_hash" ] && [ ${#group_files[@]} -gt 0 ]; then
      process_group "$prev_hash" "${group_files[@]}"
    fi
    group_files=()
    prev_hash="$h"
  fi
  group_files+=("$rel")
done < "$HASH_LIST"
# Flush last group
if [ -n "$prev_hash" ] && [ ${#group_files[@]} -gt 0 ]; then
  process_group "$prev_hash" "${group_files[@]}"
fi

# Rebuild docs list after moving duplicates
find "$ROOT" \
  -type f \
  \( -iname "*.md" -o -iname "*.mdx" -o -iname "*.rst" -o -iname "*.adoc" -o -iname "*.txt" -o -iname "*.pdf" -o -iname "*.doc" -o -iname "*.docx" -o -iname "*.odt" -o -iname "*.html" \) \
  -not -path "*/.git/*" -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/build/*" -not -path "*/.next/*" -not -path "*/out/*" -not -path "*/.venv/*" -not -path "*/venv/*" -not -path "*/target/*" -not -path "*/.terraform/*" -not -path "*/.cache/*" -not -path "*/docs/_archive/*" \
  | sed "s#^$ROOT/##" | sort -u > "$DOCS_LIST"

# Detect likely unused documents by searching for references to filename or stem
HAS_RG=0
if command -v rg >/dev/null 2>&1; then HAS_RG=1; fi
unused_moved=0
while IFS= read -r rel; do
  [ "$rel" = "README.md" ] && continue
  base=$(basename "$rel")
  name_no_ext="${base%.*}"
  if [ $HAS_RG -eq 1 ]; then
    hits=$(rg -n --hidden --no-ignore-vcs \
      -g '!docs/_archive/**' -g '!.git/**' -g '!node_modules/**' -g '!dist/**' -g '!build/**' -g '!.next/**' -g '!out/**' -g '!.venv/**' -g '!venv/**' -g '!target/**' -g '!.terraform/**' -g '!.cache/**' \
      -e "$base" -e "$name_no_ext" "$ROOT" | grep -v -F "$rel:" || true)
  else
    hits=$(grep -RIn --exclude-dir={.git,node_modules,dist,build,.next,out,.venv,venv,target,.terraform,.cache,docs/_archive} -e "$base" -e "$name_no_ext" "$ROOT" | grep -v -F "$rel:" || true)
  fi
  if [ -z "$hits" ]; then
    src="$ROOT/$rel"; dst="$UNUSED_DIR/$rel"
    mkdir -p "$(dirname "$dst")"
    if [ -f "$src" ]; then
      mv "$src" "$dst"
      echo "moved unused: $rel -> docs/_archive/unused/$rel" >> "$ACTIONS_REPORT"
      unused_moved=$((unused_moved+1))
    fi
  fi
done < "$DOCS_LIST"

# Summaries
dup_count=$(grep -c "^moved duplicate:" "$ACTIONS_REPORT" || true)
echo "Duplicates moved: $dup_count"
echo "Unused moved: $unused_moved"
echo "Reports at: docs/_archive/actions_taken.txt"