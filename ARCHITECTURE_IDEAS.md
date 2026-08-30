# Architecture Ideas — Lessons from the Replit Call-Bot System

This documents a multi-agent system Mr. Lopez previously built and
sold on Replit, before Nex existed. It's captured here so the good
architectural ideas can inform Nex's future development, even though
the original system stays running independently on Replit/Twilio.

**Status: reference only. Not built into Nex. A future project, not
current scope.**

## What it was
An AI-powered cold-calling business. It found local businesses with
no website (or a weak one) despite having good reviews, pitched them
on building a site, and handled the outreach largely autonomously.
It made real money before this project (Nex) existed.

## The agents involved

**Scout bot** — a scraper, controlled by instructions from a lead
agent. Searched for and qualified businesses matching the target
profile (no website, or a subpar one, paired with good reviews).

**Nex (lead bot)** — directed the Scout bot on what to search for
and interpreted what it found. (Note: this is where the name "Nex"
originally came from, before it became the current assistant's
identity.)

**Jordan (call bot)** — the actual outbound caller, built on Twilio.
Got fed qualified leads from the lead/scout pipeline. For each call:
- Showed Mr. Lopez the exact pitch it planned to use *before*
  calling — propose-then-approve, the same pattern Nex uses today.
- Attached a confidence score to each pitch, plus reasoning for why
  that specific script was chosen for that specific business.
- Looked up local details about the business ahead of time, so the
  call felt warm/researched rather than a cold generic script.
- After the call, self-graded its own performance and saved a
  "lesson" from it — a structured, self-directed memory system for
  improving future calls, distinct from Nex's current save_memory
  tool but conceptually similar.

**Trainer bot** — a separate adversarial bot used to practice Jordan
before real calls. Roleplayed as a tough customer, with different
configurable personality types, so Jordan could rehearse against
resistance before facing a real prospect.

## Why this is worth remembering
Several of these patterns were independently arrived at again while
building Nex, months later:
- Propose-then-approve before a risky action (Jordan showing the
  pitch first → Nex's approval queue)
- Self-directed memory that improves the agent over time (Jordan's
  call lessons → Nex's save_memory tool)
- Tool use to gather context before acting (local business lookup →
  Nex's list_repo_files before editing)

The parts NOT yet rebuilt in Nex, and genuinely new territory if
ever pursued:
- Real telephony (Twilio integration) — a different technical domain
  entirely from anything Nex currently does
- Confidence scoring on generated content/decisions
- An adversarial training bot that practices another agent by
  roleplaying difficulty, rather than just testing against fixed
  cases

## If this is ever revisited
This would be a deliberate, separate project — not a natural
extension of Nex's current GitHub/Vercel-focused capabilities.
Telephony alone is a big enough scope to warrant its own dedicated
build, similar in size to the original MCP connector work.
