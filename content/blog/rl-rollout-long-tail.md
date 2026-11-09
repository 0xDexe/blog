---
title: "Half of Every RL Rollout Step Waits on the Slowest 10%: What Fixed It, and the 2x That Didn't"
date: November 08, 2026
tags: [vLLM, Reinforcement Learning, LLM Inference, Speculative Decoding, GRPO, Systems]
---

For two days, my headline result was that my RL rollout scheduler ran **2.4x faster** than the baseline, and I was about to build this post around it. Before writing, I checked the `env.json` file my harness saves next to every run. The "fast" runs had landed on a 97 GB RTX PRO 6000 Blackwell node. The baseline had run on a 46 GB L40S. Re-run on the same GPU, the speedup was gone.

This post covers what I found after that: where RL rollout time actually goes on a single GPU, the fixes that don't help (even though the metrics say they should), and the one that does. **Gating speculative decoding on batch size gave +23% rollout throughput and +70% tail throughput at a 16k-token limit, with reward unchanged.**

## TL;DR

- **The long tail dominates.** With a 16k-token limit, 45% of each GRPO rollout step is spent after 90% of the sequences have finished.
- **Scheduling around it barely helps on one GPU.** Keeping every slot full (occupancy 0.47 → 0.99) and adaptive KV-aware admission both landed within noise of the simple baseline.
- **Making the tail itself faster does help.** vLLM's n-gram speculation, switched on only when 64 or fewer sequences are running: 2,725 → 3,355 tok/s, tail throughput 758 → 1,288 tok/s.
- **You can measure drafting strategies offline, without bias.** A replay simulator predicted vLLM's real acceptance within a few percent, before I wrote any engine code.

## The Challenge

In RL post-training of reasoning models (GRPO, PPO), most wall-clock time goes to generating rollouts. GRPO samples G completions per prompt, here 64 prompts × 8 samples = 512 sequences per step, and the trainer waits for all of them. Reasoning traces are heavily long-tailed:

- **The median trace** is about 1,400 tokens.
- **The longest trace in a batch** regularly runs past 10,000 tokens and sometimes hits the 16,384 limit.
- **Average slot occupancy is 0.30**: for most of the step, the GPU is working on a small, shrinking batch.

![Sequences decoding and KV-cache usage over time, 16k limit](images/longtail/final16k_timeline.png)

**How to read this chart.** Each blue sawtooth in the top panel is one barrier step: 256 sequences start together, most finish within a couple of minutes, and the last few drag on alone. Every flat stretch near zero is the GPU waiting on stragglers. The other lines are the refill scheduler, which keeps the GPU full by starting new work as sequences finish. Its KV cache (bottom panel) is pinned at 100% almost the entire time. I expected that to be a big win. It wasn't.

## Why the Tail Is Slow

I wanted to understand why a handful of sequences can take minutes, so I did the arithmetic from my own logs.

### 1. Every Generated Token Rereads the Whole KV Cache

- **KV cache per token**: vLLM reported 33.19 GiB of KV cache holding 310,768 tokens for Qwen3-1.7B, about **112 KiB per token** (28 layers × 8 KV heads × 128 dims × key + value × 2 bytes).
- **One long sequence**: at 10,000 tokens, that's about **1.1 GiB of KV cache**, all of which is read for every new token.
- **Bandwidth**: an L40S has about 864 GB/s of memory bandwidth. Twenty such sequences mean roughly 22 GiB of reads per decode step, about 25 ms, or around 40 tokens per second per sequence, no matter how much compute is free.

So the tail isn't slow because there are few sequences. It's slow because every remaining sequence pulls a gigabyte through memory for each token it produces.

### 2. Which Makes Verification Nearly Free

Speculative decoding guesses the next k tokens cheaply and then verifies them all in one forward pass. That pass reads the same weights and the same KV cache as generating a single token, so in the tail, verifying 8 drafted tokens costs about the same as producing one. Every accepted draft token is close to a free token.

With 200+ sequences in flight it's different: the GPU is busier, and verifying 8 extra tokens for every sequence is real work. That's why the batch size matters, and it explains the results below.

## Architecture Overview

I built **longtail-rl**, a measurement harness around vLLM 0.33's async engine:

