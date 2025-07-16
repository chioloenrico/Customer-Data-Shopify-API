/*
 * render-shopify-pixel-api / server.js
 *
 * Minimal Node.js/Express microservice you can deploy on Render.com.
 * Receives POST from your Shopify Custom Pixel with { apiKey, customerId }.
 * Validates apiKey, calls Shopify Admin API (server-side, secure),
 * computes orderCount + lifetimeValue + derived customerStatus, and returns JSON.
 *
 * Includes full CORS support (POST + preflight OPTIONS) so the pixel can read the response.
 *
 * ENV VARS (configure in Render dashboard -> Environment):
 *   PORT                  // Render injects automatically; don't set manually
 *   SECRET_API_KEY        // must match the key you send from pixel.js
 *   SHOPIFY_ACCESS_TOKEN  // private Admin API access token (Server side ONLY)
 *   SHOP_NAME             // e.g. mystore.myshopify.com (no protocol)
 *   SHOPIFY_API_VERSION   // optional (default "2025-04"). Update as needed.
 *
 * NOTE: For Production security, consider using a *public* lightweight token in the pixel
 *       and signing requests (HMAC) server-side instead of exposing SECRET_API_KEY in client JS.
 */

import express from "express";
import fetch from "node-fetch"; // Node <18 compatibility; harmless if Node >=18 (global fetch)

const app = express();

// --- Body parsing ----------------------------------------------------------
// We expect JSON. If you really want to avoid preflight in the browser, you can
// ask your pixel to send text/plain and parse manually; but with real CORS here,
// JSON is fine.
app.use(express.json({ limit: "1mb" }));

// --- CORS middleware -------------------------------------------------------
// Permissive default: allow all origins (safe if you don't send credentials).
// If you prefer a whitelist, replace "*" with dynamic origin check.
app.use((req, res, next) => {
  const origin = req.headers.origin || "*"; // record but don't necessarily echo
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Vary", "Origin"); // good practice when echoing origin; harmless here
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "600");
  if (req.method === "OPTIONS") return res.status(204).send(); // Preflight success, no body
  next();
});

// --- Health endpoint -------------------------------------------------------
app.get("/health", (req, res) => {
  res.json({ ok: true, service: "render-shopify-pixel-api", ts: Date.now() });
});

// --- Main endpoint ---------------------------------------------------------
app.post("/", async (req, res) => {
  const { apiKey, customerId } = req.body || {};

  const EXPECTED_KEY = process.env.SECRET_API_KEY;
  if (!EXPECTED_KEY) {
    console.error("CONFIG ERROR: SECRET_API_KEY not set");
    return res.status(500).json({ error: "Server misconfiguration (API key)." });
  }

  if (!apiKey || apiKey !== EXPECTED_KEY) {
    console.warn("SECURITY: Bad apiKey", { received: apiKey });
    return res.status(401).json({ error: "Unauthorized access." });
  }

  if (!customerId) {
    console.warn("Missing customerId");
    return res.status(400).json({ error: "Missing customer ID." });
  }

  const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
  const SHOP_NAME = process.env.SHOP_NAME; // e.g. "mystore.myshopify.com"
  const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-04"; // update when needed

  if (!SHOPIFY_ACCESS_TOKEN || !SHOP_NAME) {
    console.error("CONFIG ERROR: Missing Shopify credentials");
    return res.status(500).json({ error: "Internal server configuration error." });
  }

  const apiUrl = `https://${SHOP_NAME}/admin/api/${SHOPIFY_API_VERSION}/customers/${encodeURIComponent(customerId)}/orders.json?status=any`;
  console.log("Calling Shopify API:", apiUrl);

  try {
    const shopResp = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
        "Accept": "application/json"
      }
    });

    const status = shopResp.status;
    const text = await shopResp.text();

    if (!shopResp.ok) {
      console.error("Shopify error", status, text);
      return res.status(502).json({ error: "Unable to retrieve customer data from Shopify." });
    }

    let orders;
    try {
      const data = JSON.parse(text);
      orders = Array.isArray(data.orders) ? data.orders : [];
    } catch (err) {
      console.error("JSON parse error from Shopify", err, text);
      return res.status(502).json({ error: "Invalid response from Shopify." });
    }

    const orderCount = orders.length;
    const lifetimeValue = orders.reduce((sum, o) => sum + Number(o.total_price || 0), 0);
    const customerStatus = orderCount === 0
      ? "New - No Orders"
      : orderCount === 1
        ? "New - First Order"
        : "Returning Customer";

    const payload = {
      customerStatus,
      lifetimeValue: lifetimeValue.toFixed(2),
      orderCount,
      success: true
    };

    return res.json(payload);
  } catch (err) {
    console.error("CRITICAL ERROR:", err);
    return res.status(500).json({ error: "Unexpected internal server error." });
  }
});

// --- Server bootstrap ------------------------------------------------------
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});

/* --------------------------------------------------------------------------
 * pixel.js SNIPPET (update your Shopify Custom Pixel)
 * --------------------------------------------------------------------------
 * Replace the URL with your Render service URL, e.g. https://shopify-pixel-api.onrender.com
 *
 * analytics.subscribe("checkout_completed", async (event) => {
 *   const customerGid = event.data.checkout.order?.customer?.id;
 *   if (!customerGid) return;
 *   const customerId = customerGid.replace("gid://shopify/Customer/", "");
 *
 *   const requestBody = {
 *     customerId,
 *     apiKey: "<same-as-SECRET_API_KEY-or-public-token>"
 *   };
 *
 *   try {
 *     const resp = await fetch("https://YOUR-RENDER-URL/", {
 *       method: "POST",
 *       headers: { "Content-Type": "application/json" },
 *       body: JSON.stringify(requestBody),
 *       keepalive: true
 *     });
 *     let customerApiData = {};
 *     if (resp.ok) {
 *       customerApiData = await resp.json();
 *     } else {
 *       console.error("Pixel API error", resp.status, await resp.text());
 *     }
 *     window.dataLayer.push({
 *       event: "checkout_completed",
 *       customerApiData,
 *       rawEvent: event
 *     });
 *   } catch (err) {
 *     console.error("Pixel network error", err);
 *   }
 * });
 */
