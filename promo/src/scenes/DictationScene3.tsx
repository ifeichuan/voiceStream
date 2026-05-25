import {AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig} from 'remotion';
import {RemotionShaderOrb} from '../components/RemotionShaderOrb';
import {KeyboardShortcut} from '../components/KeyboardShortcut';

export const DictationScene3: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const slideIn = spring({frame, fps, config: {damping: 12}});
  const cursorBlink = Math.sin(frame * 0.3) > 0 ? 1 : 0;

  const rawText = '今天要做的事情有这么几个第一个是把那个 PR review 完第二个是修复登录页面的 bug 第三个是写一下周报';
  const cleanLines = [
    '今天要做的事情有这么几个：',
    '1. 把那个 PR review 完',
    '2. 修复登录页面的 bug',
    '3. 写一下周报',
  ];

  const rawChars = Math.floor(interpolate(frame, [20, 70], [0, rawText.length], {extrapolateRight: 'clamp'}));
  const showClean = frame > 80;
  const cleanOpacity = interpolate(frame, [80, 93], [0, 1], {extrapolateRight: 'clamp'});
  const rawStrike = interpolate(frame, [77, 85], [0, 1], {extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{
      justifyContent: 'center',
      alignItems: 'center',
      background: 'radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a0a 70%)',
    }}>
      <div style={{
        position: 'absolute',
        top: 80,
        left: 0,
        right: 0,
        textAlign: 'center',
        opacity: interpolate(frame, [0, 15], [0, 1], {extrapolateRight: 'clamp'}),
      }}>
        <span style={{
          fontSize: 18,
          color: '#4dc9f6',
          fontFamily: '-apple-system, sans-serif',
          fontWeight: 500,
          letterSpacing: 3,
          textTransform: 'uppercase',
        }}>听写模式</span>
      </div>

      <div style={{
        position: 'absolute',
        top: 130,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        opacity: interpolate(frame, [5, 20], [0, 1], {extrapolateRight: 'clamp'}),
      }}>
        <KeyboardShortcut keys={['⌘', '⇧', 'Space']} pressAt={8} releaseAt={18} />
      </div>

      <div style={{
        marginBottom: 30,
        opacity: interpolate(frame, [5, 15], [0, 1], {extrapolateRight: 'clamp'}),
        transform: `scale(${slideIn})`,
      }}>
        <RemotionShaderOrb
          size={140}
          isActive={frame > 10 && frame < 75}
          audioLevel={frame < 75
            ? interpolate(frame, [10, 30, 50, 70], [0, 0.5, 0.9, 0.6], {extrapolateRight: 'clamp'})
            : 0
          }
        />
      </div>

      <div style={{
        background: 'rgba(255,255,255,0.03)',
        borderRadius: 12,
        padding: '20px 40px',
        border: '1px solid rgba(255,255,255,0.08)',
        maxWidth: 800,
        marginBottom: 16,
        opacity: interpolate(frame, [15, 25], [0, 1], {extrapolateRight: 'clamp'}),
        transform: `translateY(${showClean ? -10 : 0}px)`,
      }}>
        <p style={{
          fontSize: 14,
          color: 'rgba(255,255,255,0.35)',
          margin: '0 0 8px 0',
          fontFamily: '-apple-system, sans-serif',
        }}>原始语音</p>
        <p style={{
          fontSize: 22,
          color: `rgba(255,255,255,${showClean ? 0.3 : 0.9})`,
          margin: 0,
          fontFamily: '-apple-system, sans-serif',
          fontWeight: 400,
          lineHeight: 1.6,
          textDecoration: rawStrike > 0 ? 'line-through' : 'none',
          textDecorationColor: 'rgba(255,100,100,0.5)',
        }}>
          {rawText.slice(0, rawChars)}
          {rawChars < rawText.length && (
            <span style={{opacity: cursorBlink, color: '#4dc9f6'}}>|</span>
          )}
        </p>
      </div>

      {showClean && (
        <div style={{
          background: 'rgba(77, 201, 246, 0.05)',
          borderRadius: 12,
          padding: '20px 40px',
          border: '1px solid rgba(77, 201, 246, 0.2)',
          maxWidth: 800,
          opacity: cleanOpacity,
          transform: `translateY(${(1 - cleanOpacity) * 15}px)`,
        }}>
          <p style={{
            fontSize: 14,
            color: 'rgba(77, 201, 246, 0.7)',
            margin: '0 0 8px 0',
            fontFamily: '-apple-system, sans-serif',
          }}>整理后</p>
          <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
            {cleanLines.map((line, i) => (
              <p key={i} style={{
                fontSize: 26,
                color: '#ffffff',
                margin: 0,
                fontFamily: '-apple-system, sans-serif',
                fontWeight: i === 0 ? 500 : 400,
                lineHeight: 1.5,
                opacity: interpolate(frame, [83 + i * 5, 88 + i * 5], [0, 1], {extrapolateRight: 'clamp'}),
              }}>
                {line}
              </p>
            ))}
          </div>
        </div>
      )}

      <p style={{
        fontSize: 18,
        color: 'rgba(255,255,255,0.45)',
        marginTop: 30,
        fontFamily: '-apple-system, sans-serif',
        opacity: interpolate(frame, [105, 118], [0, 1], {extrapolateRight: 'clamp'}),
      }}>
        自动识别列表结构，格式化输出
      </p>
    </AbsoluteFill>
  );
};
