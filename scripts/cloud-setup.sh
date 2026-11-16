#!/bin/bash
# WarnWeather: mise and its tools (mise.toml), the Pebble SDK (pebble-sdk-version) and the
# generated files `mise test` needs, as CI sets them up. Best effort: a failed step is
# reported and the session still starts.
export HOME="${HOME:-/root}" PATH="${HOME:-/root}/.local/bin:$PATH"
if ! command -v mise >/dev/null; then
  curl -fsSL --retry 5 --retry-all-errors -o /tmp/mise-install.sh https://mise.run \
    && sh /tmp/mise-install.sh || echo "setup: installing mise failed"
fi
if [ -d WarnWeather ]; then
  cd WarnWeather
  mise trust && mise install || echo "setup: installing the mise tools failed"
  git checkout -- mise.lock   # a newer mise rewrites the lock's format on install
  mise exec -- scripts/ensure-pebble-sdk.sh || echo "setup: installing the Pebble SDK failed"
  # pebble (and the uv its SDK installs need) on PATH outside mise tasks too
  for t in pebble uv; do p=$(mise which "$t") && ln -sf "$p" "$HOME/.local/bin/$t"; done
  # the emulator's pypkjs listens on IPv6, which these containers lack: listen on IPv4
  sed -i 's/WSGIServer(("", self.port)/WSGIServer(("0.0.0.0", self.port)/' \
    "$(mise where pipx:pebble-tool)"/pebble-tool/lib/python3*/site-packages/pypkjs/runner/websocket.py \
    || echo "setup: patching pypkjs for IPv4 failed"
  { mise run prepare-package -- dev && npm ci && node scripts/prepare-fixture.js \
    && node scripts/build-config-page.js; } || echo "setup: generating the build files failed"
fi
exit 0