### 1. Two Rollout Schedulers

- **Barrier**: submit the whole batch and wait for the slowest sequence, like most RL frameworks.
- **Refill**: start a new GRPO group as soon as a group's worth of slots frees up, and hand the trainer a batch once enough complete groups exist. Long sequences carry over into later steps, and their staleness is recorded.

### 2. Engine Telemetry

- **Once-a-second sampling** of vLLM's own metrics: running and waiting sequences, KV-cache usage, preemptions, generated tokens, and speculative acceptance.
- **Tail tok/s**: throughput while 64 or fewer sequences are decoding. It's much less noisy than step time, which depends on whichever sample happens to run longest.

### 3. An Offline Drafting Simulator

- **Records every generated token**, then replays batches engine step by engine step to evaluate drafting strategies without touching vLLM (details below).

### 4. Experiment Infrastructure

- **A TOML experiment queue**: many runs in one GPU job, each in its own process, resumable after time-limit kills.
- **Automatic logging** of config, GPU, package versions and git commit for every run, plus a report script that produces the tables and charts in this post. Logging the GPU is what caught the 2x mistake.

## Implementation

### 1. Scheduling Around the Tail (Didn't Help)

Refill does what it promises on the surface: slot occupancy went from 0.47 to 0.99. Throughput didn't follow. Same L40S, 4k limit, 7 measured steps each:

| Setup | tok/s | Preemptions per step |
|---|---|---|
| Barrier, 512 in flight | 4,014 ± 220 | 390 |
| Refill, fixed cap 384 | 3,952 ± 164 | 2,649 |
| Refill, adaptive admission | 4,120 ± 279 | 761 |

![KV-cache preemptions per step, 4k limit](images/longtail/final4k_preemptions.png)

