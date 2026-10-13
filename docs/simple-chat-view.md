# Optional Simple chat view

Owner Workspace and customer Nexus offer a Nexus view preference in Settings. Existing users
retain their current view until they choose it. The choice is stored on the device;
customer preferences use the signed-in username, separate from the owner key.
Explicit feature deep links still open that destination with Simple chat chrome.
Home/Messages links return to Simple chat while it is selected; Settings is the
only way to switch back to the current workspace. The owner’s last conversation
metadata is saved separately so workspace visits cannot erase the return target.

The simple surface uses the existing conversation and authenticated endpoints.
It does not run another agent, create another store, or change entitlements.
A small chat menu surfaces Calendar, Reminders, Projects, and Life cards, opens
Agents/chats, and provides Settings. Settings is the only place to change the view.
Choosing Current workspace returns to Messages. Owner team cards show one live status and teammate buttons, with the existing
assignment/progress/results controls inside See what everyone is doing. Questions,
blocked work, and approvals expand that section automatically. Saved builders
expose an Open saved build link; unsaved HTML previews use the existing safe frame.

Agenda, Reminders, Projects, and Life cards read saved account data on demand.
Related messages surface a fresh card after the existing assistant finishes.
Cards display at most three records and link to the full existing editing surface.
They show data, not proof that the latest message performed a mutation. Empty
states and unavailable endpoints are explicit; retry rereads the same service.
Cards are ephemeral and can be restored with the chat menu; conversations
continue to use the existing persistence. Life currently shows upcoming activities.

Customer chat retains its existing room-assistant capabilities: this UI does not
add owner team execution or schedule mutation tools to that assistant. Builds
continue through the existing Build with Nex action. No fabricated running-agent
cards, fake confirmations, or live pod claims are introduced.

Validation: scripts/verify-simple-chat.mjs boots both actual shells with local API
fixtures and native mobile taps at 320px and 393px. It verifies Settings-only view preferences, saved conversations, menu/read cards,
retry, preference reload, compact team progress, answering and resuming a real team
question path, saved build links, and no horizontal overflow.
No production accounts, model calls, or GPU pods are used.

Headers and menus preserve the iPhone safe-area inset. Browser checks also
simulate a 59px status area that intercepts taps, then verify accessible menu taps,
workspace-screen return, old Messages deep links, and conversation Back controls.
