# Security and Responsible Use

## Intended use

PhishForge generates **phishing-simulation email templates** for **authorized, consented** security-awareness testing. In other words, an organization (or a security firm acting for it) tests its own employees, with the organization's knowledge and agreement. This is the same model as commercial simulation platforms.

**Do not** use this software to:

- send deceptive email to people who have not consented to be tested,
- impersonate a real organization to defraud or harvest real credentials,
- run any campaign without written authorization from the organization being tested.

## Built-in boundaries

- **Template generation only.** PhishForge does not send email, manage target lists, host landing pages, or capture credentials or clicks.
- Generation prompts frame every output as an authorized simulation.
- The UI states the authorization boundary on the brief form.
- Sample brands, domains and addresses in this repo are fictional and use reserved TLDs (`.example`).

## Secrets

This repo contains **no credentials**. `.env` files are git-ignored, and only `.env.example` templates with placeholder values are tracked. Supply your own `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `SECRET_KEY`. Seeded demo accounts (`password123`) are for local development only and **must not** be used in any real deployment.

## Reporting a vulnerability

Please open a private security advisory on this repository (Security → Report a vulnerability) rather than a public issue.
