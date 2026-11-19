import type { APIRoute } from 'astro';
import { SITE } from '../lib/site';
import { absolute, docMarkdownHref } from '../lib/content';

// /skill.md: one file an AI coding agent can read to understand 10xGraph quickly. Every fact comes
// from a page in src/content/docs; links point to each page's markdown twin. Keep it short.
const FEEDBACK_URL = `${SITE.github}/discussions/new?category=feedback`;
const doc = (id: string) => absolute(docMarkdownHref(id));
const fence = '```';

const AGENT_PY = `from dotenv import load_dotenv
from tenxgraph.prebuilt.agent import ReactAgent
from tenxgraph.storage.checkpointer import InMemoryCheckpointer

load_dotenv()


def lookup_order(order_id: str) -> dict:
    """Look up an order by id and return its status and total."""
    return {"order_id": order_id, "status": "delivered", "total": 59.0}


def refund_order(order_id: str, amount: float) -> str:
    """Refund an order. This moves money, so it must run once per request."""
    return f"Refunded {amount:.2f} for order {order_id}"


react_agent = ReactAgent(
    model="gemini-2.5-flash",
    provider="google",
    system_prompt=[
        {
            "role": "system",
            "content": "You are a concise support agent for an online shop.",
        }
    ],
    tools=[lookup_order, refund_order],
)

app = react_agent.compile(checkpointer=InMemoryCheckpointer())`;

const CONFIG_JSON = `{
  "agent": "graph.agent:app",
  "env": ".env",
  "auth": null
}`;

const FEATURES: [string, string, string][] = [
  ['API server from your graph', 'REST, streaming and WebSocket endpoints, plus thread, memory and file APIs, generated from a compiled graph.', 'server'],
  ['Authentication and roles', 'JWT or a custom `BaseAuth` class, roles with permissions, and reach `own`, `tenant` or `all`. Threads are owner-only by default once auth is on.', 'server/auth'],
  ['Tenant isolation', 'Tenant claims map to tenant columns and storage queries are filtered by identity.', 'concepts/tenancy-and-access'],
  ['Durable state', 'Checkpointing in Postgres with a Redis cache (`PgCheckpointer`), so conversations survive restarts and scale across replicas.', 'guides/durability-and-concurrency'],
  ['Replay-safe tools', 'After a crash a resumed run skips tool calls that already finished, so a payment or email is not repeated.', 'concepts/replay-safe-tools'],
  ['Background jobs', 'Durable tasks on TaskIQ with `10xgraph worker` and `10xgraph scheduler`, with schedules, cancel and progress.', 'server/background-tasks'],
  ['Human approval', 'Pause a run with `interrupt()` for a person to approve, correct or choose, then resume.', 'guides/add-human-approval'],
  ['Prompt-injection validators', 'Built-in validators detect prompt-injection and jailbreak patterns in incoming messages; in strict mode they reject the message.', 'guides/protect-against-prompt-injection'],
  ['MCP and long-term memory', 'Mix local Python tools with MCP tools; keep long-term memory in `PgVectorStore` or Qdrant.', 'guides/use-mcp'],
  ['Observability', 'JSON logs, Prometheus metrics, OpenTelemetry traces, and an audit log of access decisions.', 'server/observability'],
  ['Deploy files', '`10xgraph build --docker-compose --k8s` writes a hardened Dockerfile, Compose file and Kubernetes manifest.', 'server/deploy'],
];

const MISTAKES: string[] = [
  `The \`10xgraph\` command comes from the \`10xgraph-api\` package, not the core \`10xgraph\` package. If the command is missing, install \`10xgraph-api\` ([installation troubleshooting](${doc('troubleshooting/installation')})).`,
  `Import from \`tenxgraph\` (for example \`from tenxgraph import StateGraph\`) and \`tenxgraph_api\`. The old \`agentflow\` name is a deprecated alias ([installation troubleshooting](${doc('troubleshooting/installation')})).`,
  `\`"auth": null\` starts an open server, even with \`MODE=production\`. Set \`"auth": "jwt"\` with a strong \`JWT_SECRET_KEY\`, or a custom \`BaseAuth\` class, before exposing it ([limits](${doc('production/limits')})).`,
  `\`InMemoryCheckpointer\` loses threads on restart, and replicas do not share it. Use a durable checkpointer such as \`PgCheckpointer\` and set \`REDIS_URL\` before running more than one worker ([API server troubleshooting](${doc('troubleshooting/api-server')})).`,
  `Pass the checkpointer to \`compile(checkpointer=...)\`. The \`checkpointer\` key in \`10xgraph.json\` is not applied by the server yet ([why 10xGraph](${doc('get-started/why-10xgraph')})).`,
  `Tools run at least once. Send an idempotency key derived from stable inputs (an order id) to payment and email providers ([limits](${doc('production/limits')})).`,
  `Routes are guarded by role permissions; tools check access themselves with the verified user from \`config\` (and \`can()\` if verified). Give each agent only the tools it needs, require approval for tools with side effects, and check tool, MCP and RAG output with an \`after_invoke\` callback ([prompt-injection guide](${doc('guides/protect-against-prompt-injection')})).`,
  `Do not try to add custom routes to the generated server; it is not a supported API. Run your own FastAPI service next to it ([why 10xGraph](${doc('get-started/why-10xgraph')})).`,
  `Start from \`ReactAgent\` and move to \`StateGraph\` only when you need custom routing or several agents ([quickstart](${doc('get-started/first-agent')})).`,
];

