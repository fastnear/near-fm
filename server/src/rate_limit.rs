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

// ── Multi-window limiter: N per minute, M per hour, K per day, per IP ──

use std::collections::VecDeque;
use std::time::Instant;

#[derive(Clone)]
pub struct MultiWindowState {
    hits: Arc<Mutex<HashMap<IpAddr, VecDeque<Instant>>>>,
    /// (window, max hits in it), longest window last.
    windows: Arc<Vec<(Duration, usize)>>,
}

impl MultiWindowState {
    pub fn new(windows: &[(Duration, usize)]) -> Self {
        let mut w = windows.to_vec();
        w.sort_by_key(|(d, _)| *d);
        Self { hits: Arc::new(Mutex::new(HashMap::new())), windows: Arc::new(w) }
    }

    /// Records a hit if every window has room; false when any is full.
    async fn check(&self, ip: IpAddr) -> bool {
        let now = Instant::now();
        let longest = self.windows.last().map(|(d, _)| *d).unwrap_or(Duration::from_secs(86_400));
        let mut map = self.hits.lock().await;
        let q = map.entry(ip).or_default();
        while q.front().map_or(false, |t| now.duration_since(*t) > longest) {
            q.pop_front();
        }
        for (window, max) in self.windows.iter() {
            let n = q.iter().rev().take_while(|t| now.duration_since(**t) <= *window).count();
            if n >= *max {
                return false;
            }
        }
        q.push_back(now);
        // Keep the map from growing with one-off IPs.
        if map.len() > 50_000 {
            map.retain(|_, q| q.back().map_or(false, |t| now.duration_since(*t) <= longest));
        }
        true
    }
}

pub async fn multi_window_middleware(
    axum::extract::State(state): axum::extract::State<MultiWindowState>,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let ip = extract_ip(&req);
    if !state.check(ip).await {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    Ok(next.run(req).await)
}

#[cfg(test)]
mod multi_window_tests {
    use super::*;

    #[tokio::test]
    async fn minute_hour_day_windows_each_cap() {
        let s = MultiWindowState::new(&[(Duration::from_secs(60), 2), (Duration::from_secs(3600), 3)]);
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        assert!(s.check(ip).await);
        assert!(s.check(ip).await);
        assert!(!s.check(ip).await, "3rd within a minute refused");
        // Age the first two past the minute window; the hour window still holds them.
        {
            let mut m = s.hits.lock().await;
            for t in m.get_mut(&ip).unwrap().iter_mut() {
                *t = Instant::now() - Duration::from_secs(61);
            }
        }
        assert!(s.check(ip).await, "minute window cleared");
        assert!(!s.check(ip).await, "hour cap of 3 reached");
        let other: IpAddr = "10.0.0.2".parse().unwrap();
        assert!(s.check(other).await, "other IPs unaffected");
    }
}
