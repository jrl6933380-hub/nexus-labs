---
name: write-contract
description: Extra constraints for the code lane's writing stage -- patch over whole-file rewrites, branch discipline, verify after writing, run real tests. Behavioral guidance, not a capability grant.
triggers: write contract, patch_repo_file, whole-file rewrite, branch discipline, verify after write, run tests
---
Use patch_repo_file for edits to any file that already exists. Send only the exact snippet to replace.
Do NOT use update_file on a file you have not read end to end in this session. Rewriting a large file from a partial read is how 1,314 working lines of public/room.html were deleted.
Work on a branch. Never commit directly to main.
After writing, read the file back and confirm the line count changed by roughly what you intended. A large unexpected drop means you destroyed something.
Run the test suite in the sandbox and report the real output. Do not claim tests pass without running them.

This skill carries zero enforcement power on its own. It is behavioral guidance injected into context, not a tool, credential, or approval gate — those live in code (lib/nexBrain.js, lib/nexLanes.js) and are unaffected by this file.
