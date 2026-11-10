/**
 * Hook output for Droid.
 *
 * Droid reads any non-empty stdout of a UserPromptSubmit hook as context, a
 * bare `{}` included, and keeps only the first context across all hooks. So a
 * hook writes JSON only when it has context to inject and stays silent
 * otherwise.
 */

export function contextEnvelope(hookEventName) {
  return (additionalContext) => {
    if (!additionalContext) return;
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } })}\n`);
  };
}

export function silentEnvelope() {}
