import {useCurrentFrame, interpolate} from 'remotion';

interface PlaceholderProps {
  label: string;
  hint?: string;
  duration?: string;
  width?: number;
  height?: number;
}

export const Placeholder: React.FC<PlaceholderProps> = ({
  label,
  hint,
  duration,
  width = 960,
  height = 540,
}) => {
  const frame = useCurrentFrame();
  const pulse = Math.sin(frame * 0.08) * 0.18 + 0.55;
  const fadeIn = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        width,
        height,
        borderRadius: 12,
        border: '2px dashed rgba(255, 200, 50, 0.4)',
        background:
          'repeating-linear-gradient(45deg, rgba(255,200,50,0.025) 0px, rgba(255,200,50,0.025) 16px, rgba(255,200,50,0.06) 16px, rgba(255,200,50,0.06) 32px)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 14,
        padding: 32,
        fontFamily: 'SF Mono, Menlo, monospace',
        opacity: fadeIn,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          fontSize: 12,
          letterSpacing: 4,
          textTransform: 'uppercase',
          color: '#ffc832',
          opacity: pulse,
        }}
      >
        // PLACEHOLDER{duration ? ` · ${duration}` : ''}
      </div>
      <div
        style={{
          fontSize: 26,
          color: 'rgba(255, 255, 255, 0.92)',
          fontWeight: 500,
          textAlign: 'center',
          lineHeight: 1.3,
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        }}
      >
        {label}
      </div>
      {hint && (
        <div
          style={{
            fontSize: 14,
            color: 'rgba(255, 255, 255, 0.45)',
            textAlign: 'center',
            maxWidth: width - 80,
            lineHeight: 1.5,
            fontFamily: '-apple-system, sans-serif',
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
};
