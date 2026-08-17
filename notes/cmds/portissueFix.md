That's a port conflict — something is already bound to **3001** (almost certainly leftover host mock processes or a previous partial stack), so the compose `accounts-rest` can't publish it. Let me diagnose and clear it:

Found it — leftover **host mock servers** (`node server.js` on 3001/3002/3003) from earlier host testing are clashing with the compose stack's mocks. Let me kill them and bring the stack up cleanly:

Fixed — the stack is up and healthy. Quick end-to-end confirmation:

Working — query resolves and 3 entity-cache keys are present. The stack is up and ready for you at `http://localhost:5060/graphql`.

## What the error was
Not a bug in the compose file — **leftover host mock servers** (`node server.js` on ports 3001/3002/3003, from an earlier host-based test run) were still running and holding those ports, so the compose `accounts-rest`/`funds-rest`/`policies-rest` containers couldn't publish them. I killed those three processes and the stack came up clean.

## If it happens again — the fix
```bash
# 1. clear any partial stack
docker compose -f docker-compose.gateway.yml down --remove-orphans

# 2. free the ports (kills whatever host process holds them)
for p in 3001 3002 3003 3009 6379 5060; do
  pid=$(lsof -tiTCP:$p -sTCP:LISTEN 2>/dev/null); [ -n "$pid" ] && kill "$pid"
done

# 3. bring it up again
docker compose -f docker-compose.gateway.yml up --build -d
```

Tip: the `scripts/run-redis-cache-test.sh` / `run-valkey-cache-test.sh` scripts start with `compose down -v`, which avoids the *partial-stack* version of this — but they can't kill **host** `node` processes on those ports. The root cause here was those stray host mocks; once killed, you're clear.

The stack is currently running (Redis backend). Tear down when done:
```bash
docker compose -f docker-compose.gateway.yml down -v
```