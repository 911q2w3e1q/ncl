#!/bin/bash
# 逐个上传 v1.1.0 附件，单个失败自动重试（换名重传会替换旧资产）
cd /workspace/NCL
FILES=(
  "NCL-1.1.0-win64.zip"
  "NCL-1.1.0-linux-x64.tar.gz"
  "NCL-1.1.0-macos-arm64.zip"
  "NCL-1.1.0-macos-x64.zip"
)
for f in "${FILES[@]}"; do
  ok=0
  for attempt in 1 2 3 4; do
    echo "=== [$(date +%H:%M:%S)] upload $f attempt $attempt ==="
    if gh release upload v1.1.0 "$f" --repo 911q2w3e1q/ncl --clobber; then
      echo "=== [$(date +%H:%M:%S)] OK $f ==="
      ok=1
      break
    fi
    echo "=== [$(date +%H:%M:%S)] FAILED $f attempt $attempt, retrying in 5s ==="
    sleep 5
  done
  if [ "$ok" != "1" ]; then
    echo "=== GIVE UP $f ==="
    exit 1
  fi
done
echo "=== ALL UPLOADS DONE ==="
