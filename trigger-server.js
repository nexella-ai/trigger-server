// Updated trigger-server.js with Google Calendar integration
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const Retell = require('retell-sdk').default;
const GoogleCalendarService = require('./google-calendar-service'); // NEW: Import Google Calendar service

const app = express();
app.use(express.json());

// Initialize Google Calendar service
const calendarService = new GoogleCalendarService();

// Set the default n8n webhook URL - UPDATED FOR N8N
const DEFAULT_N8N_WEBHOOK_URL = 'https://n8n-clp2.onrender.com/webhook/retell-scheduling';

// Helper function to parse a date string
function parseDate(dateStr) {
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
    
    return {
      date: targetDate.toISOString(),
      formattedDate: targetDate.toLocaleDateString()
    };
  } catch (error) {
    console.error('Error parsing date:', error);
    throw new Error(`Failed to parse date "${dateStr}": ${error.message}`);
  }
}

// Enhanced helper function to send data to n8n webhook with Google Calendar data
async function notifyN8nWebhook(data) {
  console.log('🚀 PREPARING TO SEND DATA TO N8N WEBHOOK:', JSON.stringify(data, null, 2));
  
  try {
    // Format discovery data if present
    if (data.discovery_data) {
      // Format the discovery data into a structured format for Airtable
      const formattedDiscoveryData = {};
      
      // Map discovery questions to better field names
      const questionMapping = {
        'question_0': 'How did you hear about us',
        'question_1': 'Business/Industry',
        'question_2': 'Main product',
        'question_3': 'Running ads',
        'question_4': 'Using CRM',
        'question_5': 'Pain points'
      };
      
      // Process discovery data into formatted fields
      Object.entries(data.discovery_data).forEach(([key, value]) => {
        if (questionMapping[key]) {
          formattedDiscoveryData[questionMapping[key]] = value;
        } else {
          formattedDiscoveryData[key] = value;
        }
      });
      
      // Add formatted discovery data
      data.formatted_discovery = formattedDiscoveryData;
      
      // Create a formatted notes field combining all discovery answers
      let notes = "";
      Object.entries(formattedDiscoveryData).forEach(([question, answer]) => {
        notes += `${question}: ${answer}\n\n`;
      });
      
      // Add notes field for Airtable
      if (notes) {
        data.notes = notes.trim();
      }
    }
    
    // Add timestamp to webhook data
    const webhookData = {
      ...data,
      timestamp: new Date().toISOString(),
      webhook_version: '1.2', // Updated version for Google Calendar
      // NEW: Google Calendar specific fields
      calendar_platform: 'google',
      booking_method: data.calendar_booking ? 'automatic' : 'manual'
    };
    
    console.log('📤 SENDING DATA TO N8N WEBHOOK:', JSON.stringify(webhookData, null, 2));
    
    const response = await axios.post(DEFAULT_N8N_WEBHOOK_URL, webhookData, {
      timeout: 10000, // 10 second timeout
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Source': 'Nexella-Server',
        'X-Calendar-Platform': 'google'
      }
    });
    
    console.log(`✅ DATA SENT TO N8N WEBHOOK. Response status: ${response.status}`);
    console.log(`✅ RESPONSE DETAILS:`, JSON.stringify(response.data || {}, null, 2));
    return true;
  } catch (error) {
    console.error(`❌ ERROR SENDING DATA TO N8N WEBHOOK: ${error.message}`);
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
        const retryResponse = await axios.post(DEFAULT_N8N_WEBHOOK_URL, data);
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
  res.status(200).send('Trigger server is healthy with Google Calendar integration.');
});

