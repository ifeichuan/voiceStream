export interface AudioChunk {
  timestamp: number;
  sample_rate: number;
  channels: number;
  size: number;
}

export interface HotkeySessionEvent {
  state: string;
  message: string;
  shortcut: string;
  purpose: string;
}

export interface SttTranscriptEvent {
  text: string;
  is_final: boolean;
}

export interface SttStatusEvent {
  provider: string;
  status: string;
}

export interface SttSettingsView {
  provider: string;
  api_endpoint: string;
  model: string;
  workspace_id: string;
  language: string;
  sample_rate: number;
  extra_config: string;
  has_api_key: boolean;
  api_key_hint: string;
}

export interface SttProviderMeta {
  id: string;
  label: string;
  needs_api_key: boolean;
  needs_endpoint: boolean;
  needs_model: boolean;
  needs_workspace_id: boolean;
  default_endpoint: string;
  default_model: string;
  default_sample_rate: number;
}

export interface LocalPiModelView {
  id: string;
  name: string;
}

export interface LocalPiProviderView {
  id: string;
  base_url: string;
  api: string;
  has_api_key: boolean;
  models: LocalPiModelView[];
}

export interface LocalPiConfigView {
  settings_path: string;
  models_path: string;
  default_provider: string;
  default_model: string;
  providers: LocalPiProviderView[];
  raw_settings_json: string;
  raw_models_json: string;
}

export interface PiSettingsView {
  mode: string;
  provider: string;
  model: string;
  reuse_process: boolean;
  prompt_template_key: string;
  custom_prompt_template: string;
  provider_json: string;
}

export interface AppSettingsView {
  stt: SttSettingsView;
  pi: PiSettingsView;
  shortcuts: ShortcutSettingsView;
  local_pi: LocalPiConfigView;
}

export interface ShortcutSettingsView {
  dictation_shortcut: string;
  agent_shortcut: string;
}

export interface TimingEvent {
  session_id: number;
  stage: string;
  elapsed_ms: number;
  details: string;
}

export interface AgentTaskEvent {
  timestamp_ms: number;
  kind: string;
  message: string;
}

export interface AgentTask {
  id: string;
  title: string;
  transcript: string;
  status: "pending" | "running" | "completed" | "failed" | "interrupted" | "unknown";
  created_at_ms: number;
  updated_at_ms: number;
  session_path: string;
  events: AgentTaskEvent[];
  final_text: string;
  error_text: string;
}

export interface AgentTaskUpdatedEvent {
  task: AgentTask;
}

export interface AgentNotificationEvent {
  task_id: string;
  title: string;
  status: "completed" | "failed" | string;
  summary: string;
  display_text: string;
  spoken_text: string;
  channel: string;
  timestamp_ms: number;
}

export interface AgentTerminalOutputEvent {
  task_id: string;
  data: number[];
}

export interface AgentTerminalStatusEvent {
  task_id: string;
  status: string;
  message: string;
}

export interface AgentSessionEntry {
  line: number;
  timestamp: string;
  entry_type: string;
  role: string;
  title: string;
  text: string;
  tool_name: string;
  is_error: boolean;
  raw: string;
}

export interface AgentSessionView {
  task_id: string;
  session_path: string;
  resume_command: string;
  entries: AgentSessionEntry[];
  parse_errors: string[];
}
