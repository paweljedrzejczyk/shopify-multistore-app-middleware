# Shopify Multistore App Middleware

## Basic Requirements

- Multiple Shopify Stores,
- Shopify App Created in Partners Account - one for each store - this is where we get unique API_KEY and API_SECRET from,
- Each App needs to have the URL configured to point to the same URL where we have our App deployed, so multiple apps but pointing to same URL,

## Frontend changes requirements

The package is intented to allow the backend to work with multiple stores, but some frontend changes are needed as well.

Update vite config to pass additional env vars with API Keys for multiple stores to frontend code:
```tsx
import { defineConfig } from "vite";
import { dirname } from "path";
import { fileURLToPath } from "url";
import https from "https";
import react from "@vitejs/plugin-react";

if (
  process.env.npm_lifecycle_event === "build" &&
  !process.env.CI &&
  !process.env.SHOPIFY_API_KEY &&
  !Object.keys(process.env).some(
    (key) => key.startsWith("SHOPIFY_API_KEY_") && process.env[key]
  )
) {
  console.warn(
    "\nBuilding the frontend app without an API key. The frontend build will not run without an API key. Set the SHOPIFY_API_KEY environment variable when running the build command.\n"
  );
}

const proxyOptions = {
  target: `http://127.0.0.1:${process.env.BACKEND_PORT}`,
  changeOrigin: false,
  secure: true,
  ws: false,
};

const host = process.env.HOST
  ? process.env.HOST.replace(/https?:\/\//, "")
  : "localhost";

let hmrConfig;
if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: process.env.FRONTEND_PORT,
    clientPort: 443,
  };
}

function getEnvs() {
  const envs = {};
  Object.keys(process.env).forEach((env) => {
    if (env.startsWith("SHOPIFY_API_KEY_")) {
      envs[env] = process.env[env];
    }
  });

  return {
    "process.env.SHOPIFY_API_KEYS": JSON.stringify(envs),
    "process.env.SHOPIFY_API_KEY": JSON.stringify(process.env.SHOPIFY_API_KEY),
  };
}

export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  plugins: [react()],
  define: getEnvs(),
  resolve: {
    preserveSymlinks: true,
  },
  server: {
    host: "localhost",
    port: process.env.FRONTEND_PORT,
    hmr: hmrConfig,
    proxy: {
      "^/(\\?.*)?$": proxyOptions,
      "^/api(/|(\\?.*)?$)": proxyOptions,
    },
  },
});
```

Update AppBridgeProvider.tsx to use different API Key based on the shop:
```tsx
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Provider } from "@shopify/app-bridge-react";
import { Banner, Layout, Page } from "@shopify/polaris";

