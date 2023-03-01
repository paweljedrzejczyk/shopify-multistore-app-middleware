import { NextFunction, Response, Request, RequestHandler } from "express";
import { ShopifyApp } from "@shopify/shopify-app-express";
import { Session } from "@shopify/shopify-api";

function decodeJWT(token: string): Record<string, unknown> {
  const base64Url = token.split(".")[1];
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const jsonPayload = JSON.parse(
    Buffer.from(base64, "base64").toString("binary")
  );
  return jsonPayload;
}

const sanitizedShopName = (shop: string): string =>
  shop
    .replace(/^https:\/\//, "")
    .replace(".myshopify.com", "")
    .replace("/admin", "")
    .replace(/-/g, "_")
    .toUpperCase();

function extractShopFromReq(req: Request): string | undefined {
  let queryShop = Array.isArray(req.query.shop)
    ? req.query.shop[0]
    : req.query.shop;
  queryShop = queryShop ? String(queryShop) : queryShop;
  let sessionShop = "";
  const authHeader = req.get("authorization");
  if (authHeader) {
    const matches = authHeader.match(/^Bearer (.+)$/);
    if (!matches) {
      return;
    }
    try {
      const jwtPayload = decodeJWT(matches[1]);
      sessionShop = (jwtPayload.dest as string).replace(/^https:\/\//, "");
    } catch (e) {
      console.error("Unable to decode JWT");
    }
  }

  const shop = queryShop || sessionShop;
  return shop;
}

type ResponseWithShopifyLocals = Response<
  any,
  {
    shopify: {
      app: ShopifyApp;
      session: Session;
    };
  }
>;

type createShopifyAppFunction = (storeName: string) => ShopifyApp;
type createMultistoreMiddlewareFn = (
  shopifyAppCreateFn: createShopifyAppFunction
) => RequestHandler;

const createMultistoreMiddleware: createMultistoreMiddlewareFn = (
  shopifyAppCreateFn
) => {
  const shopifyAppMap: Record<string, ShopifyApp> = {};
  return (req, res, next) => {
    const shop = extractShopFromReq(req);

    if (shop && !res.locals?.shopify?.app) {
      let shopifyApp = shopifyAppMap[shop];
      if (!shopifyApp) {
        shopifyApp = shopifyAppCreateFn(sanitizedShopName(shop));
        shopifyAppMap[shop] = shopifyApp;
      }

      res.locals.shopify = {
        ...res.locals.shopify,
        app: shopifyApp,
      };
    }

    next();
  };
};

const getShopifyApp = (res: ResponseWithShopifyLocals): ShopifyApp =>
  res.locals.shopify.app;

type useShopifyAppMethod = (
  shopifyApp: ShopifyApp
) => RequestHandler | RequestHandler[];

const useShopifyApp =
  (useShopifyAppHandler: useShopifyAppMethod) =>
  (req: Request, res: ResponseWithShopifyLocals, next: NextFunction): void => {
    const shopifyApp = getShopifyApp(res);
    const handler = useShopifyAppHandler(shopifyApp);
    if (Array.isArray(handler)) {
      handler.forEach((h) => {
        h(req, res, next);
      });
    } else {
      handler(req, res, next);
    }
  };

export { createMultistoreMiddleware, useShopifyApp, getShopifyApp };
