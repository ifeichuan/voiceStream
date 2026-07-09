import {AbsoluteFill, useCurrentFrame, interpolate, Sequence} from 'remotion';
import {Placeholder} from '../components/Placeholder';
import {KeyboardShortcut} from '../components/KeyboardShortcut';
import {Typewriter} from '../components/remocn/Typewriter';
import {PulsingIndicator} from '../components/remocn/PulsingIndicator';
import {BlurReveal} from '../components/remocn/BlurReveal';

const RAW_TEXT = '呃 你帮我把这个需求整理一下 就是我们想做一个语音输入 然后最好可以自动优化一下文字';
const CLEAN_TEXT = '帮我整理这个需求：我们想做一个语音输入工具，并且希望它能自动优化文字。';

export const SlowPolishScene: React.FC = () => {
  const frame = useCurrentFrame();

  const showClean = frame > 240;
  const cleanOpacity = interpolate(frame, [240, 280], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const rawFade = interpolate(frame, [240, 280], [1, 0.32], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  const timerVal = interpolate(frame, [240, 290, 350], [0, 1.2, 1.2], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const timerOpacity = interpolate(frame, [60, 100, 380, 420], [0, 1, 1, 0.6], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const subtitleOpacity = interpolate(frame, [340, 380], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const sectionFade = interpolate(frame, [0, 20], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill
      style={{
        background: 'radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a0a 70%)',
        justifyContent: 'flex-start',
        alignItems: 'center',
        padding: '60px 80px 60px',
      }}
    >
      <div style={{textAlign: 'center', opacity: sectionFade}}>
        <span style={{fontSize: 16, color: '#4dc9f6', fontFamily: '-apple-system, sans-serif', fontWeight: 500, letterSpacing: 4, textTransform: 'uppercase'}}>
          慢速完整流程
        </span>
      </div>

      <div style={{marginTop: 30, opacity: sectionFade}}>
        <KeyboardShortcut keys={['⌘', '⇧', 'Space']} pressAt={20} releaseAt={40} />
      </div>

      <div style={{position: 'absolute', top: 60, right: 80, opacity: timerOpacity, fontFamily: 'SF Mono, Menlo, monospace', textAlign: 'right'}}>
        <div style={{fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: 2, marginBottom: 4}}>ELAPSED</div>
        <div style={{fontSize: 56, color: '#4dc9f6', fontWeight: 600, fontVariantNumeric: 'tabular-nums', lineHeight: 1}}>
          {timerVal.toFixed(1)}s
        </div>
      </div>

      <div style={{marginTop: 40, opacity: sectionFade}}>
        <Placeholder
          label="真实录屏 · 用户在 App 中按下快捷键并说话"
          hint="录制：用户在 Cursor / 邮件 / Notion 中触发听写，看到 HUD 出现并开始说话"
          duration="约 6s"
          width={1100}
          height={260}
        />
      </div>

      <div style={{marginTop: 28, display: 'flex', flexDirection: 'column', gap: 14, width: 1100}}>
        <div style={{background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '14px 22px', opacity: rawFade}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6}}>
            <Sequence from={20} durationInFrames={400} layout="none">
              <PulsingIndicator color="#ef4444" size={8} period={10} />
            </Sequence>
            <div style={{fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: 2, fontFamily: 'SF Mono, monospace'}}>
              RAW TRANSCRIPT
            </div>
          </div>
          <p style={{margin: 0, fontSize: 18, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5, fontFamily: '-apple-system, sans-serif'}}>
            <Sequence from={60} durationInFrames={360} layout="none">
              <Typewriter
                text={RAW_TEXT}
                charsPerSecond={18}
                fontSize={18}
                color="rgba(255,255,255,0.85)"
                cursorColor="#4dc9f6"
                fontFamily="-apple-system, sans-serif"
              />
            </Sequence>
          </p>
        </div>

        {showClean && (
          <div style={{background: 'rgba(77, 201, 246, 0.05)', border: '1px solid rgba(77, 201, 246, 0.25)', borderRadius: 10, padding: '14px 22px', opacity: cleanOpacity, transform: `translateY(${(1 - cleanOpacity) * 12}px)`}}>
            <div style={{fontSize: 11, color: '#4dc9f6', letterSpacing: 2, marginBottom: 6, fontFamily: 'SF Mono, monospace'}}>POLISHED · 1.2s</div>
            <p style={{margin: 0, fontSize: 22, color: '#ffffff', lineHeight: 1.5, fontWeight: 500, fontFamily: '-apple-system, sans-serif'}}>
              {CLEAN_TEXT}
            </p>
          </div>
        )}
      </div>

      <div style={{position: 'absolute', bottom: 36, left: 0, right: 0, textAlign: 'center', opacity: subtitleOpacity}}>
        <Sequence from={340} durationInFrames={80} layout="none">
          <BlurReveal
            text="Speak → Transcribe → Polish → Paste"
            revealFrames={20}
            blur={6}
            fontSize={18}
            color="rgba(255,255,255,0.7)"
            fontFamily="SF Mono, Menlo, monospace"
            style={{letterSpacing: 2}}
          />
        </Sequence>
      </div>
    </AbsoluteFill>
  );
};
