# Forge service starters

Three layouts share one business content record: Editorial (warm studio journal), Bold (dark graphic portfolio), and Fresh (light service chooser). Suitable for barbers, nail/hair salons, beauty studios, and other appointment businesses. The renderer has no model calls, credentials, network requests, or storage.

## Use in Forge

In Field, “They answered” and “Generate 3 looks” call the existing protected `/api/forge-site` route with `action: templates`. This saves three independent HTML documents in `siteVariants` and selects Editorial. Direction buttons call `select_template` with `templateId`; `siteHtml` remains the selected document for existing consumers. Full screen opens the selected document in a sandboxed dialog. The existing custom edit path updates the selected variant only. “Rebuild 3 looks” intentionally replaces all three variants. The original `generate` API action remains available for custom model generation and clears template variants.

## Business content

Manager-created leads can include `siteContent`. Its known fields are normalized and retained; arbitrary scripts and unsupported fields are not stored there. Business name, category, phone, and location remain top-level lead fields.

```js
{
  businessName: 'Business name',
  category: 'Nail salon',
  location: 'City, State',
  phone: 'Business phone',
  siteContent: {
    headline: 'The business’s own headline',
    intro: 'A short verified introduction',
    about: 'The owner’s story',
    address: 'Verified address',
    services: [{ name: 'Actual service', price: '$45', duration: '45 min' }],
    hours: [{ day: 'Tuesday', time: '9 AM–5 PM' }],
    photos: [{ url: 'https://approved-host.example/photo.jpg', alt: 'Describe the work', credit: 'Required credit' }]
  }
}
```

Only supply facts and photos approved for reuse. HTTPS image URLs are accepted; missing images are explicit photo slots. Missing services are marked sample services, missing prices say “Ask for pricing,” and missing hours/address are marked unconfirmed. No fake testimonials are generated. Imported ratings are only displayed with a numeric review count and a source/date confirmation note.

## Edit and reuse

`public/forge-service-templates.js` is the shared Node/browser renderer. Use `generateServiceVariants(lead)` to get all three independent sources, or `renderServiceTemplate(lead, templateId)` for one. All CSS and behavior are inline in each result. Source can be edited or saved into separate Projects; generated instances do not modify the shared starter. Supplied photo URLs remain external assets.

`/forge-templates.html` is a public sample gallery with fictional business examples, editable name/headline/introduction/services, desktop/phone sizing, and an HTML download. Its edits are local and not persisted unless downloaded. No actual leads or private account data are loaded.

The booking dialog is a local demonstration: it collects sample name/day/service, checks no availability, sends nothing, and stores nothing. Live scheduling, form delivery, payments, and publishing are separate integrations. Do not present it as a working booking system.
