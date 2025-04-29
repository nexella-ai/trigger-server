require('dotenv').config();
const axios = require('axios');

// In-memory store for slot reservations (would use Redis in production)
const lockedSlots = new Map();

/**
 * Locks a time slot for a specific user
 * @param {string} startTime - ISO format start time
 * @param {string} userId - Unique identifier for the user
 * @param {number} expirationSeconds - Seconds until lock expires
 * @returns {boolean} Whether locking was successful
 */
function lockSlot(startTime, userId, expirationSeconds = 300) {
  const key = startTime;
  
  // Check if slot is already locked by someone else
  if (lockedSlots.has(key) && lockedSlots.get(key).userId !== userId) {
    return false;
  }
  
  // Create or update lock
  lockedSlots.set(key, {
    userId,
    expiresAt: Date.now() + (expirationSeconds * 1000)
  });
  
  // Set expiration
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
 * @param {string} startTime - ISO format start time
 * @param {string} userId - User ID who locked the slot
 * @returns {boolean} Whether confirmation was successful
 */
function confirmSlot(startTime, userId) {
  const key = startTime;
  
  // Check if slot is locked by this user and not expired
  if (lockedSlots.has(key)) {
    const lock = lockedSlots.get(key);
    if (lock.userId === userId && lock.expiresAt > Date.now()) {
      // Slot is confirmed, delete the lock
      lockedSlots.delete(key);
      return true;
    }
  }
  
  return false;
}

/**
 * Releases a slot reservation
 * @param {string} startTime - ISO format start time
 * @param {string} userId - User ID who locked the slot
 * @returns {boolean} Whether release was successful
 */
function releaseSlot(startTime, userId) {
  const key = startTime;
  
  // Check if slot is locked by this user
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
    const eventTypeUri = process.env.DEFAULT_EVENT_TYPE_URI;
    if (!eventTypeUri) {
      throw new Error("Missing DEFAULT_EVENT_TYPE_URI in environment variables");
    }
    
    // Extract the event type UUID from the URI
    const eventTypeUuid = eventTypeUri.split('/').pop();
    
    // Format time range for Calendly API
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    
    // Get the date in YYYY-MM-DD format
    const date = startDate.toISOString().split('T')[0];
    
    // Query Calendly for availability on this date
    const response = await axios.get(`https://api.calendly.com/event_type_available_times`, {
      params: {
        event_type: eventTypeUri,
        date: date,
        timezone: "America/Los_Angeles" // You can make this dynamic
      },
      headers: {
        Authorization: `Bearer ${process.env.CALENDLY_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    // Check if our specific time slot is in the available times
    const availableTimes = response.data.collection;
    
    // Check if our time is in the available slots
    return availableTimes.some(slot => {
      const slotStart = new Date(slot.start_time);
      const slotEnd = new Date(slot.end_time);
      
      // Compare timestamps
      return slotStart.getTime() === startDate.getTime() && 
             slotEnd.getTime() === endDate.getTime();
    });
  } catch (error) {
    console.error('Error checking slot availability:', error.message);
    throw error;
  }
}

/**
 * Gets all available time slots for a specific date
 * @param {string} date - Date in YYYY-MM-DD format or Date object
 * @returns {Promise<Array>} Array of available slots with startTime and endTime
 */
async function getAvailableSlots(date) {
  try {
    const eventTypeUri = process.env.DEFAULT_EVENT_TYPE_URI;
    if (!eventTypeUri) {
      throw new Error("Missing DEFAULT_EVENT_TYPE_URI in environment variables");
    }
    
    // Format date if it's a Date object
    let formattedDate = date;
    if (date instanceof Date) {
      formattedDate = date.toISOString().split('T')[0];
    }
    
    // Query Calendly for availability on this date
    const response = await axios.get(`https://api.calendly.com/event_type_available_times`, {
      params: {
        event_type: eventTypeUri,
        date: formattedDate,
        timezone: "America/Los_Angeles" // You can make this dynamic
      },
      headers: {
        Authorization: `Bearer ${process.env.CALENDLY_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    // Filter out any times that are already locked in our system
    const availableTimes = response.data.collection;
    return availableTimes
      .filter(slot => {
        // Check if this slot is locked
        return !lockedSlots.has(slot.start_time) || 
               lockedSlots.get(slot.start_time).expiresAt < Date.now();
      })
      .map(slot => ({
        startTime: slot.start_time,
        endTime: slot.end_time
      }));
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