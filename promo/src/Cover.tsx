import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {RemotionShaderOrb} from './components/RemotionShaderOrb';

export const Cover: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{
      background: 'radial-gradient(ellipse 80% 60% at 70% 50%, #1f1a3a 0%, #0a0a14 65%, #050508 100%)',
      overflow: 'hidden',
    }}>
      {/* Decorative grid */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
        backgroundSize: '60px 60px',
        maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 70%)',
        WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 70%)',
      }} />

      {/* Glow halos */}
      <div style={{
        position: 'absolute',
        right: '5%',
        top: '50%',
        width: 900,
        height: 900,
        transform: 'translateY(-50%)',
        background: 'radial-gradient(circle, rgba(196, 77, 255, 0.15) 0%, transparent 60%)',
        filter: 'blur(40px)',
      }} />
      <div style={{
        position: 'absolute',
        left: '5%',
        bottom: '10%',
        width: 600,
        height: 600,
        background: 'radial-gradient(circle, rgba(77, 201, 246, 0.12) 0%, transparent 60%)',
        filter: 'blur(50px)',
      }} />

      {/* Main layout */}
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
      }}>
        {/* Left: text block */}
        <div style={{
          flex: 1,
          paddingLeft: 140,
          paddingRight: 60,
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
        }}>
          {/* Eyebrow */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}>
            <div style={{
              width: 36,
              height: 2,
              background: 'linear-gradient(to right, #4dc9f6, transparent)',
            }} />
            <span style={{
              fontSize: 16,
              color: '#4dc9f6',
              fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
              fontWeight: 600,
              letterSpacing: 4,
              textTransform: 'uppercase',
            }}>VoiceStream · macOS</span>
          </div>

          {/* Title */}
          <h1 style={{
            fontSize: 96,
            fontWeight: 800,
            color: '#ffffff',
            margin: 0,
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
            letterSpacing: -3,
            lineHeight: 1.05,
          }}>
            在任何应用里<br />
            <span style={{
              background: 'linear-gradient(135deg, #4dc9f6 0%, #c44dff 50%, #ff6b9d 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>开口输入</span>
          </h1>

          {/* Subtitle */}
          <p style={{
            fontSize: 28,
            color: 'rgba(255,255,255,0.6)',
            margin: 0,
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
            fontWeight: 300,
            lineHeight: 1.5,
            maxWidth: 540,
          }}>
            需要办的事，顺手交给 Agent。<br />
            语音听写 · 文本整理 · 任务执行 · 人机协作
          </p>

          {/* Keyboard hints */}
          <div style={{
            display: 'flex',
            gap: 16,
            marginTop: 12,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}>
              {['⌘', '⇧', 'Space'].map((k, i) => (
                <div key={i} style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  fontSize: 16,
                  color: 'rgba(255,255,255,0.85)',
                  fontFamily: 'SF Mono, Menlo, monospace',
                  fontWeight: 600,
                  boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                }}>{k}</div>
              ))}
              <span style={{
                fontSize: 14,
                color: 'rgba(255,255,255,0.4)',
                fontFamily: '-apple-system, sans-serif',
                marginLeft: 4,
              }}>听写</span>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginLeft: 8,
            }}>
              {['⌘', '⇧', 'L'].map((k, i) => (
                <div key={i} style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  background: 'rgba(0, 255, 136, 0.08)',
                  border: '1px solid rgba(0, 255, 136, 0.25)',
                  fontSize: 16,
                  color: 'rgba(0, 255, 136, 0.9)',
                  fontFamily: 'SF Mono, Menlo, monospace',
                  fontWeight: 600,
                  boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                }}>{k}</div>
              ))}
              <span style={{
                fontSize: 14,
                color: 'rgba(255,255,255,0.4)',
                fontFamily: '-apple-system, sans-serif',
                marginLeft: 4,
              }}>Agent</span>
            </div>
          </div>
        </div>

        {/* Right: orb */}
        <div style={{
          flex: 1,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          paddingRight: 80,
        }}>
          <div style={{
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}>
            {/* Outer ring */}
            <div style={{
              position: 'absolute',
              width: 540,
              height: 540,
              borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.08)',
            }} />
            <div style={{
              position: 'absolute',
              width: 660,
              height: 660,
              borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.04)',
            }} />

            <RemotionShaderOrb size={420} isActive audioLevel={0.55} />
          </div>
        </div>
      </div>

      {/* Bottom strip */}
      <div style={{
        position: 'absolute',
        bottom: 50,
        left: 140,
        right: 140,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{
          display: 'flex',
          gap: 14,
        }}>
          {['Tauri', 'React 19', '阿里云百炼 STT', 'Pi Agent', 'Human-in-the-loop'].map((tag, i) => (
            <span key={i} style={{
              fontSize: 13,
              color: 'rgba(255,255,255,0.5)',
              padding: '6px 14px',
              borderRadius: 14,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              fontFamily: '-apple-system, sans-serif',
              fontWeight: 500,
            }}>{tag}</span>
          ))}
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <div style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#00ff88',
            boxShadow: '0 0 8px #00ff88',
          }} />
          <span style={{
            fontSize: 13,
            color: 'rgba(255,255,255,0.5)',
            fontFamily: 'SF Mono, monospace',
            letterSpacing: 1,
          }}>v1.1.1 · ACTIVE PROTOTYPE</span>
        </div>
      </div>

      {/* Hidden frame ref for type checker */}
      <div style={{position: 'absolute', opacity: 0, pointerEvents: 'none'}}>{frame}</div>
    </AbsoluteFill>
  );
};
