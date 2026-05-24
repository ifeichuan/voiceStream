#!/bin/bash
# bench-pi-rpc.sh — 用 RPC 模式测试 pi，排除启动开销
# 用法: ./scripts/bench-pi-rpc.sh [测试文本]

TEXT="${1:-这是一个文本测试，文本测试。}"
SYSTEM_PROMPT="你是语音输入法的文本整理助手。将用户发来的语音转写内容做最小必要整理，输出自然、清晰、可直接使用的文本。只输出最终文本，不加任何解释、前缀或标签。"
MODEL="deepseek/deepseek-v4-flash"

echo "=== Pi RPC Benchmark ==="
echo "Model: $MODEL"
echo "Text: $TEXT"
echo ""

run_rpc_test() {
  local label="$1"
  local thinking="$2"

  echo "--- $label ---"

  # 启动 pi RPC 进程
  local fifo_in=$(mktemp -u)
  local fifo_out=$(mktemp -u)
  mkfifo "$fifo_in" "$fifo_out"

  pi --mode rpc \
    --no-session \
    --no-skills \
    --no-prompt-templates \
    --no-themes \
    --model "$MODEL" \
    --thinking "$thinking" \
    --system-prompt "$SYSTEM_PROMPT" \
    < "$fifo_in" > "$fifo_out" 2>/dev/null &
  local PI_PID=$!

  # 打开 fifo
  exec 3>"$fifo_in"
  exec 4<"$fifo_out"

  # 等 pi 就绪 (短暂 sleep)
  sleep 0.5

  # 发送 prompt
  local START=$(perl -MTime::HiRes=time -e 'printf "%.6f\n", time')
  echo "{\"id\":\"p1\",\"type\":\"prompt\",\"message\":\"$TEXT\"}" >&3

  # 读取响应，计算 TTFT
  local FIRST_TOKEN_TIME=""
  local LAST_LINE=""
  local GOT_AGENT_END=0
  local RESULT_TEXT=""

  while IFS= read -r line <&4; do
    local NOW=$(perl -MTime::HiRes=time -e 'printf "%.6f\n", time')

    # prompt ack
    if echo "$line" | grep -q '"type":"response"' 2>/dev/null; then
      local PROMPT_ACK_TIME="$NOW"
    fi

    # first text_delta = TTFT
    if echo "$line" | grep -q '"text_delta"' 2>/dev/null && [ -z "$FIRST_TOKEN_TIME" ]; then
      FIRST_TOKEN_TIME="$NOW"
    fi

    # agent_end = done
    if echo "$line" | grep -q '"agent_end"' 2>/dev/null; then
      GOT_AGENT_END=1
      local END_TIME="$NOW"
      break
    fi

    # message_end — extract text
    if echo "$line" | grep -q '"message_end"' 2>/dev/null; then
      RESULT_TEXT=$(echo "$line" | perl -ne 'if(/"text"\s*:\s*"([^"]*)"/) { print $1 }')
    fi
  done

  # 清理
  exec 3>&-
  exec 4<&-
  kill $PI_PID 2>/dev/null
  wait $PI_PID 2>/dev/null
  rm -f "$fifo_in" "$fifo_out"

  # 计算
  if [ -n "$FIRST_TOKEN_TIME" ] && [ -n "$START" ]; then
    local TTFT=$(echo "$FIRST_TOKEN_TIME - $START" | bc)
    local TOTAL=$(echo "$END_TIME - $START" | bc)
    local PROMPT_ACK=$(echo "${PROMPT_ACK_TIME:-$START} - $START" | bc)
    echo "  Thinking:   $thinking"
    echo "  Prompt ACK: ${PROMPT_ACK}s"
    echo "  TTFT:       ${TTFT}s"
    echo "  Total:      ${TOTAL}s"
    [ -n "$RESULT_TEXT" ] && echo "  Output:     $RESULT_TEXT"
  else
    echo "  (no text_delta received, TTFT unknown)"
    echo "  Total: $(echo "${END_TIME:-0} - $START" | bc)s"
  fi
  echo ""
}

# 测试各 thinking level
run_rpc_test "thinking=off" "off"
run_rpc_test "thinking=minimal" "minimal"
run_rpc_test "thinking=low" "low"

echo "=== Done ==="
