import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

export interface ShimmerSweepProps {
  text: string;
  baseColor?: string;
  shineColor?: string;
  fontSize?: number;
  fontWeight?: number;
  letterSpacing?: number;
  speed?: number;
  style?: React.CSSProperties;
}

export function ShimmerSweep({
  text,
  baseColor = '#4dc9f6',
  shineColor = '#ffffff',
  fontSize = 16,
  fontWeight = 500,
  letterSpacing = 4,
  speed = 1,
  style,
}: ShimmerSweepProps) {
  const frame = useCurrentFrame() * speed;
  const {durationInFrames} = useVideoConfig();

  const position = interpolate(frame, [0, durationInFrames * 0.8], [200, -100], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const textStyle: React.CSSProperties = {
    fontSize,
    fontWeight,
    letterSpacing,
    textTransform: 'uppercase',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    margin: 0,
    lineHeight: 1,
    ...style,
  };

  return (
    <div style={{position: 'relative', display: 'inline-block'}}>
      <span style={{...textStyle, color: baseColor}}>{text}</span>
      <span style={{
        ...textStyle,
        position: 'absolute',
        inset: 0,
        color: 'transparent',
        backgroundClip: 'text',
        WebkitBackgroundClip: 'text',
        backgroundImage: `linear-gradient(110deg, transparent 30%, ${shineColor} 50%, transparent 70%)`,
        backgroundSize: '200% 100%',
        backgroundPosition: `${position}% 50%`,
      }}>
        {text}
      </span>
    </div>
  );
}
