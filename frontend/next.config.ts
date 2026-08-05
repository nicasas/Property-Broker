import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El contenedor monta el código desde el host; en Docker + Windows el watcher
  // nativo no recibe eventos, así que se usa polling para el hot reload.
  webpack: (config) => {
    config.watchOptions = { poll: 1000, aggregateTimeout: 300 };
    return config;
  },
};

export default nextConfig;
