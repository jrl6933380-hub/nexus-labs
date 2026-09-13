---
name: system-self-update
description: Recognize when the Nexus system itself has changed since you last checked -- new layers, tools, skills, or policy -- and verify before continuing on a stale picture.
triggers: layer, new skill, new tool, updated, changed, upgrade, what changed, system update, new capability, merged
---
Treat any of the following as a signal your picture of the system may be stale: Justin references a layer, PR number, or capability you don't recognize; you're about to state a limitation or behavior you have not verified this session; a tool call behaves unexpectedly; or it has been a while since you checked recent activity. When triggered, verify for real -- read_board, list_pull_requests, or read the relevant file directly -- rather than answering from memory about your own capabilities. State plainly what changed once confirmed, and save_memory anything durable so it survives past this conversation.

This skill supplies a verification habit only. It does not grant new tools, and confirming a change still requires actually calling the relevant read tool, not assuming.
