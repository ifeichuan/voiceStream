import {AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig} from 'remotion';
import {RemotionShaderOrb} from '../components/RemotionShaderOrb';
import {KeyboardShortcut} from '../components/KeyboardShortcut';

export const AgentScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const slideIn = spring({frame, fps, config: {damping: 12}});

  // Phase timeline (total 180 frames = 6s)
  // 0-30: Shortcut press + orb activates
  // 30-70: Voice input "帮我把这个函数重构一下"
  // 70-110: Agent executing
  // 110-130: Agent asks question (human-in-the-loop)
  // 130-160: User responds via voice
  // 160-180: Task completes

  const isRecording1 = frame > 15 && frame < 65;
  const isRecording2 = frame > 130 && frame < 158;
  const isAgentRunning = frame > 70 && frame < 170;

  const voiceText1 = '帮我把这个函数重构一下';
  const voiceChars1 = Math.floor(interpolate(frame, [30, 60], [0, voiceText1.length], {extrapolateRight: 'clamp'}));

  const questionText = '需要保留原有的接口签名吗？';
  const questionOpacity = interpolate(frame, [110, 120], [0, 1], {extrapolateRight: 'clamp'});

  const voiceText2 = '保留，但是加一个可选参数';
  const voiceChars2 = Math.floor(interpolate(frame, [135, 155], [0, voiceText2.length], {extrapolateRight: 'clamp'}));

  const completedOpacity = interpolate(frame, [165, 175], [0, 1], {extrapolateRight: 'clamp'});

  const cursorBlink = Math.sin(frame * 0.3) > 0 ? 1 : 0;

  // Progress
  const progress1 = interpolate(frame, [70, 110], [0, 45], {extrapolateRight: 'clamp'});
  const progress2 = interpolate(frame, [158, 175], [45, 100], {extrapolateRight: 'clamp'});
  const progressWidth = frame < 158 ? progress1 : progress2;

  return (
    <AbsoluteFill style={{
      justifyContent: 'center',
      alignItems: 'center',
      background: 'radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a0a 70%)',
    }}>
      {/* Section label */}
      <div style={{
        position: 'absolute',
        top: 60,
        left: 0,
        right: 0,
        textAlign: 'center',
        opacity: interpolate(frame, [0, 15], [0, 1], {extrapolateRight: 'clamp'}),
      }}>
        <span style={{
          fontSize: 18,
          color: '#00ff88',
          fontFamily: '-apple-system, sans-serif',
          fontWeight: 500,
          letterSpacing: 3,
          textTransform: 'uppercase',
        }}>Agent 模式</span>
      </div>

      {/* Keyboard shortcut animation */}
      <div style={{
        position: 'absolute',
        top: 110,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
      }}>
        <KeyboardShortcut keys={['⌘', '⇧', 'L']} pressAt={8} releaseAt={20} />
      </div>

      {/* Main content area */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
        marginTop: 40,
      }}>
        {/* ShaderOrb - active during voice input */}
        <div style={{
          opacity: interpolate(frame, [12, 20], [0, 1], {extrapolateRight: 'clamp'}),
          transform: `scale(${slideIn})`,
        }}>
          <RemotionShaderOrb
            size={120}
            isActive={isRecording1 || isRecording2}
            audioLevel={
              isRecording1
                ? interpolate(frame, [20, 35, 50, 63], [0, 0.7, 0.5, 0.8], {extrapolateRight: 'clamp'})
                : isRecording2
                  ? interpolate(frame, [132, 140, 150, 156], [0, 0.6, 0.8, 0.5], {extrapolateRight: 'clamp'})
                  : 0
            }
          />
        </div>

        {/* Voice input 1 */}
        {frame > 25 && frame < 115 && (
          <div style={{
            background: 'rgba(255,255,255,0.04)',
            borderRadius: 12,
            padding: '16px 32px',
            border: '1px solid rgba(255,255,255,0.1)',
            maxWidth: 600,
            opacity: frame > 70 ? interpolate(frame, [70, 80], [1, 0.5], {extrapolateRight: 'clamp'}) : 1,
          }}>
            <p style={{
              fontSize: 12,
              color: 'rgba(255,255,255,0.35)',
              margin: '0 0 6px 0',
              fontFamily: '-apple-system, sans-serif',
            }}>语音指令</p>
            <p style={{
              fontSize: 22,
              color: '#ffffff',
              margin: 0,
              fontFamily: '-apple-system, sans-serif',
              fontWeight: 500,
            }}>
              {voiceText1.slice(0, voiceChars1)}
              {voiceChars1 < voiceText1.length && (
                <span style={{opacity: cursorBlink, color: '#4dc9f6'}}>|</span>
              )}
            </p>
          </div>
        )}

        {/* Agent running indicator */}
        {isAgentRunning && frame < 165 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            opacity: interpolate(frame, [70, 80], [0, 1], {extrapolateRight: 'clamp'}),
          }}>
            <div style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#00ff88',
              boxShadow: '0 0 8px #00ff88',
              opacity: Math.sin(frame * 0.15) * 0.4 + 0.6,
            }} />
            <span style={{
              fontSize: 14,
              color: 'rgba(255,255,255,0.6)',
              fontFamily: '-apple-system, sans-serif',
            }}>Agent 执行中...</span>
          </div>
        )}

        {/* Progress bar */}
        {frame > 70 && (
          <div style={{
            width: 400,
            height: 3,
            borderRadius: 2,
            background: 'rgba(255,255,255,0.08)',
            overflow: 'hidden',
            opacity: interpolate(frame, [70, 78], [0, 1], {extrapolateRight: 'clamp'}),
          }}>
            <div style={{
              width: `${progressWidth}%`,
              height: '100%',
              borderRadius: 2,
              background: 'linear-gradient(to right, #00ff88, #4dc9f6)',
            }} />
          </div>
        )}

        {/* Agent question - human in the loop */}
        {frame > 108 && (
          <div style={{
            background: 'rgba(255, 200, 50, 0.06)',
            borderRadius: 12,
            padding: '16px 32px',
            border: '1px solid rgba(255, 200, 50, 0.25)',
            maxWidth: 600,
            opacity: questionOpacity,
            transform: `translateY(${(1 - questionOpacity) * 10}px)`,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 8,
            }}>
              <span style={{
                fontSize: 11,
                color: '#ffc832',
                fontFamily: 'SF Mono, monospace',
                background: 'rgba(255, 200, 50, 0.15)',
                padding: '2px 8px',
                borderRadius: 4,
                fontWeight: 600,
              }}>QUESTION</span>
              <span style={{
                fontSize: 12,
                color: 'rgba(255,255,255,0.35)',
                fontFamily: '-apple-system, sans-serif',
              }}>需要你的输入</span>
            </div>
            <p style={{
              fontSize: 20,
              color: '#ffffff',
              margin: 0,
              fontFamily: '-apple-system, sans-serif',
              fontWeight: 400,
            }}>
              {questionText}
            </p>
          </div>
        )}

        {/* Second keyboard shortcut for voice reply */}
        {frame > 123 && frame < 160 && (
          <div style={{
            opacity: interpolate(frame, [123, 130], [0, 1], {extrapolateRight: 'clamp'}),
          }}>
            <KeyboardShortcut keys={['⌘', '⇧', 'L']} pressAt={128} releaseAt={135} />
          </div>
        )}

        {/* Voice input 2 - user reply */}
        {frame > 133 && (
          <div style={{
            background: 'rgba(77, 201, 246, 0.04)',
            borderRadius: 12,
            padding: '16px 32px',
            border: '1px solid rgba(77, 201, 246, 0.2)',
            maxWidth: 600,
            opacity: interpolate(frame, [133, 140], [0, 1], {extrapolateRight: 'clamp'}),
          }}>
            <p style={{
              fontSize: 12,
              color: 'rgba(77, 201, 246, 0.7)',
              margin: '0 0 6px 0',
              fontFamily: '-apple-system, sans-serif',
            }}>语音回复</p>
            <p style={{
              fontSize: 20,
              color: '#ffffff',
              margin: 0,
              fontFamily: '-apple-system, sans-serif',
              fontWeight: 500,
            }}>
              {voiceText2.slice(0, voiceChars2)}
              {voiceChars2 < voiceText2.length && frame < 158 && (
                <span style={{opacity: cursorBlink, color: '#4dc9f6'}}>|</span>
              )}
            </p>
          </div>
        )}

        {/* Task completed */}
        {frame > 163 && (
          <div style={{
            background: 'rgba(0, 255, 136, 0.06)',
            borderRadius: 12,
            padding: '14px 28px',
            border: '1px solid rgba(0, 255, 136, 0.3)',
            opacity: completedOpacity,
            transform: `translateY(${(1 - completedOpacity) * 10}px)`,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <span style={{
                fontSize: 11,
                color: '#00ff88',
                fontFamily: 'SF Mono, monospace',
                background: 'rgba(0, 255, 136, 0.15)',
                padding: '2px 8px',
                borderRadius: 4,
                fontWeight: 600,
              }}>END</span>
              <span style={{
                fontSize: 18,
                color: '#ffffff',
                fontFamily: '-apple-system, sans-serif',
              }}>重构完成，已保留接口签名并添加可选参数</span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom description */}
      <p style={{
        position: 'absolute',
        bottom: 60,
        left: 0,
        right: 0,
        textAlign: 'center',
        fontSize: 18,
        color: 'rgba(255,255,255,0.4)',
        fontFamily: '-apple-system, sans-serif',
        opacity: interpolate(frame, [170, 180], [0, 1], {extrapolateRight: 'clamp'}),
      }}>
        Human-in-the-loop · 任务中随时语音介入
      </p>
    </AbsoluteFill>
  );
};
