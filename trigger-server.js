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

// Set the default Make.com webhook URL
const DEFAULT_MAKE_WEBHOOK_URL = 'https://hook.us2.make.com/6wsdtorhmrpxbical1czq09pmurffoei';

// Helper function to parse a date and time string
function parseDateTime(dateStr, timeStr) {
  try {
    // Handle common day formats
    const days = {
      'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4,
      'friday': 5, 'saturday': 6, 'sunday': 0,
      'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6, 'sun': 0
    };
    
    const now = new Date();
    const currentDay = now.getDay();
    
    // Extract day from string
    let targetDay = null;
    for (const [dayName, dayNumber] of Object.entries(days)) {
      if (dateStr.toLowerCase().includes(dayName)) {
        targetDay = dayNumber;
        break;
      }
    }
    
    if (targetDay === null) {
      throw new Error(`Could not parse day from "${dateStr}"`);
    }
    
    // Calculate days to add
    let daysToAdd = targetDay - currentDay;
    if (daysToAdd <= 0) {
      daysToAdd += 7; // Move to next week if day has passed
    }
    
    // Create target date
    const targetDate = new Date(now);
    targetDate.setDate(now.getDate() + daysToAdd);
    targetDate.setHours(0, 0, 0, 0);
    
    // Parse time
    // Example formats: "11am", "11:00 AM", "2pm", "14:00"
    let hours = 0;
    let minutes = 0;
    
    // Remove all spaces from time string
    const cleanTime = timeStr.toLowerCase().replace(/\s+/g, '');
    
    if (cleanTime.includes(':')) {
      // Format like "11:00am"
      const timeParts = cleanTime.split(':');
      hours = parseInt(timeParts[0], 10);
      
      if (timeParts[1].includes('pm') && hours < 12) {
        hours += 12;
      } else if (timeParts[1].includes('am') && hours === 12) {
        hours = 0;
      }
      
      minutes = parseInt(timeParts[1].replace(/[^\d]/g, ''), 10);
    } else {
      // Format like "11am"
      hours = parseInt(cleanTime.replace(/[^\d]/g, ''), 10);
      if (cleanTime.includes('pm') && hours < 12) {
        hours += 12;
      } else if (cleanTime.includes('am') && hours === 12) {
        hours = 0;
      }
      minutes = 0;
    }
    
    // Set time on target date
    targetDate.setHours(hours, minutes, 0, 0);
    
    // Create end time (1 hour later)
    const endDate = new Date(targetDate);
    endDate.setHours(endDate.getHours() + 1);
    
    return {
      startTime: targetDate.toISOString(),
      endTime: endDate.toISOString(),
      formattedDate: targetDate.toLocaleDateString(),
      formattedTime: targetDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    };
  } catch (error) {
    console.error('Error parsing date/time:', error);
    throw new Error(`Failed to parse date "${dateStr}" and time "${timeStr}": ${error.message}`);
  }
}

// Enhanced helper function to send data to Make.com webhook
async function notifyMakeWebhook(data) {
  console.log('🚀 PREPARING TO SEND DATA TO MAKE.COM WEBHOOK:', JSON.stringify(data, null, 2));
  
  try {
    // Add timestamp to webhook data
    const webhookData = {
      ...data,
      timestamp: new Date().toISOString(),
      webhook_version: '1.1'
    };
    
    console.log('📤 SENDING DATA TO MAKE.COM WEBHOOK:', JSON.stringify(webhookData, null, 2));
    
    const response = await axios.post(DEFAULT_MAKE_WEBHOOK_URL, webhookData, {
      timeout: 10000, // 10 second timeout
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Source': 'Nexella-Server'
      }
    });
    
    console.log(`✅ DATA SENT TO MAKE.COM WEBHOOK. Response status: ${response.status}`);
    console.log(`✅ RESPONSE DETAILS:`, JSON.stringify(response.data || {}, null, 2));
    return true;
  } catch (error) {
    console.error(`❌ ERROR SENDING DATA TO MAKE.COM WEBHOOK: ${error.message}`);
    if (error.response) {
      console.error('❌ RESPONSE ERROR DETAILS:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    } else if (error.request) {
      console.error('❌ REQUEST ERROR: No response received', error.request);
    } else {
      console.error('❌ SETUP ERROR:', error.message);
    }
    
    // Retry logic
    console.log('🔄 Attempting to retry webhook notification in 3 seconds...');
    setTimeout(async () => {
      try {
        const retryResponse = await axios.post(DEFAULT_MAKE_WEBHOOK_URL, data);
        console.log(`✅ RETRY SUCCESSFUL. Response status: ${retryResponse.status}`);
      } catch (retryError) {
        console.error(`❌ RETRY FAILED: ${retryError.message}`);
      }
    }, 3000);
    
    return false;
  }
}

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

