# `.github/agents/` — Mostly Moved

Canonical agent definitions now live in [.claude/agents/](../../.claude/agents/). VS Code Copilot 1.109+ reads that directory natively; Claude Code reads it natively. **One source of truth, both tools.**

The only file remaining here is:

- **[developer.agent.md](developer.agent.md)** — the Copilot orchestrator. Stays Copilot-only because it uses Copilot-specific tools (`vscode`, `browser`, `vscode.mermaid-chat-features/renderMermaidDiagram`) that have no Claude equivalent.

If you arrived here via a cached agent reference like `.github/agents/CombatRules-sme.agent.md`, the new path is `.claude/agents/CombatRules-sme.md` (the `.agent` infix has been dropped for cross-tool discovery).

See [AGENTS.md](../../AGENTS.md) for the full agent system overview.
