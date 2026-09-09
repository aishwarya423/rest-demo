//! Redis/Valkey response cache for the REST resolver.
//!
//! The point of this module is the CACHE KEY. The gateway's own entity cache
//! keys are `<prefix>-<blake3 of the subgraph fetch>`, which nothing outside
//! the gateway can reconstruct or target. Here the key is the REST URL:
//!
//!     rest:funds:/funds/fund-green-bond
//!
//! so any system that changes fund data — none of which go through Grafbase —
//! can invalidate it with a plain `DEL`, no purge API and no knowledge of
//! GraphQL. Because the entry is the RAW REST response (cached before the jq
//! `selection` runs), there is exactly ONE key per resource no matter which
//! fields the GraphQL query asked for.
//!
//! Everything is configured in grafbase.toml under
//! `[extensions.rest.config.cache]`; adding a new REST API is config, not code.
//!
//! Failure policy: the cache is strictly best-effort. Any Redis error drops the
//! connection and the request falls through to the REST API, so a cache outage
//! degrades latency, never correctness.

use std::{
    collections::HashMap,
    io::{ErrorKind, Read, Write},
    net::TcpStream,
    time::Duration,
};

use serde::Deserialize;

// ---------------------------------------------------------------------------
// Configuration ([extensions.rest.config.cache] in grafbase.toml)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CacheSettings {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// redis://host:port — TLS (rediss://) is not supported by this fork.
    #[serde(default = "default_url")]
    pub url: String,
    /// First segment of every cache key.
    #[serde(default = "default_key_prefix")]
    pub key_prefix: String,
    /// Default TTL in seconds. 0 disables caching.
    #[serde(default = "default_ttl")]
    pub ttl: u64,
    /// TTL of the `tag:*` index SETs. Defaults to twice the LONGEST endpoint
    /// TTL, so a shared tag index can never expire while an entry it points at
    /// is still cached (which would make a later purge silently miss it).
    #[serde(default)]
    pub tag_ttl: Option<u64>,
    /// Per-endpoint overrides, keyed by the @restEndpoint name.
    #[serde(default)]
    pub endpoints: HashMap<String, EndpointSettings>,
    /// Route patterns -> entity tags.
    #[serde(default)]
    pub tags: Vec<TagRule>,
    /// Log every HIT/MISS/SET to stderr (needs `stderr = true` on the extension).
    #[serde(default)]
    pub debug: bool,
}

#[derive(Debug, Deserialize)]
pub struct EndpointSettings {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// Overrides the global ttl for this endpoint.
    #[serde(default)]
    pub ttl: Option<u64>,
}

/// One route -> tags rule, e.g.
/// ```toml
/// [[extensions.rest.config.cache.tags]]
/// path = "/funds/{id}"
/// tags = ["Fund", "Fund:{id}"]
/// ```
/// `{name}` captures one path segment and can be interpolated into the tags.
/// Rules are tried in order; the first match wins.
#[derive(Debug, Deserialize)]
pub struct TagRule {
    pub path: String,
    pub tags: Vec<String>,
}

fn default_enabled() -> bool {
    true
}
fn default_url() -> String {
    "redis://localhost:6379".to_string()
}
fn default_key_prefix() -> String {
    "rest".to_string()
}
fn default_ttl() -> u64 {
    60
}

// ---------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------

pub struct RestCache {
    settings: CacheSettings,
    tag_ttl: u64,
    host: String,
    port: u16,
    conn: Option<Conn>,
}

