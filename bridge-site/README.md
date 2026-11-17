# Render routing-only bridge for GitHub Pages

The visible Watch Tower page is served only from:
https://qqweasdzxc.github.io/zhuge-ai-os/learning/watch-tower/

Render service srv-dbtt3h67bikc73flk8hg retains the old URL only.
Publish this directory with no HTML, JavaScript or images.
Build command: echo Redirect-only
Publish directory: bridge-site
Auto-Deploy: Off

Apply the following rule using Render Dashboard Redirects/Rewrites:
Source: /*
Destination: https://qqweasdzxc.github.io/zhuge-ai-os/learning/watch-tower/
Action: Redirect (HTTP 301, the platform-supported code)

Do not add an index.html: Render serves existing resources before redirect rules.
A _redirects file is not the Render routing mechanism.
The browser keeps the original URL fragment across the redirect; no identity
fragment is transmitted to either HTTP server. GitHub presents one tower and
one five-second interval, with the original button to the learning root.

Official routing semantics:
https://render.com/docs/redirects-rewrites
