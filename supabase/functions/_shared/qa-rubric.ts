// THE SEVEN QA POINTS, WRITTEN DOWN.
//
// These rules are derived from the sales team's own WhatsApp assistant configurations - the funnel
// (greet -> buying intent -> configuration -> budget -> match -> ask for the visit -> confirm time ->
// share the address), the information the team is instructed never to give out over a message, and
// the tone rules. The same funnel appears identically across every RESIDENTIAL project's
// configuration, which is what makes it a company standard rather than one project's habit.
// Durbaar Banquets is the one venue that runs a different funnel, and the handful of other rules
// that genuinely vary by project - servant quarters, pick-up and drop, Dream Valley's 3BHK-only
// range, Dream One's fixed per-sqft rate - are carried in PROJECT_EXCEPTIONS in qa-prompt.ts, NOT
// here. That is deliberate: they name projects and figures, and this file must stay free of both.
//
// WHY THERE ARE NO FIGURES IN THIS FILE, AND WHY THERE MUST NEVER BE ANY. Every rule below is about
// what the AGENT DID - asked, answered, confirmed, disclosed - and none of it is a fact about a
// project. There is no price here, no square footage, no location and no possession date, so there is
// nothing in this text for a transcript to absorb.

export const QA_RUBRIC = `Score each point Pass, Fail or Partial against the definition given. Judge
only what the audio contains. Where a step never arose because the call ended early or the customer
refused to engage, say so in "notes" and do not fail the agent for it.

1. Script - did the call follow the company funnel, in order?
   The order is: greet and thank them for their interest -> establish whether they are actually
   looking to buy -> which configuration they want -> the size range for it -> their budget -> only
   then whether it matches.
   Pass    - the agent reached the budget question having covered intent and configuration first.
   Partial - the funnel was followed but a step was skipped or taken out of order.
   Fail    - the agent quoted prices or pitched units before establishing that the customer is
             buying, or ended a live conversation having never asked the configuration or budget.

2. Etiquette - how the agent conducted themselves.
   Pass    - identified themselves as calling from Jain Group about a named project, was courteous
             throughout, let the customer finish, and closed politely even when the answer was no.
   Partial - courteous but did not identify themselves or their project.
   Fail    - talked over the customer, was curt or argumentative, or hung up on a refusal without a
             polite close.
   Language mirroring belongs here: if the customer speaks Bengali or Hindi, the agent is expected to
   answer in that language. An agent who continues in English while the customer struggles is at best
   Partial.

3. Query Handling - were the customer's actual questions answered, accurately?
   Pass    - each question the customer asked got a direct answer, and where the agent did not know
             they said so and undertook to find out.
   Partial - answered, but vaguely, or deflected a question that had a straightforward answer.
   Fail    - invented an answer, passed the customer off to someone else instead of answering, named
             a competitor's project, steered the customer to a different Jain Group project than the
             one the call was about, or denied a fact about the project that is true.
   Asking for a configuration the project does not offer is handled by saying so plainly and offering
   what does exist - not by pretending it is available.

4. Call to Action - did the agent ask for the next step?
   The site visit is the objective of every call. A callback with a fixed time is the acceptable
   second best.
   Pass    - the agent explicitly asked the customer to visit the site, or agreed a callback.
   Partial - hinted at a visit ("you should come and see it sometime") without asking for one.
   Fail    - the call ended with the lead still live and neither a visit nor a callback proposed.
   Where the customer's requirements clearly matched what was on offer and the agent still did not
   ask for the visit, that is a Fail regardless of how well the rest of the call went.
   Where the customer declined the visit, the agent is expected to make the case once more before
   letting it go; not doing so is Partial.

5. Leakage Avoidance - did the agent give out what is only ever given at the site?
   These are settled at the project office, never over the phone: construction percentage complete,
   floor plans, which specific flats are unsold, the payment plan, the cost sheet, EMI workings,
   registration charges, individual room dimensions, maintenance charges, and whether two flats can
   be merged. Payment details are never sent as a link.
   Pass    - none of the above was disclosed, or the agent redirected the request to the site visit.
   Partial - disclosed something borderline, or gave an approximate figure while redirecting.
   Fail    - quoted any of the above over the phone.
   Offering a virtual or video site visit in place of a real one is also a Fail. Headline price and
   size range are NOT leakage - those are the agent's job.

6. Follow-up Accuracy - was what was agreed actually pinned down?
   Pass    - a visit was agreed with a specific day and time, confirmed back to the customer, and the
             address given; or a callback was agreed with a specific day and time and confirmed.
   Partial - a commitment was made but left vague ("sometime this weekend", "I will call you back").
   Fail    - the agent claimed something was agreed that the customer did not agree to, promised a
             callback with no time attached, or agreed a visit and never gave the address.

7. Hyper-personalization - did the agent use what the customer told them?
   Pass    - used the customer's name, and worked with at least one thing they volunteered - where
             they live or work, children (schools nearby), elderly parents (hospitals nearby), a
             budget shortfall (the home-loan route), or something from an earlier conversation.
   Partial - used the name but otherwise delivered the same pitch anyone would have received.
   Fail    - ignored what the customer volunteered, or contradicted it.
   A budget below the project's range is the specific test: the expected move is to raise the
   home-loan option and keep the lead, not to close the conversation. A budget above the range is not
   a problem at all - the customer stays qualified and is still asked for the visit.`;
