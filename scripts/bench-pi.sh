#!/bin/bash
# bench-pi.sh — 测试 pi CLI 的 TTFT 和总耗时
# 用法: ./scripts/bench-pi.sh [测试文本]

TEXT="${1:-这是一个文本测试，文本测试。}"
SYSTEM_PROMPT="你是语音输入法的文本整理助手。将用户发来的语音转写内容做最小必要整理，输出自然、清晰、可直接使用的文本。只输出最终文本，不加任何解释、前缀或标签。"

echo "=== Pi CLI Benchmark ==="
echo "Text: $TEXT"
echo "System prompt: ${SYSTEM_PROMPT:0:60}..."
echo ""

# 测试1: 带 --thinking none + --system-prompt
echo "--- Test 1: --thinking none + --system-prompt ---"
START=$(perl -MTime::HiRes=time -e 'printf "%.3f\n", time')
FIRST_BYTE_FILE=$(mktemp)

pi -p "$TEXT" \
  --system-prompt "$SYSTEM_PROMPT" \
  --thinking none \
  --no-skills \
  --no-prompt-templates \
  --no-themes \
  --no-session 2>/dev/null | while IFS= read -r -n1 char; do
  if [ -z "$(cat "$FIRST_BYTE_FILE" 2>/dev/null)" ]; then
    FIRST_BYTE=$(perl -MTime::HiRes=time -e 'printf "%.3f\n", time')
    echo "$FIRST_BYTE" > "$FIRST_BYTE_FILE"
  fi
  printf '%s' "$char"
done

END=$(perl -MTime::HiRes=time -e 'printf "%.3f\n", time')
FIRST_BYTE=$(cat "$FIRST_BYTE_FILE" 2>/dev/null)
rm -f "$FIRST_BYTE_FILE"

echo ""
if [ -n "$FIRST_BYTE" ] && [ -n "$START" ]; then
  TTFT=$(echo "$FIRST_BYTE - $START" | bc)
  TOTAL=$(echo "$END - $START" | bc)
  echo "  TTFT:  ${TTFT}s"
  echo "  Total: ${TOTAL}s"
else
  echo "  (timing failed)"
fi
echo ""

# 测试2: 不带 --thinking（看 pi 默认行为）
echo "--- Test 2: no --thinking flag (pi default) ---"
START=$(perl -MTime::HiRes=time -e 'printf "%.3f\n", time')
FIRST_BYTE_FILE=$(mktemp)

pi -p "$TEXT" \
  --system-prompt "$SYSTEM_PROMPT" \
  --no-skills \
  --no-prompt-templates \
  --no-themes \
  --no-session 2>/dev/null | while IFS= read -r -n1 char; do
  if [ -z "$(cat "$FIRST_BYTE_FILE" 2>/dev/null)" ]; then
    FIRST_BYTE=$(perl -MTime::HiRes=time -e 'printf "%.3f\n", time')
    echo "$FIRST_BYTE" > "$FIRST_BYTE_FILE"
  fi
  printf '%s' "$char"
done

END=$(perl -MTime::HiRes=time -e 'printf "%.3f\n", time')
FIRST_BYTE=$(cat "$FIRST_BYTE_FILE" 2>/dev/null)
rm -f "$FIRST_BYTE_FILE"

echo ""
if [ -n "$FIRST_BYTE" ] && [ -n "$START" ]; then
  TTFT=$(echo "$FIRST_BYTE - $START" | bc)
  TOTAL=$(echo "$END - $START" | bc)
  echo "  TTFT:  ${TTFT}s"
  echo "  Total: ${TOTAL}s"
else
  echo "  (timing failed)"
fi
echo ""

# 测试3: 最简模式 — 无 system prompt，纯文本
echo "--- Test 3: minimal (no system prompt) ---"
START=$(perl -MTime::HiRes=time -e 'printf "%.3f\n", time')
FIRST_BYTE_FILE=$(mktemp)

pi -p "直接原样输出以下文本：$TEXT" \
  --thinking none \
  --no-skills \
  --no-prompt-templates \
  --no-themes \
  --no-session 2>/dev/null | while IFS= read -r -n1 char; do
  if [ -z "$(cat "$FIRST_BYTE_FILE" 2>/dev/null)" ]; then
    FIRST_BYTE=$(perl -MTime::HiRes=time -e 'printf "%.3f\n", time')
    echo "$FIRST_BYTE" > "$FIRST_BYTE_FILE"
  fi
  printf '%s' "$char"
done

END=$(perl -MTime::HiRes=time -e 'printf "%.3f\n", time')
FIRST_BYTE=$(cat "$FIRST_BYTE_FILE" 2>/dev/null)
rm -f "$FIRST_BYTE_FILE"

echo ""
if [ -n "$FIRST_BYTE" ] && [ -n "$START" ]; then
  TTFT=$(echo "$FIRST_BYTE - $START" | bc)
  TOTAL=$(echo "$END - $START" | bc)
  echo "  TTFT:  ${TTFT}s"
  echo "  Total: ${TOTAL}s"
else
  echo "  (timing failed)"
fi

echo ""
echo "=== Done ==="
