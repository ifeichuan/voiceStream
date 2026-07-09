import {AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig} from 'remotion';
import {RemotionShaderOrb} from '../components/RemotionShaderOrb';

export const ClosingScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const scale = spring({frame, fps, config: {damping: 10}});
  const taglineOpacity = interpolate(frame, [15, 30], [0, 1], {extrapolateRight: 'clamp'});
  const featuresOpacity = interpolate(frame, [25, 40], [0, 1], {extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{
      justifyContent: 'center',
      alignItems: 'center',
      background: 'radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a0a 70%)',
    }}>
      <div style={{transform: `scale(${scale})`, marginBottom: 40}}>
        <RemotionShaderOrb size={120} isActive audioLevel={0.3} />
      </div>

      {/* Title */}
      <h1 style={{
        fontSize: 56,
        fontWeight: 700,
        color: '#ffffff',
        margin: 0,
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        letterSpacing: -1,
        opacity: scale,
      }}>
        SpeakMore
      </h1>

      {/* Tagline */}
      <p style={{
        fontSize: 24,
        color: 'rgba(255,255,255,0.7)',
        margin: '16px 0 0 0',
        fontFamily: '-apple-system, sans-serif',
        fontWeight: 300,
        opacity: taglineOpacity,
      }}>
        在任何应用里开口输入
      </p>

      {/* Feature pills */}
      <div style={{
        display: 'flex',
        gap: 16,
        marginTop: 40,
        opacity: featuresOpacity,
      }}>
        {['全局快捷键', '流式识别', 'Agent 自动执行', 'macOS 原生'].map((feat, i) => (
          <span key={i} style={{
            fontSize: 14,
            color: 'rgba(255,255,255,0.7)',
            background: 'rgba(255,255,255,0.08)',
            padding: '8px 18px',
            borderRadius: 20,
            border: '1px solid rgba(255,255,255,0.12)',
            fontFamily: '-apple-system, sans-serif',
          }}>{feat}</span>
        ))}
      </div>
    </AbsoluteFill>
  );
};
