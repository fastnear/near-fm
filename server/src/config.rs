use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub database_url: String,
    pub jwt_secret: String,
    pub near_network: String,
    pub contract_id: String,
    pub fastfs_receiver: String,
    pub near_rpc_url: String,
    pub admin_accounts: Vec<String>,
    pub cors_origins: Vec<String>,
    pub google_client_id: String,
    pub google_client_secret: String,
    pub google_redirect_uri: String,
    pub frontend_url: String,
    pub suno_api_key: String,
    pub treasury_agent_key: String,
}

impl Config {
    pub fn from_env() -> Self {
        dotenvy::dotenv().ok();

        let near_network =
            env::var("NEAR_NETWORK").unwrap_or_else(|_| "testnet".to_string());

        let near_rpc_url = env::var("NEAR_RPC_URL").unwrap_or_else(|_| {
            match near_network.as_str() {
                "mainnet" => "https://rpc.mainnet.near.org".to_string(),
                _ => "https://rpc.testnet.near.org".to_string(),
            }
        });

        let contract_id = env::var("CONTRACT_ID").unwrap_or_else(|_| {
            format!("near-fm.{}", near_network)
        });

        let fastfs_receiver = env::var("FASTFS_RECEIVER").unwrap_or_else(|_| {
            format!("fastfs.{}", near_network)
        });

        let admin_accounts = env::var("ADMIN_ACCOUNTS")
            .unwrap_or_default()
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        let cors_origins = env::var("CORS_ORIGINS")
            .unwrap_or_else(|_| "http://localhost:3000".to_string())
            .split(',')
            .map(|s| s.trim().to_string())
            .collect();

        Config {
            host: env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port: env::var("PORT")
                .unwrap_or_else(|_| "8080".to_string())
                .parse()
                .expect("PORT must be a number"),
            database_url: env::var("DATABASE_URL")
                .expect("DATABASE_URL is required"),
            jwt_secret: env::var("JWT_SECRET")
                .expect("JWT_SECRET is required"),
            near_network,
            contract_id,
            fastfs_receiver,
            near_rpc_url,
            admin_accounts,
            cors_origins,
            google_client_id: env::var("GOOGLE_CLIENT_ID").unwrap_or_default(),
            google_client_secret: env::var("GOOGLE_CLIENT_SECRET").unwrap_or_default(),
            google_redirect_uri: env::var("GOOGLE_REDIRECT_URI").unwrap_or_default(),
            frontend_url: env::var("FRONTEND_URL").unwrap_or_else(|_| "https://near.fm".to_string()),
            suno_api_key: env::var("SUNO_API_KEY").unwrap_or_default(),
            treasury_agent_key: env::var("TREASURY_AGENT_KEY").unwrap_or_default(),
        }
    }

    pub fn is_admin(&self, account_id: &str) -> bool {
        self.admin_accounts.iter().any(|a| a == account_id)
    }
}
