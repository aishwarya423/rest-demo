# REST extension example

This example demonstrates how to use the [REST extension](https://grafbase.com/extensions/rest) to integrate the [REST Countries API](https://restcountries.com/) declaratively with the Grafbase Gateway.

## Quickstart

- Start the Grafbase development server: `npx grafbase dev`
- Explore the GraphQL API: `http://localhost:5000`


https://github.com/grafbase/grafbase/tree/main/examples/rest-extension


Useful cmds
npx grafbase dev --port 5050

docker compose up --build -d
main----
docker compose down && docker compose up --build -d && sleep 5 && docker compose ps

docker compose build --no-cache grafbase

docker useful cmds

docker compose down --remove-orphans && lsof -iTCP:3001 -sTCP:LISTEN | grep -v COMMAND | awk '{print $2}' | xargs kill -9 2>/dev/null || true && sleep 2 && docker compose up --build -d && sleep 5 && docker compose ps