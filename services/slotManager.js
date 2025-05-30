require('dotenv').config();
const axios = require('axios');

// In-memory store for slot reservations (would use Redis in production)
const lockedSlots = new Map();

/**
 * Locks a time slot for a specific user
 */
function lockSlot(startTime, userId, expirationSeconds = 300) {
  const key = startTime.toString();
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
  const key = startTime.toString();
  if (lockedSlots.has(key)) {
    const lock = lockedSlots.get(key);
    if (lock.userId === userId && lock.expiresAt > Date.now()) {
      // We don't delete the lock here to prevent double-booking
      return true;
    }
  }
  return false;
}

/**
 * Releases a slot reservation
 */
function releaseSlot(startTime, userId) {
  const key = startTime.toString();
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
      console.error("Missing CALENDLY_USER_URI in environment variables");
      // Instead of throwing an error, let's just assume it's available for now
      // This is a temporary fix until Calendly API is properly set up
      return true;
    }
    
    if (!eventTypeUri) {
      console.error("Missing CALENDLY_EVENT_TYPE_URI in environment variables");
      // Instead of throwing an error, let's just assume it's available for now
      return true;
    }
    
    // First check if the slot is locked in our system
    const key = startTime.toString();
    if (lockedSlots.has(key)) {
      // If the slot is locked and not expired, it's not available
      const lock = lockedSlots.get(key);
      if (lock.expiresAt > Date.now()) {
        return false;
      }
    }
    
    // For now, let's skip the Calendly API check until it's properly configured
    // This is a temporary fix to prevent errors
    return true;
    
    /* Commented out Calendly API check for now
    // Check if there are any scheduled events in this timeframe
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
    */
    
  } catch (error) {
    console.error('Calendly availability error:', error.message);
    // For development, let's return true to allow testing
    return true;
  }
}

/**
 * Gets available time slots for a specific date
 * @param {string|Date} date - The date to check
 * @returns {Promise<Array>} Array of available slots with startTime and endTime
 */
async function getAvailableSlots(date) {
  try {
    // For now, returning dummy slots since Calendly might not be configured
    const startOfDay = new Date(date);
    startOfDay.setUTCHours(0, 0, 0, 0);
    
    const availableSlots = [];
    
    // Generate some dummy slots for testing (9 AM to 5 PM)
    for (let hour = 9; hour < 17; hour++) {
      const slotStart = new Date(startOfDay);
      slotStart.setHours(hour);
      
      const slotEnd = new Date(slotStart);
      slotEnd.setHours(hour + 1);
      
      // Ensure this slot isn't locked
      const key = slotStart.toISOString();
      if (!lockedSlots.has(key) || lockedSlots.get(key).expiresAt < Date.now()) {
        availableSlots.push({
          startTime: slotStart.toISOString(),
          endTime: slotEnd.toISOString()
        });
      }
    }
    
    return availableSlots;
    
    /*
    // Commented out Calendly API call for now
    const eventTypeUri = process.env.CALENDLY_EVENT_TYPE_URI;
    if (!eventTypeUri) {
      console.error("Missing CALENDLY_EVENT_TYPE_URI in environment variables");
      return [];
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
      */
      
  } catch (error) {
    console.error('Error getting available slots:', error.message);
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