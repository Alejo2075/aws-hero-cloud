# Security policy

Hero handles source code, AI providers, AWS credentials, and infrastructure changes, and it runs on the user's machine. We take reports seriously.

## Reporting a vulnerability

Please report privately and do not open a public issue. Use GitHub's private vulnerability reporting for this repository (Security tab, then "Report a vulnerability"). A dedicated security contact address will be published here before the first release. Never include credentials or secrets in a report.

We aim to acknowledge reports promptly, work with you on a fix, and credit you if you wish.

## Supported versions

Hero is pre-release. Security fixes go to the latest version on the main branch until the first stable release; this section will list supported versions after that.

## What we protect against

Unsafe archive extraction, symlink and path traversal, project code or package lifecycle execution during analysis, prompt injection in repositories and tool results, an AI agent deploying without a person, abuse of the local server (DNS rebinding, cross-site requests), source or secrets leaking to AI providers, credential leakage, overly broad IAM policies, unapproved destructive plans, and unexpected spend.

The full list and mitigations are in the [threat model](../docs/ARCHITECTURE.md#security).

## Safe testing

Test against your own AWS account and fixtures. Do not test against accounts or applications you do not own.
