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

// Enhanced debug endpoint for testing the complete workflow
app.post('/debug-test-webhook', async (req, res) => {
  try {
    console.log('🧪 DEBUG TEST WEBHOOK TRIGGERED');
    
    // Use provided data or default test data
    const testData = {
      name: req.body.name || "Jaden Test",
      email: req.body.email || "jadenlugoco@gmail.com", 
      phone: req.body.phone || "+12099387088",
      preferredDay: req.body.preferredDay || "Monday",
      call_id: req.body.call_id || `test_call_${Date.now()}`,
      schedulingComplete: true,
      schedulingLink: process.env.CALENDLY_SCHEDULING_LINK || "https://calendly.com/nexella/30min",
      
      // Complete discovery data for testing
      discovery_data: req.body.discovery_data || {
        "How did you hear about us": "Instagram",
        "Business/Industry": "Solar",
        "Main product": "Solar panels", 
        "Running ads": "No",
        "Using CRM": "Yes. Go high level",
        "Pain points": "I'm not following up the leads quickly enough"
      }
    };
    
    console.log('🧪 Sending test data to n8n webhook:', JSON.stringify(testData, null, 2));
    
    // Send to n8n webhook
    const success = await notifyN8nWebhook(testData);
    
    if (success) {
      res.status(200).json({
        success: true,
        message: 'Debug test webhook sent successfully to n8n',
        data: testData,
        webhook_url: DEFAULT_N8N_WEBHOOK_URL
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

// Quick GET endpoint for easy browser testing
app.get('/debug-test-webhook', async (req, res) => {
  try {
    console.log('🧪 DEBUG TEST WEBHOOK TRIGGERED (GET)');
    
    // Use query parameters or defaults
    const testData = {
      name: req.query.name || "Jaden Test Browser",
      email: req.query.email || "jadenlugoco@gmail.com",
      phone: req.query.phone || "+12099387088", 
      preferredDay: req.query.day || "Tuesday",
      call_id: `browser_test_${Date.now()}`,
      schedulingComplete: true,
      schedulingLink: process.env.CALENDLY_SCHEDULING_LINK || "https://calendly.com/nexella/30min",
      
      // Complete discovery data
      discovery_data: {
        "How did you hear about us": req.query.source || "Instagram",
        "Business/Industry": req.query.industry || "Solar",
        "Main product": req.query.product || "Solar panels",
        "Running ads": req.query.ads || "No", 
        "Using CRM": req.query.crm || "Yes. Go high level",
        "Pain points": req.query.pain || "Not following up leads quickly enough"
      }
    };
    
    console.log('🧪 Browser test - sending to n8n:', JSON.stringify(testData, null, 2));
    
    const success = await notifyN8nWebhook(testData);
    
    res.status(200).send(`
      <html>
        <head><title>Debug Test Results</title></head>
        <body style="font-family: Arial; padding: 20px;">
          <h2>🧪 Debug Test Webhook Results</h2>
          <p><strong>Status:</strong> ${success ? '✅ SUCCESS' : '❌ FAILED'}</p>
          <p><strong>Webhook URL:</strong> ${DEFAULT_N8N_WEBHOOK_URL}</p>
          <h3>Test Data Sent:</h3>
          <pre style="background: #f5f5f5; padding: 10px; border-radius: 5px;">${JSON.stringify(testData, null, 2)}</pre>
          
          <h3>Quick Test Links:</h3>
          <ul>
            <li><a href="/debug-test-webhook?name=John&email=john@test.com&industry=Real Estate&product=Houses">Real Estate Test</a></li>
            <li><a href="/debug-test-webhook?name=Sarah&email=sarah@test.com&industry=E-commerce&product=Clothing">E-commerce Test</a></li>
            <li><a href="/debug-test-webhook?name=Mike&email=mike@test.com&industry=SaaS&product=Software">SaaS Test</a></li>
          </ul>
          
          <p><a href="/debug-test-webhook">🔄 Run Another Test</a></p>
        </body>
      </html>
    `);
    
  } catch (error) {
    console.error('❌ Error in browser debug test:', error);
    res.status(500).send(`
      <html>
        <body style="font-family: Arial; padding: 20px;">
          <h2>❌ Debug Test Failed</h2>
          <p><strong>Error:</strong> ${error.message}</p>
          <p><a href="/debug-test-webhook">🔄 Try Again</a></p>
        </body>
      </html>
    `);
  }
});

// Test endpoint specifically for the N8N discovery flow
app.get('/test-n8n-flow', async (req, res) => {
  try {
    console.log('🧪 TESTING N8N DISCOVERY FLOW');
    
    // Use query parameters or defaults for easy browser testing
    const testData = {
      name: req.query.name || "Discovery Test User",
      email: req.query.email || "discoverytest@example.com",
      phone: req.query.phone || "+1555123456",
      preferredDay: req.query.day || "Friday", 
      call_id: `n8n_test_${Date.now()}`,
      schedulingComplete: true,
      
      // Complete discovery data with all 6 answers
      discovery_data: {
        "How did you hear about us": req.query.source || "LinkedIn",
        "Business/Industry": req.query.industry || "Digital Marketing",
        "Main product": req.query.product || "Marketing Software", 
        "Running ads": req.query.ads || "Yes, Meta and Google",
        "Using CRM": req.query.crm || "Yes, HubSpot",
        "Pain points": req.query.pain || "Lead attribution is unclear"
      }
    };
    
    console.log('📤 Sending test data directly to N8N webhook:', JSON.stringify(testData, null, 2));
    
    // Send directly to N8N webhook (not through our server)
    const n8nResponse = await axios.post('https://n8n-clp2.onrender.com/webhook/retell-scheduling', testData, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000 // 30 second timeout for N8N processing
    });
    
    console.log('✅ N8N Response:', n8nResponse.data);
    
    // Create a nice HTML response showing what happened
    res.status(200).send(`
      <html>
        <head>
          <title>N8N Discovery Flow Test</title>
          <style>
            body { font-family: Arial; padding: 20px; max-width: 800px; }
            .success { color: green; }
            .data-box { background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 10px 0; }
            .discovery-item { margin: 5px 0; padding: 5px; background: #e8f4fd; border-radius: 3px; }
            .test-links { margin: 20px 0; }
            .test-links a { display: inline-block; margin: 5px; padding: 8px 15px; background: #007cba; color: white; text-decoration: none; border-radius: 4px; }
          </style>
        </head>
        <body>
          <h2>🧪 N8N Discovery Flow Test Results</h2>
          <p class="success"><strong>✅ SUCCESS!</strong> Data sent to N8N workflow</p>
          
          <h3>📧 Contact Info Sent:</h3>
          <div class="data-box">
            <strong>Name:</strong> ${testData.name}<br>
            <strong>Email:</strong> ${testData.email}<br>
            <strong>Phone:</strong> ${testData.phone}<br>
            <strong>Preferred Day:</strong> ${testData.preferredDay}
          </div>
          
          <h3>🔍 Discovery Answers Sent:</h3>
          <div class="data-box">
            ${Object.entries(testData.discovery_data).map(([question, answer]) => 
              `<div class="discovery-item"><strong>${question}:</strong> ${answer}</div>`
            ).join('')}
          </div>
          
          <h3>🎯 What Should Happen Next:</h3>
          <ol>
            <li>N8N should process this data through the "Code" node</li>
            <li>Create/update record in "Email Log" Airtable</li>
            <li>Check if email already sent</li>
            <li>Generate Calendly link</li>
            <li>Send email with booking link</li>
            <li>Update Email Log with discovery data</li>
          </ol>
          
          <div class="test-links">
            <h3>🔄 Try Different Test Scenarios:</h3>
            <a href="/test-n8n-flow?name=Solar Sam&email=sam@solar.com&industry=Solar&product=Panels&ads=No&crm=GoHighLevel&pain=Follow up issues">Solar Industry</a>
            <a href="/test-n8n-flow?name=Tech Tim&email=tim@tech.com&industry=SaaS&product=Software&ads=Yes&crm=Salesforce&pain=Lead quality">SaaS Company</a>
            <a href="/test-n8n-flow?name=Real Estate Rita&email=rita@realty.com&industry=Real Estate&product=Houses&ads=Yes&crm=No&pain=Market competition">Real Estate</a>
            <a href="/test-n8n-flow?name=Agency Alice&email=alice@agency.com&industry=Marketing&product=Services&ads=Yes&crm=HubSpot&pain=Client retention">Marketing Agency</a>
          </div>
          
          <h3>📊 Check Results In:</h3>
          <ul>
            <li><strong>Airtable Email Log:</strong> Should have new record with discovery data</li>
            <li><strong>Email:</strong> ${testData.email} should receive booking link</li>
            <li><strong>N8N Logs:</strong> Check your N8N workflow execution logs</li>
          </ul>
          
          <p><strong>N8N Response:</strong></p>
          <div class="data-box">
            <pre>${JSON.stringify(n8nResponse.data, null, 2)}</pre>
          </div>
          
          <p><a href="/test-n8n-flow">🔄 Run Another Test</a></p>
        </body>
      </html>
    `);
    
  } catch (error) {
    console.error('❌ Error testing N8N flow:', error);
    
    res.status(500).send(`
      <html>
        <body style="font-family: Arial; padding: 20px;">
          <h2>❌ N8N Flow Test Failed</h2>
          <p><strong>Error:</strong> ${error.message}</p>
          
          ${error.response ? `
            <h3>N8N Response Details:</h3>
            <pre style="background: #ffe6e6; padding: 10px; border-radius: 5px;">
Status: ${error.response.status}
Data: ${JSON.stringify(error.response.data, null, 2)}
            </pre>
          ` : ''}
          
          <p><strong>Possible Issues:</strong></p>
          <ul>
            <li>N8N webhook might be down</li>
            <li>Airtable credentials might be expired</li>
            <li>Email SMTP settings might be incorrect</li>
            <li>Workflow might be paused</li>
          </ul>
          
          <p><a href="/test-n8n-flow">🔄 Try Again</a></p>
        </body>
      </html>
    `);
  }
});

// POST version for API testing
app.post('/test-n8n-flow', async (req, res) => {
  try {
    const testData = {
      name: req.body.name || "API Test User",
      email: req.body.email || "apitest@example.com", 
      phone: req.body.phone || "+1555999888",
      preferredDay: req.body.preferredDay || "Thursday",
      call_id: req.body.call_id || `api_test_${Date.now()}`,
      schedulingComplete: true,
      discovery_data: req.body.discovery_data || {
        "How did you hear about us": "API Test",
        "Business/Industry": "Testing",
        "Main product": "Test Products",
        "Running ads": "Maybe",
        "Using CRM": "Test CRM",
        "Pain points": "Testing pain points"
      }
    };
    
    console.log('📤 API Test - sending to N8N:', JSON.stringify(testData, null, 2));
    
    const n8nResponse = await axios.post('https://n8n-clp2.onrender.com/webhook/retell-scheduling', testData, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });
    
    res.status(200).json({
      success: true,
      message: 'Successfully sent test data to N8N workflow',
      test_data: testData,
      n8n_response: n8nResponse.data,
      instructions: {
        check_airtable: "Look for new record in Email Log table",
        check_email: `Email should be sent to ${testData.email}`,
        check_n8n: "Review N8N workflow execution logs"
      }
    });
    
  } catch (error) {
    console.error('❌ API test error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      n8n_response: error.response?.data || null
    });
  }
});

// Endpoint to test just the discovery data mapping
app.post('/debug-discovery-mapping', async (req, res) => {
  try {
    console.log('🔍 TESTING DISCOVERY DATA MAPPING');
    
    const rawDiscoveryData = req.body.discovery_data || {
      "question_0": "Instagram",
      "question_1": "Solar", 
      "question_2": "Solar panels",
      "question_3": "No",
      "question_4": "Yes. Go high level", 
      "question_5": "Not following up leads quickly"
    };
    
    // Test the mapping logic from your server
    const fieldMappings = {
      'question_0': 'How did you hear about us',
      'question_1': 'Business/Industry',
      'question_2': 'Main product', 
      'question_3': 'Running ads',
      'question_4': 'Using CRM',
      'question_5': 'Pain points'
    };
    
    const formattedDiscoveryData = {};
    
    Object.entries(rawDiscoveryData).forEach(([key, value]) => {
      if (key.startsWith('question_')) {
        if (fieldMappings[key]) {
          formattedDiscoveryData[fieldMappings[key]] = value;
        } else {
          formattedDiscoveryData[key] = value;
        }
      } else {
        formattedDiscoveryData[key] = value;
      }
    });
    
    res.status(200).json({
      success: true,
      message: 'Discovery data mapping test completed',
      raw_input: rawDiscoveryData,
      formatted_output: formattedDiscoveryData,
      field_mappings: fieldMappings
    });
    
  } catch (error) {
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

// Get call information endpoint for Server LLM
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
          email: callData.email || '',
          phone: callData.phone || '',
          call_id: callId
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

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Trigger server running on port ${PORT}`);
});
