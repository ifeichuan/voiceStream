import {interpolate, useCurrentFrame} from 'remotion';

export interface BlurRevealProps {
  text: string;
  blur?: number;
  revealFrames?: number;
  fontSize?: number;
  color?: string;
  fontWeight?: number;
  fontFamily?: string;
  style?: React.CSSProperties;
}

export function BlurReveal({
  text,
  blur = 10,
  revealFrames = 30,
  fontSize = 32,
  color = '#ffffff',
  fontWeight = 400,
  fontFamily = '-apple-system, BlinkMacSystemFont, sans-serif',
  style,
}: BlurRevealProps) {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [0, revealFrames], [0, 1], {extrapolateRight: 'clamp'});
  const blurAmount = interpolate(frame, [0, revealFrames], [blur, 0], {extrapolateRight: 'clamp'});

  return (
    <span style={{opacity, filter: `blur(${blurAmount}px)`, fontSize, fontWeight, color, fontFamily, ...style}}>
      {text}
    </span>
  );
}
