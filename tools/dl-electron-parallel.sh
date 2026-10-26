#!/usr/bin/env bash
# 并发分段下载 Electron 发行包（GitHub Releases 直连很慢，多路 Range 并行更快）
# 用法：bash tools/dl-electron-parallel.sh <platform> <arch> <version>
set -u
PLATFORM="${1:-win32}"
ARCH="${2:-x64}"
VERSION="${3:-v37.10.3}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/build/electron-dists"
# 优先用 npmmirror CDN（国内快），失败回退 GitHub Releases
MIRROR_URL="https://cdn.npmmirror.com/binaries/electron/${VERSION}/electron-${VERSION}-${PLATFORM}-${ARCH}.zip"
GITHUB_URL="https://github.com/electron/electron/releases/download/${VERSION}/electron-${VERSION}-${PLATFORM}-${ARCH}.zip"
URL="$MIRROR_URL"
OUT="$DIR/electron-${VERSION}-${PLATFORM}-${ARCH}.zip"
PARTS=8

mkdir -p "$DIR"
cd "$DIR"

# 探测总大小
TOTAL=$(curl -sL -r 0-0 -D - -o /dev/null "$URL" 2>/dev/null | grep -i "^content-range:" | tr -d '\r' | sed 's|.*/||')
if [ -z "${TOTAL:-}" ]; then echo "无法获取文件大小"; exit 1; fi
echo "总大小 $TOTAL 字节，分 $PARTS 段下载"

CHUNK=$(( (TOTAL + PARTS - 1) / PARTS ))
rm -f part.* "$OUT"

for i in $(seq 0 $((PARTS-1))); do
  START=$(( i * CHUNK ))
  END=$(( START + CHUNK - 1 ))
  [ $END -ge $TOTAL ] && END=$((TOTAL-1))
  (
    for try in 1 2 3 4 5 6 7 8; do
      curl -sL --max-time 600 -r "${START}-${END}" -o "part.$i" "$MIRROR_URL" && \
        [ -s "part.$i" ] && break
      curl -sL --max-time 900 -r "${START}-${END}" -o "part.$i" "$GITHUB_URL" && \
        [ -s "part.$i" ] && break
      sleep 2
    done
  ) &
done
wait

cat part.* > "$OUT"
rm -f part.*
SIZE=$(stat -c %s "$OUT")
if [ "$SIZE" != "$TOTAL" ]; then
  echo "大小不符：$SIZE != $TOTAL"
  exit 1
fi
echo "下载完成 $OUT"
unzip -q -o "$OUT" -d "${PLATFORM}-${ARCH}"
echo "已解压到 ${PLATFORM}-${ARCH}"
