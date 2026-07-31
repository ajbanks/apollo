import { AxiosRequestConfig, AxiosResponse } from "axios";
import { $env } from "../utils/env";
import { chromium, Browser, BrowserContext } from "playwright";

let playwrightBrowser: Browser | null = null;
let playwrightContext: BrowserContext | null = null;

async function getPlaywrightContext() {
    if (!playwrightContext || !playwrightBrowser?.isConnected()) {
        if (playwrightBrowser) {
            await playwrightBrowser.close().catch(() => {});
        }
        
        playwrightBrowser = await chromium.launch({
            proxy: {
                server: `socks5://${$env.PROXY_HOST}:${$env.PROXY_PORT}`,
            },
            headless: true,
        });
        
        playwrightContext = await playwrightBrowser.newContext({
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            viewport: { width: 1920, height: 1080 },
            locale: "en-GB",
            timezoneId: "Europe/London",
        });
        
        // Pre-load a page to establish context
        const initPage = await playwrightContext.newPage();
        await initPage.goto("https://www.rightmove.co.uk/", { waitUntil: "load" }).catch(() => {});
        await initPage.close().catch(() => {});
    }
    
    return playwrightContext;
}

export function PlaywrightProxy() {
    return async (options: AxiosRequestConfig): Promise<AxiosResponse> => {
        const context = await getPlaywrightContext();
        const page = await context.newPage();
        
        try {
            // Set extra headers if provided
            if (options.headers) {
                await page.setExtraHTTPHeaders(
                    Object.fromEntries(
                        Object.entries(options.headers).map(([k, v]) => [k, String(v)])
                    )
                );
            }
            
            const url = options.url!;
            
            // Check if this is an API call
            if (url.includes("/api/")) {
                console.log(`[Playwright] API request detected: ${url}`);
                
                // Extract the location identifier from the URL
                const urlParams = new URL(url);
                const locationId = urlParams.searchParams.get("locationIdentifier");
                
                // Load the search page which will make the API call
                const searchUrl = `https://www.rightmove.co.uk/property-for-sale/find.html?locationIdentifier=${encodeURIComponent(locationId || "REGION^19408")}&sortType=2&channel=BUY`;
                
                console.log(`[Playwright] Loading search page to parse properties: ${searchUrl}`);
                const response = await page.goto(searchUrl, {
                    waitUntil: "domcontentloaded",
                    timeout: 60000,
                });
                
                if (!response) {
                    throw new Error("No response received from search page");
                }
                
                // Wait for page to fully load and make API calls
                await page.waitForTimeout(5000);
                
                // Try to extract property data using JavaScript evaluation
                const extractedData = await page.evaluate(() => {
                    // Try multiple ways to get the properties data
                    try {
                        // Method 1: Check window.__INITIAL_STATE__
                        const win = window as any;
                        if (win.__INITIAL_STATE__) {
                            const properties = win.__INITIAL_STATE__.properties?.results || win.__INITIAL_STATE__.properties || [];
                            if (Array.isArray(properties) && properties.length > 0) {
                                return { properties, source: "INITIAL_STATE" };
                            }
                        }
                        
                        // Method 2: Check window.__data or window.data
                        if (win.__data?.properties) {
                            return { properties: win.__data.properties, source: "__data" };
                        }
                        
                        // Method 3: Look for property containers in the DOM and extract attributes
                        const propertyElements = document.querySelectorAll('[data-testid*="property"], .property-card, [id*="property"], .propertyCard, [class*="propertyCard"]');
                        if (propertyElements.length > 0) {
                            const props = Array.from(propertyElements).slice(0, 24).map((el: any) => {
                                const link = el.querySelector("a") || el.closest("a");
                                const priceEl = el.querySelector('[data-testid*="price"]') || el.querySelector('.price');
                                const titleEl = el.querySelector('[data-testid*="title"]') || el.querySelector('h2') || el.querySelector('a');
                                
                                return {
                                    id: el.getAttribute("data-property-id") || el.getAttribute("id") || el.getAttribute("data-id"),
                                    url: link?.getAttribute("href"),
                                    price: priceEl?.textContent?.match(/£[\d,]+/)?.[0] || el.textContent?.match(/£[\d,]+/)?.[0],
                                    title: titleEl?.textContent?.trim(),
                                    propertyType: el.textContent?.match(/(?:Detached|Semi-detached|Terraced|Flat|Bungalow)/)?.[0],
                                };
                            });
                            return { properties: props, source: "DOM_ELEMENTS" };
                        }
                        
                        // Method 4: Parse script tags for embedded JSON
                        const scripts = Array.from(document.querySelectorAll("script"));
                        for (const script of scripts) {
                            if (script.textContent?.includes("properties")) {
                                try {
                                    const jsonMatch = script.textContent.match(/window\.__INITIAL_STATE__\s*=\s*({[^;]+});/);
                                    if (jsonMatch) {
                                        const data = JSON.parse(jsonMatch[1]);
                                        if (data.properties) {
                                            return { properties: data.properties, source: "SCRIPT_TAG" };
                                        }
                                    }
                                } catch (e) {
                                    // Continue searching
                                }
                            }
                        }
                        
                        return { properties: [], source: "NOT_FOUND" };
                    } catch (e) {
                        return { properties: [], source: "ERROR", error: (e as Error).message };
                    }
                });
                
                console.log(`[Playwright] Extraction result: ${extractedData.source}, found ${extractedData.properties?.length || 0} properties`);
                
                return {
                    data: {
                        properties: extractedData.properties || [],
                        resultCount: extractedData.properties?.length || 0,
                        pagination: {},
                        _source: extractedData.source,
                    },
                    status: 200,
                    statusText: "OK",
                    headers: { "content-type": "application/json" },
                    config: options as any,
                    request: {} as any,
                };
            } else {
                // For HTML pages, load normally
                console.log(`[Playwright] Loading HTML page: ${url}`);
                const response = await page.goto(url, {
                    waitUntil: "load",
                    timeout: 60000,
                });
                
                if (!response) {
                    throw new Error("No response received from goto");
                }
                
                const status = response.status();
                const headers: any = await response.allHeaders();
                
                // Wait a moment for the page to settle
                await page.waitForTimeout(1000);
                
                // Get the page content
                let data: any = await page.content();
                
                console.log(`[Playwright] Got response: ${status}`);
                
                return {
                    data,
                    status,
                    statusText: response.statusText(),
                    headers,
                    config: options as any,
                    request: {} as any,
                };
            }
        } catch (err: any) {
            console.error(`[Playwright] Error: ${err.message}`);
            throw new Error(`Playwright proxy error: ${err.message}`);
        } finally {
            await page.close().catch(() => {});
        }
    };
}

export const $playwrightProxy = PlaywrightProxy();
