const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({ server });

let activeClients = [];

app.use(bodyParser.json());

app.post('/trigger-call', (req, res) => {
  const { name, email, phone } = req.body;
  
  console.log('Received trigger:', { name, email, phone });

  activeClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'start_call',
        data: { name, email, phone }
      }));
    }
  });

  res.status(200).send('Call triggered.');
});

wss.on('connection', (ws) => {
  console.log('WebSocket client connected.');
  activeClients.push(ws);

  ws.on('close', () => {
    activeClients = activeClients.filter(client => client !== ws);
    console.log('WebSocket client disconnected.');
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Trigger WebSocket Server running on port ${PORT}`);
});
