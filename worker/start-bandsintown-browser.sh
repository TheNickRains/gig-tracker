#!/usr/bin/env bash
set -euo pipefail

volume="${RAILWAY_VOLUME_MOUNT_PATH:-${SHOW_SYNC_BROWSER_VOLUME:-}}"
if [[ -z "$volume" || ! -d "$volume" ]]; then
  echo "Attach a Railway volume or set SHOW_SYNC_BROWSER_VOLUME to a mounted directory." >&2
  exit 1
fi

profile="$volume/chromium"
install -d -m 700 -o pwuser -g pwuser "$profile"
if [[ -n "${RAILWAY_VOLUME_MOUNT_PATH:-}" ]]; then
  # Railway mounts the volume to one deployment at a time. Chromium's
  # singleton symlinks can outlive a container that is stopped abruptly.
  for entry in SingletonLock SingletonCookie SingletonSocket; do
    if [[ -L "$profile/$entry" ]]; then
      rm -- "$profile/$entry"
    fi
  done
fi
export DISPLAY=:99
xvfb-runner() {
  exec gosu pwuser env -i PATH=/usr/bin:/bin HOME=/home/pwuser LANG=C.UTF-8 DISPLAY="$DISPLAY" "$@"
}
children=()
stop() {
  trap - TERM INT EXIT
  if (("${#children[@]}")); then
    kill -TERM "${children[@]}" 2>/dev/null || true
    wait || true
  fi
}
trap stop TERM INT EXIT

xvfb-runner Xvfb "$DISPLAY" -screen 0 1440x900x24 -nolisten tcp -ac &
children+=("$!")

# Give the X display time to create its socket before launching clients.
for _ in {1..50}; do
  [[ -S /tmp/.X11-unix/X99 ]] && break
  sleep 0.1
done
[[ -S /tmp/.X11-unix/X99 ]] || { echo "Chromium display did not start." >&2; exit 1; }

xvfb-runner openbox &
children+=("$!")

chrome="$(node -p "require('playwright-core').chromium.executablePath()")"
start_page=()
if [[ ! -f "$profile/Default/Preferences" ]]; then
  start_page+=(https://artists.bandsintown.com/en-US/account/login)
fi
xvfb-runner "$chrome" --no-first-run --no-default-browser-check --no-sandbox --disable-dev-shm-usage \
  --no-proxy-server --password-store=basic --user-data-dir="$profile" --restore-last-session \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --start-maximized \
  "${start_page[@]}" &
children+=("$!")

# Login UI is reachable only from the container loopback, via Railway SSH.
xvfb-runner x11vnc -display "$DISPLAY" -localhost -rfbport 5900 -forever -shared &
children+=("$!")
xvfb-runner websockify --web=/usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900 &
children+=("$!")

if [[ "${SHOW_SYNC_BROWSER_SETUP:-false}" != true ]]; then
  node /app/bandsintown-runner.js &
  children+=("$!")
fi

wait -n
