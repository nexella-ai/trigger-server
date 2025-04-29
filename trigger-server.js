// trigger-server.js

// Load environment variables
require('dotenv').config();

const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

app.post('/trigger-call', async (req, res) => {
  const { name, email, phone, prompt, tags, agent_id } = req.body;

  console.log('Received trigger from LLM worker:', { name, email, phone, prompt, tags, agent_id });

  // Check if required fields are present
  if (!phone) {
    return res.status(400).json({ success: false, error: "Phone number is required." });
  }

  try {
    const response = await axios.post('https://api.retellai.com/v2/create-phone-call', {
      from_number: process.env.RETELL_FROM_NUMBER,     // Use environment variable
      to_number: phone,
      agent_id: agent_id || process.env.RETELL_AGENT_ID, // Allow override
      custom_fields: {
        name,
        email,
        prompt,
        tags
      }
    }, {
      headers: {
        Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Retell call triggered successfully:', response.data);

    res.status(200).json({
      success: true,
      message: 'Call triggered successfully.',
      retell_response: response.data
    });
  } catch (error) {
    const err = error.response?.data || error.message;
    console.error('❌ Error triggering Retell call:', err);

    res.status(500).json({
      success: false,
      message: 'Failed to trigger call.',
      error: err
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Trigger server running on port ${PORT}`);
});
