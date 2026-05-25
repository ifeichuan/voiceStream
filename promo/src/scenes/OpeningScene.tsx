import {AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig} from 'remotion';
import {RemotionShaderOrb} from '../components/RemotionShaderOrb';

export const OpeningScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const titleOpacity = interpolate(frame, [20, 45], [0, 1], {extrapolateRight: 'clamp'});
  const titleY = spring({frame: frame - 20, fps, config: {damping: 12}}) * -30;
  const subtitleOpacity = interpolate(frame, [50, 75], [0, 1], {extrapolateRight: 'clamp'});
  const orbScale = spring({frame, fps, config: {damping: 8, mass: 0.8}});
  const audioLevel = interpolate(frame, [0, 50, 80, 120], [0, 0.3, 0.6, 0.2], {extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{
      justifyContent: 'center',
      alignItems: 'center',
      background: 'radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a0a 70%)',
    }}>
      <div style={{
        transform: `scale(${orbScale})`,
        marginBottom: 60,
      }}>
        <RemotionShaderOrb size={220} isActive={frame > 10} audioLevel={audioLevel} />
      </div>

      <div style={{
        opacity: titleOpacity,
        transform: `translateY(${titleY}px)`,
        textAlign: 'center',
      }}>
        <h1 style={{
          fontSize: 72,
          fontWeight: 700,
          color: '#ffffff',
          margin: 0,
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          letterSpacing: -2,
        }}>
          VoiceStream
        </h1>
      </div>

      <div style={{
        opacity: subtitleOpacity,
        marginTop: 20,
      }}>
        <p style={{
          fontSize: 28,
          color: 'rgba(255,255,255,0.7)',
          margin: 0,
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          fontWeight: 300,
        }}>
          开口输入，让 Agent 替你完成
        </p>
      </div>
    </AbsoluteFill>
  );
};
