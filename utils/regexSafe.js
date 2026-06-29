/**
 * Escapes special regex characters so user-supplied strings can be safely
 * embedded inside a MongoDB $regex query, preventing regex injection and
 * ReDoS via crafted patterns (e.g. catastrophic backtracking).
 */
function escapeRegExp(str) {
  if (typeof str !== "string") return "";
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Safe, case-insensitive EXACT match filter.
 * Use for filename lookups where you want one specific file, not a substring search.
 */
function exactNameFilter(rawInput) {
  const escaped = escapeRegExp((rawInput || "").trim());
  return { $regex: new RegExp(`^${escaped}$`, "i") };
}

/**
 * Safe, case-insensitive "contains" filter.
 * Use only when partial/substring matching is the actual intended behavior
 * (e.g. /start "machine learning" matching "Machine Learning Notes.pdf").
 */
function containsFilter(rawInput) {
  const escaped = escapeRegExp((rawInput || "").trim());
  return { $regex: new RegExp(escaped, "i") };
}

module.exports = { escapeRegExp, exactNameFilter, containsFilter };
