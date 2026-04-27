# Error Contract

## Standard Error Envelope

The Fastify error handler returns:

- `400`: `{ "error": "ValidationError", "message": string }`
- `404`: `{ "error": "NotFoundError", "message": string }`
- `409`: `{ "error": "ConflictError", "message": string }`
- `500`: `{ "error": "InternalServerError", "message": "Internal Server Error" }`

## Common Validation Errors

- Missing required fields (`text`, `actorId`, `encounterId`, `pendingActionId`, `combatantId`, `opportunityId`)
- Invalid rest type (must be `short` or `long`)
- Invalid NPC payload shape (must provide exactly one representation: statBlock or class-backed fields)
- Invalid reaction choice (must be `use` or `decline`)
- Invalid inventory quantity/attunement constraints
- Invalid combat override patch (no fields to patch)

## Common Not Found Errors

- Session, character, monster, encounter, pending action, or reaction opportunity not found
- Cross-session ownership mismatch for character/monster/NPC operations

## Client Guidance

- Do not parse errors by status code only. Use both `error` and `message`.
- Preserve server error messages in logs for fast troubleshooting.
- Treat `409` as retriable only when operation is idempotent or explicitly safe to retry.
