#!/usr/bin/env bash

set -euo pipefail

emulator="${PEBBLE_EMULATOR:-basalt}"
config_args=()

if [[ "${1:-}" == "--" ]]; then
  shift
fi

while (($#)); do
  case "$1" in
    --emulator)
      if [[ -z "${2:-}" ]]; then
        echo "Missing value for --emulator" >&2
        exit 1
      fi
      emulator="$2"
      shift 2
      ;;
    --emulator=*)
      emulator="${1#*=}"
      shift
      ;;
    aplite|basalt|diorite|emery|flint|gabbro)
      emulator="$1"
      shift
      ;;
    *)
      config_args+=("$1")
      shift
      ;;
  esac
done

if ((${#config_args[@]})); then
  pebble emu-app-config --emulator "$emulator" "${config_args[@]}"
else
  pebble emu-app-config --emulator "$emulator"
fi
