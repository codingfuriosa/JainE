// Picks which Aadhaar record belongs to the primary applicant, when there's more than
// one candidate (applicant + co-applicant, etc). A plain HTTPS call to the Messages
// API -- not an agentic browser tool -- used only for this one judgment call;
// everything else in mapping.js is deterministic.
//
// Fails closed: if the model's answer isn't verbatim one of the candidate numbers,
// this returns null (blank cell + a note) rather than risk a hallucinated value on a
// financial/PII record.
export async function pickPrimaryApplicantAadhaar(config, candidates, applicantName, applicantPan) {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].number ?? null;

  const prompt = `A Booking Form was OCR'd and found ${candidates.length} Aadhaar (Indian ID) records. ` +
    `Pick the one belonging to the PRIMARY applicant.\n\n` +
    `Primary applicant name: ${applicantName || '(unknown)'}\n` +
    `Primary applicant PAN: ${applicantPan || '(unknown)'}\n\n` +
    `Candidates:\n${candidates.map((c, i) =>
      `${i + 1}. number=${c.number}, name_on_card=${c.name_on_card}, relation=${c.relation ?? '(none)'}`
    ).join('\n')}\n\n` +
    `Reply with ONLY a JSON object, no other text: {"aadhaar_number": "<one of the candidate numbers, verbatim>"}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.anthropicApiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    console.warn('claude-decision: API call failed', res.status);
    return null;
  }

  const data = await res.json();
  const text = data?.content?.find((b) => b.type === 'text')?.text ?? '';

  let parsed;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    console.warn('claude-decision: response was not valid JSON', text);
    return null;
  }

  const candidateNumbers = candidates.map((c) => c.number);
  if (!candidateNumbers.includes(parsed.aadhaar_number)) {
    console.warn('claude-decision: answer was not one of the candidates, discarding', parsed.aadhaar_number);
    return null;
  }

  return parsed.aadhaar_number;
}
