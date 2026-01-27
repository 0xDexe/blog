---
title: LLM Orchestration in Production - Lessons from Building an AI Chatbot
date: January 10, 2026
image: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&h=400&fit=crop
tags: [LLM, RASA, BERT, NLP, Production, Chatbot]
likes: 38
---

When we set out to build an intelligent chatbot at Tick Boxes Management, we knew it needed to do more than just answer questions. It had to understand context, extract intents from unstructured data, and route queries intelligently. Here's what we learned building a production LLM system that reduced complaint resolution time from 48 hours to 6 hours.

## The Problem Space

Our customers were submitting complex complaints through multiple channels:
- Email
- Chat
- Voice calls (via Whisper AI transcription)
- Web forms

Each complaint needed to:
1. Be classified by intent and urgency
2. Have key information extracted
3. Be routed to the appropriate team
4. Generate an initial response

Doing this manually was slow and error-prone.

## Architecture Design

We built a multi-stage pipeline using RASA as the core framework, enhanced with BERT embeddings for better intent classification.

[Rest of content...]
