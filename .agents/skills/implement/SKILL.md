---
name: implement
description: Implement a feature or change in reviewed steps. Plan the work as independently verified commits, then build one step at a time for the user to review and commit. Use when the user invokes /implement or requests this step-by-step workflow for work described in text or docs/.
---

# implement

Plan first. After the user approves the plan, build one proposed commit at a time. The user reviews and commits each step. Never commit or push.

## Phase 1: plan

Read the requested specification and other relevant documents in `docs/`. Use `docs/` as the source of project context. Read the affected code, nearby working examples, and their tests. Inspect `pyproject.toml`, `.pre-commit-config.yaml`, and any Pyright or pytest configuration before choosing commands.

Present a concise plan with:

1. The behavior the change adds and the packages it touches.
2. Design decisions and assumptions, with reasons.
3. Proposed commits, including files, tests, and what makes each step pass on its own.
4. Work outside the scope, where needed to make the boundary clear.

Ask only when missing information changes the implementation materially. If the request conflicts with requirements in `docs/`, explain the conflict and ask the user to resolve it.

Stop and wait for plan approval before changing implementation code. Existing approval for the same plan is sufficient; do not ask again.

## Phase 2: build one proposed commit

Implement only the current step. Match nearby naming, structure, error handling, and test style.

### Python requirements

- Use the project `.venv` for Python commands and dependencies. Use `.venv/bin/python` and tools from `.venv/bin`, or activate `.venv` first. Do not use global Python packages as a substitute.
- Type all Python code, including tests and helpers. Add `# pyright: strict` at the top of every new or modified Python file.
- Use Pyright for type checking. Fix type errors rather than weakening strictness or adding blanket ignores.
- Use pytest for tests. Cover the changed behavior, including relevant failure paths. Keep tests focused on observable behavior and identify any material gaps.
- Keep relevant project documentation in `docs/` consistent with changes to behavior or design.

### Verification

Before handing the step to the user, run from the repository root:

```sh
.venv/bin/python -m pre_commit run --all-files
.venv/bin/pyright
.venv/bin/python -m pytest
```

Use the project's configured equivalents if these tools have dedicated commands or configuration. Include all changed Python files in type checking, including tests. Pre-commit, strict Pyright checks, and applicable pytest tests must pass before calling a step ready. If a hook changes files, inspect its edits and rerun the affected checks.

If a required tool is missing, set it up in `.venv` using the project's dependency conventions. If permissions or external dependencies block a check, report the command and blocker. Do not report unrun or failed checks as passing. A pytest run that collects no tests is not evidence that behavior works; explain when a documentation-only step has no applicable tests.

Report the behavior changed, verification results, and decisions or limitations that need review. Suggest a commit message consistent with `git log`. Keep the report concise.

Stop for the user to review and commit. Do not start the next step or run `git commit` or `git push`.

## Phase 3: resume

When the user asks to continue, read `git status --short`, `git log --oneline -3`, and `git show --stat HEAD`. Inspect relevant changes made during review and treat them as the current state. Preserve user edits. If they conflict with the approved plan or leave a step incomplete, explain the issue before continuing.

Build the next approved step and repeat verification and review until the plan is complete.
