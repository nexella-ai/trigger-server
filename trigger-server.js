// trigger-server.js

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { confirmSlot } = require('./slot-manager');

const app = express();
app.use(express.json());

// Health check endpoint (Render will love this)
app.get('/health', (req, res) => {
  res.status(200).send('Server is healthy.');
});

// Endpoint where AI sends final picked slot
app.post('/trigger-call', async (req, res) => {
  const { name, email, phone, eventTypeUri, startTime, endTime, userId } = req.body;

  console.log('Received trigger from AI:', { name, email, phone, startTime, endTime, userId });

  if (!phone || !startTime || !endTime) {
    return res.status(400).json({ success: false, error: "Missing required fields." });
  }

  // Confirm slot lock
  if (!confirmSlot(startTime, userId)) {
    return res.status(409).json({ success: false, error: "Slot is no longer available." });
  }

  // Use provided eventTypeUri or fallback to default
  const eventType = eventTypeUri || process.env.DEFAULT_EVENT_TYPE_URI;
  if (!eventType) {
    return res.status(400).json({ success: false, error: "Missing event type information." });
  }

  try {
    const response = await axios.post('https://api.calendly.com/scheduled_events', {
      event_type: eventType,
      invitee: {
        name,
        email
      },
      start_time: startTime,
      end_time: endTime,
      timezone: "America/Los_Angeles" // you can make this dynamic if needed
    }, {
      headers: {
        Authorization: `Bearer ${process.env.CALENDLY_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Meeting booked on Calendly:', response.data);

    res.status(200).json({
      success: true,
      message: 'Call scheduled successfully.',
      calendly_response: response.data
    });
  } catch (error) {
    const err = error.response?.data || error.message;
    console.error('❌ Error booking meeting:', err);

    res.status(500).json({
      success: false,
      message: 'Failed to schedule meeting.',
      error: err
    });
  }
});

// Server listen
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Trigger server running on port ${PORT}`);
});
