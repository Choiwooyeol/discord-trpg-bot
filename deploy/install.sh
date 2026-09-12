#!/usr/bin/env bash
set -euo pipefail
# Run as root: bash deploy/install.sh /absolute/path/to/candidate
[[ ${EUID} -eq 0 ]] || { echo 'sudo로 실행하세요.' >&2; exit 1; }
source_dir=$(realpath "${1:?후보 프로젝트 경로 필요}")
[[ -f "$source_dir/package.json" && -f "$source_dir/src/main.mjs" ]] || exit 1
base=/opt/discord-trpg-bot
release="$base/releases/$(date -u +%Y%m%dT%H%M%SZ)-$$"
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) process.exit(1); require("node:sqlite")'
cd "$source_dir"
npm test
id discord-trpg >/dev/null 2>&1 || useradd --system --home-dir "$base" --shell /usr/sbin/nologin discord-trpg
install -d -m 755 "$base" "$base/releases" "$release"
install -d -m 700 -o discord-trpg -g discord-trpg "$base/data"
# Explicit allowlist excludes secrets, DB, backups and logs.
cp -R src tests deploy package.json README.md .env.example "$release/"
chmod -R a+rX "$release"
if [[ ! -f /etc/discord-trpg-bot.env ]]; then
  install -m 600 "$source_dir/.env.example" /etc/discord-trpg-bot.env
  echo '/etc/discord-trpg-bot.env의 새 봇/API 설정을 입력한 뒤 설치 명령을 다시 실행하세요.'
  exit 0
fi
previous=$(readlink -f "$base/current" || true)
install -m 644 deploy/discord-trpg-bot.service /etc/systemd/system/discord-trpg-bot.service
systemctl daemon-reload
# Stop before backing up to provide a rollback point for future migrations.
systemctl stop discord-trpg-bot || true
if [[ -n "$previous" && -f "$base/data/trpg.sqlite" ]]; then
  (cd "$previous" && DATABASE_FILE="$base/data/trpg.sqlite" node src/backup.mjs)
fi
ln -s "$release" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
systemctl start discord-trpg-bot
healthy=false
for attempt in $(seq 1 20); do
  sleep 3
  if systemctl is-active --quiet discord-trpg-bot && runuser -u discord-trpg -- env DATABASE_FILE="$base/data/trpg.sqlite" TRPG_RELEASE="$release/" node "$release/src/healthcheck.mjs"; then healthy=true; break; fi
done
if [[ "$healthy" != true ]]; then
  systemctl stop discord-trpg-bot || true
  if [[ -n "$previous" ]]; then
    ln -s "$previous" "$base/current.rollback"
    mv -Tf "$base/current.rollback" "$base/current"
    systemctl start discord-trpg-bot
  fi
  echo '연결 검증 실패. 이전 릴리스가 있으면 복원했습니다. DB는 보존했습니다.' >&2
  exit 1
fi
systemctl enable discord-trpg-bot
echo 'TRPG 봇 Gateway와 DB 상태 확인 완료.'
