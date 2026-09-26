# Shared Theme

Shared visual assets used by the WorkLog module and public product pages:

- `zhuge-os.css`
- `ai-product.css`
- `legal.css`
- `public-home.css`

Foundation tokens are split into:

- `tokens.css` — product colors and status colors.
- `variables.css` — radius and elevation.
- `dark.css` / `light.css` — theme surfaces.
- `typography.css` — type scale and family.
- `spacing.css` — spacing scale.

The existing WorkLog styles remain unchanged and can adopt these tokens
incrementally; this split does not force a UI rewrite.
