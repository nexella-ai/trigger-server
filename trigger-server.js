require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.status(200).send('Trigger server is healthy.');
});

// ✅ Simple endpoint to trigger a Retell call
app.post('/trigger-retell-call', async (req, res) => {
  const { name, email, phone, userId } = req.body;

  if (!phone) {
    return res.status(400).json({
      success: false,
      error: "Missing phone number field"
    });
  }

  console.log('Triggering Retell call with:', { name, email, phone });

  try {
    const response = await axios.post('https://api.retellai.com/v1/calls', {
      from_number: process.env.RETELL_FROM_NUMBER,
      to_number: phone,
      agent_id: process.env.RETELL_AGENT_ID,
      metadata: {
        customer_name: name || "",
        customer_email: email || "",
        user_id: userId || `user_${Date.now()}`
      }
    }, {
      headers: {
        Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Retell outbound call initiated:', response.data);

    res.status(200).json({
      success: true,
      message: 'Outbound call initiated successfully',
      call_id: response.data.call_id
    });
  } catch (error) {
    console.error('❌ Error initiating Retell call:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Trigger server running on port ${PORT}`);
});
