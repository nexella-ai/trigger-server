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

// Enhanced helper function to send data to n8n webhook - UPDATED FOR N8N
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
        'question_1': 'Business or industry',
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
      webhook_version: '1.1'
    };
    
    console.log('📤 SENDING DATA TO N8N WEBHOOK:', JSON.stringify(webhookData, null, 2));
    
    const response = await axios.post(DEFAULT_N8N_WEBHOOK_URL, webhookData, {
      timeout: 10000, // 10 second timeout
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Source': 'Nexella-Server'
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
  res.status(200).send('Trigger server is healthy.');
});

// Test endpoint to directly send a webhook to n8n
app.get('/test-webhook', async (req, res) => {
  try {
    const testData = {
      name: "Test User",
      email: "test@example.com",
      phone: "+12345678900",
      call_id: "test123",
      schedulingComplete: true,
      preferredDay: "Monday",
      schedulingLink: "https://calendly.com/nexella/30min"
    };
    
    console.log('Sending valid webhook test data:', testData);
    
    const success = await notifyN8nWebhook(testData);
    
    res.status(200).json({
      success,
      message: success ? 'Test webhook sent successfully' : 'Failed to send test webhook',
      data: testData
    });
  } catch (error) {
    console.error('Error in test-webhook endpoint:', error);
    res.status(500).json({
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
            // Updated for n8n
            n8n_webhook_url: DEFAULT_N8N_WEBHOOK_URL
          },
          // New: Add a callback URL for the agent to trigger when scheduling is complete
          webhook_url: `${process.env.SERVER_URL || 'https://trigger-server-qt7u.onrender.com'}/retell-webhook`,
          webhook_events: ["call_ended", "call_analyzed"]
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
          // Updated for n8n
          n8n_webhook_url: DEFAULT_N8N_WEBHOOK_URL
        },
        webhook_url: `${process.env.SERVER_URL || 'https://trigger-server-qt7u.onrender.com'}/retell-webhook`,
        webhook_events: ["call_ended", "call_analyzed"]
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

// NEW: Modified endpoint for sending scheduling link using n8n
app.post('/send-scheduling-link', async (req, res) => {
  try {
    const { 
      call_id, 
      name, 
      email, 
      phone, 
      preferredDay,
      userId
    } = req.body;
    
    console.log('Received scheduling link request:', { 
      call_id, name, email, phone, preferredDay
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
        activeCalls.set(call_id, callRecord);
      }
    }
    
    // Prepare webhook data with scheduling link
    const webhookData = {
      name,
      email,
      phone,
      preferredDay: preferredDay || '',
      schedulingLink, // This is the key field - sending a link instead of booking directly
      call_id,
      schedulingComplete: true
    };
    
    console.log('📤 Sending webhook notification with scheduling link details:', webhookData);
    // Updated to use the n8n webhook function
    const webhookSent = await notifyN8nWebhook(webhookData);
    
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

// Modified: Endpoint for handling preferred scheduling and sending links
app.post('/process-scheduling-preference', async (req, res) => {
  try {
    const { 
      name, 
      email, 
      phone, 
      preferredDay,
      userId, 
      call_id,
      discovery_data
    } = req.body;

    console.log('Received scheduling preference:', { 
      name, email, phone, preferredDay, userId, call_id,
      discovery_data: discovery_data ? 'Present' : 'Not present'
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
      
      // Store discovery data if present
      if (discovery_data) {
        callRecord.discoveryData = discovery_data;
      }
      
      activeCalls.set(call_id, callRecord);
    }

    // Format day string for display
    const formattedDay = preferredDay || 'preferred day';

    // Prepare webhook data
    const webhookData = {
      name,
      email,
      phone,
      preferredDay: formattedDay,
      schedulingLink,
      call_id,
      schedulingComplete: true,
      discovery_data: discovery_data || {}
    };
    
    // Log and send webhook data
    console.log('📤 Sending n8n webhook for scheduling preference:', webhookData);
    // Updated to use the n8n webhook function
    const webhookSent = await notifyN8nWebhook(webhookData);

    res.status(200).json({
      success: true,
      message: 'Scheduling preferences processed and link will be sent',
      schedulingLink,
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

// IMPROVED: Enhanced webhook endpoint for receiving events from Retell
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
          
          // Get the Calendly scheduling link
          const schedulingLink = process.env.CALENDLY_SCHEDULING_LINK || 'https://calendly.com/nexella/30min';
          
          // Send webhook to n8n
          await notifyN8nWebhook({
            name,
            email,
            phone,
            call_id: call.call_id,
            preferredDay: preferredDay || 'Not specified',
            schedulingLink,
            schedulingComplete: true,
            call_status: call.call_status || 'unknown',
            call_event: event,
            discovery_data: enhancedDiscoveryData
          });
          
          console.log(`✅ Webhook sent for call ${call.call_id} event ${event}`);
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
          discoveryComplete: true
        });
      }
    }
    
    // Update preferredDay if provided
    if (preferredDay) {
      callRecord.preferredDay = preferredDay;
      console.log(`Updated preferredDay for call ${call_id}: ${preferredDay}`);
      
      // If we have a preferredDay, send scheduling data
      const schedulingLink = process.env.CALENDLY_SCHEDULING_LINK || 'https://calendly.com/nexella/30min';
      
      await notifyN8nWebhook({
        name: callRecord.name,
        email: callRecord.email,
        phone: callRecord.phone,
        call_id,
        preferredDay,
        schedulingLink,
        schedulingComplete: true
      });
      
      console.log(`Sent scheduling webhook for call ${call_id}`);
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

// Simple endpoint to manually trigger a scheduling email
app.get('/manual-webhook', async (req, res) => {
  try {
    const testData = {
      name: req.query.name || "Jaden",
      email: req.query.email || "jadenlugoco@gmail.com",
      phone: req.query.phone || " 12099387088",
      schedulingComplete: true,
      preferredDay: req.query.day || "Monday",
      schedulingLink: process.env.CALENDLY_SCHEDULING_LINK || "https://calendly.com/nexella/30min"
    };
    
    console.log('Sending manual webhook data:', testData);
    
    const success = await notifyN8nWebhook(testData);
    
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
    const success = await notifyN8nWebhook(webhookData);
    
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
