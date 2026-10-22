# Backend CI Quality Gates

The `Backend quality and integration tests` job runs on pushes and pull
requests. It installs the locked dependencies with `npm ci`, runs TypeScript
type checking, executes unit tests serially, and then runs the in-process
integration suite.

Run the same checks locally from the repository root:

```sh
cd backend
npm ci
npm run type-check
npm test -- --runInBand
npm run test:integration
```

## Credentials and Services

The backend quality job requires no GitHub secrets, production credentials,
database, Redis instance, wallet, or live Stellar RPC endpoint. Keep unit and
integration fixtures local and mock external boundaries. The workflow grants
only `contents: read` to its GitHub token and does not deploy or mutate hosted
environments.

## Rollback

These gates only validate code and do not change runtime infrastructure. If a
workflow change blocks otherwise valid contributions, revert the workflow and
documentation commit to restore the previous CI behavior, then correct and
reapply the gate in a follow-up change.