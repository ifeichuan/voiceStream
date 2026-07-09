import {AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate} from 'remotion';
import {RemotionShaderOrb} from './RemotionShaderOrb';
import {getOrbState, ORB_SIZE} from '../orbState';

export const PersistentOrb: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {pxX, pxY, scale} = getOrbState(frame, fps);

  // Hue rotation: blue (0) → amber (175) → green (100) → fade back
  const hueRotate = interpolate(
    frame,
    [0, 1140, 1180, 1380, 1440, 1500, 1560, 1740, 1800],
    [0, 0, 175, 175, 100, 100, 60, 0, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
  );

  // Audio level — pseudo-reactivity following imagined voice timing
  const audioLevel = interpolate(
    frame,
    [0, 30, 90, 150, 250, 400, 540, 600, 700, 840, 1000, 1140, 1180, 1240, 1380, 1440, 1500, 1560, 1700, 1800],
    [0, 0.1, 0.3, 0.7, 0.5, 0.7, 0.5, 0.7, 0.4, 0.5, 0.3, 0.2, 0.7, 0.4, 0.15, 0.85, 0.55, 0.3, 0.2, 0.1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
  );

  const isActive = frame > 30;

  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        zIndex: 50,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          position: 'absolute',
          transform: `translate(${pxX}px, ${pxY}px) scale(${scale})`,
          filter: `hue-rotate(${hueRotate}deg)`,
          willChange: 'transform, filter',
        }}
      >
        <RemotionShaderOrb size={ORB_SIZE} isActive={isActive} audioLevel={audioLevel} />
      </div>
    </AbsoluteFill>
  );
};
