FROM rust:1.88-bookworm AS builder

WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
COPY src/ src/
COPY migrations/ migrations/

RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/nearfm-server /usr/local/bin/nearfm-server
COPY --from=builder /app/migrations /app/migrations

WORKDIR /app
ENV RUST_LOG=nearfm_server=info,tower_http=info

CMD ["nearfm-server"]
