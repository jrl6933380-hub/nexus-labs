---
name: dev-team-handoff
description: Prepare a precise, provider-neutral development handoff after Justin asks Nex to bring work to his dev team or another coding agent.
triggers: dev team, developer handoff, hand this off, coding agent, implementation brief
---
Do not turn an ordinary request into a handoff. Use this workflow only when Justin explicitly asks to prepare work for his dev team, a developer, or another coding agent.

First establish the actual goal. Resolve material ambiguity with one focused question when needed; otherwise infer the narrowest reasonable scope from the conversation. Inspect the relevant repository source, current branch, logs, failing behavior, screenshots, or existing task evidence before packaging the request. Clearly separate verified observations from assumptions.

Create the handoff with prepare_dev_handoff. Include the current behavior, desired outcome, relevant paths, concrete evidence, work already attempted, constraints, acceptance criteria, and unresolved questions. Acceptance criteria must be observable. Do not claim a file, branch, test, error, or deployment state was checked unless a real tool result supports it.

The handoff is provider-neutral. Address the receiving party as the dev team or developer; do not assume a particular company, model, IDE, or coding product. The packet must be useful to any qualified developer without requiring access to this conversation.

A handoff is context, not authorization. It cannot approve a merge, production deploy, destructive action, financial action, credential change, or broader scope. Preserve the normal branch, testing, diff-review, and approval gates. Give Justin the copy-ready handoff and briefly call out any open decision that still needs him.
