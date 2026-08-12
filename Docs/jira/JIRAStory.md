
Enable Valkey or redis cacheing for a grafbase local federation runtime. 

Key details

Description. 

As a platform engineer, 
I want to enable Valkey or redis caching in local grafbase runtime 
so that we can validate valkey baked caching behavior for local query federation POC.
The story proves cache feasibility, behavior, and configuration patterns at POC level.


In scope,

valkey or Redis container runs via Docker Compose with persistence. 
Runtime configured to use Valkey endpoint through environment config.
Grafbase cache configuration.
cache behavior validation entity query 
TTL or cache tagging at POC level 
documentation updated with cache setup and verification flow 
cache persistence across gateway restart and verified via retained keyspace


Acceptance criteria.
 Valkey or redis runs alongside grafbase via docker compose.
 
 Runtime uses Valkey backed cache.
 
Repeat queries Return cache response. 
Cache TTL or tagging behavior is demonstrated.
cache survives runtime restart where applicable.
Readme updated with cache configuration details.

Note, if back end mock APIs are down, cache validation queries fail because of source data cannot be fetched on initial miss. POC accepted for local feasibility of Valkey caching in federation runtime.
