use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use governor::{
    clock::DefaultClock,
    state::{InMemoryState, NotKeyed},
    Quota, RateLimiter,
};
use std::{
    collections::HashMap,
    net::IpAddr,
    num::NonZeroU32,
    sync::Arc,
    time::Duration,
};
use tokio::sync::Mutex;

type IpLimiter = Arc<Mutex<HashMap<IpAddr, Arc<RateLimiter<NotKeyed, InMemoryState, DefaultClock>>>>>;

#[derive(Clone)]
pub struct RateLimitState {
    limiters: IpLimiter,
    quota: Quota,
}

impl RateLimitState {
    pub fn new(requests_per_minute: u32, burst: u32) -> Self {
        let period = Duration::from_secs(60) / requests_per_minute;
        let quota = Quota::with_period(period)
            .unwrap()
            .allow_burst(NonZeroU32::new(burst).unwrap());
        Self {
            limiters: Arc::new(Mutex::new(HashMap::new())),
            quota,
        }
    }

    async fn check(&self, ip: IpAddr) -> bool {
        let mut map = self.limiters.lock().await;
        let limiter = map
            .entry(ip)
            .or_insert_with(|| Arc::new(RateLimiter::direct(self.quota)));
        limiter.check().is_ok()
    }
}

/// Strict rate limit: 5 req/min per IP (burst 5)
pub fn strict() -> RateLimitState {
    RateLimitState::new(5, 5)
}

/// Moderate rate limit: 30 req/min per IP (burst 10)
pub fn moderate() -> RateLimitState {
    RateLimitState::new(30, 10)
}

fn extract_ip(req: &Request) -> IpAddr {
    // Try X-Forwarded-For first (behind nginx)
    if let Some(forwarded) = req.headers().get("x-forwarded-for") {
        if let Ok(val) = forwarded.to_str() {
            if let Some(first_ip) = val.split(',').next() {
                if let Ok(ip) = first_ip.trim().parse::<IpAddr>() {
                    return ip;
                }
            }
        }
    }
    // Fallback to loopback
    "127.0.0.1".parse().unwrap()
}

pub async fn rate_limit_middleware(
    axum::extract::State(limiter): axum::extract::State<RateLimitState>,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let ip = extract_ip(&req);
    if !limiter.check(ip).await {
        tracing::warn!("Rate limit exceeded for IP: {}", ip);
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    Ok(next.run(req).await)
}
