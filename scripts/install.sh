#!/bin/sh
# Installs or updates Browser Helper Lite for Chrome on macOS and Linux:
#
#   curl -fsSL https://raw.githubusercontent.com/ethanzhrepo/browser-helper-lite/main/scripts/install.sh | sh
#
# It downloads the latest release from GitHub, checks the file against the
# SHA-256 that GitHub publishes for it, and unpacks it into a folder in your
# home directory. Chrome installs extensions by itself only from the Chrome Web
# Store, so the last step is yours: "Load unpacked" in chrome://extensions.
# Run it again to update; the folder stays the same, so your settings do too.
#
# Options (environment variables):
#   BHL_DIR      where to put the extension (default: ~/browser-helper-lite-extension)
#   BHL_VERSION  the release to install, e.g. 0.1.0 (default: the latest)
#   BHL_NO_OPEN  set to 1 to leave Chrome and the clipboard alone
set -eu

REPO="ethanzhrepo/browser-helper-lite"
MARKER=".installed-by-browser-helper-lite"

tmp=""
staging=""

say() { printf '%s\n' "$*"; }

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  [ -n "$tmp" ] && rm -rf "$tmp"
  [ -n "$staging" ] && rm -rf "$staging"
  return 0
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required but not installed."
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  else
    return 1
  fi
}

