import { SITE } from './site';

// Agentic Resource Discovery manifest (https://agenticresourcediscovery.org/spec/): tells AI
// agents and registries what this site offers them. Served at /.well-known/ard.json and at the
// legacy /.well-known/ai-catalog.json. Lighthouse checks both shapes: older versions require
// `specVersion` and reject unknown root keys, newer ones only require `entries`, so the root
// holds exactly specVersion, host and entries.
// Validate changes with Lighthouse's "Agentic Browsing" category.

// The agent skill installed by `10xgraph skills`, read from the API repo so it never drifts.
const SKILL_URL =
  'https://raw.githubusercontent.com/10xGraph/10xgraph-api/main/tenxgraph_api/cli/templates/skills/10xgraph/SKILL.md';

export const ardManifest = {
  specVersion: '1.0',
  host: {
    displayName: SITE.name,
    documentationUrl: SITE.url,
    logoUrl: `${SITE.url}/logo-512.png`,
  },
  entries: [
    {
      identifier: 'urn:air:10xgraph.com:skills:10xgraph',
      displayName: '10xGraph agent skill',
      type: 'text/markdown; profile="urn:air:agent-skills"',
      url: SKILL_URL,
      description:
        'Agent skill for coding assistants building with 10xGraph: StateGraph, agents and tools, memory, checkpointing, streaming, the API server, the CLI and the TypeScript client.',
      tags: ['10xgraph', 'python', 'multi-agent', 'agent-framework', 'skill'],
      representativeQueries: [
        'How do I build a multi-agent workflow with 10xGraph?',
        'How do I add a tool to a 10xGraph agent?',
        'How do I serve a 10xGraph graph as an API with auth?',
        'How do I persist 10xGraph threads with a Postgres checkpointer?',
      ],
    },
  ],
};

export const ardResponse = () =>
  new Response(JSON.stringify(ardManifest, null, 2), { headers: { 'Content-Type': 'application/json' } });
