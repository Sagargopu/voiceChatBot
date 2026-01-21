import WebSocket from 'ws';
import { viewerHandler } from './viewerHandler';
import { OpenAISessionConfig } from './types';

const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';

class AdminHandler {
  private adminWs: WebSocket | null = null;
  private openaiWs: WebSocket | null = null;
  private isAdminConnected: boolean = false;
  private currentContext: string = 'You are a helpful assistant. Respond naturally to the user\'s speech. Keep responses concise and conversational.';

  isConnected(): boolean {
    return this.isAdminConnected;
  }

  connectAdmin(ws: WebSocket): boolean {
    if (this.isAdminConnected && this.adminWs && this.adminWs.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'status',
        message: 'Admin already connected. Only one admin allowed.'
      }));
      ws.close();
      return false;
    }

    // Clean up any stale connection
    if (this.openaiWs) {
      this.openaiWs.close();
      this.openaiWs = null;
    }

    this.adminWs = ws;
    this.isAdminConnected = true;
    console.log('Admin connected');

    // Connect to OpenAI Realtime API
    this.connectToOpenAI();

    // Notify viewers
    viewerHandler.broadcastStatus('Admin connected. Broadcast starting...', true);

    return true;
  }

  disconnectAdmin(): void {
    if (!this.isAdminConnected) return;

    this.isAdminConnected = false;
    this.adminWs = null;

    if (this.openaiWs) {
      this.openaiWs.close();
      this.openaiWs = null;
    }

    console.log('Admin disconnected');
    viewerHandler.broadcastStatus('Admin disconnected. Broadcast paused.', false);
  }

  sendAudioToOpenAI(audioData: string): void {
    if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
      // Send audio buffer append event
      this.openaiWs.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: audioData
      }));
    }
  }

  sendTextToOpenAI(text: string): void {
    if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
      // Send text message as a conversation item
      this.openaiWs.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: text
            }
          ]
        }
      }));

      // Trigger response generation
      this.openaiWs.send(JSON.stringify({
        type: 'response.create'
      }));

      // Send the text to admin chat and broadcast to viewers
      this.sendToAdmin({ type: 'user_message', content: text });
      viewerHandler.broadcastTranscript(text);

      console.log('Admin sent text:', text);
    }
  }

  updateContext(context: string): void {
    // Store the context
    this.currentContext = context || 'You are a helpful assistant. Respond naturally to the user\'s speech. Keep responses concise and conversational.';

    if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
      // Update session instructions
      this.openaiWs.send(JSON.stringify({
        type: 'session.update',
        session: {
          instructions: this.currentContext
        }
      }));

      // Also add as a system message in the conversation for immediate effect
      this.openaiWs.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `[System Note: ${this.currentContext}] Please acknowledge this context.`
            }
          ]
        }
      }));

      // Trigger a response to acknowledge
      this.openaiWs.send(JSON.stringify({
        type: 'response.create'
      }));

      console.log('Context updated:', this.currentContext.substring(0, 100) + '...');
      this.sendToAdmin({ type: 'status', message: 'AI context updated' });
    }
  }

  private connectToOpenAI(): void {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('OPENAI_API_KEY not set');
      return;
    }

    this.openaiWs = new WebSocket(OPENAI_REALTIME_URL, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });

    this.openaiWs.on('open', () => {
      console.log('Connected to OpenAI Realtime API');
      this.configureSession();
    });

    this.openaiWs.on('message', (data) => {
      this.handleOpenAIMessage(data.toString());
    });

    this.openaiWs.on('error', (error) => {
      console.error('OpenAI WebSocket error:', error);
    });

    this.openaiWs.on('close', () => {
      console.log('OpenAI WebSocket closed');
    });
  }

  private configureSession(): void {
    if (!this.openaiWs) return;

    const sessionConfig: OpenAISessionConfig = {
      modalities: ['text'],
      instructions: this.currentContext,
      input_audio_format: 'pcm16',
      input_audio_transcription: {
        model: 'whisper-1'
      },
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500
      }
    };

    this.openaiWs.send(JSON.stringify({
      type: 'session.update',
      session: sessionConfig
    }));

    console.log('OpenAI session configured');
  }

  private handleOpenAIMessage(data: string): void {
    try {
      const event = JSON.parse(data);

      switch (event.type) {
        case 'session.created':
          console.log('OpenAI session created');
          this.sendToAdmin({ type: 'status', message: 'Ready to receive audio' });
          break;

        case 'session.updated':
          console.log('OpenAI session updated');
          break;

        case 'input_audio_buffer.speech_started':
          console.log('Speech detected');
          viewerHandler.broadcastStatus('Admin is speaking...');
          break;

        case 'input_audio_buffer.speech_stopped':
          console.log('Speech ended');
          break;

        case 'conversation.item.input_audio_transcription.completed':
          // Transcript of what admin said
          if (event.transcript) {
            console.log('Admin said:', event.transcript);
            this.sendToAdmin({ type: 'user_message', content: event.transcript });
            viewerHandler.broadcastTranscript(event.transcript);
          }
          break;

        case 'response.audio_transcript.delta':
          // Streaming text response
          if (event.delta) {
            this.sendToAdmin({ type: 'assistant_message', content: event.delta });
            viewerHandler.broadcastText(event.delta);
          }
          break;

        case 'response.audio.delta':
          // Streaming audio response
          if (event.delta) {
            this.sendToAdmin({ type: 'assistant_audio', data: event.delta });
            viewerHandler.broadcastAudio(event.delta);
          }
          break;

        case 'response.audio_transcript.done':
          console.log('Response transcript complete');
          this.sendToAdmin({ type: 'assistant_message_done' });
          break;

        case 'response.audio.done':
          console.log('Response audio complete');
          break;

        case 'response.done':
          console.log('Response complete');
          viewerHandler.broadcastStatus('Response complete');
          break;

        case 'error':
          console.error('OpenAI error:', event.error);
          viewerHandler.broadcastStatus(`Error: ${event.error?.message || 'Unknown error'}`);
          break;

        default:
          // Log other events for debugging
          if (event.type) {
            console.log('OpenAI event:', event.type);
          }
      }
    } catch (error) {
      console.error('Error parsing OpenAI message:', error);
    }
  }

  private sendToAdmin(message: object): void {
    if (this.adminWs && this.adminWs.readyState === WebSocket.OPEN) {
      this.adminWs.send(JSON.stringify(message));
    }
  }
}

export const adminHandler = new AdminHandler();
