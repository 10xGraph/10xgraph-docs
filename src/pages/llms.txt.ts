import type { APIRoute } from 'astro';
import { DOC_SECTIONS, SITE } from '../lib/site';
import { absolute, buildMarkdownHref, docMarkdownHref, getBuilds, getDocs, getPosts, postMarkdownHref } from '../lib/content';

// llms.txt (https://llmstxt.org): a markdown index of the site for LLMs. Links point to the
// plain-markdown twin of each page so agents get clean text instead of HTML.
export const GET: APIRoute = async () => {
  const [builds, docs, posts] = await Promise.all([getBuilds(), getDocs(), getPosts()]);
  const out: string[] = [
    `# ${SITE.name}`,
    '',
    `> ${SITE.name} is open-source, self-hosted infrastructure for AI applications. You write the agents, tools and tasks; ${SITE.name} runs them behind an API server with authentication, role-based access, tenant isolation, durable state in Postgres and Redis, background jobs, metrics and tracing, and generates Docker and Kubernetes deploy files. MIT licensed, by ${SITE.org.name}. Formerly ${SITE.formerName}.`,
    '',
    `Current version: ${SITE.version}. Install: \`pip install 10xgraph 10xgraph-api\`. Source: ${SITE.github}`,
    '',
    `Start here: [Why ${SITE.name}](${absolute(docMarkdownHref('get-started/why-10xgraph'))}) explains what the generated API server does (security, horizontal scaling, production defaults), how to replace each part (authentication, authorization, rate limits, storage), and its current limits. The [Platform overview](${absolute(docMarkdownHref('production'))}) lists every concern the server handles.`,
    '',
    `Learn from examples: [${SITE.name} examples](${absolute(docMarkdownHref('examples'))}) indexes 38 runnable examples, each with a code walkthrough and the full source of every file: getting started, tools and MCP, production features (graceful shutdown, resilience, human-in-the-loop, persistence, callbacks, observability), memory and RAG, multi-agent, testing and evaluation, two use cases and two full-stack apps ([RAG assistant](${absolute(docMarkdownHref('examples/rag-assistant'))}), [CopilotKit over AG-UI](${absolute(docMarkdownHref('examples/copilotkit-agui'))})).`,
    '',
  ];
  if (builds.length) {
    out.push('## Build guides', '');
    for (const b of builds) out.push(`- [${b.data.title}](${absolute(buildMarkdownHref(b.id))}): ${b.data.description}`);
    out.push('');
  }
  for (const section of DOC_SECTIONS) {
    const items = docs.filter((d) => d.data.section === section);
    if (!items.length) continue;
    out.push(`## ${section}`, '');
    for (const d of items) out.push(`- [${d.data.title}](${absolute(docMarkdownHref(d.id))}): ${d.data.description}`);
    out.push('');
  }
  if (posts.length) {
    out.push('## Blog', '');
    for (const p of posts) out.push(`- [${p.data.title}](${absolute(postMarkdownHref(p.id))}): ${p.data.description}`);
    out.push('');
  }
  out.push('## Optional', '', `- [Full content](${absolute('/llms-full.txt')}): every doc and post in one file`, `- [Changelog](${absolute('/changelog')}): release notes for every published version`, `- [Agent resource catalog](${absolute('/.well-known/ard.json')}): ARD manifest listing the 10xGraph agent skill`, '');
  return new Response(out.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
