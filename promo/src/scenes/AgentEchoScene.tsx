import {AbsoluteFill, useCurrentFrame, interpolate, Sequence} from 'remotion';
import {Placeholder} from '../components/Placeholder';
import {KeyboardShortcut} from '../components/KeyboardShortcut';
import {Typewriter} from '../components/remocn/Typewriter';
import {ToastNotification} from '../components/remocn/ToastNotification';
import {TerminalSimulator, TerminalLine} from '../components/remocn/TerminalSimulator';

const TASK_TEXT = '帮我检查最近的 commit，跑一下构建，有问题通知我。';

const AGENT_LINES: TerminalLine[] = [
  {text: 'vs agent --task "检查最近 commit 并跑构建"', type: 'command', delay: 0},
  {text: 'Fetching recent commits...', type: 'log', delay: 10},
  {text: 'git log --oneline -5', type: 'command', delay: 6},
  {text: 'd51a943 chore: bump version to 1.1.2', type: 'log', delay: 4},
  {text: '39f8466 docs: rewrite README', type: 'log', delay: 3},
  {text: '29c4ff6 feat: add Remotion promo video', type: 'log', delay: 3},
  {text: 'Running build...', type: 'log', delay: 12, pause: 6},
  {text: 'npm run build', type: 'command', delay: 4},
  {text: 'Compiling...', type: 'log', delay: 8, pause: 14},
  {text: 'Build completed in 4.2s', type: 'success', delay: 4},
  {text: 'No regressions found in recent commits', type: 'success', delay: 10},
];

export const AgentEchoScene: React.FC = () => {
  const frame = useCurrentFrame();

  const showTask = frame > 25 && frame < 200;
  const showWorking = frame > 175 && frame < 380;
  const showNotification = frame > 280;
  const showTTS = frame > 340;

  const sectionFade = interpolate(frame, [0, 20], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const shortcutOpacity = interpolate(frame, [5, 25, 60], [0, 1, 0.4], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const taskOpacity = interpolate(frame, [25, 50, 175, 200], [0, 1, 1, 0.35], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const workingOpacity = interpolate(frame, [175, 210, 360, 380], [0, 1, 1, 0.5], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const ttsOpacity = interpolate(frame, [340, 380], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const subtitleOpacity = interpolate(frame, [380, 410], [0, 0.85], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill
      style={{
        background: 'radial-gradient(ellipse at center, #2a1810 0%, #0a0a0a 70%)',
        justifyContent: 'flex-start',
        alignItems: 'center',
        padding: '60px 80px',
      }}
    >
      <div style={{textAlign: 'center', opacity: sectionFade}}>
        <span style={{fontSize: 16, color: '#ffc832', fontFamily: '-apple-system, sans-serif', fontWeight: 500, letterSpacing: 4, textTransform: 'uppercase'}}>
          AGENT 模式 · 一句话 = 一件事
        </span>
      </div>

      <div style={{marginTop: 24, opacity: shortcutOpacity}}>
        <KeyboardShortcut keys={['⌘', '⇧', 'A']} pressAt={15} releaseAt={32} />
      </div>

      {showTask && (
        <div style={{marginTop: 28, background: 'rgba(255, 200, 50, 0.06)', border: '1px solid rgba(255, 200, 50, 0.32)', borderRadius: 12, padding: '18px 32px', maxWidth: 900, width: '100%', opacity: taskOpacity, boxSizing: 'border-box'}}>
          <div style={{fontSize: 11, color: '#ffc832', letterSpacing: 2, marginBottom: 8, fontFamily: 'SF Mono, monospace'}}>VOICE COMMAND</div>
          <p style={{margin: 0, fontSize: 24, color: '#ffffff', fontWeight: 500, lineHeight: 1.5, fontFamily: '-apple-system, sans-serif'}}>
            <Sequence from={40} durationInFrames={160} layout="none">
              <Typewriter
                text={TASK_TEXT}
                charsPerSecond={14}
                fontSize={24}
                color="#ffffff"
                cursorColor="#ffc832"
                fontFamily="-apple-system, sans-serif"
                style={{fontWeight: 500}}
              />
            </Sequence>
          </p>
        </div>
      )}

      {showWorking && (
        <div style={{marginTop: 28, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, width: 1300, opacity: workingOpacity}}>
          <Placeholder
            label="真实录屏 · 用户继续在另一个文件工作"
            hint="演示 Agent 异步性：用户不必盯着任务运行"
            duration="约 4s"
            width={640}
            height={300}
          />
          <Sequence from={175} durationInFrames={245} layout="none">
            <TerminalSimulator
              lines={AGENT_LINES}
              title="VoiceStream Agent"
              width={640}
              height={300}
              fontSize={13}
              charsPerFrame={3}
              chunkSize={2}
            />
          </Sequence>
        </div>
      )}

      {showNotification && (
        <div style={{position: 'absolute', top: 130, right: 60}}>
          <Sequence from={280} durationInFrames={140} layout="none">
            <ToastNotification
              title="✓ 任务完成"
              message="构建通过，最近 5 个 commit 无功能回归"
              variant="success"
            />
          </Sequence>
        </div>
      )}

      {showTTS && (
        <div style={{position: 'absolute', bottom: 100, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: ttsOpacity}}>
          <div style={{background: 'rgba(0, 255, 136, 0.06)', border: '1px solid rgba(0, 255, 136, 0.32)', borderRadius: 14, padding: '14px 28px', maxWidth: 820, boxSizing: 'border-box'}}>
            <div style={{fontSize: 11, color: '#00ff88', letterSpacing: 2, marginBottom: 6, fontFamily: 'SF Mono, monospace'}}>AI · TTS PLACEHOLDER</div>
            <p style={{margin: 0, fontSize: 18, color: '#ffffff', lineHeight: 1.5, fontFamily: '-apple-system, sans-serif', fontWeight: 500}}>
              "构建都通过了，最近 5 个 commit 也都没问题。"
            </p>
          </div>
        </div>
      )}

      <div style={{position: 'absolute', bottom: 36, left: 0, right: 0, textAlign: 'center', opacity: subtitleOpacity}}>
        <span style={{fontSize: 16, color: 'rgba(255,255,255,0.6)', fontFamily: 'SF Mono, monospace', letterSpacing: 3}}>
          有些话不只是输入
        </span>
      </div>
    </AbsoluteFill>
  );
};
