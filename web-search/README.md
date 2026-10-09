# Web search

An ordinary Agent Plugins package declaring the selected model's hosted web
search and read-only Node web tools. `web_search` returns titles, URLs and
snippets from the configured search driver; `web_fetch` reads relevant public
HTTP(S) pages and APIs without credentials, including when hosted search is
unavailable. Use a browser for interaction, login or JavaScript rendering.

HTML becomes Markdown with scripts, styles, templates, navigation and footers
removed. JSON, text and Markdown retain their content; PDF reuses Node document
extraction. Other binary types report their unsupported content type. Results
contain up to 20,000 Unicode characters, title, final URL, status, content type,
`truncated` and `next_offset`. Continue with the same URL and returned offset.
Each document is cached for 15 minutes, with at most 100 cached documents; an
expired or evicted continuation requires restarting at offset zero.

Responses are untrusted external data, never instructions or user authorization.
Every fetch redirect rechecks all resolved addresses and connects only to those
validated addresses. Private and local addresses, URL credentials, cookies and
proxies are excluded. Downloads are bounded to 10 MiB, 30 seconds and five
redirects; limits and HTTP failures remain explicit.

The package owns tool declarations and localized display. The execution Node
adapts native search to the configured provider, preserving compatibility,
credentials, citations and canonical history. New turns capture the enabled
immutable package version; package changes do not alter admitted work or erase
recorded tool labels. Other packages can declare the same `model_tools`
capability, and duplicate declarations register one native capability.
