//! `rest-cached` — the official Grafbase `rest` resolver extension (Apache-2.0)
//! with one addition: the single `http::execute` call in `resolve` is wrapped in
//! a Redis/Valkey cache whose keys are the REST URLs themselves.
//!
//!     rest:funds:/funds/fund-green-bond
//!
//! That is the whole point. The gateway's built-in entity cache hashes the
//! subgraph fetch (selection + headers) into an opaque key, so an external
//! system that updates a fund has no way to name the entry it must drop. Here
//! it is `DEL rest:funds:/funds/fund-green-bond`, from redis-cli or anything else.
//!
//! Everything below the `--- cache ---` markers is this fork's; the rest is
//! upstream, kept as close to verbatim as possible so it stays easy to rebase.
//! See extensions/rest-cached/README.md.

mod cache;
mod types;

use std::hash::Hasher;

use ::http::HeaderMap;
use grafbase_sdk::{
    ResolverExtension,
    host_io::http::{self, HttpRequest, Url},
    jq_selection::JqSelection,
    types::{
        AuthorizedOperationContext, Configuration, Error, ResolvedField, Response, SubgraphHeaders, SubgraphSchema,
        Variables,
    },
};
use serde_json::Value;
use template::{Template, Templates};

use crate::{cache::RestCache, types::*};

#[derive(ResolverExtension)]
struct RestExtension {
    endpoints: hashbrown::hash_table::HashTable<EndpointConfig>,
    templates: Templates,
    jq_selection: JqSelection,
    // --- cache --- None when unconfigured or disabled: then this extension
    // behaves exactly like upstream `rest`.
    cache: Option<RestCache>,
}

struct EndpointConfig {
    subgraph_name: String,
    name: String,
    base_url: Url,
    headers: HeaderMap,
}

fn hash_endpoint(subgraph_name: &str, name: &str) -> u64 {
    let mut hasher = rapidhash::RapidHasher::default();
    hasher.write(subgraph_name.as_bytes());
    hasher.write(&[0x0]);
    hasher.write(name.as_bytes());
    hasher.finish()
}

impl ResolverExtension for RestExtension {
    fn new(schemas: Vec<SubgraphSchema>, config: Configuration) -> Result<Self, Error> {
        let mut endpoints = hashbrown::hash_table::HashTable::<EndpointConfig>::new();
        let config: serde_json::Value = config.deserialize()?;
        let subgraph_config = &config["subgraphs"];

        for schema in schemas {
            let ctx = serde_json::json!({
                "config": subgraph_config[schema.subgraph_name()].as_object()
            });
            for directive in schema.directives() {
                let RestEndpointArgs {
                    name,
                    headers,
                    base_url,
                } = directive.arguments()?;

                let entry = endpoints.entry(
                    hash_endpoint(schema.subgraph_name(), &name),
                    |cfg| name == cfg.name && schema.subgraph_name() == cfg.subgraph_name,
                    |cfg| hash_endpoint(&cfg.subgraph_name, &cfg.name),
                );
                match entry {
                    hashbrown::hash_table::Entry::Occupied(_) => {
                        return Err(format!(
                            "Duplicate endpoint definition for {} in subgraph {}",
                            name,
                            schema.subgraph_name()
                        )
                        .into());
                    }
                    hashbrown::hash_table::Entry::Vacant(entry) => {
                        let headers = headers
                            .into_iter()
                            .map(|header| {
                                let value = Template::new(header.value)
                                    .map_err(|err| {
                                        format!(
                                            "Could not parse header value for {}/{}: {err}",
                                            schema.subgraph_name(),
                                            header.name
                                        )
                                    })?
                                    .render_unescaped(&ctx);
                                header
                                    .name
                                    .parse()
                                    .map_err(|err| {
                                        format!("Invalid header name for {}/{}: {err}", schema.subgraph_name(), name)
                                    })
                                    .and_then(|name| {
                                        value
                                            .parse()
                                            .map_err(|err| {
                                                format!(
                                                    "Invalid header value for {}/{}: {err}",
                                                    schema.subgraph_name(),
                                                    name
                                                )
                                            })
                                            .map(|value| (name, value))
                                    })
                            })
                            .collect::<Result<HeaderMap, _>>()?;
                        entry.insert(EndpointConfig {
                            subgraph_name: schema.subgraph_name().to_string(),
                            base_url: Url::parse(&base_url)
                                .map_err(|e| format!("Could not parse base URL for endpoint {}: {e}", name))?,
                            name,
                            headers,
                        });
                    }
                }
            }
        }

        Ok(Self {
            endpoints,
            templates: Default::default(),
            jq_selection: JqSelection::default(),
            // --- cache --- reads [extensions.<name>.config.cache] from grafbase.toml
            cache: RestCache::from_config(&config)?,
        })
    }

