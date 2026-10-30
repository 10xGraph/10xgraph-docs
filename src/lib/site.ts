// Single source of truth for site-wide facts. Keep in sync with POSITIONING.md at the repo root.

export const SITE = {
  name: '10xGraph',
  url: 'https://10xgraph.com',
  tagline: '10xGraph by 10xScale: graph engineering for production AI agents.',
  description:
    'Open-source Python multi-agent framework. Write the agent and 10xGraph generates its production server: auth, rate limits, replay-safe tools and Kubernetes.',
  // Canonical repo URLs. The docs repo moved from 10xHub/agentflow-docs; GitHub redirects the
  // old URL, but "Edit this page" links should not depend on the redirect.
  github: 'https://github.com/10xGraph/10xGraph',
  docsRepo: 'https://github.com/10xGraph/10xgraph-docs',
  docsBranch: 'main',
  // Hosted playground (agentflow-playground/, Cloudflare). `10xgraph play` still opens the old
  // Firebase URL until the CLI's DEFAULT_PLAYGROUND_URL changes.
  playground: 'https://play.10xgraph.com',
  version: '1.0.0rc2',
  locale: 'en_US',
  org: { name: '10xScale', url: 'https://10xscale.ai' },
  formerName: 'Agentflow',
} as const;

export const NAV = [
  { label: 'Build', href: '/build' },
  { label: 'Docs', href: '/docs' },
  { label: 'Blog', href: '/blog' },
  { label: 'GitHub', href: SITE.github },
] as const;

// Blog categories. Every post has exactly one `kind`; each kind with posts gets /blog/kind/<kind>.
// Rules for what belongs in each: CONTENT_GUIDE.md at the repo root.
export const BLOG_KINDS = {
  tutorial: { label: 'Tutorials', blurb: 'Problem-first builds with 10xGraph: real use cases, working code, tested end to end.' },
  paper: { label: 'Papers', blurb: 'Research papers on agents, implemented in 10xGraph and run, with results, costs and limits.' },
  engineering: { label: 'Engineering', blurb: 'How 10xGraph works inside and why: failure modes, storage, auth and the runtime.' },
  release: { label: 'Releases', blurb: 'What changed in notable 10xGraph releases and how to upgrade. Every version is in the changelog.' },
  news: { label: 'News', blurb: 'Project announcements from the 10xGraph team: the rename from Agentflow, new packages, the GitHub org move and roadmap updates.' },
} as const;
export type BlogKind = keyof typeof BLOG_KINDS;

// Docs sections, in reading-journey order (install, learn, build, look up, unblock, everything
// else). A doc picks its section with the `section` frontmatter field and, optionally, a `group`.
export const DOC_SECTIONS = [
  'Get started',
  'Production',
  'Concepts',
  'Build agents',
  'API server',
  'TypeScript client',
  'Testing and evaluation',
  'Integrations',
  'Examples',
  'Reference',
  'Troubleshooting',
  'Glossary',
  'Compare',
  'Project',
] as const;
export type DocSection = (typeof DOC_SECTIONS)[number];
// Sections reached from the footer and in-page links, not the docs map.
export const MAP_HIDDEN: readonly DocSection[] = ['Glossary', 'Compare', 'Project'];

// Section landing pages (/docs/<slug>). When a doc with id `<slug>/index` exists, its content
// is shown at the top of the landing page.
export const SECTION_INFO: Record<DocSection, { slug: string; title: string; blurb: string }> = {
  'Get started': { slug: 'get-started', title: 'Get started with 10xGraph: install and first agent', blurb: 'Install 10xGraph, build and serve a first agent, then follow the tutorial from a hand-built graph to a tested, served agent.' },
  Production: { slug: 'production', title: 'Production readiness: what 10xgraph-api does for you', blurb: 'What the 10xGraph server enforces by default, what you configure, what you still own, and the path from quickstart to a deployed, secured, scaled agent.' },
  Concepts: { slug: 'concepts', title: '10xGraph concepts: graphs, state, memory, serving', blurb: 'How 10xGraph works: graphs and state, agents and tools, interrupts, memory and durability, serving, security and observability.' },
  'Build agents': { slug: 'guides', title: 'Build agents with 10xGraph: Python guides', blurb: 'Task guides for the Python library: agents and graphs, prebuilt agents and tools, MCP, memory, multi-agent flows, streaming, safety and observability.' },
  'API server': { slug: 'server', title: 'The 10xGraph API server: run, secure, deploy', blurb: 'Run your graph as a production API: configuration, auth, rate limits, streaming, WebSockets, AG-UI, files, observability and deployment.' },
  'TypeScript client': { slug: 'client', title: '10xGraph TypeScript client: call agents from apps', blurb: 'Call a 10xGraph server from TypeScript: invoke, stream, threads, remote tools, files, memory, realtime audio, errors and Next.js.' },
  'Testing and evaluation': { slug: 'testing', title: 'Testing and evaluating AI agents with 10xGraph', blurb: 'Unit tests with mocked models, evaluation sets, criteria, simulated users, reports and quality gates in CI.' },
  Integrations: { slug: 'integrations', title: '10xGraph integrations: models, frameworks, storage', blurb: 'Use 10xGraph with OpenAI, Google and Anthropic models, FastAPI, CopilotKit, Postgres and Redis, and AI coding assistants.' },
  Examples: { slug: 'examples', title: '10xGraph examples: walkthroughs and use cases', blurb: 'Walkthroughs of the examples in the repository, from a single tool agent to MCP and multi-agent systems, plus complete use cases.' },
  Reference: { slug: 'reference', title: '10xGraph reference: Python, REST API, CLI, TS client', blurb: 'Exact details: the Python library, the REST API, the CLI and configuration, the TypeScript client and error codes.' },
  Troubleshooting: { slug: 'troubleshooting', title: 'Troubleshooting 10xGraph: install, server, client', blurb: 'Fixes for common problems with installation, providers, the API server, deployments, the client and the playground.' },
  Glossary: { slug: 'glossary', title: 'AI agent glossary: key terms, explained', blurb: 'Plain definitions of AI agent terms: agents, ReAct, state graphs, memory, MCP, RAG, streaming, durable execution and idempotent tool calls.' },
  Compare: { slug: 'compare', title: '10xGraph compared with other agent frameworks', blurb: 'How 10xGraph compares with LangGraph, CrewAI, AutoGen, LlamaIndex agents and Google ADK, and when to pick each.' },
  Project: { slug: 'project', title: '10xGraph project: roadmap, security, upgrades', blurb: 'How the 10xGraph project is run: roadmap, security policy, upgrade guides, maintainers, support and contributing.' },
};

// Project policies linked from the footer: the license file, plus the docs pages for contributing and security.
export const POLICIES = [
  { label: 'License (MIT)', href: 'https://github.com/10xGraph/10xGraph/blob/main/LICENSE' },
  { label: 'Contributing', href: '/docs/project/contributing' },
  { label: 'Security policy', href: '/docs/project/security' },
] as const;

// Packages that publish releases, with the names they are published under today.
export const PACKAGES = {
  core: { label: 'Core framework', registry: 'PyPI', name: '10xgraph', url: 'https://pypi.org/project/10xgraph/' },
  api: { label: 'API server and CLI', registry: 'PyPI', name: '10xgraph-api', url: 'https://pypi.org/project/10xgraph-api/' },
  client: { label: 'TypeScript client', registry: 'npm', name: '10xgraph-client', url: 'https://www.npmjs.com/package/10xgraph-client' },
} as const;
export type PackageKey = keyof typeof PACKAGES;
