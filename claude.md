---
Project status: Prototype
Instructions: Prototype lives inside `gig-collective.html`. One file. Not changing until Nick says so. No framework migrations, no build systems, no backend suggestions unless asked. Chip away one feature at a time. Ask one question before starting if anything is ambiguous. Don't touch anything outside the scope of what was asked.
---

## File index
| File | What it is | When to read it |
|---|---|---|
| `gig-collective.html` | The prototype | Every session, before anything else |
| `handoff.md` | Architecture, data model, design tokens, principles | When you need to understand how something is built or why |
| `ux.md` | Every screen, its components, interactions — current state | When working on any screen; update it after changes |
| `journal.md` | Append-only decisions log | When you need history; append after every session with a real decision |

--

## Maintaining journal.md
Append an entry after any session where a decision was made — feature added, approach rejected, principle clarified.

Format:
```
## YYYY-MM-DD — [one line describing what happened]
[2–4 sentences: what we did, why, and what a future Claude needs to know to not undo it]
```
--
## Maintaining ux.md
Update the relevant section in `ux.md` after any session where a screen is added, changed, or removed.

Rules:
- Edit the section in place — don't append. `ux.md` reflects current state, not history (that's journal.md).
- Match what's actually in `gig-collective.html`. No speculative or planned content.
- Be specific enough that a future Claude could reconstruct the screen without reading the HTML.
- Note component names, interaction behaviors, edge cases, and anything non-obvious.
- If a screen is removed, remove its section.

