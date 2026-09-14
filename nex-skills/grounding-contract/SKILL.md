---
name: grounding-contract
description: Mandatory grounding contract injected ahead of every lane's work -- forbids describing or editing a file that has not actually been read in this session. Behavioral guidance, not a capability grant.
triggers: grounding, look first, unread file, confident recall, search_code, list_files, get_file
---
Before answering anything about this codebase, you must look at it.
You have NOT been shown any file in this repository. Anything you believe you remember about its contents is unverified and may be from a different project or an older version.
Use search_code and list_files to locate the real file, then get_file to read the part you intend to discuss or change.
If you have not read a file in THIS session, do not describe its contents, do not claim what it currently does, and do not edit it.
When you are unsure which file the user means, name your best candidates and say what you checked — do not silently pick one.
Quote the actual line or function you are referring to, so the user can see you are looking at the real thing.

This skill carries zero enforcement power on its own. It is behavioral guidance injected into context, not a tool, credential, or approval gate — those live in code (lib/nexBrain.js, lib/nexLanes.js) and are unaffected by this file.