// NEW: Endpoint to check Google Calendar availability
app.get('/check-availability', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;

    if (!startTime || !endTime) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing startTime or endTime" 
      });
    }

    const available = await calendarService.isSlotAvailable(startTime, endTime);

    res.status(200).json({
      success: true,
      available,
      platform: 'google_calendar'
    });
  } catch (error) {
    console.error('Error checking availability:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// NEW: Endpoint to get available slots from Google Calendar
app.get('/available-slots', async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing date parameter" 
      });
    }

    const availableSlots = await calendarService.getAvailableSlots(date);

    res.status(200).json({
      success: true,
      availableSlots,
      platform: 'google_calendar',
      date: date
    });
  } catch (error) {
    console.error('Error getting available slots:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// NEW: Endpoint to create Google Calendar event
app.post('/create-calendar-event', async (req, res) => {
  try {
    const { 
      summary = 'Nexella AI Consultation',
      description = '',
      startTime,
      endTime,
      attendeeEmail,
      attendeeName = 'Guest'
    } = req.body;

    if (!startTime || !endTime || !attendeeEmail) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing required fields: startTime, endTime, attendeeEmail" 
      });
    }

    const result = await calendarService.createEvent({
      summary,
      description,
      startTime,
      endTime,
      attendeeEmail,
      attendeeName
    });

    res.status(result.success ? 200 : 500).json({
      ...result,
      platform: 'google_calendar'
    });
  } catch (error) {
    console.error('Error creating calendar event:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test endpoint to directly send a webhook to n8n with Google Calendar data
app.get('/test-webhook', async (req, res) => {
  try {
    const testData = {
      name: "Test User",
      email: "test@example.com",
      phone: "+12345678900",
      call_id: "test123",
      schedulingComplete: true,
      preferredDay: "Monday",
      // NEW: Google Calendar specific test data
      calendar_booking: true,
      meeting_link: "https://meet.google.com/test-meeting",
      event_link: "https://calendar.google.com/test-event",
      event_id: "test_event_123",
      scheduled_time: new Date().toISOString()
    };
    
    console.log('Sending test webhook with Google Calendar data:', testData);
    
    const success = await notifyN8nWebhook(testData);
    
    res.status(200).json({
      success,
      message: success ? 'Test webhook sent successfully' : 'Failed to send test webhook',
      data: testData,
      platform: 'google_calendar'
    });
  } catch (error) {
    console.error('Error in test-webhook endpoint:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// FIXED: Updated endpoint to trigger a Retell call using SDK with enhanced call storage
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
    
    // Create a unique user ID
    const userIdentifier = userId || `user_${phone}`;
    
    // First try using the SDK
    if (retellClient) {
      try {
        const response = await retellClient.call.createPhoneCall({
          from_number: process.env.RETELL_FROM_NUMBER,
          to_number: phone,
          agent_id: process.env.RETELL_AGENT_ID,
          metadata: {
            customer_name: name || "",
            customer_email: email || "", // ← CRITICAL: This must be passed
            user_id: userIdentifier,
            needs_scheduling: true,
            call_source: "website_form",
            n8n_webhook_url: DEFAULT_N8N_WEBHOOK_URL,
            calendar_platform: "google" // NEW: Indicate we're using Google Calendar
          },
          webhook_url: `${process.env.SERVER_URL || 'https://trigger-server-qt7u.onrender.com'}/retell-webhook`,
          webhook_events: ["call_ended", "call_analyzed"]
        });
        
        // Store the call in our active calls map WITH COMPLETE INFO
        const callId = response.call_id;
        activeCalls.set(callId, {
          id: callId,
          phone,
          name: name || "",
          email: email || "", // ← CRITICAL: Store email here
          userId: userIdentifier,
          startTime: Date.now(),
          state: 'initiated',
          discoveryComplete: false,
          schedulingComplete: false,
          calendarPlatform: 'google', // NEW: Track calendar platform
          // Store metadata for easy access
          metadata: {
            customer_name: name || "",
            customer_email: email || "",
            user_id: userIdentifier,
            calendar_platform: "google"
          }
        });
        
        console.log('✅ Retell outbound call initiated with SDK:', response);
        console.log('✅ Stored call data with email:', email);
        
        return res.status(200).json({
          success: true,
          message: 'Outbound call initiated successfully',
          call_id: response.call_id,
          calendar_platform: 'google'
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
          customer_email: email || "", // ← CRITICAL: This must be passed
          user_id: userIdentifier,
          needs_scheduling: true,
          call_source: "website_form",
          n8n_webhook_url: DEFAULT_N8N_WEBHOOK_URL,
          calendar_platform: "google" // NEW: Indicate we're using Google Calendar
        },
        webhook_url: `${process.env.SERVER_URL || 'https://trigger-server-qt7u.onrender.com'}/retell-webhook`,
        webhook_events: ["call_ended", "call_analyzed"]
      }, {
        headers: {
          Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      
      // Store the call in our active calls map WITH COMPLETE INFO
      const callId = response.data.call_id;
      activeCalls.set(callId, {
        id: callId,
        phone,
        name: name || "",
        email: email || "", // ← CRITICAL: Store email here
        userId: userIdentifier,
        startTime: Date.now(),
        state: 'initiated',
        discoveryComplete: false,
        schedulingComplete: false,
        calendarPlatform: 'google', // NEW: Track calendar platform
        // Store metadata for easy access
        metadata: {
          customer_name: name || "",
          customer_email: email || "",
          user_id: userIdentifier,
          calendar_platform: "google"
        }
      });
      
      console.log('✅ Retell outbound call initiated with axios:', response.data);
      console.log('✅ Stored call data with email:', email);
      
      return res.status(200).json({
        success: true,
        message: 'Outbound call initiated successfully',
        call_id: response.data.call_id,
        calendar_platform: 'google'
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

// UPDATED: Modified endpoint for processing scheduling with Google Calendar
app.post('/process-scheduling-preference', async (req, res) => {
  try {
    const { 
      name, 
      email, 
      phone, 
      preferredDay,
      userId, 
      call_id,
      discovery_data,
      // NEW: Google Calendar specific fields
      calendar_booking,
      meeting_link,
      event_link,
      event_id,
      scheduled_time
    } = req.body;

    console.log('Received scheduling preference:', { 
      name, email, phone, preferredDay, userId, call_id,
      discovery_data: discovery_data ? 'Present' : 'Not present',
      calendar_booking: calendar_booking || false
    });

    if (!email) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing email address" 
      });
    }

    // Update call record if this is associated with a call
    if (call_id && activeCalls.has(call_id)) {
      const callRecord = activeCalls.get(call_id);
      callRecord.schedulingComplete = true;
      callRecord.preferredDay = preferredDay;
      callRecord.calendarBooked = calendar_booking || false;
      
      // Store discovery data if present
      if (discovery_data) {
        callRecord.discoveryData = discovery_data;
      }
      
      // NEW: Store Google Calendar specific data
      if (meeting_link) callRecord.meetingLink = meeting_link;
      if (event_link) callRecord.eventLink = event_link;
      if (event_id) callRecord.eventId = event_id;
      if (scheduled_time) callRecord.scheduledTime = scheduled_time;
      
      activeCalls.set(call_id, callRecord);
    }

    // Format day string for display
    const formattedDay = preferredDay || 'preferred day';

    // Prepare webhook data with Google Calendar fields
    const webhookData = {
      name,
      email,
      phone,
      preferredDay: formattedDay,
      call_id,
      schedulingComplete: true,
      discovery_data: discovery_data || {},
      // NEW: Google Calendar specific fields
      calendar_platform: 'google',
      calendar_booking: calendar_booking || false,
      meeting_link: meeting_link || '',
      event_link: event_link || '',
      event_id: event_id || '',
      scheduled_time: scheduled_time || '',
      booking_method: calendar_booking ? 'automatic' : 'manual'
    };
    
    // Log and send webhook data
    console.log('📤 Sending n8n webhook for scheduling preference with Google Calendar data:', webhookData);
    const webhookSent = await notifyN8nWebhook(webhookData);

    res.status(200).json({
      success: true,
      message: calendar_booking ? 
        'Google Calendar event created and preferences processed' : 
        'Scheduling preferences processed, manual booking needed',
      calendar_platform: 'google',
      calendar_booking: calendar_booking || false,
      meeting_link: meeting_link || '',
      webhookSent,
      preferredDay: formattedDay,
      discovery_data_received: !!discovery_data
    });
  } catch (error) {
    console.error('❌ Error in process-scheduling-preference endpoint:', error);
    res.status(500).json({
      success: false,
      error: "Internal server error: " + error.message
    });
  }
});

// IMPROVED: Enhanced webhook endpoint for receiving events from Retell with Google Calendar
app.post('/retell-webhook', express.json(), async (req, res) => {
  try {
    const { event, call } = req.body;
    
    console.log(`🔍 RECEIVED WEBHOOK FROM RETELL:`, JSON.stringify(req.body, null, 2));
    console.log(`Received Retell webhook event: ${event}`);
    
    if (call && call.call_id) {
      console.log(`Call ID: ${call.call_id}, Status: ${call.call_status}`);
      
      // Update our internal call record
      const callRecord = activeCalls.get(call.call_id) || {};
      
      // Important: Extract email and other info from call metadata
      const email = call.metadata?.customer_email || callRecord.email || '';
      const name = call.metadata?.customer_name || callRecord.name || '';
      const phone = call.to_number || callRecord.phone || '';
      const userId = call.metadata?.user_id || callRecord.userId || '';
      let preferredDay = '';
      let discoveryData = {};
      
      // Extract scheduling data from the call
      if (event === 'call_ended' || event === 'call_analyzed') {
        // Try to extract scheduling info from call data
        if (call.variables && call.variables.preferredDay) {
          preferredDay = call.variables.preferredDay;
          console.log(`Found preferredDay in call variables: ${preferredDay}`);
        } else if (call.custom_data && call.custom_data.preferredDay) {
          preferredDay = call.custom_data.preferredDay;
          console.log(`Found preferredDay in custom_data: ${preferredDay}`);
        } else if (call.analysis && call.analysis.custom_data) {
          // Try to extract from analysis data
          try {
            let analysisData = call.analysis.custom_data;
            if (typeof analysisData === 'string') {
              analysisData = JSON.parse(analysisData);
            }
            
            if (analysisData.preferredDay) {
              preferredDay = analysisData.preferredDay;
              console.log(`Found preferredDay in analysis data: ${preferredDay}`);
            } else if (analysisData.scheduling && analysisData.scheduling.day) {
              preferredDay = analysisData.scheduling.day;
              console.log(`Found preferredDay in scheduling data: ${preferredDay}`);
            }
            
            // Extract discovery data if available
            if (analysisData.discovery_data || analysisData.discoveryData) {
              discoveryData = analysisData.discovery_data || analysisData.discoveryData || {};
              console.log(`Found discovery data in analysis:`, discoveryData);
            }
          } catch (error) {
            console.error('Error parsing analysis data:', error);
          }
        }
        
        // Extract discovery data from variables if available
        if (call.variables && Object.keys(call.variables).length > 0) {
          // Look for discovery related variables
          Object.entries(call.variables).forEach(([key, value]) => {
            if (key.includes('question') || key.includes('discovery')) {
              discoveryData[key] = value;
            }
          });
          
          console.log('Extracted discovery data from variables:', discoveryData);
        }
        
        // If we have an email and the call ended or was analyzed, always send webhook
        if (email) {
          console.log(`Sending webhook for call ${call.call_id} event ${event}`);
          
          // Prepare discovery data to include in webhook
          const enhancedDiscoveryData = {
            ...discoveryData,
            call_duration: call.call_duration_seconds || 0,
            call_status: call.call_status || 'unknown',
            custom_data: call.custom_data || {}
          };
          
          // If no specific discovery data but we have transcripts, use those
          if (Object.keys(discoveryData).length === 0 && call.transcript && call.transcript.length > 0) {
            // Extract user questions and answers from transcript
            const transcript = call.transcript;
            let lastQuestion = '';
            
            transcript.forEach((item, index) => {
              if (item.role === 'assistant' && item.content.includes('?')) {
                // This is likely a question from the assistant
                lastQuestion = item.content;
                
                // Check if the next item is a user response
                if (transcript[index + 1] && transcript[index + 1].role === 'user') {
                  const answer = transcript[index + 1].content;
                  // Store in discovery data with a simplified key
                  const questionKey = `transcript_q${index}`;
                  enhancedDiscoveryData[questionKey] = {
                    question: lastQuestion,
                    answer: answer
                  };
                }
              }
            });
            
            console.log('Extracted Q&A from transcript:', enhancedDiscoveryData);
          }
          
          // Send webhook to n8n with Google Calendar platform info
          await notifyN8nWebhook({
            name,
            email,
            phone,
            call_id: call.call_id,
            preferredDay: preferredDay || 'Not specified',
            schedulingComplete: true,
            call_status: call.call_status || 'unknown',
            call_event: event,
            discovery_data: enhancedDiscoveryData,
            // NEW: Google Calendar specific fields
            calendar_platform: 'google',
            calendar_booking: false, // Will be updated if booking occurs
            booking_method: 'manual'
          });
          
          console.log(`✅ Webhook sent for call ${call.call_id} event ${event} with Google Calendar platform`);
        } else {
          console.warn(`⚠️ No email found for call ${call.call_id}, cannot send webhook`);
        }
        
        // Clean up call record after sending webhook
        setTimeout(() => {
          activeCalls.delete(call.call_id);
          console.log(`Cleaned up call record for ${call.call_id}`);
        }, 5 * 60 * 1000); // 5 minutes timeout
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
    const { call_id, discoveryComplete, preferredDay, schedulingData } = req.body;
    
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
        await notifyN8nWebhook({
          name: callRecord.name,
          email: callRecord.email,
          phone: callRecord.phone,
          call_id,
          discoveryComplete: true,
          calendar_platform: 'google'
        });
      }
    }
    
    // Update preferredDay if provided
    if (preferredDay) {
      callRecord.preferredDay = preferredDay;
      console.log(`Updated preferredDay for call ${call_id}: ${preferredDay}`);
      
      // If we have a preferredDay, send scheduling data with Google Calendar info
      await notifyN8nWebhook({
        name: callRecord.name,
        email: callRecord.email,
        phone: callRecord.phone,
        call_id,
        preferredDay,
        schedulingComplete: true,
        calendar_platform: 'google',
        calendar_booking: false // Will be updated when actual booking happens
      });
      
      console.log(`Sent scheduling webhook for call ${call_id} with Google Calendar platform`);
    }
    
    // Update scheduling data if provided
    if (schedulingData) {
      callRecord.schedulingData = schedulingData;
      console.log(`Updated scheduling data for call ${call_id}: ${JSON.stringify(schedulingData)}`);
      
      // Send scheduling data to webhook
      await notifyN8nWebhook({
        name: callRecord.name,
        email: callRecord.email,
        phone: callRecord.phone,
        call_id,
        schedulingData,
        calendar_platform: 'google'
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

// FIXED: Enhanced get-call-info endpoint
app.get('/get-call-info/:callId', (req, res) => {
  try {
    const { callId } = req.params;
    console.log(`📞 Server LLM requesting call info for: ${callId}`);
    
    // Check if we have this call in our active calls
    if (activeCalls.has(callId)) {
      const callData = activeCalls.get(callId);
      console.log(`✅ Found call data:`, callData);
      
      res.status(200).json({
        success: true,
        data: {
          name: callData.name || '',
          email: callData.email || '', // ← CRITICAL: Return the email
          phone: callData.phone || '',
          call_id: callId,
          calendar_platform: 'google', // NEW: Include calendar platform
          metadata: callData.metadata || {}
        }
      });
    } else {
      console.log(`⚠️ Call ${callId} not found in active calls`);
      res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }
  } catch (error) {
    console.error('Error getting call info:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Simple endpoint to manually trigger a scheduling email with Google Calendar data
app.get('/manual-webhook', async (req, res) => {
  try {
    const testData = {
      name: req.query.name || "Jaden",
      email: req.query.email || "jadenlugoco@gmail.com",
      phone: req.query.phone || " 12099387088",
      schedulingComplete: true,
      preferredDay: req.query.day || "Monday",
      // NEW: Google Calendar test data
      calendar_platform: 'google',
      calendar_booking: req.query.booked === 'true',
      meeting_link: req.query.booked === 'true' ? 'https://meet.google.com/test-meeting' : '',
      event_id: req.query.booked === 'true' ? 'test_event_123' : ''
    };
    
    console.log('Sending manual webhook data with Google Calendar:', testData);
    
    const success = await notifyN8nWebhook(testData);
    
    res.status(200).json({
      success,
      message: success ? 'Webhook sent successfully' : 'Failed to send webhook',
      data: testData,
      platform: 'google_calendar'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Enhanced debug endpoint for testing Google Calendar workflow
app.post('/debug-test-webhook', async (req, res) => {
  try {
    console.log('🧪 DEBUG TEST WEBHOOK TRIGGERED WITH GOOGLE CALENDAR');
    
    // Use provided data or default test data
    const testData = {
      name: req.body.name || "Google Calendar Test",
      email: req.body.email || "gcal-test@example.com", 
      phone: req.body.phone || "+15551234567",
      preferredDay: req.body.preferredDay || "Tuesday",
      call_id: req.body.call_id || `gcal_test_${Date.now()}`,
      schedulingComplete: true,
      
      // NEW: Google Calendar specific test data
      calendar_platform: 'google',
      calendar_booking: req.body.calendar_booking || true,
      meeting_link: req.body.meeting_link || "https://meet.google.com/test-meeting-link",
      event_link: req.body.event_link || "https://calendar.google.com/calendar/event?eid=test",
      event_id: req.body.event_id || "test_event_12345",
      scheduled_time: req.body.scheduled_time || new Date().toISOString(),
      booking_method: 'automatic',
      
      // Complete discovery data for testing
      discovery_data: req.body.discovery_data || {
        "How did you hear about us": "Google Search",
        "Business/Industry": "Technology", 
        "Main product": "Software Solutions",
        "Running ads": "Yes, Google Ads",
        "Using CRM": "Yes, Salesforce",
        "Pain points": "Lead management automation"
      }
    };
    
    console.log('🧪 Sending Google Calendar test data to n8n webhook:', JSON.stringify(testData, null, 2));
    
    // Send to n8n webhook
    const success = await notifyN8nWebhook(testData);
    
    if (success) {
      res.status(200).json({
        success: true,
        message: 'Debug test webhook sent successfully to n8n with Google Calendar data',
        data: testData,
        webhook_url: DEFAULT_N8N_WEBHOOK_URL,
        platform: 'google_calendar'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to send debug test webhook to n8n',
        data: testData
      });
    }
  } catch (error) {
    console.error('❌ Error in debug test webhook:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Debug test webhook failed'
    });
  }
});

// Test endpoint for Google Calendar API connection
app.get('/test-google-calendar', async (req, res) => {
  try {
    console.log('🧪 Testing Google Calendar API connection...');
    
    // Test getting available slots for today
    const today = new Date();
    const availableSlots = await calendarService.getAvailableSlots(today);
    
    res.status(200).json({
      success: true,
      message: 'Google Calendar API connection successful',
      available_slots_today: availableSlots.length,
      sample_slots: availableSlots.slice(0, 3), // Show first 3 slots
      calendar_id: process.env.GOOGLE_CALENDAR_ID,
      test_date: today.toISOString()
    });
  } catch (error) {
    console.error('❌ Error testing Google Calendar API:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Google Calendar API connection failed'
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Trigger server running on port ${PORT} with Google Calendar integration`);
});
