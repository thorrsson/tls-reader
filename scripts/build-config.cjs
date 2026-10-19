const keys = [
  'NEXT_PUBLIC_TLS_API_BASE_URL',
  'NEXT_PUBLIC_TLS_AUTH_URL',
  'NEXT_PUBLIC_TLS_CATALOG_URL',
];

function buildConfig(env = process.env) {
  const base = env.NEXT_PUBLIC_TLS_API_BASE_URL || 'http://localhost:8080';
  const config = {
    NEXT_PUBLIC_TLS_API_BASE_URL: base,
    NEXT_PUBLIC_TLS_AUTH_URL: env.NEXT_PUBLIC_TLS_AUTH_URL || new URL('/auth/login', base).href,
    NEXT_PUBLIC_TLS_CATALOG_URL: env.NEXT_PUBLIC_TLS_CATALOG_URL || new URL('/opds/publications', base).href,
    NEXT_PUBLIC_TLS_BASE_READER_URL: '',
  };
  for (const key of keys) {
    const url = new URL(config[key]);
    if (url.username || url.password || url.search || url.hash ||
        !['http:', 'https:'].includes(url.protocol)) {
      throw new Error(`${key} must be a public HTTP(S) endpoint without credentials, query or fragment`);
    }
    if (env.GITHUB_REF_TYPE === 'tag' && (!env[key] || url.protocol !== 'https:')) {
      throw new Error(`Release requires an explicit HTTPS ${key}`);
    }
  }
  return config;
}

module.exports = { buildConfig };
