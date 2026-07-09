import {spring, useCurrentFrame, useVideoConfig} from 'remotion';

export interface SpringPopInProps {
  children: React.ReactNode;
  damping?: number;
  mass?: number;
  stiffness?: number;
  delayInFrames?: number;
  speed?: number;
}

export function SpringPopIn({
  children,
  damping = 12,
  mass = 1,
  stiffness = 100,
  delayInFrames = 0,
  speed = 1,
}: SpringPopInProps) {
  const frame = useCurrentFrame() * speed;
  const {fps} = useVideoConfig();

  const scale = spring({
    fps,
    frame: frame - delayInFrames,
    config: {damping, mass, stiffness},
  });

  return (
    <div style={{transform: `scale(${scale})`, transformOrigin: 'center', willChange: 'transform'}}>
      {children}
    </div>
  );
}