# Prints the download URL of the Chrome zip in a release (GitHub API JSON), then its SHA-256 if GitHub lists one.
asset_of() {
  awk '
    { buf = buf $0 "\n" }
    END {
      if (!match(buf, /"assets"[ \t\n\r]*:[ \t\n\r]*\[/)) exit
      s = substr(buf, RSTART + RLENGTH)
      n = length(s)
      depth = 0; in_str = 0; esc = 0; obj = ""
      for (i = 1; i <= n; i++) {
        c = substr(s, i, 1)
        if (in_str) {
          if (esc) esc = 0
          else if (c == "\\") esc = 1
          else if (c == "\"") in_str = 0
          if (depth > 0) obj = obj c
          continue
        }
        if (c == "\"") { in_str = 1; if (depth > 0) obj = obj c; continue }
        if (c == "{") {
          obj = (depth == 0 ? "{" : obj "{")
          depth++
          continue
        }
        if (c == "}") {
          depth--
          if (depth >= 0) obj = obj "}"
          if (depth == 0) {
            if (obj ~ /"name"[ \t\n\r]*:[ \t\n\r]*"[^"]*-chrome\.zip"/) {
              url = ""; digest = ""
              if (match(obj, /"browser_download_url"[ \t\n\r]*:[ \t\n\r]*"[^"]*"/)) {
                url = substr(obj, RSTART, RLENGTH)
                sub(/.*:[ \t\n\r]*"/, "", url)
                sub(/"$/, "", url)
              }
              if (match(obj, /"digest"[ \t\n\r]*:[ \t\n\r]*"sha256:[0-9a-fA-F]+"/)) {
                digest = substr(obj, RSTART, RLENGTH)
                sub(/.*"sha256:/, "", digest)
                sub(/"$/, "", digest)
              }
              if (url != "") {
                print url
                print digest
                exit
              }
            }
            obj = ""
          }
          continue
        }
        if (c == "]" && depth == 0) exit
        if (depth > 0) obj = obj c
      }
    }
  ' "$1"
}

copy_to_clipboard() {
  if command -v pbcopy >/dev/null 2>&1; then
    printf '%s' "$1" | pbcopy
  elif [ -n "${WAYLAND_DISPLAY:-}" ] && command -v wl-copy >/dev/null 2>&1; then
    printf '%s' "$1" | wl-copy
  elif [ -n "${DISPLAY:-}" ] && command -v xclip >/dev/null 2>&1; then
    printf '%s' "$1" | xclip -selection clipboard
  else
    return 1
  fi
}

open_extensions_page() {
  if [ "$(uname -s)" = "Darwin" ]; then
    open -a "Google Chrome" "chrome://extensions" >/dev/null 2>&1
    return
  fi
  [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] || return 1
  for browser in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$browser" >/dev/null 2>&1; then
      "$browser" "chrome://extensions" >/dev/null 2>&1 &
      return 0
    fi
  done
  return 1
}

main() {
  need curl
  need unzip

  dir="${BHL_DIR:-$HOME/browser-helper-lite-extension}"
  while [ "${dir%/}" != "$dir" ] && [ "$dir" != "/" ]; do dir="${dir%/}"; done
  [ -n "$dir" ] && [ "$dir" != "/" ] || fail "Invalid install folder: ${BHL_DIR:-}"
  version="${BHL_VERSION:-}"
  version="${version#v}"

  # Never replace a folder this installer did not create.
  if [ -e "$dir" ] && [ ! -f "$dir/$MARKER" ]; then
    if [ ! -d "$dir" ] || [ -n "$(ls -A "$dir" 2>/dev/null)" ]; then
      fail "$dir already exists and was not created by this installer. Move it away, or set BHL_DIR to another folder."
    fi
  fi

  trap cleanup EXIT
  trap 'exit 130' INT TERM
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/browser-helper-lite.XXXXXX")"

  if [ -n "$version" ]; then
    api="https://api.github.com/repos/$REPO/releases/tags/v$version"
  else
    api="https://api.github.com/repos/$REPO/releases/latest"
  fi

  say "Looking up the ${version:-latest} release of Browser Helper Lite..."
  url=""
  digest=""
  if curl -fsSL -H "Accept: application/vnd.github+json" "$api" -o "$tmp/release.json" 2>/dev/null; then
    asset="$(asset_of "$tmp/release.json")"
    url="$(printf '%s\n' "$asset" | sed -n 1p)"
    digest="$(printf '%s\n' "$asset" | sed -n 2p)"
  fi
  if [ -z "$url" ]; then
    # GitHub's API allows a limited number of requests per address; the release pages do not.
    if [ -z "$version" ]; then
      latest="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")" || fail "Could not reach GitHub."
      version="${latest##*/v}"
    fi
    case "$version" in
      "" | *[!0-9A-Za-z.-]*) fail "Could not find the release. Download it from https://github.com/$REPO/releases" ;;
    esac
    url="https://github.com/$REPO/releases/download/v$version/browser-helper-lite-$version-chrome.zip"
  fi
  case "$url" in
    "https://github.com/$REPO/releases/download/"*) ;;
    *) fail "Unexpected download address: $url" ;;
  esac

  say "Downloading ${url##*/}..."
  curl -fsSL "$url" -o "$tmp/extension.zip" || fail "Download failed: $url"

  if [ -n "$digest" ]; then
    actual="$(sha256_of "$tmp/extension.zip")" || fail "sha256sum or shasum is required to check the download."
    [ "$actual" = "$digest" ] || fail "The download does not match the checksum GitHub lists (expected $digest, got $actual). Nothing was installed."
    say "Checksum OK (sha256 $actual)."
  else
    say "Note: GitHub's API could not be reached, so the download's checksum was not checked."
  fi

  # Unpacked next to its final place, so swapping it in is a rename on the same disk.
  mkdir -p "$(dirname "$dir")"
  staging="$(mktemp -d "$dir.XXXXXX")"
  unzip -q "$tmp/extension.zip" -d "$staging/new" || fail "The download is not a valid zip file."
  [ -f "$staging/new/manifest.json" ] || fail "The download does not look like the extension (no manifest.json)."
  installed="$(sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' "$staging/new/manifest.json" | head -n 1)"
  printf '%s\n' "${installed:-unknown}" >"$staging/new/$MARKER"

  updating=0
  if [ -f "$dir/$MARKER" ]; then updating=1; fi
  if [ -e "$dir" ]; then mv "$dir" "$staging/old"; fi
  mv "$staging/new" "$dir"

  say ""
  if [ "$updating" = 1 ]; then
    say "Updated Browser Helper Lite to ${installed:-the new version} in:"
    say "  $dir"
    say ""
    say "To finish: open chrome://extensions and click the reload button on the Browser Helper Lite card."
  else
    copied=0
    if [ "${BHL_NO_OPEN:-}" != 1 ] && copy_to_clipboard "$dir" 2>/dev/null; then copied=1; fi
    say "Browser Helper Lite ${installed:-} is unpacked in:"
    say "  $dir"
    say ""
    say "To finish, in Chrome:"
    say "  1. Open chrome://extensions and turn on \"Developer mode\" (top right)."
    say "  2. Click \"Load unpacked\" and choose the folder above."
    if [ "$copied" = 1 ]; then
      if [ "$(uname -s)" = "Darwin" ]; then
        say "     Its path is on your clipboard: in the file dialog, press Cmd+Shift+G and paste it."
      else
        say "     Its path is on your clipboard: in the file dialog, press Ctrl+L and paste it."
      fi
    fi
    say "  3. Click the extension's toolbar icon to open the side panel, then add a model connection in Settings."
    say ""
    say "Keep the folder: Chrome loads the extension from it. Run this command again to update."
  fi

  if [ "${BHL_NO_OPEN:-}" != 1 ]; then open_extensions_page || true; fi
}

main "$@"
