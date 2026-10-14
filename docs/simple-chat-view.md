# Simple chat over the Nexus workspace

Settings → Nexus view chooses the presentation on this device. Existing workspace
screens remain available. Headers and menus preserve iPhone safe-area insets.

Entering Simple chat or opening its main chat page starts a fresh Nex conversation.
The header and side menu use the same New conversation action, including from
a team or team-creation screen. Fresh chats offer Calendar, Reminders, Projects,
and Life buttons that open their interactive cards directly. The menu also lists
Recent conversations. Opening a recent thread
is explicit; visiting a workspace screen and returning to Conversation keeps that
active thread. Reloading the chat starts fresh again. Empty conversations are not
saved as recent chats. Owner threads use the existing authenticated chat store.
Customer threads use validated nexus-chat-* IDs within their authenticated account,
with a separate customer-scoped index and support for their earlier nex-main chat.
No other customer or project conversation can be selected through the thread ID.

Calendar and Reminders cards embed the same interactive components used by their
full screens: calendar modes, time changes and existing entry controls; reminder
completion, snooze, notes and editing. Life also reuses its existing component.
Existing entitlement checks and server-side validation remain in force. Some
Calendar entry/edit actions open the existing full form. Workspace cards are
shown from the menu or after related conversation requests and are ephemeral.

Projects read the authenticated saved-project list and current saved HTML. The
card contains a project picker and an interactive sandboxed preview, with Open
project and Edit with Nex actions. Frames allow scripts and forms but retain opaque
origins: no same-origin, parent navigation, popups or download permissions are added.
A missing saved preview is an explicit error, not a replacement/generated mockup.

Owner team cards retain real progress, expandable agent work, questions/resume,
existing approvals and safe build previews. Customer chat retains its current
assistant abilities; this presentation does not add private owner tools or team
execution. In-flight customer replies remain tied to the conversation that sent
them even if the user starts another chat.

Validation uses actual owner/customer browser shells at 320px and 393px with
isolated Planner/Reminder/Workbench stores, fixture conversation responses, and
no paid model/pod or production calls. Tests cover fresh entry, sidebar recents,
new conversation, calendar modes and saved time changes, reminder completion
persistence, actual saved HTML interaction, safe areas, reload and view settings.