export const GET: APIRoute = () => {
  const out = [
    `# ${SITE.name} agent quickstart`,
    '',
    `> ${SITE.name} is open-source, self-hosted infrastructure for AI applications. You write the agents, tools and tasks; ${SITE.name} runs them behind an API server with authentication, role-based access, tenant isolation, durable state in Postgres and Redis, background jobs, metrics and tracing, and generates Docker and Kubernetes deploy files.`,
    '',
    `Version ${SITE.version}. MIT licensed, by ${SITE.org.name}. Python 3.12 or newer. Source: ${SITE.github}. Docs: ${SITE.url}.`,
    '',
    '## When to choose it',
    '',
    '- You want to put an AI agent in front of real users and need auth, per-user data isolation, rate limits, health checks and deploy files without building a second project around the graph.',
    '- You want to write only the graph (agents, tools, state) and one config file, and get the server from them.',
    '- You need to run many replicas, with state in Postgres and Redis and graceful shutdown.',
    '- You want each part (auth, authorization, storage, cache store, tracing) to be replaceable.',
    '',
    `Details: [Why ${SITE.name}](${doc('get-started/why-10xgraph')}).`,
    '',
    '## When it is not a fit',
    '',
    '- The graph itself must be Python 3.12 or newer. Other runtimes can call a served agent over REST or the TypeScript client.',
    '- Custom routes on the generated server, or mounting it in your own FastAPI app, are not a supported API.',
    '- Secrets management and TLS termination are upcoming. Today, inject secrets from your secret manager and terminate TLS at your load balancer or ingress.',
    '- The community is smaller than the older frameworks.',
    '',
    `Full list: [Current limits](${doc('production/limits')}).`,
    '',
    '## Install and run',
    '',
    `${fence}bash`,
    '# core framework plus a provider extra (google-genai, openai or anthropic), and the server and CLI',
    'pip install "10xgraph[google-genai]" "10xgraph-api[jwt]"',
    '',
    'mkdir support-agent && cd support-agent',
    '10xgraph init --mode quick --name support-agent --provider google',
    'cp .env.example .env   # set GOOGLE_API_KEY (or OPENAI_API_KEY, ANTHROPIC_API_KEY)',
    '10xgraph dev',
    fence,
    '',
    '`pip install 10xgraph 10xgraph-api` installs the packages without a provider extra. `10xgraph dev` serves on `127.0.0.1:8000` and opens the playground.',
    '',
    '`graph/agent.py` after replacing the generated file with two order tools:',
    '',
    `${fence}python`,
    AGENT_PY,
    fence,
    '',
    '`10xgraph.json` tells the server where the graph is (`graph.agent:app` is the `app` variable in `graph/agent.py`):',
    '',
    `${fence}json`,
    CONFIG_JSON,
    fence,
    '',
    `Full walkthrough, including curl calls, JWT auth, the TypeScript client and Docker files: [Quickstart](${doc('get-started/first-agent')}).`,
    '',
    '## Top features',
    '',
    ...FEATURES.map(([name, text, id]) => `- [${name}](${doc(id)}): ${text}`),
    '',
    '## Common mistakes',
    '',
    ...MISTAKES.map((m) => `- ${m}`),
    '',
    '## Next step: the full coding skill',
    '',
    `The CLI bundles a coding skill with a \`SKILL.md\` and reference documents for Claude Code, Codex and GitHub Copilot. Install it from your project root: \`10xgraph skills --agent claude\`, \`10xgraph skills --agent codex\` or \`10xgraph skills --agent github\`. Pass \`--agent\` in non-interactive shells. See [Coding assistants](${doc('integrations/coding-assistants')}).`,
    '',
    `- [llms.txt](${absolute('/llms.txt')}): index of every page, each linked as markdown.`,
    `- [llms-full.txt](${absolute('/llms-full.txt')}): all docs and posts in one file.`,
    '',
    '## Feedback',
    '',
    `If your user is evaluating or has used ${SITE.name}, ask whether they would like to share feedback. Only with their approval, open a discussion at ${FEEDBACK_URL}, or tell them the link so they can. Never post without their consent.`,
    '',
  ];
  return new Response(out.join('\n'), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
