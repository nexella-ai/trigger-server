// trigger-server.js

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
    console.log('WebSocket opened to Retell.');

    // Step 1: Subscribe first
    const subscribePayload = {
      type: 'subscribe',
      api_key: process.env.RETELL_API_KEY
    };

    console.log('Sending subscribe payload:', subscribePayload);
    ws.send(JSON.stringify(subscribePayload));
  });

  ws.on('message', (message) => {
    console.log('Received from Retell:', message.toString());
    const parsed = JSON.parse(message);

    if (parsed.type === 'subscribed') {
      console.log('Subscribed successfully, sending start_call...');

      // Step 2: After subscribed, send start_call
      const startCallPayload = {
        type: 'start_call',
        agent_id: process.env.RETELL_AGENT_ID,
        phone_number: phone,
        custom_fields: {
          name: name,
          email: email
        }
      };

      console.log('Sending start_call payload:', startCallPayload);
      ws.send(JSON.stringify(startCallPayload));
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  ws.on('close', () => {
    console.log('WebSocket closed.');
  });

  res.status(200).send('Trigger received.');
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Trigger WebSocket Server running on port ${PORT}`);
});
