#!/bin/sh
# Layer checker for the bridge mod (rule table L1).
#
# Usage: sh tools/check-sidebar-layers.sh <plugin dir>
#
# Prints each violation as `file:line: rule` and exits 1 when there is any;
# exits 0 on a clean tree and 2 on a usage error. Folders that do not exist
# yet are skipped.
#
#   hooks/core/*.ts and the four legacy pure modules
#       imports only ./*, ../sidebar-policy, ../card-policy, ../relative-time,
#       ../project-colors, and ../../types (types only); no `$.`; no terminal
#       names, in code or in comments
#   hooks/render/*.tsx
#       imports only ../core/* and `import type` from claude-code; same bans
#   hooks/adapters/*.ts
#       imports only ./* and ../core/types (types only); nothing from
#       ../render or ../register

set -u

dir=${1:-}
if [ -z "$dir" ] || [ ! -d "$dir/hooks" ]; then
  echo "usage: sh tools/check-sidebar-layers.sh <plugin dir>" >&2
  exit 2
fi

out=$(mktemp "${TMPDIR:-/tmp}/layers.XXXXXX") || exit 2
trap 'rm -f "$out"' EXIT HUP INT TERM

report() { printf '%s:%s: %s\n' "$1" "$2" "$3" >>"$out"; }

# Terminal facts and the runtime handle that no pure layer may mention.
WORDS='TERM_PROGRAM|COLORTERM|TMUX|CMUX|KITTY|ghostty|Ghostty|iTerm|Terminal\.app|osascript|tmux|cmux'

# Prints `line<TAB>specifier<TAB>kind` for every import in a file, where kind
# is `type` for an `import type` statement and `value` otherwise.
imports_of() {
  awk '
    function emit(spec) { printf "%d\t%s\t%s\n", NR, spec, (isType ? "type" : "value") }
    /^[ \t]*(import|export)[ \t]/ && !open { open = 1; isType = ($0 ~ /^[ \t]*import[ \t]+type[ \t]/) }
    open && match($0, /from[ \t]*["\047][^"\047]*["\047]/) {
      s = substr($0, RSTART, RLENGTH); sub(/^from[ \t]*["\047]/, "", s); sub(/["\047]$/, "", s)
      emit(s); open = 0; next
    }
    open && /^[ \t]*(import|export)[ \t]+["\047]/ {
      match($0, /["\047][^"\047]*["\047]/); s = substr($0, RSTART + 1, RLENGTH - 2); emit(s); open = 0; next
    }
    open && /;[ \t]*$|^[ \t]*(import|export)[ \t][^{]*$/ && !/\{[^}]*$/ { open = 0 }
    match($0, /(require|import)[ \t]*\([ \t]*["\047][^"\047]*["\047]/) {
      s = substr($0, RSTART, RLENGTH); sub(/^[a-z]+[ \t]*\([ \t]*["\047]/, "", s); sub(/["\047]$/, "", s)
      isType = 0; emit(s)
    }
  ' "$1"
}

# bans FILE: the text rules shared by every layer.
bans() {
  f=$1
  grep -nE '\$\.' "$f" | while IFS=: read -r n _; do
    report "$f" "$n" 'the runtime handle ($.) belongs in register.tsx only'
  done
  grep -nE "$WORDS" "$f" | while IFS=: read -r n _; do
    report "$f" "$n" 'terminal fact (belongs in an adapter, even in a comment)'
  done
}

# check_imports FILE LAYER: classify each import specifier.
check_imports() {
  f=$1; layer=$2
  imports_of "$f" | while IFS='	' read -r n spec kind; do
    case "$spec" in
      claude-code|claude-code/*)
        if [ "$layer" = render ] && [ "$kind" = type ]; then continue; fi
        report "$f" "$n" "import of claude-code is not allowed in $layer (render may use import type only)" ;;
      ../adapters/*|../adapters)
        [ "$layer" = adapters ] || report "$f" "$n" "$layer must not import ../adapters" ;;
      ../render/*|../render) report "$f" "$n" "$layer must not import ../render" ;;
      ../focus-policy|../focus-policy/*|./focus-policy|../register|./register|../register.tsx)
        report "$f" "$n" "$layer must not import focus-policy or register" ;;
      ./*)
        # same folder; for legacy modules ./focus-policy and ./register were caught above
        ;;
      ../core/*|../core)
        [ "$layer" = adapters ] && { [ "$spec" = ../core/types ] && [ "$kind" = type ] || report "$f" "$n" "adapters may import ../core/types as a type only"; } ;;
      ../sidebar-policy|../card-policy|../relative-time|../project-colors)
        [ "$layer" = core ] || report "$f" "$n" "$layer must not import $spec" ;;
      ../../types|../../types/*)
        if [ "$layer" = core ] && [ "$kind" = type ]; then continue; fi
        report "$f" "$n" "$spec is allowed in core as a type import only" ;;
      *) report "$f" "$n" "import of $spec is outside the $layer layer rule" ;;
    esac
  done
}

scan() { # scan LAYER FILE...
  layer=$1; shift
  for f in "$@"; do
    [ -f "$f" ] || continue
    bans "$f"
    check_imports "$f" "$layer"
  done
}

h="$dir/hooks"

# core: the layer folder, and the four legacy pure modules at hooks/
set --
for f in "$h"/core/*.ts; do [ -f "$f" ] && set -- "$@" "$f"; done
scan core "$@"

# Legacy modules sit in hooks/, so ./x is a sibling; apply the core text bans
# and the forbidden-import rules (their relative paths are one level up).
for f in "$h/sidebar-policy.ts" "$h/card-policy.ts" "$h/relative-time.ts" "$h/project-colors.ts"; do
  [ -f "$f" ] || continue
  bans "$f"
  imports_of "$f" | while IFS='	' read -r n spec kind; do
    case "$spec" in
      claude-code|claude-code/*|./adapters/*|./render/*|./focus-policy|./register|./register.tsx)
        report "$f" "$n" "legacy pure module must not import $spec" ;;
    esac
  done
done

set --
for f in "$h"/render/*.tsx "$h"/render/*.ts; do [ -f "$f" ] && set -- "$@" "$f"; done
scan render "$@"

set --
for f in "$h"/adapters/*.ts; do [ -f "$f" ] && set -- "$@" "$f"; done
# adapters carry terminal facts by design: only the import rules apply
for f in "$@"; do
  check_imports "$f" adapters
done

if [ -s "$out" ]; then
  sort -t: -k1,1 -k2,2n "$out"
  exit 1
fi
echo "sidebar layers: ok"
exit 0
