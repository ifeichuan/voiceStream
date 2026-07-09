import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

export interface TypewriterProps {
  text: string;
  cursor?: boolean;
  charsPerSecond?: number;
  speed?: number;
  fontSize?: number;
  color?: string;
  cursorColor?: string;
  fontWeight?: number;
  fontFamily?: string;
  style?: React.CSSProperties;
}

export function Typewriter({
  text,
  cursor = true,
  charsPerSecond = 20,
  speed = 1,
  fontSize = 24,
  color = '#ffffff',
  cursorColor = '#4dc9f6',
  fontWeight = 500,
  fontFamily = '-apple-system, BlinkMacSystemFont, sans-serif',
  style,
}: TypewriterProps) {
  const frame = useCurrentFrame() * speed;
  const {fps} = useVideoConfig();

  const charsToRevealOver = (text.length / charsPerSecond) * fps;
  const revealed = Math.floor(
    interpolate(frame, [0, charsToRevealOver], [0, text.length], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })
  );

  const isCursorVisible = Math.floor((frame / fps) * 2) % 2 === 0;

  return (
    <span style={{fontSize, fontWeight, color, fontFamily, lineHeight: 1.5, ...style}}>
      {text.substring(0, revealed)}
      {cursor && revealed < text.length && (
        <span style={{opacity: isCursorVisible ? 1 : 0, color: cursorColor}}>|</span>
      )}
    </span>
  );
}
