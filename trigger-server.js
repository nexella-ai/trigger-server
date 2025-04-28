// trigger-server.js (Final corrected version)

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

app.use(bodyParser.json());

app.post('/trigger-call', (req, res) => {
  const { name, email, phone } = req.body;
  console.log('Received trigger:', { name, email, phone });

  const ws = new WebSocket('wss://api.retellai.com/ws');

  ws.on('open', () => {
    console.log('✅ WebSocket opened to Retell.');

    setTimeout(() => {
      ws.send(JSON.stringify({
        type: 'start_call',
        phone_number: phone,
        agent_id: process.env.RETELL_AGENT_ID,
        custom_fields: {
          name: name,
          email: email
        }
      }));
      console.log('📞 Sent start_call to Retell.');
    }, 500); // 500ms small delay to prevent race conditions
  });

  ws.on('message', (message) => {
    console.log('📝 Received from Retell:', message.toString());
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  });

  ws.on('close', () => {
    console.log('🔒 WebSocket closed.');
  });

  res.status(200).send('Trigger received.');
});

// OPTIONAL - Webhook for Retell call events (answer, hangup, etc)
app.post('/retell-webhook', (req, res) => {
  console.log('📞 Retell Webhook Event:', req.body);
  res.status(200).send('Webhook received.');
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Trigger WebSocket Server running on port ${PORT}`);
});
