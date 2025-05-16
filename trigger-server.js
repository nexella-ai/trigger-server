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

// IMPROVED: Enhanced helper function to send data to n8n webhook
async function notifyN8nWebhook(data) {
  console.log('🚀 PREPARING TO SEND DATA TO N8N WEBHOOK:', JSON.stringify(data, null, 2));
  
  try {
    // CRITICAL: Email validation
    if (!data.email || data.email.trim() === '') {
      console.error('⚠️ ERROR: No email provided in webhook data. Cannot process without an email.');
      return false;
    }
    
    // Debug log for tracking email
    console.log('📧 Email validation in notifyN8nWebhook:');
    console.log('- Email value:', data.email);
    console.log('- Email type:', typeof data.email);
    
    // Ensure phone number is formatted with a + if it has digits
    if (data.phone && !data.phone.startsWith('+') && /\d/.test(data.phone)) {
      data.phone = '+1' + data.phone.replace(/[^0-9]/g, '');
    }
    
    // Format discovery data if present
    if (data.discovery_data) {
      // Format the discovery data into a structured format for Airtable
      const formattedDiscoveryData = {};
      
      // Map discovery questions to better field names
      const questionMapping = {
        'question_0': 'How did you hear about us',
        'question_1': 'Business/industry',
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
      webhook_version: '1.2' // Updated version
    };
    
    console.log('📤 SENDING DATA TO N8N WEBHOOK:', JSON.stringify(webhookData, null, 2));
    
    const response = await axios.post(DEFAULT_N8N_WEBHOOK_URL, webhookData, {
      timeout: 15000, // 15 second timeout (increased)
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
    
    // Enhanced retry logic
    console.log('🔄 Attempting to retry webhook notification in 3 seconds...');
    try {
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Ensure we still have email
      if (!data.email) {
        console.error('❌ RETRY FAILED: Missing email in data');
        return false;
      }
      
      // Make sure we're sending valid data
      const retryData = {
        ...data,
        retry: true,
        timestamp: new Date().toISOString()
      };
      
      const retryResponse = await axios.post(DEFAULT_N8N_WEBHOOK_URL, retryData, {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Source': 'Nexella-Server',
          'X-Retry': 'true'
        }
      });
      
      console.log(`✅ RETRY SUCCESSFUL. Response status: ${retryResponse.status}`);
      return true;
    } catch (retryError) {
      console.error(`❌ RETRY FAILED: ${retryError.message}`);
      return false;
    }
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
      email: "test@example.com", // Required field
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

// IMPROVED: Updated endpoint to trigger a Retell call using SDK with better error handling
app.post('/trigger-retell-call', async (req, res) => {
  try {
    const { name, email, phone, userId } = req.body;
    
    // Validate required fields
    if (!phone) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing phone number field" 
      });
    }
    
    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Missing email field - this is required for lead tracking"
      });
    }
    
    // Ensure phone is formatted correctly
    let formattedPhone = phone;
    if (!formattedPhone.startsWith('+')) {
      formattedPhone = '+1' + formattedPhone.replace(/[^0-9]/g, '');
    }
    
    console.log('Triggering Retell call with:', { name, email, formattedPhone });
    console.log('📧 Using email for Retell call:', email);
    
    // First try using the SDK
    if (retellClient) {
      try {
        // Create the call metadata
        const metadata = {
          customer_name: name || "",
          customer_email: email, // Using validated email
          user_id: userId || `user_${formattedPhone}`,
          needs_scheduling: true,
          call_source: "website_form",
          n8n_webhook_url: DEFAULT_N8N_WEBHOOK_URL
        };
        
        console.log('Using metadata for call:', metadata);
        
        const response = await retellClient.call.createPhoneCall({
          from_number: process.env.RETELL_FROM_NUMBER,
          to_number: formattedPhone,
          agent_id: process.env.RETELL_AGENT_ID,
          metadata: metadata,
          // New: Add a callback URL for the agent to trigger when scheduling is complete
          webhook_url: `${process.env.SERVER_URL || 'https://trigger-server-qt7u.onrender.com'}/retell-webhook`,
          webhook_events: ["call_ended", "call_analyzed"]
        });
        
        // Store the call in our active calls map
        const callId = response.call_id;
        activeCalls.set(callId, {
          id: callId,
          phone: formattedPhone,
          name,
          email,
          userId: userId || `user_${Date.now()}`,
          startTime: Date.now(),
          state: 'initiated',
          discoveryComplete: false,
          schedulingComplete: false,
          metadata: metadata
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
      // Create metadata for the call
      const metadata = {
        customer_name: name || "",
        customer_email: email, // Using validated email
        user_id: userId || `user_${formattedPhone}`,
        needs_scheduling: true,
        call_source: "website_form",
        n8n_webhook_url: DEFAULT_N8N_WEBHOOK_URL
      };
      
      console.log('Using fallback axios with metadata:', metadata);
      
      const response = await axios.post('https://api.retellai.com/v1/calls', {
        from_number: process.env.RETELL_FROM_NUMBER,
        to_number: formattedPhone,
        agent_id: process.env.RETELL_AGENT_ID,
        metadata: metadata,
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
        phone: formattedPhone,
        name,
        email,
        userId: userId || `user_${Date.now()}`,
        startTime: Date.now(),
        state: 'initiated',
        discoveryComplete: false,
        schedulingComplete: false,
        metadata: metadata
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

// IMPROVED: Modified endpoint for sending scheduling link using n8n
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
    
    // Validate email is present
    if (!email && !call_id) {
      return res.status(400).json({
        success: false,
        error: "Missing email address or call_id for scheduling link"
      });
    }
    
    // Debug email tracking
    console.log('📧 Email check in send-scheduling-link:');
    console.log('- Email provided:', email);
    console.log('- Call ID:', call_id);
    
    // Get email from call record if available
    let finalEmail = email;
    let finalName = name;
    let finalPhone = phone;
    
    // Try to get data from active calls if we have a call_id
    if (call_id && activeCalls.has(call_id) && !finalEmail) {
      const callRecord = activeCalls.get(call_id);
      if (!finalEmail && callRecord.email) {
        finalEmail = callRecord.email;
        console.log('Retrieved email from call record:', finalEmail);
      }
      if (!finalName && callRecord.name) finalName = callRecord.name;
      if (!finalPhone && callRecord.phone) finalPhone = callRecord.phone;
    }
    
    // Validate we have an email after lookups
    if (!finalEmail) {
      return res.status(400).json({
        success: false,
        error: "Could not find an email address for scheduling - this is required"
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
      name: finalName,
      email: finalEmail,
      phone: finalPhone,
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

// IMPROVED: Endpoint for handling preferred scheduling and sending links
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

    // Debug email tracking
    console.log('📧 Email Debug in process-scheduling-preference:');
    console.log('- Received email in request:', email);
    console.log('- Call ID present:', Boolean(call_id));
    
    // Validate email is required
    if (!email || email.trim() === '') {
      // Try to find email in call record if we have a call ID
      let recoveredEmail = null;
      
      if (call_id && activeCalls.has(call_id)) {
        const callRecord = activeCalls.get(call_id);
        if (callRecord.email) {
          recoveredEmail = callRecord.email;
          console.log('Recovered email from call record:', recoveredEmail);
        } else if (callRecord.metadata && callRecord.metadata.customer_email) {
          recoveredEmail = callRecord.metadata.customer_email;
          console.log('Recovered email from call metadata:', recoveredEmail);
        }
      }
      
      if (!recoveredEmail) {
        return res.status(400).json({
          success: false,
          error: "Missing email address - this is required for processing"
        });
      }
      
      // Use the recovered email
      console.log('Using recovered email:', recoveredEmail);
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
      name: name || '',
      email: email || (call_id && activeCalls.has(call_id) ? activeCalls.get(call_id).email : ''),
      phone: phone || '',
      preferredDay: formattedDay,
      schedulingLink,
      call_id,
      schedulingComplete: true,
      discovery_data: discovery_data || {}
    };
    
    // Final email validation
    if (!webhookData.email || webhookData.email.trim() === '') {
      return res.status(400).json({
        success: false,
        error: "Could not find a valid email after recovery attempts"
      });
    }
    
    // Log and send webhook data
    console.log('📤 Sending n8n webhook for scheduling preference with email:', webhookData.email);
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
      
      // Debug email tracking
      console.log('📧 Email check in retell webhook:');
      if (call.metadata && call.metadata.customer_email) {
        console.log('- customer_email in metadata:', call.metadata.customer_email);
      } else {
        console.log('- No customer_email in metadata!');
      }
      
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
        
        // Extract discovery data from transcript
        if (Object.keys(discoveryData).length < 4 && call.transcript && call.transcript.length > 0) {
          console.log('Trying to extract discovery data from transcript');
          
          // Define the discovery questions to look for
          const discoveryQuestions = [
            'How did you hear about us?',
            'What line of business are you in? What\'s your business model?',
            'What\'s your main product and typical price point?',
            'Are you running ads (Meta, Google, TikTok)?',
            'Are you using a CRM like GoHighLevel?',
            'What problems are you running into?'
          ];
          
          // Shortened versions of questions to match in the transcript
          const shortQuestions = [
            'hear about',
            'business',
            'product',
            'running ads',
            'crm',
            'problems'
          ];
          
          // Extract user responses to bot questions from transcript
          for (let i = 0; i < call.transcript.length - 1; i++) {
            const message = call.transcript[i];
            const nextMessage = call.transcript[i + 1];
            
            // Look for bot messages that contain questions followed by user responses
            if (message.role === 'assistant' && nextMessage.role === 'user') {
              const botText = message.content.toLowerCase();
              
              // Check each discovery question
              shortQuestions.forEach((questionText, questionIndex) => {
                if (botText.includes(questionText)) {
                  // Found a matching question, store the user's response
                  discoveryData[`question_${questionIndex}`] = nextMessage.content;
                  console.log(`Found answer to question ${questionIndex} in transcript: ${nextMessage.content.substring(0, 30)}...`);
                }
              });
            }
          }
        }
        
        // Validate email for webhooks
        if (!email) {
          console.error('⚠️ NO EMAIL FOUND FOR CALL! Cannot send webhook.');
          
          // Try to look up from our activeCalls map
          if (activeCalls.has(call.call_id)) {
            const storedCall = activeCalls.get(call.call_id);
            if (storedCall.email) {
              console.log(`Found email in
