# Agent Guidelines

## 🧠 Coding Principles (all agents)

Derived from [Karpathy's LLM pitfalls](https://x.com/karpathy/status/2015883857489522876). Bias toward caution over speed; use judgment on trivial tasks.

### 1. Think Before Coding
- State assumptions explicitly. If uncertain, **ask** — don't guess and run.
- If multiple interpretations exist, present them. Don't pick silently.
- Push back when a simpler approach exists. Stop when confused.

### 2. Simplicity First
- No features beyond what was asked. No speculative abstractions.
- No "flexibility" or "configurability" that wasn't requested.
- If 200 lines could be 50, rewrite it.
- Test: "Would a senior engineer call this overcomplicated?" If yes, simplify.

### 3. Surgical Changes
- Touch only what the task requires. Don't "improve" adjacent code/comments/formatting.
- Match existing style, even if you'd do it differently.
- Remove imports/variables YOUR changes orphaned. Leave pre-existing dead code alone (mention it, don't delete).
- Every changed line should trace directly to the request.

### 4. Goal-Driven Execution
- Transform tasks into verifiable goals with success criteria.
- For multi-step work, state a brief plan with verify steps.
- Strong success criteria → independent looping. Weak criteria → ask first.