A 7x difference in preemptions (vLLM evicting a sequence's KV cache and recomputing it later) produced the same throughput. Recomputing a sequence is one large prefill, which GPUs handle very efficiently, so it costs far less than the counts suggest. And slot occupancy isn't GPU utilization: decode on this GPU stops scaling well below 512 concurrent sequences.

I also built a **KV-aware admission controller** that adjusts the in-flight cap from vLLM's live KV usage and preemption count. It works mechanically, but it's reactive: newly admitted sequences use little KV at first and grow later, so it admits too many and then has to cut back. At 16k it reached 2,967 tok/s against 2,725 for the barrier baseline, within run-to-run noise.

### 2. Measuring Drafts Before Building Anything

Before writing a speculative drafter, I wanted to know what one would be worth. The key observation makes offline evaluation exact:

> For temperature sampling with a deterministic draft token x, speculative decoding accepts x with probability p(x). Plain sampling produces exactly x with the same probability p(x).

So if you record real rollouts and replay them, counting how often a drafted token matches what was actually sampled gives an **unbiased estimate of real acceptance**, chained across draft positions. No engine changes needed.

On 1,024 recorded 16k rollouts, the simulator found:

- **Self-drafting** (vLLM's n-gram method: find the sequence's last few tokens earlier in its own text, copy what followed) averaged 1.64 tokens per step overall and 1.95 in the tail.
- **Long traces repeat themselves**: 21.5% of 8-token sequences in the longest 10% of traces had already appeared earlier in the same trace, against 8% for the rest. That comes from re-checking equations and intermediate values, not degenerate loops; no trace ended in one.

Then I checked it against the real engine: the simulator predicted **0.643 accepted tokens per verification step**, and vLLM measured **0.61–0.68**.

### 3. Gated Speculation (The Win)

vLLM has a batch-size schedule for speculative decoding, so drafting can be limited to the tail with a config change:

```python
speculative_config = {
    "method": "ngram",
    "num_speculative_tokens": 8,
    "prompt_lookup_min": 2,
    "prompt_lookup_max": 4,
    # draft 8 tokens when <= 64 sequences are running, none above that
    "num_speculative_tokens_per_batch_size": [[1, 64, 8], [65, 512, 0]],
}
```

16k limit, same GPU, same prompts, 7 measured steps each:

| Setup | tok/s | Tail tok/s | Step time | Reward |
|---|---|---|---|---|
| Barrier, cap 256 | 2,725 ± 334 | 758 ± 119 | 365 s | 0.936 |
| + gated n-gram speculation | **3,355 ± 352** | **1,288 ± 170** | **296 s** | 0.934 |

![Rollout throughput at a 16k limit](images/longtail/final16k_throughput.png)

That's **+23% throughput, +70% tail throughput and 1.23x faster steps**, with reward unchanged, as expected: speculative decoding doesn't change the output distribution. In an earlier run, the same drafter left on for every step reached only 1.02x. It shortened the tail just as much, but verifying drafts for hundreds of sequences in the bulk phase cancelled the gain.

### 4. Sibling Drafting (An Honest Partial Result)

GRPO gives each sequence 7 siblings answering the same question. My hypothesis was that siblings make good draft sources: one might restate the problem while another has already started computing, so its text is ahead in content. I built it as a custom vLLM drafter:

- **Offline**: drafting from self + siblings reached 2.14 tokens per step, against 1.64 for self only (+30%).
- **Inside vLLM**: siblings supplied 35% of all drafts and raised accepted tokens per draft by about 10%.
- **End to end**: +3% throughput over self-drafting alone. The custom-drafter path ran on the CPU in vLLM's older V1 runner, and that overhead absorbed most of the gain.

The idea holds up in the measurements, but the implementation path limited it. A GPU-native version is the obvious next step.

## What Didn't Work, and Why

1. **Filling every slot (refill)**: occupancy 0.99, same throughput. Decode was already saturated.
2. **Cutting preemptions**: 7x fewer preemptions, same throughput. Recompute is cheap.
3. **Adaptive admission**: reacts to KV usage after the fact, while sequences keep growing after admission.
4. **Always-on speculation**: the tail got faster, the bulk phase got slower, and the net was 1.02x.
5. **A CPU-side custom drafter**: better drafts, but per-step overhead ate most of the gain.

## If You Run RL Infrastructure

- **Measure tail throughput, not step time.** Step time is dominated by whichever sample runs longest.
- **Gate speculative decoding on batch size.** In vLLM it's one config field, and it's the cheapest throughput win in this post.
- **Don't trust occupancy or preemption counts as proxies.** Measure tokens per second.
- **Log the GPU with every result.** Clusters move jobs between node types, and a hardware difference can look like an algorithmic one.
- **Simulate drafting strategies offline first.** Exact-match replay is unbiased for temperature sampling and takes minutes on a CPU.

## Deployment Notes

- **Hardware**: one NVIDIA L40S (46 GB) per job on BU's SCC cluster; vLLM 0.33, torch 2.14, Qwen3-1.7B in bf16, GSM8K prompts.
- **Scheduling**: SGE batch jobs, each running a whole experiment queue, with weights prefetched and Hugging Face in offline mode.
- **Gotchas**: SCC's system Python lacks `Python.h`, which Triton needs (use a uv-managed Python); compute nodes have no `nvcc`, so FlashInfer's JIT sampler fails (set `VLLM_USE_FLASHINFER_SAMPLER=0`).
- **Moving target**: vLLM removed the V1 runner my custom drafter depended on during this project, and replaced custom drafters with a registered speculator interface.

## Next Steps

- **Port the sibling drafter** to vLLM's new GPU speculator interface, removing the CPU overhead that limited it.
- **Combine refill with tail-gated drafting**, so the final drain of each refill run also benefits.
- **Predictive admission** from each prompt's output-length history, since RL revisits the same prompts every epoch.
- **Close the loop** with a GRPO trainer to measure end-to-end training steps per hour.

## Conclusion

On a single GPU, the long tail of reasoning traces dominates RL rollout time, and keeping the GPU busy doesn't fix it, because the tail's real cost is memory bandwidth spent rereading each long sequence's KV cache. Speeding up the tail does fix it: gating speculative decoding on batch size turns the spare compute in the drain phase into a 23% throughput gain. The project's most useful lesson was more mundane: log the hardware next to every number.

The code, experiment plans, raw results and simulator are in the repo, and every number here can be reproduced from the archived runs. If you work on RL infrastructure or inference and want to compare notes, reach out on LinkedIn or open an issue.