impl RestCache {
    /// Builds the cache from the `cache` object of the extension config.
    /// Returns `Ok(None)` when there is no config or it is disabled, which is
    /// how this fork stays behaviourally identical to upstream `rest`.
    pub fn from_config(config: &serde_json::Value) -> Result<Option<Self>, String> {
        let raw = &config["cache"];
        if raw.is_null() {
            return Ok(None);
        }

        let settings: CacheSettings =
            serde_json::from_value(raw.clone()).map_err(|e| format!("Invalid [cache] config: {e}"))?;

        if !settings.enabled || settings.ttl == 0 {
            return Ok(None);
        }

        let (host, port) = parse_redis_url(&settings.url)?;

        // Longest TTL in play, so the tag index outlives every entry it indexes.
        let longest = settings
            .endpoints
            .values()
            .filter_map(|e| e.ttl)
            .chain(std::iter::once(settings.ttl))
            .max()
            .unwrap_or(settings.ttl);
        let tag_ttl = settings.tag_ttl.unwrap_or(longest.saturating_mul(2));

        Ok(Some(Self {
            settings,
            tag_ttl,
            host,
            port,
            conn: None,
        }))
    }

    /// TTL for an endpoint, or `None` when caching is off for it.
    pub fn ttl_for(&self, endpoint: &str) -> Option<u64> {
        match self.settings.endpoints.get(endpoint) {
            Some(cfg) if !cfg.enabled => None,
            Some(cfg) => Some(cfg.ttl.unwrap_or(self.settings.ttl)),
            None => Some(self.settings.ttl),
        }
    }

    /// `rest:funds:/funds/fund-green-bond` — the whole reason this fork exists.
    pub fn key(&self, endpoint: &str, path: &str, query: Option<&str>) -> String {
        match query {
            Some(q) if !q.is_empty() => format!("{}:{}:{}?{}", self.settings.key_prefix, endpoint, path, q),
            _ => format!("{}:{}:{}", self.settings.key_prefix, endpoint, path),
        }
    }

    /// Entity tags for a path, from the configured rules. First match wins.
    pub fn tags_for(&self, path: &str) -> Vec<String> {
        for rule in &self.settings.tags {
            if let Some(captures) = match_path(&rule.path, path) {
                return rule
                    .tags
                    .iter()
                    .map(|tag| interpolate(tag, &captures))
                    .collect();
            }
        }
        Vec::new()
    }

    pub fn debug(&self) -> bool {
        self.settings.debug
    }

    /// Cache read. `None` on miss OR on any Redis trouble.
    pub fn get(&mut self, key: &str) -> Option<Vec<u8>> {
        match self.command(&[b"GET", key.as_bytes()]) {
            Ok(Reply::Bulk(bytes)) => Some(bytes),
            Ok(_) => None,
            Err(err) => {
                self.drop_conn(&format!("GET {key}: {err}"));
                None
            }
        }
    }

    /// Cache write: `SET key value EX ttl`, plus one `SADD`/`EXPIRE` pair per
    /// tag, all pipelined into a single round trip.
    pub fn store(&mut self, key: &str, value: &[u8], ttl: u64, tags: &[String]) {
        let ttl = ttl.to_string();
        let tag_ttl = self.tag_ttl.to_string();

        let mut out = Vec::with_capacity(value.len() + 128);
        encode(&mut out, &[b"SET", key.as_bytes(), value, b"EX", ttl.as_bytes()]);
        for tag in tags {
            let index = format!("tag:{tag}");
            encode(&mut out, &[b"SADD", index.as_bytes(), key.as_bytes()]);
            encode(&mut out, &[b"EXPIRE", index.as_bytes(), tag_ttl.as_bytes()]);
        }

        let replies = 1 + tags.len() * 2;
        if let Err(err) = self.pipeline(&out, replies) {
            self.drop_conn(&format!("SET {key}: {err}"));
        }
    }

    // -- plumbing -----------------------------------------------------------

    fn command(&mut self, args: &[&[u8]]) -> Result<Reply, String> {
        let mut out = Vec::with_capacity(64);
        encode(&mut out, args);
        let mut replies = self.pipeline(&out, 1)?;
        Ok(replies.pop().unwrap_or(Reply::Nil))
    }

