# Compose Health Checks

Postgres and Redis provide dependency health checks. The indexer and development API use their HTTP liveness routes, while the development frontend checks its local root response. The dev API waits for healthy Postgres and Redis before starting. Liveness checks intentionally avoid Stellar RPC calls so a temporary upstream outage does not report a dead process.

Validate both supported configurations without starting containers or using credentials:

```bash
CONTRACT_ID=CTEST000000000000000000000000000000000000000000000000000000000000 docker compose -f docker-compose.yml config
CONTRACT_ID=CTEST000000000000000000000000000000000000000000000000000000000000 docker compose -f docker-compose.yml -f docker-compose.dev.yml config
```

The same checks run on pull requests. They need no secrets; the example contract ID is only for Compose variable interpolation. For a local runtime, set `CONTRACT_ID` to a contract on the selected network.

Inspect `docker compose ps` for health state and `docker compose logs <service>` for failures. Compose reports an unhealthy container but does not restart it solely because of an unhealthy check; fix the dependency/configuration and restart the affected service. To roll back a Compose change, restore the previous configuration and run `docker compose up -d` again. Do not use `docker compose down -v` for rollback because it deletes Postgres and Redis data volumes.
