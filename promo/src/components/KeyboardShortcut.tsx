import {useCurrentFrame, interpolate, spring, useVideoConfig} from 'remotion';

interface KeyboardShortcutProps {
  keys: string[];
  pressAt: number;
  releaseAt?: number;
}

export const KeyboardShortcut: React.FC<KeyboardShortcutProps> = ({keys, pressAt, releaseAt}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const opacity = interpolate(frame, [pressAt - 10, pressAt], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const scale = spring({frame: frame - pressAt + 5, fps, config: {damping: 12, mass: 0.6}});

  return (
    <div style={{
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      opacity,
      transform: `scale(${scale})`,
    }}>
      {keys.map((key, i) => {
        const isPressed = frame >= pressAt && (releaseAt === undefined || frame < releaseAt);
        const keyScale = isPressed
          ? interpolate(frame, [pressAt, pressAt + 4], [1, 0.92], {extrapolateRight: 'clamp'})
          : interpolate(frame, [releaseAt ?? 999, (releaseAt ?? 999) + 4], [0.92, 1], {extrapolateRight: 'clamp'});
        const shadowY = isPressed ? 1 : 3;
        const bg = isPressed ? 'rgba(77, 201, 246, 0.15)' : 'rgba(255,255,255,0.08)';
        const borderColor = isPressed ? 'rgba(77, 201, 246, 0.5)' : 'rgba(255,255,255,0.2)';

        return (
          <div key={i} style={{display: 'flex', alignItems: 'center', gap: 8}}>
            <div style={{
              padding: '10px 18px',
              borderRadius: 10,
              background: bg,
              border: `1px solid ${borderColor}`,
              boxShadow: `0 ${shadowY}px ${shadowY * 2}px rgba(0,0,0,0.4)`,
              transform: `scale(${keyScale}) translateY(${isPressed ? 2 : 0}px)`,
            }}>
              <span style={{
                fontSize: 20,
                fontFamily: 'SF Mono, Menlo, monospace',
                color: isPressed ? '#4dc9f6' : 'rgba(255,255,255,0.8)',
                fontWeight: 600,
              }}>{key}</span>
            </div>
            {i < keys.length - 1 && (
              <span style={{
                fontSize: 16,
                color: 'rgba(255,255,255,0.3)',
              }}>+</span>
            )}
          </div>
        );
      })}
    </div>
  );
};
