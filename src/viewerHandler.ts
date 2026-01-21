import WebSocket from 'ws';
import { Viewer, ServerToViewerMessage } from './types';

const MAX_VIEWERS = 5;

class ViewerHandler {
  private viewers: Map<string, Viewer> = new Map();

  addViewer(ws: WebSocket): Viewer | null {
    if (this.viewers.size >= MAX_VIEWERS) {
      ws.send(JSON.stringify({
        type: 'status',
        message: 'Server full. Maximum 5 viewers allowed.'
      }));
      ws.close();
      return null;
    }

    const id = `viewer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const viewer: Viewer = {
      id,
      ws,
      audioEnabled: true, // Default: audio enabled
      connectedAt: new Date()
    };

    this.viewers.set(id, viewer);
    console.log(`Viewer connected: ${id}. Total viewers: ${this.viewers.size}`);

    // Send welcome message
    this.sendToViewer(viewer, {
      type: 'status',
      message: 'Connected to broadcast',
      viewerCount: this.viewers.size
    });

    return viewer;
  }

  removeViewer(id: string): void {
    const viewer = this.viewers.get(id);
    if (viewer) {
      this.viewers.delete(id);
      console.log(`Viewer disconnected: ${id}. Total viewers: ${this.viewers.size}`);
    }
  }

  toggleAudio(id: string, enabled: boolean): void {
    const viewer = this.viewers.get(id);
    if (viewer) {
      viewer.audioEnabled = enabled;
      console.log(`Viewer ${id} audio: ${enabled ? 'enabled' : 'disabled'}`);
      this.sendToViewer(viewer, {
        type: 'status',
        message: `Audio ${enabled ? 'enabled' : 'disabled'}`
      });
    }
  }

  broadcastText(content: string): void {
    const message: ServerToViewerMessage = { type: 'text', content };
    this.viewers.forEach(viewer => {
      this.sendToViewer(viewer, message);
    });
  }

  broadcastTranscript(content: string): void {
    const message: ServerToViewerMessage = { type: 'transcript', content };
    this.viewers.forEach(viewer => {
      this.sendToViewer(viewer, message);
    });
  }

  broadcastAudio(data: string): void {
    const message: ServerToViewerMessage = { type: 'audio', data };
    this.viewers.forEach(viewer => {
      if (viewer.audioEnabled) {
        this.sendToViewer(viewer, message);
      }
    });
  }

  broadcastStatus(statusMessage: string, adminConnected?: boolean): void {
    const message: ServerToViewerMessage = {
      type: 'status',
      message: statusMessage,
      viewerCount: this.viewers.size,
      adminConnected
    };
    this.viewers.forEach(viewer => {
      this.sendToViewer(viewer, message);
    });
  }

  private sendToViewer(viewer: Viewer, message: ServerToViewerMessage): void {
    if (viewer.ws.readyState === WebSocket.OPEN) {
      viewer.ws.send(JSON.stringify(message));
    }
  }

  getViewerCount(): number {
    return this.viewers.size;
  }

  getViewerById(id: string): Viewer | undefined {
    return this.viewers.get(id);
  }
}

export const viewerHandler = new ViewerHandler();
