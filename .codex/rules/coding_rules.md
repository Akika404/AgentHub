# Think Before Coding

- Requirements must be clear before implementing a new feature.
- If requirements are ambiguous or incomplete, ask the user for clarification first.
- Follow existing project conventions, architecture, naming patterns, and coding style.
- Do not fix unrelated issues unless explicitly requested.
- Do not assume unspecified requirements or behaviors, if multiple interpretations exist, present them - don't pick silently.
- If the requested design is clearly unreasonable, or there is a clearly superior solution in the current project arch, explain the concern and ask the user before changing the design.
- If a new feature is a relatively independent module, create an appropriate localized structure for it, following existing project conventions and sound engineering practices. Avoid cramming independent logic into unrelated files just to minimize changes. However, do not over-engineer, introduce unnecessary abstractions, or perform broad refactoring unless required and approved.

# Auto Testing

After completing code changes, always run the minimal relevant tests before finishing the task.

Do NOT automatically run tests in the following situations:

- Pure visual UI changes that do not affect functionality, such as colors, fonts, spacing, or styling.
- Running tests requires additional environment setup that may pollute or alter the current environment.
- The required test execution time is significantly long relative to the scope of the change.

# Think After Coding

- After completing any feature addition or modification, always check for related documentation (e.g., README.md, the project's /doc folder). If the changes cause the actual implementation to diverge from the existing docs, update them to keep everything consistent.
- Explicitly call out any TODOs, known limitations, skipped edge cases, or follow-up work introduced by this change.

# When Commit

- Proactively suggest a commit after completing an independent change
- Strictly follow Conventional Commits: `type(scope): description`
- Allowed types: feat, fix, refactor, style, docs, test, chore, perf
- scope: affected module name (lowercase), separate multiple modules with commas, use `*` if unsure
- description: lowercase, concise, describe "what was done" (not how)
- Example: `feat(desktop): skeleton loaders for list/message loading states`
