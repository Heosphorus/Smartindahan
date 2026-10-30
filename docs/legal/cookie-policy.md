# Cookies and browser storage (internal summary)

smarTindahan sets **no cookies**. The browser's local storage holds the session token (`sarismart_token`) and display preferences (theme, accent, font). Signing out removes the token from the device and revokes it on the server. There are no advertising trackers. The front end includes Vercel Web Analytics (`@vercel/analytics`), which counts page views without cookies and only reports when the site is served from Vercel.

Third-party requests made by the browser: the optional barcode product-name lookup sends the barcode number to Open Food Facts.

User-facing wording: Privacy Policy, section 3.
