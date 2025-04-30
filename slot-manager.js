require('dotenv').config();
const axios = require('axios');

// In-memory store for slot reservations (would use Redis in production)
const lockedSlots = new Map();

/**
 * Locks a time slot for a specific user
 */
function lockSlot(startTime, userId, expirationSeconds = 300) {
  const key = startTime;
  if (lockedSlots.has(key) && lockedSlots.get(key).userId !== userId) {
    return false;
  }
  lockedSlots.set(key, {
    userId,
    expiresAt: Date.now() + (expirationSeconds * 1000)
  });
  setTimeout(() => {
    const lock = lockedSlots.get(key);
    if (lock && lock.userId === userId) {
      lockedSlots.delete(key);
      console.log(`Lock for slot ${key} expired and was released`);
    }
  }, expirationSeconds * 1000);
  return true;
}

/**
 * Confirms a slot reservation
 */
function confirmSlot(startTime, userId) {
  const key = startTime;
  if (lockedSlots.has(key)) {
    const lock = lockedSlots.get(key);
    if (lock.userId === userId && lock.expiresAt > Date.now()) {
      lockedSlots.delete(key);
      return true;
    }
  }
  return false;
}

/**
 * Releases a slot reservation
 */
function releaseSlot(startTime, userId) {
  const key = startTime;
  if (lockedSlots.has(key) && lockedSlots.get(key).userId === userId) {
    lockedSlots.delete(key);
    return true;
  }
  return false;
}

/**
 * Checks if a slot is available in Calendly
 * @param {string} startTime - ISO format start time
 * @param {string} endTime - ISO format end time
 * @returns {Promise<boolean>} Whether slot is available
 */
async function isSlotAvailable(startTime, endTime) {
  try {
    // Essential parameters for Calendly API
    const userUri = process.env.CALENDLY_USER_URI;
    const eventTypeUri = process.env.CALENDLY_EVENT_TYPE_URI;
    
    if (!userUri) {
      throw new Error("Missing CALENDLY_USER_URI in environment variables");
    }
    
    if (!eventTypeUri) {
      throw new Error("Missing CALENDLY_EVENT_TYPE_URI in environment variables");
    }
    
    // First check if there are any scheduled events in this timeframe
    const eventsResponse = await axios.get('https://api.calendly.com/scheduled_events', {
      params: {
        user: userUri,
        min_start_time: startTime,
        max_start_time: endTime
      },
      headers: {
        Authorization: `Bearer ${process.env.CALENDLY_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    // If there are events scheduled in this timeframe, the slot is not available
    const events = eventsResponse.data.collection || [];
    if (events.length > 0) {
      return false;
    }
    
    // Also check available times from the event type to confirm this slot is valid
    const startDate = new Date(startTime);
    const formattedDate = startDate.toISOString().split('T')[0]; // Get YYYY-MM-DD
    
    const availabilityResponse = await axios.get('https://api.calendly.com/event_type_available_times', {
      params: {
        event_type: eventTypeUri,
        start_time: `${formattedDate}T00:00:00Z`,
        end_time: `${formattedDate}T23:59:59Z`
      },
      headers: {
        Authorization: `Bearer ${process.env.CALENDLY_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    const availableTimes = availabilityResponse.data.collection || [];
    
    // Check if our timeframe is in the available slots
    return availableTimes.some(slot => 
      new Date(slot.start_time).getTime() === new Date(startTime).getTime());
    
  } catch (error) {
    console.error('Calendly availability error:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Gets available time slots for a specific date
 * @param {string|Date} date - The date to check
 * @returns {Promise<Array>} Array of available slots with startTime and endTime
 */
async function getAvailableSlots(date) {
  try {
    const eventTypeUri = process.env.CALENDLY_EVENT_TYPE_URI;
    if (!eventTypeUri) {
      throw new Error("Missing CALENDLY_EVENT_TYPE_URI in environment variables");
    }
    
    const startOfDay = new Date(date);
    startOfDay.setUTCHours(0, 0, 0, 0);
    
    const endOfDay = new Date(startOfDay);
    endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);
    
    // Format dates for the API
    const formattedStartDate = startOfDay.toISOString();
    const formattedEndDate = endOfDay.toISOString();
    
    // Get available times from Calendly
    const response = await axios.get('https://api.calendly.com/event_type_available_times', {
      params: {
        event_type: eventTypeUri,
        start_time: formattedStartDate,
        end_time: formattedEndDate
      },
      headers: {
        Authorization: `Bearer ${process.env.CALENDLY_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    // Process Calendly's response
    const availableSlots = response.data.collection || [];
    
    // Map to our expected format and filter out any locked slots
    return availableSlots
      .filter(slot => {
        const startTimeIso = slot.start_time;
        return !lockedSlots.has(startTimeIso) || 
               lockedSlots.get(startTimeIso).expiresAt < Date.now();
      })
      .map(slot => ({
        startTime: slot.start_time,
        endTime: slot.end_time
      }));
      
  } catch (error) {
    console.error('Error getting available slots:', error.response?.data || error.message);
    return [];
  }
}

module.exports = {
  lockSlot,
  confirmSlot,
  releaseSlot,
  isSlotAvailable,
  getAvailableSlots
};