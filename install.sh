#!/usr/bin/env bash
# Install the create-sdd skill for one or more coding agents.
#
#   curl -fsSL https://raw.githubusercontent.com/migaia/sdd-generate/main/install.sh | bash -s -- claude codex
#
# The skill is cloned once into $CREATE_SDD_HOME (default ~/.create-sdd) and linked into each
# agent's user-level skill directory, so `install.sh` again updates every agent at once.
# An existing real directory at a target is never removed: it is reported and skipped.
#
# Options:
#   --host <id>   an agent to install for; repeatable, or comma-separated (same as a positional id)
#   --list        print the supported agents and their skill directories, then exit
#   --ref <ref>   branch or tag to install (default: main)
#   --copy        copy the skill instead of linking it (for agents that do not follow symlinks)
#   -h, --help    show this help
#
# Environment: CREATE_SDD_HOME (clone location), CREATE_SDD_REPO (git URL to clone from).
set -euo pipefail

REPO="${CREATE_SDD_REPO:-https://github.com/migaia/sdd-generate.git}"
HOME_DIR="${CREATE_SDD_HOME:-$HOME/.create-sdd}"
REF="main"
MODE="link"
NAME="create-sdd"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"

# Supported agents. Each line: id|aliases (comma-separated)|display name|user-level skill directory.
# Directories come from each agent's documentation.
AGENTS="claude|claude-code|Claude Code|${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills
codex||OpenAI Codex|${CODEX_HOME:-$HOME/.codex}/skills
cursor||Cursor|$HOME/.cursor/skills
copilot|github-copilot|GitHub Copilot (CLI, VS Code, JetBrains)|$HOME/.copilot/skills
opencode||OpenCode|$CONFIG/opencode/skills
pi|pi-agent|Pi coding agent|$HOME/.pi/agent/skills
kimi|kimi-code|Kimi Code CLI|${KIMI_CODE_HOME:-$HOME/.kimi-code}/skills
zcode|z-code|ZCode (Zhipu)|$HOME/.zcode/skills
devin|devin-cli|Devin for Terminal|$CONFIG/devin/skills
trae||TRAE|$HOME/.trae/skills
trae-cn||TRAE CN|$HOME/.trae-cn/skills
doubao||Doubao|$HOME/.doubao/skills
gemini|gemini-cli|Gemini CLI|$HOME/.gemini/skills
qwen|qwen-code|Qwen Code|$HOME/.qwen/skills
windsurf||Windsurf|$HOME/.codeium/windsurf/skills
agents|universal|Shared Agent Skills directory (read by many agents)|$HOME/.agents/skills"

usage() {
  cat <<'USAGE'
Install the create-sdd skill for one or more coding agents.

  curl -fsSL https://raw.githubusercontent.com/migaia/sdd-generate/main/install.sh | bash -s -- <agent>...

Agents are positional or given with --host <id>[,<id>] (repeatable).
Options: --list, --ref <branch|tag>, --copy, -h|--help
Environment: CREATE_SDD_HOME (clone location, default ~/.create-sdd), CREATE_SDD_REPO (git URL)

USAGE
  list
}

list() {
  echo "Agents (pass one or more ids; aliases in brackets):"
  printf '%s\n' "$AGENTS" | while IFS='|' read -r id aliases label dir; do
    printf '  %-10s %-26s %s\n' "$id" "${aliases:+[$aliases]}" "$dir  ($label)"
  done
}

# Print the line for an id or alias, or nothing.
lookup() {
  printf '%s\n' "$AGENTS" | while IFS='|' read -r id aliases label dir; do
    case ",$id,$aliases," in *",$1,"*) printf '%s|%s|%s\n' "$id" "$label" "$dir" ;; esac
  done
}

say() { printf '%s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

targets=()
while [ $# -gt 0 ]; do
  case "$1" in
    --list)
      list
      exit 0
      ;;
    --ref)
      [ $# -ge 2 ] || die "--ref needs a branch or tag"
      REF="$2"
      shift
      ;;
    --host)
      [ $# -ge 2 ] || die "--host needs an agent id (see --list)"
      # Repeatable, and a comma-separated list is accepted: --host claude,codex
      for host in $(printf '%s' "$2" | tr ',' ' '); do
        targets+=("$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')")
      done
      shift
      ;;
    --copy) MODE="copy" ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*) die "unknown option $1 (see --help)" ;;
    *) targets+=("$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')") ;;
  esac
  shift
done
[ ${#targets[@]} -gt 0 ] || {
  usage
  die "name at least one agent, for example: --host claude --host codex"
}

# Resolve every target before touching the disk, so a typo installs nothing.
resolved=()
for target in "${targets[@]}"; do
  line="$(lookup "$target")"
  [ -n "$line" ] || die "unknown agent '$target' (see --list)"
  resolved+=("$line")
done

command -v git >/dev/null 2>&1 || die "git is required"

# One clone, updated in place on later runs.
if [ -d "$HOME_DIR/.git" ]; then
  say "Updating $HOME_DIR ($REF)"
  git -C "$HOME_DIR" fetch --quiet --depth 1 origin "$REF"
  git -C "$HOME_DIR" checkout --quiet --force FETCH_HEAD
elif [ -e "$HOME_DIR" ]; then
  die "$HOME_DIR exists and is not a git clone; set CREATE_SDD_HOME to another path"
else
  say "Cloning $REPO ($REF) into $HOME_DIR"
  git clone --quiet --depth 1 --branch "$REF" "$REPO" "$HOME_DIR"
fi
[ -f "$HOME_DIR/SKILL.md" ] || die "$HOME_DIR has no SKILL.md; is $REPO the create-sdd repository?"

home_real="$(cd "$HOME_DIR" && pwd -P)"
installed=0
for line in "${resolved[@]}"; do
  IFS='|' read -r id label dir <<<"$line"
  dest="$dir/$NAME"
  if [ -e "$dest" ] && [ "$(cd "$dest" && pwd -P)" = "$home_real" ]; then
    say "  $label: already installed at $dest"
    installed=$((installed + 1))
    continue
  fi
  # A copy made by an earlier --copy run carries this marker and may be replaced.
  if [ -f "$dest/.create-sdd-copy" ] && [ ! -L "$dest" ]; then rm -rf "$dest"; fi
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    warn "$label: $dest already exists and is not a link; left untouched (remove it, then rerun)"
    continue
  fi
  mkdir -p "$dir"
  if [ "$MODE" = "copy" ]; then
    rm -f "$dest"
    mkdir -p "$dest"
    (cd "$HOME_DIR" && tar --exclude .git -cf - .) | (cd "$dest" && tar -xf -)
    : >"$dest/.create-sdd-copy"
    say "  $label: copied to $dest"
  else
    ln -sfn "$home_real" "$dest"
    say "  $label: linked $dest -> $home_real"
  fi
  installed=$((installed + 1))
done

command -v bun >/dev/null 2>&1 ||
  warn "Bun was not found; the skill's scripts need it (https://bun.sh)"
[ "$installed" -gt 0 ] || die "nothing was installed"
say "Done. Restart the agent, then invoke the skill (/create-sdd in Claude Code, \$create-sdd in Codex)."
