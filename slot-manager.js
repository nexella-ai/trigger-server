// slot-manager.js

const offeredSlots = new Map();

function offerSlot(slotTime, userId) {
  offeredSlots.set(slotTime, {
    userId,
    timestamp: Date.now()
  });

  // Auto-expire after 10 minutes
  setTimeout(() => {
    const slot = offeredSlots.get(slotTime);
    if (slot && slot.userId === userId) {
      offeredSlots.delete(slotTime);
      console.log(`Slot ${slotTime} released after timeout.`);
    }
  }, 10 * 60 * 1000); // 10 minutes
}

function isSlotAvailable(slotTime) {
  return !offeredSlots.has(slotTime);
}

function confirmSlot(slotTime, userId) {
  const slot = offeredSlots.get(slotTime);
  if (slot && slot.userId === userId) {
    offeredSlots.delete(slotTime);
    return true;
  }
  return false;
}

module.exports = {
  offerSlot,
  isSlotAvailable,
  confirmSlot
};
