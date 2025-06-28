# Customer Data Shopify API

This Web API integrates with Google Apps Script and a Shopify App. The primary goal of this project is to provide an API endpoint that can be called from a Custom Pixel to retrieve specific customer data.

## The Problem

Within Shopify’s Custom Pixels environment, it’s not possible to directly access certain customer data points—such as lifetime value (LTV), number of orders, or whether a user is new or returning.
Although a customer object exists within the Custom Pixel’s data structure, it often doesn’t include or correctly populate these key user-specific details.

In particular, Shopify provides the customer.isFirstOrder property, but in most cases it proved unreliable and led to inaccurate results.

## What I Just Do

This might not be the most elegant solution, but it works reliably.

As you’ll see later, there are potential security concerns with this implementation. Using Cloud Run instead of Apps Script would be a more robust alternative. However, for this early stage, the current approach is a reasonable trade-off.

In this setup, I used Google Apps Script and a Shopify App to create an endpoint that, given a Customer ID, returns the following information:

- **Customer Status**: New vs Returning  
- **Lifetime Value (LTV)**  
- **Number of Orders**

This data has proven to be extremely useful when sent to platforms like Google Ads and Google Analytics. Enriching events with customer-level information is essential for campaign optimization.

Unfortunately, Shopify Custom Pixels do not expose this data by default—so I built a system that retrieves it directly from the Shopify Admin API.

## How It Works

![alt text](/image/image.png)

The solution is quite simple. It consists of three components:

- **Shopify App:** Used to integrate with the Shopify Admin API.
- **Custom Pixel:** Used to send information into the `dataLayer`. I prefer using Custom Pixels only to push data to the `dataLayer` and let Google Tag Manager handle the rest.
- **Apps Script:** This started as a quick experiment using Google Apps Script. It turned out to be a good idea because it's free, but it has some limitations. For example, it doesn't allow full control over CORS policies, which would add an extra layer of security.

In future implementations, I plan to use **Cloud Run**, which provides more flexibility, scalability, and control.  

(Actually, this repository has already been updated to support Cloud Run—so no worries there.)

## Step-by-Step Guide to Installation

This is a step-by-step tutorial to replicate this experiment.  
Don't worry — there are just a few very simple steps.

### Step 1: Create a New App in Shopify

The first step is to create an app in your Shopify store.  
Log in to your Shopify Admin Panel, click on **Settings**, then go to **Apps and Sales Channels**.  
Here, click on **Develop apps**, and in the new interface, select **Create an app**.

![alt text](/image/step1.png)  
![alt text](/image/step2.png)

Once the app is created, click on **Configure Admin API Scopes**.  
Now we need to assign the right scopes for the app.

![alt text](/image/step3.png)

At this point, select the following scopes:

- `read_customers`
- `read_orders`

I'm fairly sure these are the only two scopes you need.  
If you run into issues, feel free to open an issue or contact me - I’ll double-check everything later this week.

After Save, go to API credential setting and at this poi click to "Install". We need to Install App in store before generate API Call. 

Completed installation Shopify Give You Admin Access Token. You just see similar of this. 

![alt text](/image/step4.png)

So if you are completed this step, you can don't need another step to complete the Shopify App. So You can pass to the next Step. 


### Step 2: Create an Apps Script Project

Copy the [Apps Script file](appscript.js) into your Apps Script project.  
Before deploying the Web App, you need to configure the following three script properties.

![alt text](/image/step5.png)

To set them, go to **Project Settings** and look for the **Script Properties** section.  
Once configured, you can proceed to deploy the Web App.

The parameters to set are:

- `SECRET_API_KEY`: A secret key used to authenticate incoming API calls.  
  ⚠️ This is critical for security — ensure that any API call includes this key.

- `SHOPIFY_ACCESS_TOKEN`: The Admin API token generated during the Shopify app setup.

- `SHOP_NAME`: Your Shopify store's name (the domain used in `.myshopify.com`). 

