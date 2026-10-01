# App Shell

The shell owns application-level chrome shared by every module:

- Top Bar
- Sidebar
- Notification surface
- Avatar / identity surface
- Theme contract
- Breadcrumb

`index.js` is a side-effect-free contract for future module mounting. It does
not replace the validated WorkLog runtime or start a second authentication
flow.
