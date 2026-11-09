---
title: longtail-rl - Measuring and Fixing the Long Tail in RL Rollouts
order: 0
tags: [vLLM, Reinforcement Learning, Speculative Decoding, GRPO, LLM Inference, Systems]
---

# longtail-rl

A measurement harness around vLLM's async engine for figuring out where RL rollout time actually goes on a single GPU, and which fixes really help. The headline: gating speculative decoding on batch size gave **+23% rollout throughput and +70% tail throughput** at a 16k-token limit, with reward unchanged.

Full write-up: [Half of Every RL Rollout Step Waits on the Slowest 10%](#post/rl-rollout-long-tail)

## The Problem

GRPO samples 512 sequences per step (64 prompts × 8 samples), and the trainer waits for all of them. Reasoning traces are long-tailed: the median is about 1,400 tokens, but the longest regularly passes 10,000. At a 16k limit, **45% of each step is spent after 90% of the sequences have finished**, while the GPU decodes a small, shrinking batch that's bottlenecked on memory bandwidth.

## What's Inside

- **Two rollout schedulers**: a barrier scheduler (wait for the slowest sequence, like most RL frameworks) and a refill scheduler that starts new GRPO groups as slots free up and tracks staleness.
- **Engine telemetry**: once-a-second sampling of vLLM's running and waiting sequences, KV-cache usage, preemptions, generated tokens and speculative acceptance, plus a tail-throughput metric that's far less noisy than step time.
- **An offline drafting simulator**: records every generated token and replays batches step by step. For temperature sampling, exact-match replay is an unbiased estimate of real acceptance. It predicted 0.643 accepted tokens per verification step; vLLM measured 0.61–0.68.
- **A sibling drafter**: a custom vLLM drafter that also drafts from the other 7 GRPO samples answering the same prompt.
- **Experiment infrastructure**: a resumable TOML experiment queue, and automatic logging of config, GPU, package versions and git commit for every run. Logging the GPU is what caught a fake 2x speedup that came from a faster node.

## Results

16k limit, same GPU and prompts, 7 measured steps each:

| Setup | tok/s | Tail tok/s | Step time | Reward |
|---|---|---|---|---|
| Barrier, cap 256 | 2,725 ± 334 | 758 ± 119 | 365 s | 0.936 |
| + gated n-gram speculation | **3,355 ± 352** | **1,288 ± 170** | **296 s** | 0.934 |

What didn't move the needle:

- **Refill scheduling** raised slot occupancy from 0.47 to 0.99 with no throughput gain. Decode was already saturated.
- **7x fewer preemptions** gave the same throughput, because recompute is one cheap prefill.
- **Always-on speculation** only reached 1.02x: verifying drafts for hundreds of sequences in the bulk phase cancelled the tail gains.
- **Sibling drafting** raised offline draft quality by 30%, but ended at +3% end to end because the custom-drafter path ran on the CPU.

## Stack

Python, vLLM 0.33, PyTorch, Qwen3-1.7B (bf16), GSM8K prompts, one NVIDIA L40S per job on BU's SCC cluster with SGE batch jobs.

## Next

- Port the sibling drafter to vLLM's GPU speculator interface.
- Combine refill scheduling with tail-gated drafting.
- Predictive admission from each prompt's output-length history.
- Close the loop with a GRPO trainer to measure training steps per hour.