After completing the setup, you can deploy the Web App using Google Apps Script.

Once deployed, copy the Web App URL.  

It should look something like this:

`https://script.google.com/macros/s/AKssfycbzjAcUffffBFW9NmifLCfdfdfdfdNUmf1gB7LzbyBVsS2w7y8g5r7heQcLS3aIEC6Pvrd8hBB5Qfh4Kw/exec`

### Step 3: Set Up the Custom Pixel

After deploying the script, you can now call it from your Shopify Custom Pixel to retrieve customer information.

At this point, go to your Custom Pixel code and implement the final part of the integration.

You can adapt this implementation however you prefer, but below is an example of how I did it in one of my projects:

````js
analytics.subscribe("checkout_completed", async (event) => {
  console.log("--- START DEBUG CHECKOUT COMPLETED ---");
  console.log("Event received:", event);

  const baseDataLayerPayload = {
    event: "checkout_completed",
    timestamp: event.timestamp,
    id: event.id,
    client_id: event.clientId,
    data: event.data,
    name: event.name,
    context: event.context
  };

  let customerApiData = {};

  /* 1. CUSTOMER ID VALIDATION */
  const customerGid = event.data.checkout.order?.customer?.id;
  if (customerGid) {
    console.log("STEP 1: Customer ID found:", customerGid);
    const customerId = customerGid.replace("gid://shopify/Customer/", "");
    console.log("Extracted Customer ID:", customerId);

    /* 2. API CALL PREPARATION */
    const googleScriptUrl =
      "https://script.google.com/macros/s/AKfycbxcyh9CuY5V4iJbApC_yrb7xkzpc4ZDE4YSEN-cgbquBv-cxNSAgJNjf0DgGVaWrRGQ/exec";
    const secretApiKey = "secret-key"; // << usa la tua chiave

    const requestBody = {
      customerId: customerId,
      apiKey: secretApiKey
    };
    console.log("STEP 2: POST request body:", requestBody);

    try {
      /* 3. EXECUTING THE API CALL */
      console.log("STEP 3: Executing fetch call with POST...");
      const response = await fetch(googleScriptUrl, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=UTF-8" /* 👉 evita il pre-flight */
        },
        body: JSON.stringify(requestBody),
        keepalive: true /* consigliato da Shopify */
      });
      console.log("Response received. Status:", response.status, response.statusText);

      if (response.ok) {
        /* 4. SUCCESS */
        const responseData = await response.json();
        customerApiData = responseData;
        console.log("STEP 4 (SUCCESS): JSON data received and processed:", customerApiData);
      } else {
        /* 4. FAILURE (NON-OK RESPONSE) */
        const errorText = await response.text();
        console.error("STEP 4 (ERROR): Response was not OK. Error text:", errorText);
      }
    } catch (error) {
      /* 4. FAILURE (NETWORK ERROR) */
      console.error("STEP 4 (NETWORK ERROR): Fetch call failed.", error);
    }
  } else {
    console.error("STEP 1 (ERROR): Customer ID NOT found at event.data.checkout.order.customer.id");
  }

  /* 5. PUSH TO DATALAYER */
  window.dataLayer.push({
    ...baseDataLayerPayload,
    customerApiData: customerApiData
  });
  console.log("--- END DEBUG --- Data sent to dataLayer:", window.dataLayer[window.dataLayer.length - 1]);
});
    
    analytics.subscribe("payment_info_submitted", (event) => {
      window.dataLayer.push({
        event: "payment_info_submitted",
        timestamp: event.timestamp,
        id: event.id,
        client_id: event.clientId,
        data: event.data,
        name: event.name,
        context: event.context
      });
    });
````

The two most important variables in this script are:

- `googleScriptUrl`: This must point to the URL of your deployed Apps Script Web App.
- `secretApiKey`: This must match the Secret API Key you previously set in your Script Properties.