    fn pipeline(&mut self, payload: &[u8], replies: usize) -> Result<Vec<Reply>, String> {
        let conn = self.conn()?;
        conn.stream.write_all(payload).map_err(|e| e.to_string())?;
        conn.stream.flush().map_err(|e| e.to_string())?;

        let mut out = Vec::with_capacity(replies);
        for _ in 0..replies {
            match conn.read_reply()? {
                Reply::Error(msg) => return Err(msg),
                reply => out.push(reply),
            }
        }
        Ok(out)
    }

    fn conn(&mut self) -> Result<&mut Conn, String> {
        if self.conn.is_none() {
            // WASI preview 2 gives the guest real sockets, so std::net works
            // here — this is the piece that makes a Redis client possible at
            // all inside the extension sandbox (needs `networking = true`).
            let stream = TcpStream::connect((self.host.as_str(), self.port))
                .map_err(|e| format!("connect {}:{}: {e}", self.host, self.port))?;
            // Timeouts are advisory: some WASI hosts reject them, and a failure
            // to SET one must not stop us from using the connection.
            let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
            let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
            let _ = stream.set_nodelay(true);
            self.conn = Some(Conn {
                stream,
                buf: Vec::with_capacity(4096),
                pos: 0,
            });
        }
        Ok(self.conn.as_mut().expect("just set"))
    }

    fn drop_conn(&mut self, context: &str) {
        if self.settings.debug {
            eprintln!("[rest-cache] redis error, falling through to REST ({context})");
        }
        self.conn = None;
    }
}

// ---------------------------------------------------------------------------
// Path templates: "/funds/{id}" matches "/funds/fund-green-bond" -> {id: ...}
// A tiny matcher instead of a regex dependency — it keeps the wasm small and
// the TOML readable.
// ---------------------------------------------------------------------------

fn match_path<'p>(template: &str, path: &'p str) -> Option<Vec<(String, &'p str)>> {
    let mut captures = Vec::new();
    let mut template_parts = template.trim_matches('/').split('/');
    let mut path_parts = path.trim_matches('/').split('/');

    loop {
        match (template_parts.next(), path_parts.next()) {
            (None, None) => return Some(captures),
            (Some(t), Some(p)) => {
                if let Some(name) = t.strip_prefix('{').and_then(|t| t.strip_suffix('}')) {
                    if p.is_empty() {
                        return None;
                    }
                    captures.push((name.to_string(), p));
                } else if t != p {
                    return None;
                }
            }
            _ => return None,
        }
    }
}

fn interpolate(tag: &str, captures: &[(String, &str)]) -> String {
    let mut out = tag.to_string();
    for (name, value) in captures {
        out = out.replace(&format!("{{{name}}}"), value);
    }
    out
}

fn parse_redis_url(url: &str) -> Result<(String, u16), String> {
    let rest = url
        .strip_prefix("redis://")
        .ok_or_else(|| format!("cache.url must start with redis:// (got {url}); rediss:// is not supported"))?;
    let rest = rest.split('/').next().unwrap_or(rest);
    // Strip any user:password@ prefix — AUTH is not implemented.
    let host_port = rest.rsplit('@').next().unwrap_or(rest);
    match host_port.rsplit_once(':') {
        Some((host, port)) => {
            let port = port.parse().map_err(|_| format!("Invalid port in {url}"))?;
            Ok((host.to_string(), port))
        }
        None => Ok((host_port.to_string(), 6379)),
    }
}

// ---------------------------------------------------------------------------
// Minimal RESP2 client. Only what this cache needs: GET, SET..EX, SADD, EXPIRE.
// ---------------------------------------------------------------------------

