# Autonomous Issue Implementation & Review Policy

This repo is set up so AI agents can implement issues on their own, from start to finish.
**The default is autonomous:** an agent implements, an LLM reviews, CI gates, and the PR auto-merges.
A human gets involved **only** when a change matches a rule in [§3 Human review required](#3-human-review-required).

> Agents: read this file before you start any issue. If you are unsure whether a change falls under §3, treat it as if it does.

---

## 1. Pipeline

```
Issue ──► Triage (LLM) ──► Implement (agent, own branch) ──► CI gates ──► LLM review ──► Auto-merge
              │                         │                                       │
              └── needs-human? ─────────┴────── touches §3 path/category? ──────┴──► label `needs-human-review`, stop
```

1. **Triage.** An LLM reads each new or open issue and adds exactly one label:
   - `agent-ready`: the issue is clear, scoped, and testable. Go.
   - `needs-clarification`: the agent posts specific questions as a comment, then stops. Don't guess on vague issues.
   - `needs-human-review`: the issue falls under §3 (the agent may still prepare a draft PR).
   - `too-large`: the agent splits it into sub-issues of about ≤ 400 changed lines each and triages those.
2. **Implement.** One issue per branch: `agent/<issue-number>-<slug>`. Keep PRs small. Write or update tests first when you can.
3. **CI gates.** All of these must pass before review: build, lint, type-check, tests, coverage not lower than on `main`, secret scan, dependency audit.
4. **LLM review.** This is a *separate* agent session that hasn't seen the implementation, using the checklist in §4. It either approves or requests changes. The implementing agent gets at most **3 fix rounds**. After that, escalate to a human.
5. **Merge.** Squash auto-merge once CI is green and the LLM has approved. The PR body must say `Closes #<n>`.

### Running it
- **Trigger:** use the Claude Code GitHub Action (`@claude` on an issue, or on `issues: labeled agent-ready`), or a scheduled task that picks up `agent-ready` issues each night.
- **Branch protection on `main`:** require a PR, require status checks, and require 1 approval (the LLM reviewer bot counts). Add a `CODEOWNERS` that only lists the §3 paths, so GitHub enforces human review there automatically.
- **Concurrency:** at most N agent PRs open per repo (suggested: 3) so merge conflicts don't pile up.

---

## 2. LLM-reviewable (no human needed)

Changes like these can merge with LLM review alone, as long as they don't touch anything in §3:

- Bug fixes with a reproducing test
- New features behind existing patterns: endpoints, components, CLI flags, report sections
- Refactors that don't change behaviour (tests stay unchanged and green)
- Adding or improving tests
- Documentation, README, docstrings, comments, typos
- UI and styling changes in existing components
- Logging, error messages, i18n strings and translations (for user-facing *legal* text, see §3)
- Language, lesson, dictionary, and game-rule content. Expert review is deferred and batched, see §3.8.
- Performance improvements with a before/after benchmark or test
- Lint and format fixes, dead-code removal
- **Patch and minor** dependency bumps where CI passes and the changelog has no breaking-change notes
- Non-destructive, additive DB migrations: a new nullable column, a new table, a new index

---

## 3. Human review required

Add the label `needs-human-review`, request a review from CODEOWNERS, and **do not auto-merge** if a change does any of the following.

### 3.1 Security & access
- Authentication, authorization, sessions, tokens, password handling, permission checks
- Cryptography, signing, hashing of secrets
- Secrets, credentials, `.env*`, key management, anything that loosens a secret scanner
- CORS, CSP, rate limiting, input-sanitisation layers, firewall/network rules
- Any fix for a reported vulnerability (CVE, security issue)

### 3.2 Data & privacy
- **Destructive or irreversible** DB migrations: drop or rename a column or table, data backfills/rewrites, type narrowing
- Collecting, storing, exporting, or deleting **personal data** (PII), including GDPR/AVG retention and logging of PII
- Changes to data models that are shared with other services or clients (breaking schema changes)

### 3.3 Infrastructure, deploy & cost
- CI/CD workflows (`.github/workflows/**`), **including this pipeline and the reviewer prompt itself**
- Branch protection, `CODEOWNERS`, this policy file
- Infrastructure-as-code (Terraform, Bicep, Helm, Docker/compose for prod), DNS, cloud IAM
- Anything that adds recurring cost: new paid services, larger instances, new external API usage with billing
- Production config, feature flags that default to **on** in production

### 3.4 Dependencies & licensing
- **Major** version bumps, or swapping/adding a framework-level dependency
- Adding any new dependency with a copyleft (GPL/AGPL) or unknown license
- Dependencies from unknown or low-reputation publishers

### 3.5 Public contracts
- Breaking changes to a public API, SDK, CLI, file format, or webhook payload
- Removing endpoints or features that users rely on
- Versioning or release decisions (tagging, publishing to npm/PyPI, app stores)

### 3.6 Domain judgement
- **Compliance, legal, audit, or fraud-risk logic**: scoring rules, thresholds, control judgements, report wording that ends up in an official deliverable
- Payments, billing, pricing, invoices
- Legal or user-facing policy text (terms, privacy notice, disclaimers)
- Prompts, model choice, or eval thresholds for LLM features that are in production

> Language and cultural content is **not** on this list on purpose. See [§3.8](#38-deferred-content-review).

### 3.8 Deferred content review
Language and cultural content means vocabulary, grammar, lessons, example sentences, translations, transliteration rules, dictionaries, and game rules such as Troefcall. It is **LLM-reviewed per PR and merged without waiting for a human.** Expert review happens once, as a batch, after the product is complete. We accept the risk that content is wrong until that review.

- **Per PR:** the LLM reviewer checks that content is internally consistent, follows the repo's content schema and authoring docs, cites its source (an authored doc, a PDF section, or the rulebook paragraph), and doesn't contradict existing content. If the agent was unsure about a word, translation, or rule, it says so in the PR body and adds the label `content-unverified`. That label does **not** block the merge.
- **When the batch review happens:** once per repo, after the content is complete *and* the rest of the product is production-ready. That means features done, §3 items resolved, CI green, deployed to staging, and no open bugs blocking release. Doing it then means the expert reviews everything once instead of re-reviewing it after every change.
- **How it works:** an agent compiles everything labelled `content-unverified`, plus a full export of the content, into one review package grouped by topic. The expert's corrections come back as issues, and agents implement those as normal `agent-ready` work.
- **Still needs a human per PR:** content that is legal or policy text (§3.6), content about identifiable real people, and anything presented to users as official or certified.

### 3.7 Process signals (escalate no matter the topic)
- The LLM reviewer and implementer disagree after 3 rounds
- The issue was ambiguous and the agent had to pick between materially different interpretations
- The diff is larger than about 600 lines (excluding lockfiles and generated files), or touches more than 20 files
- Tests had to be **deleted or weakened** to make CI pass
- Coverage on changed lines < 70%
- The agent could not run the code or tests locally
- Anything that can't be undone with `git revert` (data deletion, sent emails, published packages)

---

## 4. LLM reviewer checklist

The reviewer must answer each item in the PR review. If any item fails, request changes.

1. **Scope:** Does the diff do what the issue asks, and nothing unrelated?
2. **§3 check:** List each changed path and confirm none match §3. If one does, label `needs-human-review` and stop reviewing.
3. **Correctness:** Edge cases, error handling, null/empty input, concurrency, timezones.
4. **Tests:** New behaviour is tested, tests would fail without the change, and no tests were weakened.
5. **Security smell test:** Injection, unsafe deserialisation, path traversal, hard-coded secrets, overly broad permissions.
6. **Consistency:** Follows existing patterns, naming, and structure. No duplicate utilities.
7. **Docs:** README, changelog, and docstrings are updated where behaviour changed.
7a. **Content:** For language or game-rule content, follow §3.8. Check sources and consistency, label `content-unverified` where the agent was unsure, and don't block the merge on correctness.
8. **Reversibility:** Can this be reverted cleanly?

The reviewer may **not** approve its own implementation session's work, and may not change §3 or this checklist.

---

## 5. Agent rules of engagement

- Never push to `main`. Never force-push to a branch someone else opened.
- Never disable, skip, or loosen a check (`--no-verify`, `skip ci`, lowering coverage thresholds, deleting tests) to get green.
- Never commit secrets or `.env` files.
- Ask on the issue rather than guessing when requirements are ambiguous, then move on to the next `agent-ready` issue.
- Link every PR to its issue, and explain *why* in the PR body, not just *what*.
- If a change hits §3 partway through implementation, finish a draft PR, add the label `needs-human-review`, and summarise the specific §3 rule(s) that triggered it.
