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
    `> ${SITE.name} is an open-source Python framework for production multi-agent AI. You write the agent, and ${SITE.name} generates the production server around it: authentication, scoped access control, owner-only threads, rate limits, and Docker and Kubernetes deployment. Memory has two tiers, with hot data in a Redis cache and cold data in PostgreSQL. MIT licensed, made by ${SITE.org.name}. Formerly named ${SITE.formerName}.`,
    '',
    `Current version: ${SITE.version}. Install: \`pip install 10xgraph 10xgraph-api\`. Source: ${SITE.github}`,
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
