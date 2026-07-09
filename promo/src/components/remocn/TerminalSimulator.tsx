import {Sequence, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

export type TerminalLineType = 'command' | 'log' | 'success' | 'error';

export interface TerminalLine {
  text: string;
  type: TerminalLineType;
  delay?: number;
  pause?: number;
}

export interface TerminalSimulatorProps {
  lines?: TerminalLine[];
  prompt?: string;
  title?: string;
  background?: string;
  chromeColor?: string;
  fontSize?: number;
  charsPerFrame?: number;
  chunkSize?: number;
  speed?: number;
  width?: number;
  height?: number;
}

const TYPE_COLORS: Record<TerminalLineType, string> = {
  command: '#fafafa',
  log: '#a1a1aa',
  success: '#22c55e',
  error: '#ef4444',
};

function autoPause(line: TerminalLine): number {
  if (line.pause !== undefined) return line.pause;
  if (line.text.trimEnd().endsWith('...')) return 18;
  return 0;
}

function Light({color}: {color: string}) {
  return <div style={{width: 12, height: 12, borderRadius: '50%', background: color, opacity: 0.85}} />;
}

function TerminalLineRow({line, prompt, fontSize, lineHeight, charsPerFrame, chunkSize, fps, speed}: {
  line: TerminalLine; prompt: string; fontSize: number; lineHeight: number;
  charsPerFrame: number; chunkSize: number; fps: number; speed: number;
}) {
  const localFrame = useCurrentFrame() * speed;
  const totalChars = line.text.length;
  const linearRevealed = Math.floor(
    interpolate(localFrame, [0, totalChars / charsPerFrame], [0, totalChars], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})
  );
  const revealed = Math.min(totalChars, Math.ceil(linearRevealed / chunkSize) * chunkSize);
  const typingDone = revealed >= totalChars;
  const cursorVisible = Math.floor((localFrame / fps) * 2) % 2 === 0;

  return (
    <div style={{height: lineHeight, fontSize, color: TYPE_COLORS[line.type], display: 'flex', alignItems: 'center', whiteSpace: 'pre'}}>
      {line.type === 'command' && <span style={{color: '#22c55e', marginRight: 8}}>{prompt}</span>}
      <span>{line.text.substring(0, revealed)}</span>
      {!typingDone && cursorVisible && (
        <span style={{display: 'inline-block', width: fontSize * 0.55, height: fontSize, background: TYPE_COLORS[line.type], marginLeft: 2}} />
      )}
    </div>
  );
}

export function TerminalSimulator({
  lines = [],
  prompt = '$',
  title = '~/projects/speakmore',
  background = '#0a0a0a',
  chromeColor = '#1a1a1a',
  fontSize = 15,
  charsPerFrame = 2,
  chunkSize = 1,
  speed = 1,
  width = 640,
  height = 300,
}: TerminalSimulatorProps) {
  const frame = useCurrentFrame() * speed;
  const {fps} = useVideoConfig();

  const lineHeight = Math.round(fontSize * 1.6);
  const visibleLines = Math.floor((height - 40 - 40) / lineHeight);

  const starts: number[] = [];
  let acc = 10;
  for (let i = 0; i < lines.length; i++) {
    const delay = lines[i].delay ?? 8;
    acc += delay;
    starts.push(acc);
    const typingFrames = Math.ceil(lines[i].text.length / (chunkSize * charsPerFrame));
    acc += typingFrames + autoPause(lines[i]);
  }

  let translateY = 0;
  for (let i = visibleLines; i < lines.length; i++) {
    if (frame >= starts[i]) translateY -= lineHeight;
  }

  return (
    <div style={{width, height, background, borderRadius: 12, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', fontFamily: 'SF Mono, ui-monospace, monospace'}}>
      <div style={{height: 40, background: chromeColor, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8, borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0}}>
        <Light color="#ff5f57" />
        <Light color="#febc2e" />
        <Light color="#28c840" />
        <div style={{flex: 1, textAlign: 'center', color: '#71717a', fontSize: 12}}>{title}</div>
      </div>
      <div style={{flex: 1, padding: 20, overflow: 'hidden', position: 'relative'}}>
        <div style={{position: 'absolute', left: 20, right: 20, top: 20, transform: `translateY(${translateY}px)`}}>
          {lines.map((line, index) => (
            <Sequence key={index} from={Math.round(starts[index] / speed)} layout="none">
              <TerminalLineRow line={line} prompt={prompt} fontSize={fontSize} lineHeight={lineHeight} charsPerFrame={charsPerFrame} chunkSize={chunkSize} fps={fps} speed={speed} />
            </Sequence>
          ))}
        </div>
      </div>
    </div>
  );
}
