# Optional Simple chat view

Owner Workspace and customer Nexus expose a Simple chat switch. Existing users
retain their current view until they choose it. The choice is stored on the device;
customer preferences use the signed-in username, separate from the owner key.
Explicit deep links still open the requested destination.

The simple surface uses the existing conversation and authenticated endpoints.
It does not run another agent, create another store, or change entitlements.
Workspace opens Calendar, Reminders, Projects, Life, and Agents/chats. Current view
returns to Messages. Owner team execution, progress, questions, retries, and safe
build previews retain their existing controls.

Agenda, Reminders, Projects, and Life cards read saved account data on demand.
Related messages surface a fresh card after the existing assistant finishes.
Cards display at most three records and link to the full existing editing surface.
They show data, not proof that the latest message performed a mutation. Empty
states and unavailable endpoints are explicit; retry rereads the same service.
Cards are ephemeral and can be restored with the quick controls; conversations
continue to use the existing persistence. Life currently shows upcoming activities.

Customer chat retains its existing room-assistant capabilities: this UI does not
add owner team execution or schedule mutation tools to that assistant. Builds
continue through the existing Build with Nex action. No fabricated running-agent
cards, fake confirmations, or live pod claims are introduced.

Validation: scripts/verify-simple-chat.mjs boots both actual shells with local API
fixtures and native mobile taps at 320px and 393px. It verifies saved conversation,
read cards, retry, remembered preference, view switching, and no horizontal overflow.
No production accounts, model calls, or GPU pods are used.
