require('dotenv').config();
const express = require('express');
const axios = require('axios');
const Retell = require('retell-sdk').default;
const { 
  lockSlot, 
  confirmSlot, 
  releaseSlot, 
  isSlotAvailable, 
  getAvailableSlots 
} = require('./slot-manager');

const app = express();
app.use(express.json());

// Initialize Retell SDK client
let retellClient = null;
try {
  retellClient = new Retell({
    apiKey: process.env.RETELL_API_KEY,
  });
  console.log('✅ Retell client initialized successfully');
} catch (error) {
  console.error('❌ Error initializing Retell client:', error.message);
}

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toLocaleString();
  console.log(`${timestamp} ${req.method} ${req.path}`);
  next();
});

// Store active calls for tracking state
const activeCalls = new Map();

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('Trigger server is healthy.');
});

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

// Updated endpoint to trigger a Retell call using SDK with Make.com webhook URL
app.post('/trigger-retell-call', async (req, res) => {
  try {
    const { name, email, phone, userId, make_webhook_url } = req.body;
    
    if (!phone) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing phone number field" 
      });
    }
    
    console.log('Triggering Retell call with:', { name, email, phone });
    
    // First try using the SDK
    if (retellClient) {
      try {
        const response = await retellClient.call.createPhoneCall({
          from_number: process.env.RETELL_FROM_NUMBER,
          to_number: phone,
          agent_id: process.env.RETELL_AGENT_ID,
          metadata: {
            customer_name: name || "",
            customer_email: email || "",
            user_id: userId || `user_${Date.now()}`,
            needs_scheduling: true,
            call_source: "website_form",
            make_webhook_url: make_webhook_url || ""
          }
        });
        
        // Store the call in our active calls map
        const callId = response.call_id;
        activeCalls.set(callId, {
          id: callId,
          phone,
          name,
          email,
          userId: userId || `user_${Date.now()}`,
          make_webhook_url: make_webhook_url || "",
          startTime: Date.now(),
          state: 'initiated',
          discoveryComplete: false,
          schedulingComplete: false
        });
        
        console.log('✅ Retell outbound call initiated with SDK:', response);
        return res.status(200).json({
          success: true,
          message: 'Outbound call initiated successfully',
          call_id: response.call_id
        });
      } catch (sdkError) {
        console.error('❌ SDK Error initiating Retell call:', sdkError);
        // Fall through to the axios fallback
      }
    }
    
    // Fallback to direct axios call if SDK fails or isn't initialized
    try {
      const response = await axios.post('https://api.retellai.com/v1/calls', {
        from_number: process.env.RETELL_FROM_NUMBER,
        to_number: phone,
        agent_id: process.env.RETELL_AGENT_ID,
        metadata: {
          customer_name: name || "",
          customer_email: email || "",
          user_id: userId || `user_${Date.now()}`,
          needs_scheduling: true,
          call_source: "website_form",
          make_webhook_url: make_webhook_url || ""
        }
      }, {
        headers: {
          Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      
      // Store the call in our active calls map
      const callId = response.data.call_id;
      activeCalls.set(callId, {
        id: callId,
        phone,
        name,
        email,
        userId: userId || `user_${Date.now()}`,
        make_webhook_url: make_webhook_url || "",
        startTime: Date.now(),
        state: 'initiated',
        discoveryComplete: false,
        schedulingComplete: false
      });
      
      console.log('✅ Retell outbound call initiated with axios:', response.data);
      return res.status(200).json({
        success: true,
        message: 'Outbound call initiated successfully',
        call_id: response.data.call_id
      });
    } catch (error) {
      console.error('❌ Error initiating Retell call:', error.response?.data || error.message);
      return res.status(500).json({
        success: false,
        error: error.response?.data || error.message
      });
    }
  } catch (error) {
    console.error('❌ Error in trigger-retell-call endpoint:', error);
    res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
});

// New endpoint for scheduling after discovery (called by Retell AI agent)
app.post('/schedule-calendly', async (req, res) => {
  try {
    const { 
      call_id, 
      name, 
      email, 
      phone, 
      startTime, 
      endTime, 
      userId 
    } = req.body;
    
    console.log('Received calendly scheduling request:', { 
      call_id, name, email, phone, startTime, endTime 
    });
    
    // Verify that discovery is complete if we're tracking this call
    const callRecord = activeCalls.get(call_id);
    if (callRecord && !callRecord.discoveryComplete) {
      console.log(`⚠️ Attempted to schedule before discovery complete for call ${call_id}`);
      
      // Continue anyway since the AI agent is responsible for ensuring discovery is done
    }
    
    // Do the Calendly scheduling
    if (startTime && endTime) {
      // Step 1: Attempt to lock the slot
      const userIdToUse = userId || (callRecord ? callRecord.userId : `user_${Date.now()}`);
      const locked = lockSlot(startTime, userIdToUse);
      if (!locked) {
        return res.status(409).json({ 
          success: false, 
          error: "Slot is already locked by another user." 
        });
      }

      // Step 2: Confirm the lock
      if (!confirmSlot(startTime, userIdToUse)) {
        return res.status(409).json({ 
          success: false, 
          error: "Slot is no longer available." 
        });
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
      const eventTypeUri = process.env.CALENDLY_EVENT_TYPE_URI;
      if (!eventTypeUri) {
        return res.status(400).json({ 
          success: false, 
          error: "Missing event type URI." 
        });
      }

      try {
        const calendlyResponse = await axios.post('https://api.calendly.com/scheduled_events', {
          event_type: eventTypeUri,
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

        // Update call record if available
        if (callRecord) {
          callRecord.schedulingComplete = true;
          callRecord.state = 'scheduled';
          callRecord.appointmentTime = startTime;
          activeCalls.set(call_id, callRecord);
          
          // Send notification to make.com if webhook URL was provided
          if (callRecord.make_webhook_url) {
            try {
              await axios.post(callRecord.make_webhook_url, {
                name,
                email,
                phone,
                appointmentDate: new Date(startTime).toLocaleDateString(),
                appointmentTime: new Date(startTime).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true
                }),
                calendlyLink: calendlyResponse.data.uri,
                call_id,
                schedulingComplete: true
              });
              console.log('✅ Booking information sent to make.com webhook:', callRecord.make_webhook_url);
            } catch (makeError) {
              console.error('❌ Error sending to make.com webhook:', makeError.message);
            }
          } else {
            // Default webhook if no custom one provided
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
                calendlyLink: calendlyResponse.data.uri,
                call_id
              });
              console.log('✅ Booking information sent to default make.com webhook');
            } catch (makeError) {
              console.error('❌ Error sending to default make.com webhook:', makeError.message);
            }
          }
        }

        res.status(200).json({
          success: true,
          message: 'Call scheduled successfully.',
          calendly_response: calendlyResponse.data
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
    } else {
      return res.status(400).json({
        success: false,
        error: "Missing required scheduling information."
      });
    }
  } catch (error) {
    console.error('❌ Error in schedule-calendly endpoint:', error);
    res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
});

// Enhanced webhook endpoint for receiving events from Retell
app.post('/retell-webhook', express.json(), async (req, res) => {
  try {
    const { event, call } = req.body;
    
    console.log(`Received Retell webhook event: ${event}`);
    
    if (call && call.call_id) {
      console.log(`Call ID: ${call.call_id}, Status: ${call.call_status}`);
      
      // Update our internal call record
      const callRecord = activeCalls.get(call.call_id);
      
      if (callRecord) {
        // Update call state based on event
        switch (event) {
          case 'call_started':
            callRecord.state = 'in_progress';
            break;
            
          case 'call_ended':
            callRecord.state = 'ended';
            
            // If we have a make.com webhook URL, notify that call has ended
            if (callRecord.make_webhook_url) {
              try {
                await axios.post(callRecord.make_webhook_url, {
                  call_id: call.call_id,
                  name: callRecord.name,
                  email: callRecord.email,
                  phone: callRecord.phone,
                  call_status: 'ended',
                  schedulingComplete: callRecord.schedulingComplete || false
                });
                console.log('✅ Call ended notification sent to make.com webhook');
              } catch (makeError) {
                console.error('❌ Error sending call ended notification to make.com:', makeError.message);
              }
            }
            break;
            
          case 'call_analyzed':
            callRecord.state = 'analyzed';
            
            // Extract scheduling data from the call analysis if available
            let schedulingData = null;
            
            if (call.analysis && call.analysis.custom_data) {
              try {
                // Try to parse any scheduling data that might be in the analysis
                if (typeof call.analysis.custom_data === 'string') {
                  const parsedData = JSON.parse(call.analysis.custom_data);
                  if (parsedData.scheduling || parsedData.appointmentInfo) {
                    schedulingData = parsedData.scheduling || parsedData.appointmentInfo;
                    console.log('✅ Extracted scheduling data from call analysis:', schedulingData);
                  }
                } else if (call.analysis.custom_data.scheduling || call.analysis.custom_data.appointmentInfo) {
                  schedulingData = call.analysis.custom_data.scheduling || call.analysis.custom_data.appointmentInfo;
                  console.log('✅ Extracted scheduling data from call analysis:', schedulingData);
                }
              } catch (parseError) {
                console.error('❌ Error parsing call analysis custom data:', parseError.message);
              }
            }
            
            // Now that call is analyzed, check if scheduling was completed
            // If not, we might want to send a follow-up email/SMS
            if (!callRecord.schedulingComplete && call.metadata?.needs_scheduling) {
              console.log(`Call ${call.call_id} ended without scheduling. Sending data to Make.com.`);
              
              // Send notification to make.com webhook if URL was provided
              if (callRecord.make_webhook_url) {
                try {
                  await axios.post(callRecord.make_webhook_url, {
                    call_id: call.call_id,
                    name: callRecord.name,
                    email: callRecord.email,
                    phone: callRecord.phone,
                    call_status: 'analyzed',
                    schedulingComplete: callRecord.schedulingComplete || false,
                    schedulingData: schedulingData,
                    needs_followup: true
                  });
                  console.log('✅ Call analysis with scheduling data sent to make.com webhook');
                } catch (makeError) {
                  console.error('❌ Error sending to make.com webhook:', makeError.message);
                }
              } else {
                // Optional: Send follow-up notification to default webhook
                try {
                  await axios.post('https://hook.us2.make.com/6wsdtorhmrpxbical1czq09pmurffoei', {
                    name: callRecord.name,
                    email: callRecord.email,
                    phone: callRecord.phone,
                    call_id: call.call_id,
                    needs_followup: true,
                    schedulingData: schedulingData
                  });
                  
                  console.log('✅ Follow-up notification sent to default webhook');
                } catch (makeError) {
                  console.error('❌ Error sending follow-up notification:', makeError.message);
                }
              }
            }
            
            // Clean up call record after some time
            setTimeout(() => {
              activeCalls.delete(call.call_id);
              console.log(`Cleaned up call record for ${call.call_id}`);
            }, 24 * 60 * 60 * 1000); // 24 hours
            
            break;
        }
        
        // Update the record
        activeCalls.set(call.call_id, callRecord);
      }
    }
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error handling Retell webhook:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update conversation state from Retell agent
app.post('/update-conversation', express.json(), async (req, res) => {
  try {
    const { call_id, discoveryComplete, selectedSlot, schedulingData } = req.body;
    
    if (!call_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing call_id'
      });
    }
    
    // Get the call record
    const callRecord = activeCalls.get(call_id);
    if (!callRecord) {
      return res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }
    
    // Update discovery state if provided
    if (discoveryComplete !== undefined) {
      callRecord.discoveryComplete = discoveryComplete;
      console.log(`Updated discovery state for call ${call_id}: ${discoveryComplete}`);
      
      // If discovery is complete and we have a make.com webhook URL, notify
      if (discoveryComplete && callRecord.make_webhook_url) {
        try {
          await axios.post(callRecord.make_webhook_url, {
            call_id,
            name: callRecord.name,
            email: callRecord.email,
            phone: callRecord.phone,
            discoveryComplete: true
          });
          console.log('✅ Discovery complete notification sent to make.com webhook');
        } catch (makeError) {
          console.error('❌ Error sending discovery notification to make.com:', makeError.message);
        }
      }
    }
    
    // Update selected slot if provided
    if (selectedSlot) {
      callRecord.selectedSlot = selectedSlot;
      console.log(`Updated selected slot for call ${call_id}: ${JSON.stringify(selectedSlot)}`);
    }
    
    // Update scheduling data if provided
    if (schedulingData) {
      callRecord.schedulingData = schedulingData;
      console.log(`Updated scheduling data for call ${call_id}: ${JSON.stringify(schedulingData)}`);
      
      // If we have scheduling data and a make.com webhook URL, send the data to make.com
      if (callRecord.make_webhook_url) {
        try {
          await axios.post(callRecord.make_webhook_url, {
            call_id,
            name: callRecord.name,
            email: callRecord.email,
            phone: callRecord.phone,
            schedulingData
          });
          console.log('✅ Scheduling data sent to make.com webhook');
        } catch (makeError) {
          console.error('❌ Error sending scheduling data to make.com:', makeError.message);
        }
      }
    }
    
    // Save the updated record
    activeCalls.set(call_id, callRecord);
    
    res.status(200).json({
      success: true,
      callRecord
    });
  } catch (error) {
    console.error('Error updating conversation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint where AI sends final picked slot for scheduling
app.post('/schedule-appointment', async (req, res) => {
  const { name, email, phone, eventTypeUri, startTime, endTime, userId, call_id } = req.body;

  console.log('Received scheduling request:', { name, email, phone, startTime, endTime, userId, call_id });

  if (!phone) {
    return res.status(400).json({ success: false, error: "Missing phone number field." });
  }

  // Check if this is associated with an active call
  if (call_id) {
    const callRecord = activeCalls.get(call_id);
    if (callRecord && !callRecord.discoveryComplete) {
      console.log(`⚠️ Warning: Attempted to schedule for call ${call_id} before discovery is complete`);
      // You might want to prevent scheduling here, but we'll allow it to proceed anyway
    }
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

      // Update call record if this is associated with a call
      if (call_id && activeCalls.has(call_id)) {
        const callRecord = activeCalls.get(call_id);
        callRecord.schedulingComplete = true;
        callRecord.appointmentTime = startTime;
        activeCalls.set(call_id, callRecord);
        
        // If we have a make.com webhook URL, send the scheduling confirmation
        if (callRecord.make_webhook_url) {
          try {
            await axios.post(callRecord.make_webhook_url, {
              call_id,
              name,
              email,
              phone,
              appointmentDate: new Date(startTime).toLocaleDateString(),
              appointmentTime: new Date(startTime).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
              }),
              calendlyLink: calendlyResponse.data.uri,
              schedulingComplete: true
            });
            console.log('✅ Booking confirmation sent to make.com webhook');
          } catch (makeError) {
            console.error('❌ Error sending to make.com webhook:', makeError.message);
          }
        } else {
          // Use default webhook
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
              calendlyLink: calendlyResponse.data.uri,
              call_id
            });
            console.log('✅ Booking information sent to default make.com webhook');
          } catch (makeError) {
            console.error('❌ Error sending to default make.com webhook:', makeError.message);
          }
        }
      } else {
        // No associated call - use default webhook
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
          console.log('✅ Booking information sent to default make.com webhook');
        } catch (makeError) {
          console.error('❌ Error sending to default make.com webhook:', makeError.message);
        }
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
    });
  }
});

// Test endpoint for Retell API using the SDK
app.get('/test-retell-api', async (req, res) => {
  try {
    // First try with SDK
    if (retellClient) {
      try {
        const agents = await retellClient.agent.list();
        
        return res.status(200).json({
          success: true,
          message: 'Successfully connected to Retell API using SDK',
          agents_count: agents.agents?.length || 0,
          method: 'sdk'
        });
      } catch (sdkError) {
        console.error('❌ SDK Error connecting to Retell API:', sdkError);
        // Fall through to axios fallback
      }
    }
    
    // Fallback to axios
    if (!process.env.RETELL_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "Missing RETELL_API_KEY environment variable"
      });
    }
    
    const response = await axios.get('https://api.retellai.com/v1/agents', {
      headers: {
        Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    res.status(200).json({
      success: true,
      message: 'Successfully connected to Retell API using axios',
      agents_count: response.data.agents?.length || 0,
      method: 'axios'
    });
  } catch (error) {
    console.error('❌ Error connecting to Retell API:', error.response?.data || error.message);
    
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
