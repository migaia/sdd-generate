# Decision authority

Load when a choice may need user authority: scope change or Must-Ship deferral, breaking public API, ownership move, behavior deletion, material risk, irreversible or external effects, or a choice the user reserved.

## Whose choice it is

User authorization is reserved for changing Must-Ship scope, deferring Must-Ship, accepting material security or data risk, breaking a public API, moving major ownership, deleting behavior, performing an irreversible or external action, or a product choice the user or the SDD reserved. Declaring as a non-goal an outcome the user discussed, when that removes or visibly degrades what the user asked for, is a Must-Ship scope change; a claim that the user confirmed something cites the `USER_STATED` fact. Record the boolean authority-effect delta with evidence for each true value; when every value is false, the choice belongs to the design owner (and later Coordinator), not the user. An ordinary reversible technical detail with one evidence-backed dominant route inside the approved scope, ownership, API, behavior and risk boundaries is decided and recorded, never asked.

## Close decisions across the whole graph

Before the first implementation batch, inventory every known change to package ownership, dependency direction, public exports and API, directly affected consumers, breaking behavior and approval authority across all Must-Ship requirements, not only the first batch. Ask for every currently knowable decision together. Encode each unresolved choice as a predecessor Must-Ship decision requirement that affected requirements depend on; never hide it in rationale, a repair direction, a packet precondition, a risk or a stop condition. A decision resolves only from explicit authority evidence, and the SDD stays `in-review` and non-loop-ready while any is pending.

## Authorization brief

Each genuine request is self-contained: the scenario and cause, current and proposed behavior (short repository-language examples or precise pseudocode only when they distinguish the options), affected packages and consumers, runtime and compatibility impact, destructive or irreversible effects and reversibility, every real option with trade-offs, the evidence-backed recommendation, the exact authority boundary crossed, the effect of declining or deferring, and the authority-effect delta. When only one viable route exists, say so and ask only for permission to cross the boundary; do not manufacture alternatives. Scale detail to the decision.