    fn resolve(
        &mut self,
        _ctx: &AuthorizedOperationContext,
        prepared: &[u8],
        headers: SubgraphHeaders,
        variables: Variables,
    ) -> Result<Response, Error> {
        let field = ResolvedField::try_from(prepared)?;

        let Rest {
            endpoint,
            http: ConnectHttp { method_path, body },
            selection,
        }: Rest<'_> = field
            .directive()
            .arguments()
            .map_err(|e| format!("Could not parse directive arguments: {e}"))?;
        let field_arguments: serde_json::Value = field.arguments(&variables)?;
        let ctx = serde_json::json!({"args": field_arguments});
        let (method, path) = method_path.split();

        // --- cache --- `endpoint` is shadowed by the EndpointConfig lookup below,
        // and `method`/`body` are moved into the request builder, so record what
        // the cache needs while it is still in scope.
        //
        // The body is rendered HERE rather than at request-building time because
        // `@rest`'s `body` argument carries a default (`{ selection: ".args.input" }`),
        // so `body.is_some()` is true even for a plain GET. Only the RENDERED
        // value tells us whether this request actually carries one.
        let endpoint_name = endpoint;
        let is_get = method == http::Method::GET;
        let rendered_body = match body {
            Some(body) => Some(self.render_body(body, &ctx)?),
            None => None,
        };
        let body_is_empty = rendered_body.as_ref().is_none_or(serde_json::Value::is_null);

        let path = self.templates.get_or_insert(path)?.render_url(&ctx);
        let path = path.strip_prefix("/").unwrap_or(&path);

        let Some(endpoint) = self.get_endpoint(endpoint, field.subgraph_name()) else {
            return Err(format!("Endpoint not found: {}", endpoint).into());
        };

        let mut url = endpoint.base_url.clone();

        if !path.is_empty() {
            let mut path_segments = url.path_segments_mut().map_err(|_| "Could not parse URL")?;

            path_segments.push(path);
        }

        let url = url.join(path).map_err(|e| format!("Could not parse URL path: {e}"))?;

        // --- cache --- the key is built from the URL, not from the GraphQL
        // selection, so every query shape for the same resource shares one entry.
        let cache_path = url.path().to_string();
        let cache_query = url.query().map(str::to_string);

        let mut builder = HttpRequest::builder(url, method);
        let _ = std::mem::replace(builder.headers(), headers);
        for (name, value) in &endpoint.headers {
            builder.header(name, value);
        }

        let request = match rendered_body {
            Some(body) => builder.json(body),
            None => builder.build(),
        };

        // --- cache --- only safe (and only useful) for bodyless GETs.
        let cache_entry: Option<(String, u64)> = if is_get && body_is_empty {
            self.cache.as_ref().and_then(|cache| {
                cache
                    .ttl_for(endpoint_name)
                    .map(|ttl| (cache.key(endpoint_name, &cache_path, cache_query.as_deref()), ttl))
            })
        } else {
            None
        };
        let debug = self.cache.as_ref().is_some_and(RestCache::debug);

        let mut cached: Option<Vec<u8>> = None;
        if let Some((key, _)) = &cache_entry {
            cached = self.cache.as_mut().and_then(|cache| cache.get(key));
            if debug {
                eprintln!("[rest-cache] {} {key}", if cached.is_some() { "HIT " } else { "MISS" });
            }
        }

        // --- cache --- MISS (or uncacheable): the upstream request path, then store.
        let bytes = match cached {
            Some(bytes) => bytes,
            None => {
                let resp = http::execute(request).map_err(|e| format!("HTTP request failed: {e}"))?;

                if !resp.status().is_success() {
                    return Err(format!("HTTP request failed with status: {}", resp.status()).into());
                }

                let bytes = resp.into_bytes();

                if let Some((key, ttl)) = &cache_entry {
                    let tags = self
                        .cache
                        .as_ref()
                        .map(|cache| cache.tags_for(&cache_path))
                        .unwrap_or_default();
                    if let Some(cache) = self.cache.as_mut() {
                        cache.store(key, &bytes, *ttl, &tags);
                    }
                    if debug {
                        eprintln!("[rest-cache] SET  {key} ttl={ttl}s tags=[{}]", tags.join(", "));
                    }
                }

                bytes
            }
        };

        if let Some(selection) = selection {
            let data: serde_json::Value =
                serde_json::from_slice(&bytes).map_err(|e| format!("Error deserializing response: {e}"))?;

            if !(data.is_object() || data.is_array()) {
                return Ok(Response::data(data));
            }

            let data = self.render_jq_template(selection, &ctx, data)?;

            Ok(Response::data(data))
        } else {
            Ok(Response::json(bytes))
        }
    }
}

impl RestExtension {
    pub fn get_endpoint(&self, name: &str, subgraph_name: &str) -> Option<&EndpointConfig> {
        self.endpoints.find(hash_endpoint(subgraph_name, name), |cfg| {
            cfg.name == name && cfg.subgraph_name == subgraph_name
        })
    }

    fn render_body(&mut self, body: Body<'_>, ctx: &Value) -> Result<Value, Error> {
        match body.into_case() {
            Some(BodyCase::Selection(source)) => self.render_jq_template(source, ctx, ctx.clone()),
            Some(BodyCase::Static(value)) => Ok(value),
            None => Ok(Value::Null),
        }
    }

    fn render_jq_template(&mut self, source: &str, ctx: &Value, jq_value: Value) -> Result<Value, Error> {
        let selection = self.templates.get_or_insert(source)?.render_json(ctx);
        let mut values = self
            .jq_selection
            .select(&selection, jq_value)
            .map_err(|e| format!("Failed to filter with selection: {}", e))?
            .collect::<Result<Vec<Value>, _>>()
            .map_err(|e| format!("Failed to collect filtered value: {}", e))?;
        // TODO: Be smarter, but not sure how with jq...
        if values.len() == 1 {
            Ok(values.pop().unwrap())
        } else {
            Ok(serde_json::Value::Array(values))
        }
    }
}
