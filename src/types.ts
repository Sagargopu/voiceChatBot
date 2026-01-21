// Viewer connection with preferences
export interface Viewer {
  id: string;
  ws: import('ws').WebSocket;
  audioEnabled: boolean;
  connectedAt: Date;
}

// Message types from admin
export interface AdminAudioMessage {
  type: 'audio';
  data: string; // base64 encoded PCM16 audio
}

// Message types from viewer
export interface ViewerToggleMessage {
  type: 'toggle_audio';
  enabled: boolean;
}

// Message types to viewer
export interface TextResponseMessage {
  type: 'text';
  content: string;
}

export interface AudioResponseMessage {
  type: 'audio';
  data: string; // base64 encoded audio
}

export interface StatusMessage {
  type: 'status';
  message: string;
  viewerCount?: number;
  adminConnected?: boolean;
}

export interface TranscriptMessage {
  type: 'transcript';
  content: string; // What the admin said (input transcript)
}

export type ServerToViewerMessage = 
  | TextResponseMessage 
  | AudioResponseMessage 
  | StatusMessage
  | TranscriptMessage;

export type ViewerToServerMessage = ViewerToggleMessage;

export type AdminToServerMessage = AdminAudioMessage;

// OpenAI Realtime API event types
export interface OpenAISessionConfig {
  modalities: string[];
  instructions: string;
  voice?: string;
  input_audio_format: string;
  output_audio_format?: string;
  input_audio_transcription: {
    model: string;
  };
  turn_detection: {
    type: string;
    threshold: number;
    prefix_padding_ms: number;
    silence_duration_ms: number;
  };
}
