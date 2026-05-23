import { useRecordingStore } from "../stores/recording";
import { useSettingsStore } from "../stores/settings";

export default function Overview() {
  const { isRecording, chunkCount, sttStatus, startRecording, stopRecording, playLatest } =
    useRecordingStore();
  const { piSettings, localPi, sttSettings } = useSettingsStore();

  return (
    <div className="grid gap-[34px] pt-7">
      <section className="grid grid-cols-[minmax(0,1.25fr)_minmax(240px,0.75fr)] items-end gap-6 border-b border-paper-line pb-5 max-[900px]:grid-cols-1">
        <div>
          <p className="kicker">概览</p>
          <h3 className="mt-2.5 text-[clamp(1.7rem,2vw,2.15rem)] leading-none font-semibold tracking-[-0.06em]">
            语音输入设置
          </h3>
          <p className="mt-2.5 max-w-[34ch] text-[0.96rem] text-paper-muted [line-height:1.65]">
            当前配置概览。
          </p>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <button className="btn-primary" onClick={isRecording ? stopRecording : startRecording}>
            {isRecording ? "停止录音" : "开始录音"}
          </button>
          <button className="btn-ghost" onClick={playLatest} disabled={isRecording}>
            播放最新录音
          </button>
        </div>
      </section>

      <section className="grid grid-cols-3 gap-5 max-[900px]:grid-cols-1">
        <article className="stat-card">
          <span className="field-label">状态</span>
          <strong className="mt-3 block text-[1.25rem] font-semibold tracking-[-0.045em]">
            {isRecording ? "录音中" : "空闲"}
          </strong>
          <small className="text-paper-muted">{sttStatus}</small>
        </article>
        <article className="stat-card">
          <span className="field-label">音频包</span>
          <strong className="mt-3 block text-[1.25rem] font-semibold tracking-[-0.045em]">
            {chunkCount}
          </strong>
          <small className="text-paper-muted">当前会话音频包数</small>
        </article>
        <article className="stat-card">
          <span className="field-label">Pi 路由</span>
          <strong className="mt-3 block break-words text-[1.25rem] font-semibold tracking-[-0.045em]">
            {piSettings.provider || localPi.default_provider || "未设置"}
          </strong>
          <small className="text-paper-muted">
            {piSettings.model || localPi.default_model || "选择模型"}
          </small>
        </article>
      </section>

      <section className="section-divider">
        <div className="section-head">
          <div>
            <h3 className="section-title">当前状态</h3>
            <p className="mt-1.5 text-paper-muted">当前配置。</p>
          </div>
        </div>

        <div className="grid gap-0">
          <div className="row">
            <span className="text-paper-muted">语音 API Key</span>
            <strong className="block text-[1.25rem] font-semibold tracking-[-0.045em]">
              {sttSettings.has_api_key ? sttSettings.api_key_hint : "未配置"}
            </strong>
          </div>
          <div className="row">
            <span className="text-paper-muted">语音模型</span>
            <strong className="block text-[1.25rem] font-semibold tracking-[-0.045em]">
              {sttSettings.model}
            </strong>
          </div>
          <div className="row">
            <span className="text-paper-muted">整理模式</span>
            <strong className="block text-[1.25rem] font-semibold tracking-[-0.045em]">
              {piSettings.mode}
            </strong>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-3.5 max-[760px]:flex-col max-[760px]:items-start">
            <span className="text-paper-muted">复用进程</span>
            <strong className="block text-[1.25rem] font-semibold tracking-[-0.045em]">
              {piSettings.reuse_process ? "已开启" : "已关闭"}
            </strong>
          </div>
        </div>
      </section>
    </div>
  );
}
