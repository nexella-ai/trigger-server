require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

<<<<<<< HEAD
// Health check
=======
// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toLocaleString();
  console.log(`${timestamp} ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
>>>>>>> 69ea29e (initial commit of trigger server with Retell integration)
app.get('/health', (req, res) => {
  res.status(200).send('Trigger server is healthy.');
});

<<<<<<< HEAD
// ✅ Simple endpoint to trigger a Retell call
app.post('/trigger-retell-call', async (req, res) => {
  const { name, email, phone, userId } = req.body;

  if (!phone) {
    return res.status(400).json({
      success: false,
      error: "Missing phone number field"
=======
// Endpoint to check slot availability
app.get('/check-availability', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;

    if (!startTime || !endTime) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing startTime or endTime" 
      });
    }

    const available = await isSlotAvailable(startTime, endTime);

    res.status(200).json({
      success: true,
      available
    });
  } catch (error) {
    console.error('Error checking availability:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint to get available slots for a date
app.get('/available-slots', async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing date parameter" 
      });
    }

    const availableSlots = await getAvailableSlots(date);

    res.status(200).json({
      success: true,
      availableSlots
    });
  } catch (error) {
    console.error('Error getting available slots:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint to lock a slot
app.post('/lock-slot', (req, res) => {
  try {
    const { startTime, endTime, userId } = req.body;

    if (!startTime || !userId) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing required fields" 
      });
    }

    const success = lockSlot(startTime, userId);

    res.status(success ? 200 : 409).json({
      success,
      message: success ? "Slot locked successfully" : "Slot is already locked"
    });
  } catch (error) {
    console.error('Error locking slot:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint to release a slot
app.post('/release-slot', (req, res) => {
  try {
    const { startTime, userId } = req.body;

    if (!startTime || !userId) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing required fields" 
      });
    }

    const success = releaseSlot(startTime, userId);

    res.status(success ? 200 : 404).json({
      success,
      message: success ? "Slot released successfully" : "No matching lock found"
    });
  } catch (error) {
    console.error('Error releasing slot:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint where AI sends final picked slot for scheduling
app.post('/schedule-appointment', async (req, res) => {
  const { name, email, phone, eventTypeUri, startTime, endTime, userId } = req.body;

  console.log('Received scheduling request:', { name, email, phone, startTime, endTime, userId });

  if (!phone) {
    return res.status(400).json({ success: false, error: "Missing phone number field." });
  }

  // Try to book a Calendly event
  if (startTime && endTime && userId) {
    // Step 1: Attempt to lock the slot
    const locked = lockSlot(startTime, userId);
    if (!locked) {
      return res.status(409).json({ success: false, error: "Slot is already locked by another user." });
    }

    // Step 2: Confirm the lock
    if (!confirmSlot(startTime, userId)) {
      return res.status(409).json({ success: false, error: "Slot is no longer available." });
    }

    // Step 3: Check Calendly to make sure it hasn't been taken externally
    try {
      const available = await isSlotAvailable(startTime, endTime);
      if (!available) {
        console.log("❌ That time slot is already booked.");
        return res.status(409).json({
          success: false,
          error: "That time slot is already booked. Please choose another."
        });
      }
    } catch (checkErr) {
      console.error("Error while checking slot availability:", checkErr);
      return res.status(500).json({
        success: false,
        error: "Error checking Calendly availability."
      });
    }

    // Step 4: Create the event
    const eventType = eventTypeUri || process.env.CALENDLY_EVENT_TYPE_URI;
    if (!eventType) {
      return res.status(400).json({ success: false, error: "Missing event type URI." });
    }

    try {
      const calendlyResponse = await axios.post('https://api.calendly.com/scheduled_events', {
        event_type: eventType,
        invitee: {
          name: name || "Guest",
          email,
          phone_number: phone
        },
        start_time: startTime,
        end_time: endTime,
        timezone: "America/Los_Angeles"
      }, {
        headers: {
          Authorization: `Bearer ${process.env.CALENDLY_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('✅ Meeting booked on Calendly:', calendlyResponse.data);

      try {
        await axios.post('https://hook.us2.make.com/6wsdtorhmrpxbical1czq09pmurffoei', {
          name,
          email,
          phone,
          appointmentDate: new Date(startTime).toLocaleDateString(),
          appointmentTime: new Date(startTime).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          }),
          calendlyLink: calendlyResponse.data.uri
        });
        console.log('✅ Booking information sent to make.com');
      } catch (makeError) {
        console.error('❌ Error sending to make.com:', makeError.message);
      }

      res.status(200).json({
        success: true,
        message: 'Call scheduled successfully.',
        calendly_response: calendlyResponse.data
      });
      return;
    } catch (error) {
      const err = error.response?.data || error.message;
      console.error('❌ Error booking meeting:', err);

      res.status(500).json({
        success: false,
        message: 'Failed to schedule meeting.',
        error: err
      });
      return;
    }
  } else {
    return res.status(400).json({
      success: false,
      error: "Missing required scheduling information."
>>>>>>> 69ea29e (initial commit of trigger server with Retell integration)
    });
  }

<<<<<<< HEAD
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
=======
// Endpoint to trigger a Retell call without scheduling
app.post('/trigger-retell-call', async (req, res) => {
  try {
    const { name, email, phone, userId } = req.body;
    
    if (!phone) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing phone number field" 
      });
    }
    
    console.log('Triggering Retell call with:', { name, email, phone });
    
    // Make sure we have the required environment variables
    if (!process.env.RETELL_API_KEY) {
      console.error('❌ Missing RETELL_API_KEY environment variable');
      return res.status(500).json({
        success: false,
        error: "Server configuration error: Missing API key"
      });
    }
    
    if (!process.env.RETELL_FROM_NUMBER) {
      console.error('❌ Missing RETELL_FROM_NUMBER environment variable');
      return res.status(500).json({
        success: false,
        error: "Server configuration error: Missing from number"
      });
    }
    
    if (!process.env.RETELL_AGENT_ID) {
      console.error('❌ Missing RETELL_AGENT_ID environment variable');
      return res.status(500).json({
        success: false,
        error: "Server configuration error: Missing agent ID"
      });
    }
    
    // Make outbound call with Retell
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
      // More detailed error logging
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response headers:', error.response.headers);
        console.error('Response data:', error.response.data);
      } else if (error.request) {
        console.error('No response received:', error.request);
      } else {
        console.error('Error setting up request:', error.message);
      }
      console.error('Error config:', error.config);
      
      res.status(500).json({
        success: false,
        error: error.response?.data || error.message
      });
    }
>>>>>>> 69ea29e (initial commit of trigger server with Retell integration)
  } catch (error) {
    console.error('❌ Error in trigger-retell-call endpoint:', error);
    res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Trigger server running on port ${PORT}`);
});