enum Reply {
    Nil,
    Status(#[allow(dead_code)] String),
    Int(#[allow(dead_code)] i64),
    Bulk(Vec<u8>),
    Error(String),
}

fn encode(out: &mut Vec<u8>, args: &[&[u8]]) {
    out.extend_from_slice(format!("*{}\r\n", args.len()).as_bytes());
    for arg in args {
        out.extend_from_slice(format!("${}\r\n", arg.len()).as_bytes());
        out.extend_from_slice(arg);
        out.extend_from_slice(b"\r\n");
    }
}

struct Conn {
    stream: TcpStream,
    buf: Vec<u8>,
    pos: usize,
}

impl Conn {
    fn read_reply(&mut self) -> Result<Reply, String> {
        let line = self.read_line()?;
        let (marker, rest) = line.split_first().ok_or("empty reply")?;
        let rest = String::from_utf8_lossy(rest).into_owned();

        match marker {
            b'+' => Ok(Reply::Status(rest)),
            b'-' => Ok(Reply::Error(rest)),
            b':' => Ok(Reply::Int(rest.parse().unwrap_or(0))),
            b'$' => {
                let len: i64 = rest.parse().map_err(|_| format!("bad bulk length: {rest}"))?;
                if len < 0 {
                    return Ok(Reply::Nil);
                }
                let bytes = self.read_exact(len as usize + 2)?; // + CRLF
                Ok(Reply::Bulk(bytes[..len as usize].to_vec()))
            }
            other => Err(format!("unsupported RESP marker: {}", *other as char)),
        }
    }

    fn read_line(&mut self) -> Result<Vec<u8>, String> {
        loop {
            if let Some(idx) = find_crlf(&self.buf[self.pos..]) {
                let line = self.buf[self.pos..self.pos + idx].to_vec();
                self.consume(idx + 2);
                return Ok(line);
            }
            self.fill()?;
        }
    }

    fn read_exact(&mut self, n: usize) -> Result<Vec<u8>, String> {
        while self.buf.len() - self.pos < n {
            self.fill()?;
        }
        let bytes = self.buf[self.pos..self.pos + n].to_vec();
        self.consume(n);
        Ok(bytes)
    }

    fn fill(&mut self) -> Result<(), String> {
        let mut chunk = [0u8; 4096];
        match self.stream.read(&mut chunk) {
            Ok(0) => Err("connection closed by redis".to_string()),
            Ok(n) => {
                self.buf.extend_from_slice(&chunk[..n]);
                Ok(())
            }
            Err(e) if e.kind() == ErrorKind::Interrupted => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }

    fn consume(&mut self, n: usize) {
        self.pos += n;
        if self.pos == self.buf.len() {
            self.buf.clear();
            self.pos = 0;
        }
    }
}

fn find_crlf(haystack: &[u8]) -> Option<usize> {
    haystack.windows(2).position(|w| w == b"\r\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_templates() {
        assert_eq!(
            match_path("/funds/{id}", "/funds/fund-green-bond"),
            Some(vec![("id".to_string(), "fund-green-bond")])
        );
        assert!(match_path("/funds/{id}", "/funds").is_none());
        assert!(match_path("/funds/{id}", "/funds/a/b").is_none());
        assert_eq!(match_path("/funds", "/funds"), Some(vec![]));
        assert_eq!(
            match_path("/accounts/{id}/policies", "/accounts/acct-1001/policies"),
            Some(vec![("id".to_string(), "acct-1001")])
        );
    }

    #[test]
    fn tag_interpolation() {
        let captures = vec![("id".to_string(), "fund-green-bond")];
        assert_eq!(interpolate("Fund:{id}", &captures), "Fund:fund-green-bond");
        assert_eq!(interpolate("Fund", &captures), "Fund");
    }

    #[test]
    fn redis_urls() {
        assert_eq!(parse_redis_url("redis://redis:6379").unwrap(), ("redis".into(), 6379));
        assert_eq!(parse_redis_url("redis://127.0.0.1:6380").unwrap(), ("127.0.0.1".into(), 6380));
        assert_eq!(parse_redis_url("redis://cache").unwrap(), ("cache".into(), 6379));
        assert!(parse_redis_url("rediss://redis:6379").is_err());
    }

    #[test]
    fn resp_encoding() {
        let mut out = Vec::new();
        encode(&mut out, &[b"GET", b"rest:funds:/funds/x"]);
        assert_eq!(out, b"*2\r\n$3\r\nGET\r\n$19\r\nrest:funds:/funds/x\r\n");
    }
}
