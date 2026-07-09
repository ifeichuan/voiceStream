import {useCurrentFrame} from 'remotion';

export interface PulsingIndicatorProps {
  color?: string;
  size?: number;
  period?: number;
  speed?: number;
}

export function PulsingIndicator({
  color = '#ef4444',
  size = 10,
  period = 8,
  speed = 1,
}: PulsingIndicatorProps) {
  const frame = useCurrentFrame() * speed;

  const wave = Math.sin(frame / period) * 0.5 + 0.5;
  const dotScale = 0.9 + wave * 0.2;
  const dotOpacity = 0.6 + wave * 0.4;

  const ringPeriod = period * Math.PI * 2;
  const phase = (frame % ringPeriod) / ringPeriod;
  const ringScale = 1 + phase * 1.6;
  const ringOpacity = (1 - phase) * 0.7;

  return (
    <div style={{position: 'relative', width: size, height: size, flexShrink: 0}}>
      <div style={{position: 'absolute', inset: 0, borderRadius: '50%', background: color, opacity: ringOpacity, transform: `scale(${ringScale})`, transformOrigin: 'center'}} />
      <div style={{position: 'absolute', inset: 0, borderRadius: '50%', background: color, opacity: dotOpacity, transform: `scale(${dotScale})`, transformOrigin: 'center'}} />
    </div>
  );
}