// Test endpoint to directly send a webhook to Make.com
app.get('/test-webhook', async (req, res) => {
  try {
    const testData = {
      name: "Test User",
      email: "test@example.com",
      phone: "+12345678900",
      call_id: "test123",
      schedulingComplete: true,
      appointmentDate: "May 5, 2025",
      appointmentTime: "10:00 AM",
      schedulingLink: "https://calendly.com/nexella/30min" // Changed from calendlyLink to schedulingLink
    };
    
    console.log('Sending valid Calendly webhook data:', testData);
    
    const success = await notifyMakeWebhook(testData);
    
    res.status(200).json({
      success,
      message: success ? 'Test webhook sent successfully' : 'Failed to send test webhook',
      data: testData
    });
  } catch (error) {
    console.error('Error in test-webhook endpoint:', error);
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Trigger server running on port ${PORT}`);
});json({
      success: false,
      error: error.message
    });
  }
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

// Updated endpoint to trigger a Retell call using SDK
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
            make_webhook_url: DEFAULT_MAKE_WEBHOOK_URL
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
          make_webhook_url: DEFAULT_MAKE_WEBHOOK_URL
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

// UPDATED: Modified endpoint for sending scheduling link instead of direct booking
app.post('/send-scheduling-link', async (req, res) => {
  try {
    const { 
      call_id, 
      name, 
      email, 
      phone, 
      preferredDay,
      preferredTime,
      userId
    } = req.body;
    
    console.log('Received scheduling link request:', { 
      call_id, name, email, phone, preferredDay, preferredTime
    });
    
    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Missing email address for scheduling link"
      });
    }
    
    // Get the Calendly scheduling link from env or config
    const schedulingLink = process.env.CALENDLY_SCHEDULING_LINK || 'https://calendly.com/nexella/30min';
    
    // Check if call record exists and update it
    if (call_id) {
      const callRecord = activeCalls.get(call_id);
      if (callRecord) {
        callRecord.schedulingComplete = true;
        callRecord.state = 'scheduling_link_sent';
        callRecord.preferredDay = preferredDay;
        callRecord.preferredTime = preferredTime;
        activeCalls.set(call_id, callRecord);
      }
    }
    
    // Format date/time if provided
    const formattedDate = preferredDay || '';
    const formattedTime = preferredTime || '';
    
    // Prepare webhook data with scheduling link
    const webhookData = {
      name,
      email,
      phone,
      preferredDay: formattedDate,
      preferredTime: formattedTime,
      schedulingLink, // This is the key change - sending a link instead of booking directly
      call_id,
      schedulingComplete: true
    };
    
    console.log('📤 Sending webhook notification with scheduling link details:', webhookData);
    const webhookSent = await notifyMakeWebhook(webhookData);
    
    res.status(200).json({
      success: true,
      message: 'Scheduling link will be sent via email',
      schedulingLink,
      webhookNotified: webhookSent
    });
  } catch (error) {
    console.error('❌ Error in send-scheduling-link endpoint:', error);
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
    
    console.log(`🔍 RECEIVED WEBHOOK FROM RETELL:`, JSON.stringify(req.body, null, 2));
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
            
            // Notify that call has ended
            await notifyMakeWebhook({
              name: callRecord.name,
              email: callRecord.email,
              phone: callRecord.phone,
              call_id: call.call_id,
              call_status: 'ended',
              schedulingComplete: callRecord.schedulingComplete || false
            });
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
            if (!callRecord.schedulingComplete && call.metadata?.needs_scheduling) {
              console.log(`Call ${call.call_id} ended without scheduling link being sent. Sending data to Make.com.`);
              
              // Send notification to make.com webhook with scheduling data
              await notifyMakeWebhook({
                name: callRecord.name,
                email: callRecord.email,
                phone: callRecord.phone,
                call_id: call.call_id,
                call_status: 'analyzed',
                schedulingComplete: callRecord.schedulingComplete || false,
                schedulingData: schedulingData,
                needs_followup: true
              });
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
      
      // If discovery is complete, notify webhook
      if (discoveryComplete) {
        await notifyMakeWebhook({
          name: callRecord.name,
          email: callRecord.email,
          phone: callRecord.phone,
          call_id,
          discoveryComplete: true
        });
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
      
      // Send scheduling data to webhook
      await notifyMakeWebhook({
        name: callRecord.name,
        email: callRecord.email,
        phone: callRecord.phone,
        call_id,
        schedulingData
      });
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

// UPDATED: New endpoint for handling preferred scheduling times and sending links
app.post('/process-scheduling-preference', async (req, res) => {
  try {
    const { 
      name, 
      email, 
      phone, 
      preferredDay,
      preferredTime,
      userId, 
      call_id
    } = req.body;

    console.log('Received scheduling preference:', { 
      name, email, phone, preferredDay, preferredTime, userId, call_id 
    });

    if (!email) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing email address" 
      });
    }

    // Get the Calendly scheduling link
    const schedulingLink = process.env.CALENDLY_SCHEDULING_LINK || 'https://calendly.com/nexella/30min';
    
    // Update call record if this is associated with a call
    if (call_id && activeCalls.has(call_id)) {
      const callRecord = activeCalls.get(call_id);
      callRecord.schedulingComplete = true;
      callRecord.preferredDay = preferredDay;
      callRecord.preferredTime = preferredTime;
      activeCalls.set(call_id, callRecord);
    }

    // Format date/time strings for display
    const formattedDay = preferredDay || 'preferred day';
    const formattedTime = preferredTime || 'preferred time';

    // Prepare webhook data
    const webhookData = {
      name,
      email,
      phone,
      preferredDay: formattedDay,
      preferredTime: formattedTime,
      schedulingLink,
      call_id,
      schedulingComplete: true
    };
    
    // Log and send webhook data
    console.log('📤 Sending Make.com webhook for scheduling preference:', webhookData);
    const webhookSent = await notifyMakeWebhook(webhookData);

    res.status(200).json({
      success: true,
      message: 'Scheduling preferences processed and link will be sent',
      schedulingLink,
      webhookSent,
      preferredDay: formattedDay,
      preferredTime: formattedTime
    });
  } catch (error) {
    console.error('❌ Error in process-scheduling-preference endpoint:', error);
    res.status(500).json({
      success: false,
      error: "Internal server error: " + error.message
    });
  }
});

// Simple endpoint to manually trigger a scheduling email
app.get('/manual-webhook', async (req, res) => {
  try {
    const testData = {
      name: req.query.name || "Test User",
      email: req.query.email || "test@example.com",
      phone: req.query.phone || "+12345678900",
      schedulingComplete: true,
      preferredDay: req.query.day || "Monday",
      preferredTime: req.query.time || "11:00 AM",
      schedulingLink: process.env.CALENDLY_SCHEDULING_LINK || "https://calendly.com/nexella/30min"
    };
    
    console.log('Sending manual webhook data:', testData);
    
    const success = await notifyMakeWebhook(testData);
    
    res.status(200).json({
      success,
      message: success ? 'Webhook sent successfully' : 'Failed to send webhook',
      data: testData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Manual webhook trigger for testing
app.post('/manual-webhook', async (req, res) => {
  try {
    const webhookData = req.body;
    
    if (!webhookData || Object.keys(webhookData).length === 0) {
      return res.status(400).json({
        success: false,
        error: "Missing webhook data"
      });
    }
    
    // Add required fields if missing
    if (!webhookData.schedulingComplete) {
      webhookData.schedulingComplete = true;
    }
    
    console.log('📤 Manually triggering webhook with data:', webhookData);
    const success = await notifyMakeWebhook(webhookData);
    
    res.status(200).json({
      success,
      message: success ? "Webhook sent successfully" : "Failed to send webhook",
      data: webhookData
    });
  } catch (error) {
    console.error('❌ Error in manual-webhook endpoint:', error);
    res.status(500).json({
      success: false,
      error: error.message
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
    
    res.status(500).
