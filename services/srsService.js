/**
 * SuperMemo 2 (SM-2) algorithm implementation.
 * @param {number} repetitions - Number of consecutive correct reviews (default: 0)
 * @param {number} interval - Previous review interval in days (default: 0)
 * @param {number} easeFactor - Ease factor of the card (default: 2.5)
 * @param {number} quality - Review quality from 0 to 5 (0 = blackout, 5 = perfect recall)
 * @returns {object} { repetitions, interval, easeFactor, nextReviewDate }
 */
function calculateSM2(repetitions, interval, easeFactor, quality) {
  // 1. Calculate new ease factor (EF)
  let newEaseFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (newEaseFactor < 1.3) {
    newEaseFactor = 1.3;
  }

  // 2. Calculate new repetitions and interval
  let newRepetitions = repetitions;
  let newInterval = interval;

  if (quality < 3) {
    // Incorrect answer: reset repetitions and interval to 1 day
    newRepetitions = 0;
    newInterval = 1;
  } else {
    // Correct answer: increment repetitions and calculate new interval
    if (newRepetitions === 0) {
      newInterval = 1;
    } else if (newRepetitions === 1) {
      newInterval = 6;
    } else {
      newInterval = Math.round(interval * newEaseFactor);
    }
    newRepetitions += 1;
  }

  // 3. Calculate next review date
  const nextReviewDate = new Date();
  nextReviewDate.setDate(nextReviewDate.getDate() + newInterval);
  // Normalize nextReviewDate to midnight for cleaner query checks
  nextReviewDate.setHours(0, 0, 0, 0);

  return {
    repetitions: newRepetitions,
    interval: newInterval,
    easeFactor: parseFloat(newEaseFactor.toFixed(2)),
    nextReviewDate
  };
}

module.exports = { calculateSM2 };
