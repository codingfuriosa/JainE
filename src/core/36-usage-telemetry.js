/* ============================ USAGE TELEMETRY ============================
   Records WHICH FEATURE a person just used, so the Usability screen has something to count.

   Done by wrapping the global functions the buttons already call, from one map, instead of editing
   ~110 call sites. Three reasons: the call sites stay untouched so nothing can break by accident, a
   feature added later is one line here rather than a hunt through 600KB, and the map doubles as a
   readable statement of which button means which feature.

   The wrapper must be incapable of breaking the app it measures: the logging is inside its own
   try/catch, and the original function is called through unconditionally whatever happens. Events
   are queued and sent in batches, never one request per click. */
