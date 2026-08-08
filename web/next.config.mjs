/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // @coinbase/cdp-sdk (dragged in via wagmi's baseAccount connector, which we
    // don't use) declares optional deps that aren't published; stub them out.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/evm": false,
      "@x402/svm": false,
    };
    return config;
  },
};

export default nextConfig;
