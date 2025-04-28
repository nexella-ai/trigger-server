const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const axios = require('axios');
const WebSocket = require('ws'); // <- Make sure this is included!

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

// 🧠 Existing WebSocket server (keep this)
wss.on('connection', (ws) => {
  console.log('WebSocket connected.');
  ws.on('message', (message) => {
    console.log('Received message:', message.toString());
  });
});

// 🛠️ NEW: Trigger call endpoint
app.post('/trigger-call', async (req, res) => {
  const { name, email, phone } = req.body;

  console.log('Received trigger:', { name, email, phone });

  // Connect to Retell WebSocket
  const socket = new WebSocket('wss://api.retellai.com/v1/connect', {
    headers: {
      Authorization: `Bearer 3464a52d1a75cde272dc29cc3b85`
    }
  });

  socket.on('open', () => {
    console.log('WebSocket opened to Retell.');

    socket.send(JSON.stringify({
      phone_number: phone,
      agent_id: "agent_e30590f7739653b4ee36652b49",
      custom_fields: {
        name,
        email
      }
    }));

    res.status(200).send('Triggered call successfully.');
  });

  socket.on('message', (data) => {
    console.log('Retell Message:', data.toString());
  });

  socket.on('error', (error) => {
    console.error('WebSocket error:', error.message);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Trigger WebSocket Server running on port ${PORT}`);
});
