import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import dotenv from 'dotenv';
import { adminHandler } from './adminHandler';
import { viewerHandler } from './viewerHandler';
import { Viewer } from './types';

dotenv.config();

const app = express();
const server = createServer(app);

const PORT = process.env.PORT || 3000;

// Serve static files (UI)
app.use(express.static(path.join(__dirname, '../public')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    adminConnected: adminHandler.isConnected(),
    viewerCount: viewerHandler.getViewerCount()
  });
});

// Create WebSocket servers for admin and viewer
const adminWss = new WebSocketServer({ noServer: true });
const viewerWss = new WebSocketServer({ noServer: true });

// Handle upgrade requests to route to correct WebSocket server
server.on('upgrade', (request, socket, head) => {
  const pathname = request.url;

  if (pathname === '/admin') {
    adminWss.handleUpgrade(request, socket, head, (ws) => {
      adminWss.emit('connection', ws, request);
    });
  } else if (pathname === '/viewer') {
    viewerWss.handleUpgrade(request, socket, head, (ws) => {
      viewerWss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Admin WebSocket handling
adminWss.on('connection', (ws: WebSocket) => {
  // Always set up close handler first to prevent stale connections
  ws.on('close', () => {
    adminHandler.disconnectAdmin();
  });

  ws.on('error', (error) => {
    console.error('Admin WebSocket error:', error);
    adminHandler.disconnectAdmin();
  });

  const connected = adminHandler.connectAdmin(ws);
  
  if (!connected) return;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.type === 'audio') {
        adminHandler.sendAudioToOpenAI(message.data);
      } else if (message.type === 'text') {
        adminHandler.sendTextToOpenAI(message.content);
      } else if (message.type === 'update_context') {
        adminHandler.updateContext(message.context);
      }
    } catch (error) {
      console.error('Error parsing admin message:', error);
    }
  });
});

// Viewer WebSocket handling
viewerWss.on('connection', (ws: WebSocket) => {
  const viewer = viewerHandler.addViewer(ws);
  
  if (!viewer) return;

  // Send current admin status
  ws.send(JSON.stringify({
    type: 'status',
    message: adminHandler.isConnected() ? 'Admin is connected' : 'Waiting for admin...',
    adminConnected: adminHandler.isConnected(),
    viewerCount: viewerHandler.getViewerCount()
  }));

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.type === 'toggle_audio') {
        viewerHandler.toggleAudio(viewer.id, message.enabled);
      }
    } catch (error) {
      console.error('Error parsing viewer message:', error);
    }
  });

  ws.on('close', () => {
    viewerHandler.removeViewer(viewer.id);
  });

  ws.on('error', (error) => {
    console.error('Viewer WebSocket error:', error);
    viewerHandler.removeViewer(viewer.id);
  });
});

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║          Real-Time Audio Broadcast Server                ║
╠══════════════════════════════════════════════════════════╣
║  Server running on http://localhost:${PORT}                 ║
║                                                          ║
║  Endpoints:                                              ║
║  • Admin UI:    http://localhost:${PORT}/admin.html         ║
║  • Viewer UI:   http://localhost:${PORT}/viewer.html        ║
║  • Admin WS:    ws://localhost:${PORT}/admin                ║
║  • Viewer WS:   ws://localhost:${PORT}/viewer               ║
║                                                          ║
║  Max viewers: 5                                          ║
╚══════════════════════════════════════════════════════════╝
  `);
});