const sanitizedShopName = (shop: string): string =>
  shop
    .replace(/^https:\/\//, "")
    .replace(".myshopify.com", "")
    .replace("/admin", "")
    .replace(/-/g, "_")
    .toUpperCase();


declare global {
  interface Window {
    __SHOPIFY_DEV_HOST: string;
  }
}

/**
 * A component to configure App Bridge.
 * @desc A thin wrapper around AppBridgeProvider that provides the following capabilities:
 *
 * 1. Ensures that navigating inside the app updates the host URL.
 * 2. Configures the App Bridge Provider, which unlocks functionality provided by the host.
 *
 * See: https://shopify.dev/apps/tools/app-bridge/react-components
 */
export function AppBridgeProvider({ children }: any) {
  const location = useLocation();
  const navigate = useNavigate();
  const history = useMemo(
    () => ({
      replace: (path: any) => {
        navigate(path, { replace: true });
      },
    }),
    [navigate]
  );

  const routerConfig = useMemo(
    () => ({ history, location }),
    [history, location]
  );

  // The host may be present initially, but later removed by navigation.
  // By caching this in state, we ensure that the host is never lost.
  // During the lifecycle of an app, these values should never be updated anyway.
  // Using state in this way is preferable to useMemo.
  // See: https://stackoverflow.com/questions/60482318/version-of-usememo-for-caching-a-value-that-will-never-change
  const [appBridgeConfig] = useState(() => {
    const host =
      new URLSearchParams(location.search).get("host") ||
      window.__SHOPIFY_DEV_HOST;

    window.__SHOPIFY_DEV_HOST = host;

    const customApiKey = process.env.SHOPIFY_API_KEYS?.[
      `SHOPIFY_API_KEY_${sanitizedShopName(
        host ? window.atob(host) : ""
      )}` as keyof typeof process.env.SHOPIFY_API_KEYS
    ] as string;

    return {
      host,
      apiKey: customApiKey || process.env.SHOPIFY_API_KEY || "",
      forceRedirect: true,
    };
  });

  if (!appBridgeConfig.apiKey || !appBridgeConfig.host) {
    const bannerProps = !appBridgeConfig.apiKey
      ? {
          title: "Missing Shopify API Key",
          children: (
            <>
              Your app is running without the SHOPIFY_API_KEY environment
              variable. Please ensure that it is set when running or building
              your React app.
            </>
          ),
        }
      : {
          title: "Missing host query argument",
          children: (
            <>
              Your app can only load if the URL has a <b>host</b> argument.
              Please ensure that it is set, or access your app using the
              Partners Dashboard <b>Test your app</b> feature
            </>
          ),
        };

    return (
      <Page narrowWidth>
        <Layout>
          <Layout.Section>
            <div style={{ marginTop: "100px" }}>
              <Banner {...bannerProps} status="critical" />
            </div>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Provider config={appBridgeConfig} router={routerConfig}>
      {children}
    </Provider>
  );
}
```

## Usage:

```
npm install @paweljedrzejczyk/shopify-multistore-app-middleware
```

### createMultistoreMiddleware

```js
import express from "express";
import { createMultistoreMiddleware } from "@paweljedrzejczyk/shopify-multistore-app-middleware";

const app = express();

app.use(createMultistoreMiddleware(createShopifyApp));
```

where `createShopifyApp` is a function you declare that will accept the `(shop: string)` argument and return `ShopifyApp` instance created with `@shopify/shopify-app-express`. Shop passed as argument is sanitized to be used within the process.env variable name so it's also uppercased etc.

Consider we are connecting from `my-dummy-store-1.myshopify.com` store, the store argument will be: `MY_DUMMY_STORE_1`. The `createShopifyApp` function is up to us how we want to have it, but we can allow multiple shops by exposing process.env variables like:

```
process.env.SHOPIFY_API_KEY_MY_DUMMY_STORE_1 = 'XYZ';
process.env.SHOPIFY_API_SECRET_MY_DUMMY_STORE_1 = 'XYZ';
```

example:

```ts
import { LATEST_API_VERSION } from "@shopify/shopify-api";
import { ShopifyApp, shopifyApp } from "@shopify/shopify-app-express";
import { AppConfigParams } from "@shopify/shopify-app-express/build/ts/config-types";
import { PostgreSQLSessionStorage } from "@shopify/shopify-app-session-storage-postgresql";
let { restResources } = await import(
  `@shopify/shopify-api/rest/admin/${LATEST_API_VERSION}`
);

export const shopifyAppConfig: Pick<AppConfigParams, "auth" | "webhooks"> = {
  auth: {
    path: "/api/auth",
    callbackPath: "/api/auth/callback",
  },
  webhooks: {
    path: "/api/webhooks",
  },
};

export const createShopifyApp = (shop: string): ShopifyApp => {
  const app = shopifyApp({
    api: {
      apiVersion: LATEST_API_VERSION,
      restResources,
      apiKey: process.env[`SHOPIFY_API_KEY_${shopName}`],
      apiSecretKey: process.env[`SHOPIFY_API_SECRET_${shopName}`],
    },
    auth: shopifyAppConfig.auth,
    webhooks: shopifyAppConfig.webhooks,
    sessionStorage: new PostgreSQLSessionStorage(
      new URL(process.env.DATABASE_URL)
    ),
  });

  return app;
};
```

In the example above multiple stores will be using different shopify API keys, but same postgres database. We can rewrite it to connect to separate database for each store if needed.

### useShopifyApp

`ShopifyApp` instance is later stored in `res.locals.shopify.app` to be used in the request handlers, this is where `useShopifyApp` comes handy.

We can rewrite:

```js
app.get(shopifyAppConfig.auth.path, (req, res, next) => {
  return res.locals.shopify.app.auth.begin()(res, res, next);
});
```

to:

```js
app.get(
  shopifyAppConfig.auth.path,
  useShopifyApp((shopifyApp) => shopifyApp.auth.begin())
);
```

### getShopifyApp

This function is just a shortcut for accessing `res.locals.shopify.app` but it does return proper typing. Used to access the shopify app within the request handler.

Example:

```js
app.post(
  "/api/graphql",
  useShopifyApp((shopifyApp) => shopifyApp.validateAuthenticatedSession()),
  async (req, res) => {
    try {
      const response = await getShopifyApp(res).api.clients.graphqlProxy({
        session: res.locals.shopify.session,
        rawBody: req.body,
      });
      return res.status(200).send(response.body);
    } catch (error: unknown) {
      return res.status(500).send(error);
    }
  }
);
```
