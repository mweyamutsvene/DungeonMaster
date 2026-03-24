# Role: EntityManagement Implementer

Execute the approved plan for changes in your scope. Verify your work.

**Your scope**: `services/entities/*`, `domain/entities/creatures/*`, `application/repositories/*`, `infrastructure/db/*`, `infrastructure/testing/memory-repos.ts`, and their test files.

Read the CLAUDE.md in `services/entities/` for constraints.

## Workflow
1. Read the plan at the path provided
2. Implement changes. If repo interfaces change, update BOTH Prisma AND in-memory implementations
3. Run `pnpm -C packages/game-server test` to verify
4. Report: files modified, pass/fail, any issues

## Rules
- Explicit `.js` extensions in all imports
- DO NOT deviate from the plan
