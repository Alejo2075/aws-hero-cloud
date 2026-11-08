# Product

What Hero is, who it is for, and what a person gets. How it is built is in [ARCHITECTURE.md](ARCHITECTURE.md); the order of work is in [ROADMAP.md](ROADMAP.md).

## What Hero is

Give Hero any application: hand-written, AI-generated, or decades old. Hero works out what it needs, finds the simplest way to run it on AWS, shows a plan in words the reader understands, and after a person approves, deploys it and proves it works.

Hero is an open-source engine that runs **on the user's own computer**, with **their own AWS account** and **their own AI** (optional). It is sponsored and initially maintained by Cloud Republic. It is not a hosted service, an AWS reseller, or a replacement for your AWS account.

> Your application in, a working system out, explained at your level.

## What Hero is not

No Hero accounts, organizations, subscriptions, or billing. No managed AI or managed AWS accounts. No central store of anyone's code or deployments. No hosted engine, not even on the public website. No silent deployments. Companies can build all of that on top of the SDK; Hero stays unaware of it.

## Who it is for

| Reader                                        | Level    | Needs                                                      | Gets                                                                        |
| --------------------------------------------- | -------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Beginner** (owns an app, does not know AWS) | `simple` | "Is it online and working? Is it safe? What does it cost?" | Plain sentences, a link, and a clear working / not-working answer           |
| **Intermediate** (knows some cloud)           | `guided` | To understand and trust what was built                     | The same, plus what each piece is, why it was chosen, and how to operate it |
| **Expert** (engineer, architect)              | `expert` | The full picture and control                               | Architecture, resources, evidence, raw data, and operating commands         |
| **AI assistant** (the user's own)             | any      | To analyze, plan, and explain on the user's behalf         | Structured data through the SDK or MCP; never approval                      |
| **Third-party product**                       | any      | An engine to embed                                         | The SDK, with its own accounts, billing, and UI on top                      |

## The flow

```text
1. Application   a folder, ZIP, or Git repository, of any age or origin
2. Understand    the analyzer reads it without running it and writes a Hero Spec
3. Plan          the planner picks a strategy and builds a plan with a cost estimate
4. Review        the plan is shown at the reader's level
5. Approve       a person approves that exact plan
6. Deploy        Hero applies it to the user's own AWS account
7. Prove it      health checks show whether the system works, plus links and cost
8. Operate       re-check health, update, or destroy at any time
```

Hero does not run the project's code while analyzing it, never creates anything that is not in the approved plan, and never hides costs or destructive changes.

## What you get back

The goal is not a URL; it is **confidence that the system is working**, in the form each reader needs. Every deployment ends with a result, and `hero-cloud health` can re-check it at any time. The data is always complete; the level decides how much is shown and how it is worded.

|                        | Beginner (`simple`)                                                                     | Intermediate (`guided`)                                                     | Expert (`expert`)                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Is it working?**     | One answer: **Working**, **Needs attention**, or **Down**, with the time it was checked | Status per part (website, API, database, files) and which check proved it   | Every check with kind, target, status code, and latency; resource state from the provider |
| **How do I reach it?** | A link to open, in plain words                                                          | Link, plus domain and address details and how to add your own domain        | URLs, IPs, hostnames, SSH or database addresses, stack outputs                            |
| **What was checked?**  | "Your home page opened and answered in 0.4 s"                                           | The list of checks in plain language, and what each does and does not prove | Check definitions, thresholds, and how to add custom smoke tests                          |
| **What does it cost?** | "About $14 a month", and a budget alert is set                                          | Cost per component, assumptions, and how to lower it                        | Estimate with confidence, pricing dimensions, tags for cost allocation                    |
| **Where do I look?**   | "Tap here if something looks wrong"                                                     | Links to logs, metrics, and the cost page                                   | Log groups, metric namespaces, dashboards, alarms, resource ids and ARNs                  |
| **What do I do next?** | Two or three steps: share the link, add a domain, undo everything                       | Update, roll back, add a domain, rotate secrets                             | Commands, CI hooks, state and drift, raw JSON                                             |
| **How do I undo it?**  | One clear "remove everything Hero made"                                                 | The destroy plan, in readable form                                          | The destroy plan with resources and dependencies                                          |

The same change at each level:

```text
simple   Your database will be created. Cost: about $12 a month.
guided   Hero creates a managed PostgreSQL database (Amazon RDS) because your app uses SQL tables.
         Alternative considered: DynamoDB (rejected: your queries use joins).
expert   create aws:rds:DBInstance  db.t4g.micro  postgres 16  gp3 20 GiB  single-AZ  private subnet
         evidence: package.json "pg" (0.98)
```

What never changes between levels: costs, destructive changes, warnings, the approval step, and the honest limits of the checks. Hero reports what it observed (the page answered, the database is available), not guarantees about the application's behavior.

Sensitive values (generated passwords, keys) are never shown or stored in results. Hero says where to find them.

## Any application

Hero picks the **lowest** strategy that works and explains why:

| Strategy          | Typical fit                                                                        | Burden  |
| ----------------- | ---------------------------------------------------------------------------------- | ------- |
| `static`          | Built front ends, sites                                                            | Lowest  |
| `serverless`      | Stateless HTTP/API, functions, scheduled jobs                                      | Low     |
| `container`       | Long-running servers, most legacy web apps                                         | Medium  |
| `virtual-machine` | Software that needs a whole machine: local disk state, odd runtimes, legacy stacks | Highest |

When Hero cannot be sure ("does this app write uploads to disk?"), it asks instead of guessing. When it cannot understand an app at all, it says so and offers a redacted local report that the user may attach to an issue, so every failure can become a new detector.

## Build on the engine

Hero's engine is a headless library, separate from every interface. It takes an input, understands it (with an AI if you supply one), plans, and, once your system passes in a person's approval, deploys to AWS and reports health. It has no UI, no prompts, no accounts, and no hidden services, so you can build your own system on it:

- a hosted service that adds its own users, billing, and support;
- an internal developer platform for your company's apps;
- an AI coding agent that can ship what it writes, with a human approving;
- a CI bot that comments the plan on every pull request;
- a migration tool for a legacy estate;
- the same flow for another cloud, by swapping the provider.

Hero's own CLI, Studio, and MCP server are built exactly like these. See [ARCHITECTURE.md](ARCHITECTURE.md#the-engine) for the guarantees an embedder can rely on.

## Interfaces

One engine, many doors, all over the same SDK. They differ in how they look, not in what they can do.

| Door                                    | For                                      | Status            |
| --------------------------------------- | ---------------------------------------- | ----------------- |
| SDK                                     | Developers, agents, third-party products | Contracts defined |
| CLI (`hero-cloud`)                      | Developers, scripts, CI                  | Planned           |
| Studio (`hero-cloud studio`, local web) | Beginners and mixed-skill teams          | Planned           |
| MCP server (`hero-cloud mcp`)           | The user's own AI assistant              | Planned           |
| Editor extension, CI action             | Developers; pipelines                    | Later             |

Reaching people who avoid terminals is staged: `npx` anywhere Node runs, then a single-file install that opens Studio, where Studio opens in the browser and you choose a folder or upload a ZIP. There is no desktop app.

The public site (`apps/web`) is documentation and discovery only. It never runs Hero and never asks for keys.

## Open source

Hero is open source under **Apache 2.0**, chosen because companies are meant to build commercial products on the SDK and the license is permissive with explicit patent terms. Cloud Republic provides stewardship, branding, website hosting, and early engineering, but is not in the runtime path, and features are not withheld from the open-source engine for its benefit. Governance is in [.github/GOVERNANCE.md](../.github/GOVERNANCE.md); brand rules in [brand/GUIDELINES.md](../brand/GUIDELINES.md).

## Principles

1. **Engine first.** Every interface is a door into one engine.
2. **Local and user-owned.** Credentials and source never leave the user's control.
3. **Any application** is a first-class input, including legacy and AI-generated ones.
4. **Explain at the reader's level**, without hiding cost, risk, or approval.
5. **Prove it, don't claim it.** Success means checks passed, and the evidence is shown.
6. **Deterministic first, AI second.** Use a model only where static evidence is not enough, and say when it was used.
7. **Plan before apply.** A person approves the exact plan; an AI agent never does.
8. **Least burden that works.**
9. **Extensible by contract**, and built to be contributed to.

## Scope

**Hero 1.0** delivers the whole vision: any application (JavaScript/TypeScript, Python, PHP, Java, .NET, Ruby, Go, static sites, and unclassified programs) from a folder, ZIP, or Git repository; the `static`, `serverless`, `container`, and `virtual-machine` strategies; safe builds in the user's own AWS account; health, update, rollback, secrets, and destroy; all three output levels in English and Spanish; the SDK, CLI, Studio (in the browser), and MCP server; guided AWS onboarding; and optional AI (Anthropic, OpenAI, Bedrock, Ollama, OpenAI-compatible), with `--no-ai` always available. It arrives in steps (0.1 understands, 0.3 first deployment, 0.6 for non-technical people, 0.9 legacy systems); see [ROADMAP.md](ROADMAP.md#milestones).

**Out of scope:** accounts and billing, managed AI or AWS, any hosted Hero service, Kubernetes, multi-region, multi-cloud, enterprise governance.

## Definition of success for 1.0

A non-technical person, without a Cloud Republic account, installs Hero, drops in an application of any supported kind, reads a plan they understand, approves it, and gets a working system in their own AWS account with a **health result they can trust at their level**. They can re-check it, update it, or remove it. An engineer can audit every resource that was created, and a developer can embed the same flow through the SDK.
