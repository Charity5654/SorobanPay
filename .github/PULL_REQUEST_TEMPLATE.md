## Summary

<!-- What does this PR do? A concise paragraph or a short bullet list. -->

## Related Issues

<!-- Link every issue this PR addresses. Use "Closes" so the issue auto-closes on merge. -->
- Closes #

## Changes

<!-- List the specific files or components modified. -->
- `contracts/subscription/` —
- `frontend/` —
- `backend/` —
- `docs/` —
- `deploy/` —

## Testing Performed

<!-- Describe what you ran and what you observed. -->

### Contract
- [ ] `make test` — all tests pass
- [ ] Testnet deployment verified with `bash deploy/deploy.sh`
- [ ] Manual `stellar contract invoke` smoke test

### Frontend
- [ ] `npm run type-check` passes
- [ ] `next lint` — no new warnings
- [ ] Tested in browser with Freighter on testnet
- [ ] Responsive layout checked (mobile + desktop)

### Backend
- [ ] `npm test` (Jest) — all tests pass
- [ ] Integration test against testnet RPC
- [ ] Health endpoint (`GET /health`) returns `200`

## Breaking Changes

<!-- Does this PR change any public interface, storage layout, event schema, or API contract?
     If yes, describe what downstream consumers must update. -->
- [ ] No breaking changes
- [ ] Yes — describe: 

## Screenshots / Demo

<!-- For UI changes, paste before/after screenshots or a short GIF. -->

## Checklist

- [ ] Tests added or updated for new/changed behavior
- [ ] `CHANGES.md` updated (if this is a user-facing change)
- [ ] Relevant docs (`docs/`, `README.md`) updated
- [ ] No secrets, API keys, or `.env` values committed
- [ ] Branch is up-to-date with `main`
- [ ] PR title is concise (≤ 70 characters)
- [ ] Self-reviewed the diff before requesting review
