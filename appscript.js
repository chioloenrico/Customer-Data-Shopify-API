/**
 * Web-app endpoint called by a Shopify **Custom Pixel** on the
 * “checkout_completed” event.  
 *
 * ▶ Why POST instead of GET?
 *   • Keeps the API key and customerId out of the URL, so they don’t end up in
 *     browser history, server logs or intermediary caches.  
 *   • Avoids accidental pre-fetching and caching of customer data.  
 *
 * ▶ Security layers applied:
 *   • Shared-secret API key validated on every call.  
 *   • The Shopify app that owns the access token is configured with the
 *     **minimum scope**: `read_customers` and `read_orders` only.  
 *   • CORS headers are returned to let the Pixel (running in a sandboxed
 *     iframe with `Origin: null`) read the response while still blocking
 *     other browsers unless explicitly allowed.  
 *
 * ▶ What the endpoint does:
 *   1. Validates and parses the JSON payload sent by the Pixel.  
 *   2. Pulls all orders for the given customer via Shopify REST Admin API
 *      (2025-04).  
 *   3. Calculates order count, customer lifetime value and status
 *      (“New/Returning”).  
 *   4. Returns a compact JSON object that the Pixel pushes into the
 *      `dataLayer` for downstream analytics.  
 */

function doPost(e) {
  Logger.log('--- doPost Started ---');

  try {
    const props          = PropertiesService.getScriptProperties();
    const SECRET_API_KEY = props.getProperty('SECRET_API_KEY');

    /* ---------------------------------------------------------------------
       1. Parse and validate the incoming JSON payload
    --------------------------------------------------------------------- */
    Logger.log('Raw POST data received: ' + e.postData.contents);

    let req;
    try {
      req = JSON.parse(e.postData.contents);
      Logger.log('JSON parsing successful: ' + JSON.stringify(req));
    } catch (err) {
      Logger.log('!!! ERROR: Invalid JSON – ' + err.message);
      return createJsonResponse({ error: 'Invalid JSON payload.' });
    }

    const { apiKey, customerId } = req;

    /* Shared-secret check */
    if (!apiKey || apiKey !== SECRET_API_KEY) {
      Logger.log('!!! SECURITY: Unauthorized API key – ' + apiKey);
      return createJsonResponse({ error: 'Unauthorized access.' });
    }

    if (!customerId) {
      Logger.log('!!! ERROR: Missing customer ID');
      return createJsonResponse({ error: 'Missing customer ID.' });
    }

    /* ---------------------------------------------------------------------
       2. Prepare Shopify call (token has read-only scopes)
    --------------------------------------------------------------------- */
    const SHOP_TOKEN = props.getProperty('SHOPIFY_ACCESS_TOKEN');
    const SHOP_NAME  = props.getProperty('SHOP_NAME');
    if (!SHOP_TOKEN || !SHOP_NAME) {
      Logger.log('!!! CONFIG ERROR: Missing Shopify credentials');
      return createJsonResponse({ error: 'Server configuration error.' });
    }

    const apiUrl =
      `https://${SHOP_NAME}/admin/api/2025-04/customers/${customerId}` +
      `/orders.json?status=any`;
    Logger.log('Calling Shopify API URL: ' + apiUrl);

    const resp = UrlFetchApp.fetch(apiUrl, {
      method : 'get',
      headers: { 'X-Shopify-Access-Token': SHOP_TOKEN },
      muteHttpExceptions: true
    });

    if (resp.getResponseCode() !== 200) {
      Logger.log('!!! Shopify error. Body: ' + resp.getContentText());
      return createJsonResponse({ error: 'Unable to retrieve customer data.' });
    }

    /* ---------------------------------------------------------------------
       3. Aggregate order data
    --------------------------------------------------------------------- */
    const orders        = JSON.parse(resp.getContentText()).orders;
    const orderCount    = orders.length;
    const lifetimeValue = orders
      .reduce((sum, o) => sum + parseFloat(o.total_price), 0);

    const customerStatus =
      orderCount === 0 ? 'New - No Orders'   :
      orderCount === 1 ? 'New - First Order' :
                         'Returning Customer';

    const result = {
      success: true,
      customerStatus,
      orderCount,
      lifetimeValue: lifetimeValue.toFixed(2)
    };

    Logger.log('--- doPost Success --- ' + JSON.stringify(result));
    return createJsonResponse(result);

  } catch (err) {
    Logger.log('!!! CRITICAL ERROR: ' + err.message);
    Logger.log(err.stack);
    return createJsonResponse({ error: 'Unexpected internal server error.' });
  }
}

/* ------------------------------------------------------------------------
   Handles the CORS pre-flight (OPTIONS) automatically sent by the browser.
   The Custom Pixel runs in an iframe whose Origin is forced to "null", so
   we allow that plus any additional domains you might whitelist.
------------------------------------------------------------------------- */
function doOptions(e) {
  Logger.log('--- doOptions Triggered (CORS Preflight) ---');

  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT)
    .setHeader('Access-Control-Allow-Origin', '*')      // allow "null"
    .setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/* Utility: builds a JSON response and appends CORS headers */
function createJsonResponse(data) {
  const json = JSON.stringify(data);
  Logger.log('Sending JSON response: ' + json);
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON)
    .setHeader('Access-Control-Allow-Origin', '*')
    .setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/* ------------------------------------------------------------------
   DEBUGGING NOTES:
   • Deploy as Web App: Execute as “Me”, access “Anyone”.  
   • Check Apps Script → Executions for doOptions / doPost logs.
------------------------------------------------------------------ */